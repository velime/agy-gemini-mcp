---
name: gemini-image-loop
description: >-
  Get an exact image out of Gemini by iterating: delegate generation to Gemini through
  the `agy` MCP server (Google AI Pro login, no API key), look at the PNG yourself, say
  precisely what is wrong, send the correction into the same Gemini session, repeat up to
  5 times. Use when the user wants an image, picture, logo, illustration or mockup made
  by Gemini, or says Gemini keeps misunderstanding what to draw.
argument-hint: "<what to draw, plus any must-haves>"
---

# gemini-image-loop

Gemini draws with its image sub-agent when asked inside `agy` (verified: it saves a PNG into the
working folder). It often misreads the brief, so you act as the art director: you look at every
result, write concrete corrections, and keep going in the same Gemini conversation until the image
matches. You never draw. All generation costs Gemini quota, not Claude limits; each look at an image
costs some of yours, so the loop is capped.

What the user asked for: `$ARGUMENTS`. If blank, take it from the conversation.

## Tools

The `agy` MCP server: `agy_run`, `agy_result`, `agy_cancel` (tool names may carry a prefix like
`mcp__agy__`; load them with ToolSearch if deferred). If they are missing, the server is not
registered for this session: tell the user to register it (see the repo README) and restart Claude Code.

Work folder: `img-<short-name>` under the server's work root (`AGY_WORK_ROOT`, default
`~/gemini-work`). The server creates it, returns its absolute path as `workdir`, and refuses anything
outside the root. agy runs with that folder as its current directory, so the prompt can say "save as
v1.png in the current directory". Read the result PNG with the Read tool (`<workdir>/v1.png`); it
shows you the image.

## Step 1: write the acceptance list

Before the first call, turn the request into 3 to 8 checkable points, in the user's words where
possible: subject, composition, style, colors, text in the image (exact spelling), aspect ratio,
what must be absent. Do not invent requirements. Show the list to the user only if the request was
vague; otherwise just use it.

## Step 2: first generation

`agy_run` with:
- `workdir`: `img-<short-name>`
- `prompt`: the template below, filled in
- `timeout_min`: 10

```text
Generate an image with your image generation ability and save it as
v1.png (PNG) in the current directory.

What to draw:
<the request, plain and concrete>

It is correct only if ALL of these are true:
1. <point>
2. <point>
...

Do not describe the image back to me. Reply with the file path and one line on what you drew.
If you cannot generate the image, reply exactly CANNOT and say why.
```

Then `agy_result` (wait_s 45, repeat while `state` is `running`). Keep the `conversation_id` from the
result: every later call passes it so Gemini remembers what it drew.

If `status` is not SUCCESS, or the result has `error`, `stderr` or `raw_stdout` about quota (429,
RESOURCE_EXHAUSTED) or region ("location is not supported"): stop and tell the user. Do not loop
against a quota error.

## Step 3: look and judge (you, not Gemini)

Read `v<N>.png`. Check every acceptance point, one by one, honestly. Common Gemini failures: text in
the image misspelled or garbled, wrong count of objects, ignored negative ("no people"), wrong
aspect ratio, style drift, extra watermark or border, cropping. If all points hold: done, go to
Step 5.

## Step 4: correction call

`agy_run` again with the same `workdir` and `conversation_id`, `prompt`:

```text
Version v<N> is not right. Make v<N+1>.png in the current directory.
Keep: <what was good, so it is not lost>.
Fix exactly these, nothing else:
- <point failed>: <what you see> -> <what it must be>
- ...
Reply with the path and one line on what you changed.
```

Gemini redraws the whole picture on every call (observed: asked only to recolor a mug, it also changed the
background and room). So in `Keep:` list everything that must stay: subject, background, camera angle,
framing, lighting, other objects. Anything not listed may change.

Be specific and visual ("the headline reads 'Sale 50%'; it must read 'SALE -50%'", not "fix the text").
One fix list per call. Never resend the whole original brief; the conversation already has it. If
Gemini repeats the same mistake twice, change the wording of that point (say it positively, give an
example, or split a complex scene), do not just repeat louder.

Limits: at most **5 iterations** in total (v1 counts as the first). At most **3 tries in a row**
without the user's OK: after the third failed check, show the user the latest image path, what is
still wrong, and ask whether to continue, change the brief, or stop. After the 5th, stop and report.

## Step 5: report

Give the user: the final file path (`<workdir>/v<N>.png`), the acceptance
list with a pass or fail per point, how many iterations it took, and any point that never passed.
If the image should go into the user's project, ask before copying it there.

## Rules

- You judge every image yourself; never ask Gemini whether its image is good.
- Same `conversation_id` for the whole loop, same work folder, new file name per version (`v1`, `v2`,
  ...) so nothing is overwritten and the user can compare.
- Never use a workdir outside the work root. Gemini runs with auto-approve.
- Quota or region errors: stop and report; no retry loops.
