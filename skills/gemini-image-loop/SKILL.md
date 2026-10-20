---
name: gemini-image-loop
description: >-
  Get an exact image out of Gemini by iterating on the prompt: rewrite the user's request
  into an English prompt Gemini understands (same meaning, more concrete detail), send it to
  Gemini through the `agy` MCP server (Google AI Pro login, no API key), look at the PNG
  yourself, and when it is wrong rewrite the prompt where the flaws are and send it again, up
  to 5 times. Use when the user wants an image, picture, logo, illustration or mockup made
  by Gemini, or says Gemini keeps misunderstanding what to draw.
argument-hint: "<what to draw, plus any must-haves>"
---

# gemini-image-loop

Gemini draws with its image sub-agent when asked inside `agy` (verified: it saves a PNG into the
working folder). It often misreads a brief, so you act as the art director. The user's request is
turned into a prompt Gemini can follow, you look at every result, and you keep improving the prompt
until the image matches. You never draw. All generation costs Gemini quota, not Claude limits; each
look at an image costs some of yours, so the loop is capped.

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

## Step 1: the acceptance list

Before the first call, turn the request into 3 to 8 checkable points, in the user's words where
possible: subject, composition, style, colors, text in the image (exact spelling), aspect ratio,
what must be absent. Do not invent requirements. Show the list to the user only if the request was
vague; otherwise just use it. You will check every image against this list.

## Step 2: write the prompt and generate

The prompt is a living text. You write version 1 now and improve it in later rounds.

How to write it:
- English, even when the user wrote in another language: translate it yourself. Text that must appear
  inside the image stays exactly as the user wants it, in its own language and spelling, in quotes.
- The meaning is the user's. Never change what the user asked for. You may add detail so Gemini
  understands: concrete subject, composition, camera angle, lighting, background, style, colors, and what
  must not appear. Add only detail that clarifies or pins down something the user left open; do not
  add ideas that change the result's meaning.
- Say things positively and concretely ("an empty white background") rather than as bare prohibitions.
- Anything you do not write down, Gemini may change or invent. This matters most in later rounds.

`agy_run` with `workdir: img-<short-name>`, `timeout_min: 10` and a prompt of this shape:

```text
Generate an image with your image generation ability and save it as
v1.png (PNG) in the current directory.

<the image prompt, version 1>

Do not describe the image back to me. Reply with the file path and one line on what you drew.
If you cannot generate the image, reply exactly CANNOT and say why.
```

Then `agy_result` (wait_s 45, repeat while `state` is `running`). Keep the `conversation_id` from the
result.

If `status` is not SUCCESS, or the result has `error`, `stderr` or `raw_stdout` about quota (429,
RESOURCE_EXHAUSTED) or region ("location is not supported"): stop and tell the user. Do not loop
against a quota error.

## Step 3: look and judge (you, not Gemini)

Read `v<N>.png`. Check every acceptance point, one by one, honestly. Common Gemini failures: text in
the image misspelled or garbled, wrong count of objects, ignored negative ("no people"), wrong
aspect ratio, style drift, extra watermark or border, cropping. If all points hold: done, go to
Step 5.

## Step 4: rewrite the prompt where the flaws are

Take the previous prompt and change it only at the places that explain the failed points:
- add the detail Gemini was missing ("a single mug, centered, filling about half the frame");
- reword a point it misread, saying it positively or with a concrete example;
- split a crowded scene into clearer parts, or move an important point to the start.

Leave every other sentence word for word. Gemini redraws the whole picture on every call (observed: asked
only to recolor a mug, it also changed the background and the room), so the parts that were good must
be pinned down in the prompt text itself, not left to Gemini's memory of the last image. The meaning
stays the user's: you are making the prompt clearer, not changing the request.

Send the full revised prompt with `agy_run` (same `workdir`, new file name `v<N+1>.png`), in the same
conversation by default (pass the `conversation_id`). If the same flaw survives two rewrites, start a
fresh conversation (no `conversation_id`) with the reworded prompt, because Gemini may be anchored on
its earlier attempts.

Limits: at most **5 iterations** in total (v1 counts as the first). At most **3 tries in a row**
without the user's OK: after the third failed check, show the user the latest image path, what is
still wrong, and ask whether to continue, change the request, or stop. After the 5th, stop and report.

## Step 5: report

Give the user the image itself (attach or display the PNG wherever the client allows it, not only its
path) and: the final file path (`<workdir>/v<N>.png`), the acceptance list with a pass or fail per
point, how many iterations it took, and any point that never passed. If the prompt grew details the
user did not mention, say which. If the image should go into the user's project, ask before copying it
there.

## Rules

- You judge every image yourself; never ask Gemini whether its image is good.
- Same work folder for the whole loop, new file name per version (`v1`, `v2`, ...) so nothing is
  overwritten and the user can compare.
- The user's meaning never changes; only the clarity of the prompt does.
- Never use a workdir outside the work root. Gemini runs with auto-approve.
- Quota or region errors: stop and report; no retry loops.
