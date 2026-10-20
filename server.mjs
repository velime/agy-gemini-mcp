// MCP server: lets Claude delegate work to Antigravity CLI (agy) using the user's Google AI Pro login.
// Jobs run async: agy_run starts one, agy_result waits/polls. agy stdout goes to a FILE, not a pipe,
// because agy print mode on Windows can return nothing when stdout is a pipe.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AGY = process.env.AGY_PATH ?? (process.platform === "win32"
  ? path.join(os.homedir(), "AppData", "Local", "agy", "bin", "agy.exe")
  : "agy");
// agy runs with auto-approve, so keep it inside this folder (override with AGY_WORK_ROOT).
const ROOT = path.resolve(process.env.AGY_WORK_ROOT ?? path.join(os.homedir(), "gemini-work"));
const TMP = path.join(os.tmpdir(), "mcp-agy");
const MAX_ARG = 6000; // longer prompts go via TASK.md (Windows command line limit)
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(ROOT, { recursive: true });

const jobs = new Map(); // ponytail: in-memory only, jobs lost on server restart

const inside = (p) => {
  const r = path.resolve(ROOT, p);
  if (r !== ROOT && !r.startsWith(ROOT + path.sep)) throw new Error(`workdir must be inside ${ROOT}`);
  return r;
};

function start({ prompt, workdir, conversation_id, model, effort, mode, timeout_min }) {
  const cwd = inside(workdir);
  fs.mkdirSync(cwd, { recursive: true });
  let p = prompt;
  if (p.length > MAX_ARG) {
    fs.writeFileSync(path.join(cwd, "TASK.md"), p);
    p = "Read TASK.md in the current directory and do exactly what it says.";
  }
  const id = randomUUID().slice(0, 8);
  const outPath = path.join(TMP, `${id}.out`);
  const errPath = path.join(TMP, `${id}.err`);
  const out = fs.openSync(outPath, "w");
  const err = fs.openSync(errPath, "w");
  // --print consumes the next token as the prompt, so -p must be last.
  const args = ["--output-format", "json", "--dangerously-skip-permissions"];
  if (conversation_id) args.push("--conversation", conversation_id);
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  if (mode) args.push("--mode", mode);
  args.push("--print-timeout", `${timeout_min}m`, "-p", p);
  const job = { id, cwd, state: "running", started: Date.now(), outPath, errPath };
  const child = spawn(AGY, args, { cwd, stdio: ["ignore", out, err], windowsHide: true });
  const finish = (state, extra = {}) => {
    if (job.state !== "running") return;
    Object.assign(job, { state, ended: Date.now() }, extra);
    fs.closeSync(out);
    fs.closeSync(err);
  };
  const killer = setTimeout(() => { child.kill(); finish("timeout"); }, (timeout_min + 1) * 60_000);
  child.on("error", (e) => finish("error", { spawnError: String(e) }));
  child.on("exit", (code) => { clearTimeout(killer); finish("done", { code }); });
  job.child = child;
  jobs.set(id, job);
  return job;
}

function report(job) {
  const secs = Math.round(((job.ended ?? Date.now()) - job.started) / 1000);
  if (job.state === "running") return { job_id: job.id, state: "running", elapsed_s: secs };
  const read = (f) => { try { return fs.readFileSync(f, "utf8").trim(); } catch { return ""; } };
  const raw = read(job.outPath);
  const stderr = read(job.errPath);
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* not json */ }
  const res = { job_id: job.id, state: job.state, elapsed_s: secs, workdir: job.cwd };
  if (parsed) Object.assign(res, { status: parsed.status, conversation_id: parsed.conversation_id, response: parsed.response, usage: parsed.usage });
  else res.raw_stdout = raw.slice(0, 4000);
  if (stderr) res.stderr = stderr.slice(-2000);
  if (job.spawnError) res.error = job.spawnError;
  // exit 0 with empty output is the known silent-failure mode (quota, bad auth)
  if (!parsed && job.state === "done") res.error = "agy returned no JSON (quota exhausted, auth, or region?). See stderr/raw_stdout.";
  return res;
}

const txt = (o) => ({ content: [{ type: "text", text: JSON.stringify(o, null, 2) }] });
const server = new McpServer({ name: "agy", version: "0.1.0" });

server.tool(
  "agy_run",
  `Delegate a task to Gemini via Antigravity CLI (runs with auto-approve, inside ${ROOT}). Returns job_id immediately; fetch the answer with agy_result. Pass conversation_id from a previous result to continue the same session (feedback loop).`,
  {
    prompt: z.string().describe("Full task for Gemini, including acceptance criteria."),
    workdir: z.string().describe(`Folder (relative to ${ROOT}, or absolute inside it). Created if missing.`),
    conversation_id: z.string().optional(),
    model: z.string().optional().describe("agy model slug; omit for default"),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    mode: z.enum(["accept-edits", "auto", "plan"]).optional(),
    timeout_min: z.number().int().min(1).max(120).default(30),
  },
  async (a) => {
    try { const j = start(a); return txt({ job_id: j.id, workdir: j.cwd, state: "running" }); }
    catch (e) { return { isError: true, content: [{ type: "text", text: String(e.message ?? e) }] }; }
  },
);

server.tool(
  "agy_result",
  "Get a job's result. Waits up to wait_s seconds for it to finish; if still running returns state=running, call again.",
  { job_id: z.string(), wait_s: z.number().int().min(0).max(50).default(45) },
  async ({ job_id, wait_s }) => {
    const job = jobs.get(job_id);
    if (!job) return { isError: true, content: [{ type: "text", text: `unknown job ${job_id}` }] };
    const end = Date.now() + wait_s * 1000;
    while (job.state === "running" && Date.now() < end) await new Promise((r) => setTimeout(r, 500));
    return txt(report(job));
  },
);

server.tool("agy_cancel", "Kill a running job.", { job_id: z.string() }, async ({ job_id }) => {
  const job = jobs.get(job_id);
  if (!job) return { isError: true, content: [{ type: "text", text: `unknown job ${job_id}` }] };
  job.child.kill();
  return txt({ job_id, killed: true });
});

await server.connect(new StdioServerTransport());
