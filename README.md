# agy-gemini-mcp

[Русская версия](README.ru.md)

An MCP server that lets Claude Code hand work to Gemini through the Antigravity CLI (`agy`), using
a Google AI Pro subscription instead of an API key. Claude is the boss: it writes the task, reads
what Gemini produced, and sends corrections. Gemini does the heavy lifting (writing code, drawing
images), so your Claude limits go mostly to reviewing.

This project is not affiliated with Google or Anthropic. Read the "Risks" section before you use it.

## Why Antigravity CLI and not Gemini CLI

Google stopped serving Gemini CLI to individual accounts (including Google AI Pro) on 18 June 2026
([discussion](https://github.com/google-gemini/gemini-cli/discussions/28017),
[report](https://9to5google.com/2026/06/17/gemini-cli-code-assist-shutting-down/)). The replacement is
the Antigravity CLI, binary name `agy`. It signs in with your Google account and has a
[headless mode](https://antigravity.google/docs/cli/headless/) (`agy -p "..."`), which is what this
server drives.

## Setup

1. Install Antigravity CLI from [antigravity.google](https://antigravity.google/).
2. Use a Google account that has a Google AI Pro subscription.
3. Run `agy` once in a terminal and sign in with that account.

### Regions where Antigravity is not available

Antigravity is not offered in every country. We saw two separate layers: a local check inside `agy`
("not currently available in your location") and a server-side check by IP address, where Google
answers `User location is not supported for the API use` (HTTP 400). In our test, removing the local
check was not enough: the server-side answer stayed the same until the network path to Google was
fixed. Other users report that Google traffic excluded from a VPN tunnel, DNS servers of the local
provider, and VPN servers that Google treats as data-center addresses cause this
([Meduza](https://meduza.io/en/news/2026/08/14/gemini-s-vpn-workaround-stops-working-for-some-users-in-russia),
[Habr discussion](https://habr.com/en/articles/1017738)); these are anecdotes, not guarantees.
You can check which country Google sees from the terminal that runs `agy` with
`curl https://ipinfo.io/country`.

This project does not provide, link or endorse tools or services for getting around regional limits.
Whether and how to use any of them is your decision and your risk.

### Install the server

```bash
git clone https://github.com/velime/agy-gemini-mcp
cd agy-gemini-mcp
npm install
claude mcp add --scope local agy -- node /absolute/path/to/agy-gemini-mcp/server.mjs
```

`--scope local` enables it only for the current project. Use `--scope user` to enable it
everywhere. Restart Claude Code afterwards. To check that everything works end to end (this makes
two small real requests to Gemini):

```bash
node selftest.mjs
```

Optional: copy `skills/gemini-image-loop` into `.claude/skills/` of your project (or
`~/.claude/skills/`) to get the image workflow described below.

Settings (environment variables): `AGY_PATH` (path to the `agy` binary, found automatically on
Windows), `AGY_WORK_ROOT` (the only folder Gemini may work in, default `~/gemini-work`).

## How it works inside

Three tools:

- `agy_run(prompt, workdir, conversation_id?, model?, effort?, mode?, timeout_min?)` starts a Gemini job
  and returns a `job_id` immediately.
- `agy_result(job_id, wait_s?)` waits up to 45 seconds and returns the status, Gemini's answer,
  `conversation_id` and token usage, or `state: running` if it is still working.
- `agy_cancel(job_id)` kills a job.

Details that matter:

- Each job runs `agy --output-format json --dangerously-skip-permissions -p "<prompt>"` with the work
  folder as the current directory. Jobs are asynchronous because a Gemini job takes minutes.
- agy's output goes to a file, not to a pipe. A third-party report says agy print mode on Windows can
  return nothing when stdout is a pipe ([gist](https://gist.github.com/allahsan/a9a9e9c8a49aecede67ce974e64ef3cf)),
  and quota errors can look like success. The server treats "exit code 0 but no JSON" as an error.
- Pass the `conversation_id` from a result into the next `agy_run` and Gemini continues the same
  session. This is how corrections work: Gemini remembers what it did.
- Prompts longer than 6000 characters are written to `TASK.md` in the work folder, because of the
  Windows command-line limit.
- The work folder must be inside `AGY_WORK_ROOT`. This is a guard against mistakes, not a sandbox: agy
  runs with auto-approve, so Gemini can in principle run commands that touch other places.
- Jobs are kept in memory only; restarting the server forgets running jobs.

## Using Gemini for code, with Claude as the reviewer

Give Claude an instruction like this (or put it in `CLAUDE.md`):

> For big coding tasks, do not write the code yourself. Delegate with the `agy` tools: write a brief with
> concrete acceptance criteria, run it with `agy_run` in a folder under the work root, read the result
> and the files Gemini produced, run the tests, and send exact corrections into the same conversation
> with `conversation_id`. Stop after 5 rounds and report.

When it is worth it: large, write-heavy work (new modules, many files, boilerplate, tests). Claude
spends tokens on the brief and the review instead of on generating hundreds of lines. This is an
estimate, not a measurement: roughly 2 to 4 times less Claude usage on such tasks.
When it is not: small fixes in one or two files. Writing the brief, waiting minutes and reading the
answer costs more than just doing it.

Costs on the Gemini side, measured on our runs: a large first job (a 550-line tool with tests) took 14
minutes and about 420k tokens; a small, narrowly worded job (a 54-line tool with tests) took 27 seconds
and 57k tokens; a follow-up fix in the same conversation took 40 seconds to 2 minutes. Your Google
quota is the new bottleneck, so keep tasks focused.

Why jobs can be slow, found by reading agy's own step log (`~/.gemini/antigravity-cli/conversations`):
- Exploration and scratch scripts. If the brief invites it ("match the real HTML", "be exact"), the
  agent runs dozens of experiments. For the 550-line job, 31 Python scripts and 35 file reads and writes.
  Ask for the work directly: "write the files directly, do not explore, no scratch files, run the tests
  once".
- Long generation. Writing big files with a thinking model is slow (33k thinking tokens in that job).
  `effort: low` removes most of the thinking.
- API stalls. In that job 300 of the 966 seconds were one "stream idle timeout (5m0s)" followed by an
  automatic retry. The job still finishes, so a status of `ERROR` with a complete answer is possible.
  The server returns the cause in `agy_error`. Nothing on our side can prevent this; it is the
  service. Earlier jobs showed a similar loss to an `INTERNAL (code 500)` error.

Gemini works in a folder under the work root. To let it edit a real project, either copy the project
there and merge the result after review, or set `AGY_WORK_ROOT` to the folder that holds your projects
(riskier, because of auto-approve).

## Images: Gemini draws, Claude directs

Gemini generates images inside `agy` through its built-in image generator, with no API key (we
checked: a red apple on white, a mug with text). It is weak at following a brief:

- text inside the image is often wrong or garbled;
- counts of objects and "do not draw X" are often ignored;
- every correction redraws the whole picture. Asked only to recolor a mug from blue to red, it also
  changed the background and the room.

So Claude acts as an art director (skill `gemini-image-loop`). It turns your request, in any language,
into a checklist and an English prompt that Gemini can follow: the meaning stays yours, but details are
made concrete (subject, framing, lighting, background, what must not appear). It sends the prompt to
Gemini, looks at the PNG itself, and checks it against the checklist. Where the image is wrong, Claude
rewrites the prompt at exactly those places (more detail, clearer wording, everything else unchanged)
and sends the full revised prompt again. Up to 5 iterations, and it stops to ask you after 3 failed
tries in a row. When Claude judges the image correct, it shows it to you and asks whether it is right.
Each look at an image costs some Claude usage, hence the cap.

Speed: keep prompts short. We measured the same photo edit twice. A long prompt that demanded that
everything else stay "exactly" the same made Gemini's agent run 42 Python/Pillow steps (palette
extraction, array diffs, compositing) and take 9+ minutes. A short prompt that said "use only your image
generation tool, do not use Python or any image library" took 79 seconds and about a quarter of the
tokens. The skill is written this way.

The same loop edits an existing photo. Gemini only sees files in its work folder, so Claude copies your
photo there as `input.png` (a photo you attach in the Claude chat is saved by the client to a file whose
path Claude sees; a photo from a folder is copied from there; the original is never touched), looks at
it, and writes a prompt that says what to keep and what to change. We checked it: given an apple photo,
Gemini added a ribbon to the stem and left the apple, leaf, background, framing and lighting as they were.

## Tournament skill (optional)

If you want Gemini competitors to attack each other's answers and pick the best one, see the separate
repository [gemini-arena-skill](https://github.com/velime/gemini-arena-skill). It is expensive in
Gemini quota, so it is a separate, optional install.

## Risks

- Terms of service. Using Antigravity from a region where it is not offered, or with a subscription you
  did not buy from Google, may violate Google's terms. The account can be limited or banned. Use an
  account you can afford to lose.
- `--dangerously-skip-permissions` means Gemini can run commands without asking. Keep `AGY_WORK_ROOT`
  away from anything you care about.
- Quota: heavy use can exhaust your daily Google limit. The server reports quota errors instead of
  retrying.
- Everything here is provided as is, without warranty.

## License

MIT, see [LICENSE](LICENSE).
