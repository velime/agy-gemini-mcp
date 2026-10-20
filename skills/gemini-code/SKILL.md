---
name: gemini-code
description: >-
  Delegate coding work to Gemini through the `agy` MCP tools, sized to the task: tiny edits are done
  by Claude itself, small tasks go out as a short direct brief on low effort, large tasks get a full
  brief, more time and a heads-up to the user. Claude reviews the code, runs it, and sends short fixes
  into the same conversation. Use when the user wants Gemini to write or change code, or wants to
  save Claude usage on a coding task.
argument-hint: "<what to build or change>"
---

# gemini-code

Gemini writes, Claude reviews. The goal is to save Claude's usage without wasting the user's time, so
the first decision is how big the task is. Do not turn a small task into a big one: a long brief with
acceptance criteria and "be exact" wording makes Gemini explore, run scratch scripts and take many
minutes. Measured: a 54-line tool with tests took 27 seconds on a short brief with `effort: low`; a
550-line tool took 14 minutes on a long brief (31 scratch scripts, plus a 5 minute API stall).

What the user asked for: `$ARGUMENTS`. If blank, take it from the conversation.

Tools: `agy_run`, `agy_result`, `agy_cancel` (may be prefixed `mcp__agy__`; load with ToolSearch if
deferred). The work folder must be inside the server's work root (`AGY_WORK_ROOT`, default
`~/gemini-work`); the server returns the absolute `workdir`. Gemini runs with auto-approve.

## Step 0: size the task

| size | what it is | what you do |
| --- | --- | --- |
| tiny | one function, a one-file fix, a rename, a config change, anything you can finish in 2 or 3 tool calls | Do it yourself. A brief, minutes of waiting and a review cost more than the edit. Tell the user you did not delegate and why, in one line. |
| small | one new file or a small tool, up to about 150 lines, clear spec | Delegate: `effort: low`, `timeout_min: 10`, short direct brief (below). Expect under 2 minutes. |
| medium | a few files, up to about 500 lines, some unknowns | Delegate: default effort, `timeout_min: 20`, a brief with 4 to 8 acceptance points. Expect 5 to 10 minutes. |
| large | more than about 500 lines, needs looking at real data or an API, many files | Delegate: default effort, `timeout_min: 40`, full brief with acceptance criteria, and name the single thing it may look at. Say to the user up front: "this will take around 15 minutes". Expect an occasional 5 minute API stall. |

When unsure between two sizes, take the smaller one: a missing detail is cheap to fix in a follow-up in
the same conversation (seconds to 2 minutes), an oversized brief is not.

## Step 1: the brief

Write it in English. Say what to build, the interface (command line, function signatures), and the
few requirements that matter, one per line. Nothing else: do not add requirements the user did not
give, no essays, no "exactly" or "in every case".

For small tasks end the brief with: "Write the files directly. Do not explore, do not create scratch or
helper files, do not use the network. Run the tests once at the end. Reply in at most 3 lines: the files
and the test result."

For medium and large tasks add the acceptance points, tests to write, and what it may look at. Keep
"do not create scratch files outside the work folder".

Call `agy_run` with the `workdir` (a new folder per task), the brief, `effort` and `timeout_min` from the
table. Then `agy_result` with `wait_s: 50`, repeated while `state` is `running`. Say nothing to the user
between polls.

## Step 2: if it takes much longer than expected

If a job runs past twice the expected time, look at the work folder (file names and times). New files
mean it is working: keep waiting. If the result later has `agy_error` (for example a
`stream idle timeout`), the job lost time to an API stall and retried; that is the service, not your
brief. Cancel only if nothing changes in the folder for 10 minutes, then retry once with a narrower brief.

## Step 3: review (you, not Gemini)

Never trust Gemini's own report. Read the code before running anything: imports, file and network
access, anything that executes input. Then run the tests yourself, run the tool on a real input, and probe
what a brief like yours tends to miss: empty input, non-ASCII text (for example Ukrainian letters),
a file that is not UTF-8, a missing file, large input, bad arguments. Compare with the requirements
the user gave.

## Step 4: fixes

Send a short list of exact problems into the same conversation (pass `conversation_id`): what you ran,
what happened, what must happen, and "fix only this, change nothing else, no scratch files". Use
`effort: low` for fixes. Then verify again yourself. At most 5 rounds; after that, report what is
left. Fixes in an existing conversation take seconds to 2 minutes.

## Step 5: report

Tell the user: where the files are (`<workdir>`), what you checked, which bugs you found and fixed, what
is still not covered, and how long and how many Gemini tokens it took (`usage` in the result). If the
code should go into the user's project, ask before copying it there.

## Rules

- The user's explicit wishes beat the defaults in this skill. If they ask for exact, thorough or
  fully specified work, a particular `effort`, or to delegate even a tiny edit, do it that way. Tell
  them in one line what it costs in time and Gemini tokens, then follow the request.
- Size first. Tiny means you do it.
- Short brief for small tasks, full brief only for large ones.
- Review every result yourself. Read before you run.
- Same `workdir` and `conversation_id` for the fix rounds.
- Quota (429, RESOURCE_EXHAUSTED) or region errors: stop and tell the user; no retry loops.
- Do not copy secrets, tokens or personal files into the work folder.
