// Smoke test: node selftest.mjs  (run in a terminal that can see the user's agy login)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(process.env.AGY_WORK_ROOT ?? path.join(os.homedir(), "gemini-work"));
const client = new Client({ name: "selftest", version: "0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["server.mjs"] }));
const call = async (name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
const run = async (args) => {
  const { job_id } = await call("agy_run", args);
  for (;;) {
    const r = await call("agy_result", { job_id, wait_s: 45 });
    if (r.state !== "running") return r;
  }
};

const r1 = await run({ prompt: "Create hello.txt containing exactly the word banana. Then reply DONE.", workdir: "selftest", timeout_min: 5 });
console.log(r1);
assert.equal(r1.status, "SUCCESS");
assert.equal(fs.readFileSync(path.join(ROOT, "selftest", "hello.txt"), "utf8").trim(), "banana");

const r2 = await run({ prompt: "What word did you write into the file? Reply with that word only.", workdir: "selftest", conversation_id: r1.conversation_id, timeout_min: 5 });
console.log(r2);
assert.match(r2.response, /banana/i);

const bad = await client.callTool({ name: "agy_run", arguments: { prompt: "x", workdir: "../../outside" } });
assert.ok(bad.isError, "path escape must be rejected");
console.log("ALL OK");
await client.close();
