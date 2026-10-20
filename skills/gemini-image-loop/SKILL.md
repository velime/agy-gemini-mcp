---
name: gemini-image-loop
description: >-
  Get an exact image out of Gemini by iterating on the prompt: rewrite the user's request
  into an English prompt Gemini understands (same meaning, more concrete detail), send it to
  Gemini through the `agy` MCP server (Google AI Pro login, no API key), look at the PNG
  yourself, and when it is wrong rewrite the prompt where the flaws are and send it again, up
  to 5 times. Also edits an existing photo (from the chat or a folder). Use when the user wants
  an image, picture, logo, illustration, mockup or photo edit made by Gemini, or says Gemini keeps
  misunderstanding what to draw.
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
- Keep the prompt short and plain: what to draw or change, and in a few words what to leave as it is.
  Do NOT demand "exactly", "pixel-identical" or "nothing else may change", and do not write a long
  keep-list. Measured on one task: with such a prompt Gemini's agent ran 42 Python/Pillow steps (palette
  extraction, face location, array diffs, compositing) and took 9+ minutes; with a short prompt that
  said "use only your image generation tool, do not use Python or any image library" the same edit took
  79 seconds and a quarter of the tokens. The image sub-agent itself is fast; the time goes into the
  pixel-level post-processing that strict wording triggers.
- Always add this line to every prompt: "Use only your image generation tool for this. Do not use
  Python or any image library, and do not post-process the result."
- Gemini may redraw parts you did not mention. Name the few things that matter (a face, a logo, the
  background) and accept small drift; if something important changed, say so in the next round.

`agy_run` with `workdir: img-<short-name>`, `timeout_min: 10` and a prompt of this shape:

```text
Generate an image with your image generation ability and save it as
v1.png (PNG) in the current directory.

<the image prompt, version 1>

Use only your image generation tool for this. Do not use Python or any image library, and do not
post-process the result. Reply with the file path and one line on what you drew.
If you cannot generate the image, reply exactly CANNOT and say why.
```

Then `agy_result` (wait_s 45, repeat while `state` is `running`). Keep the `conversation_id` from the
result.

If `status` is not SUCCESS, or the result has `error`, `stderr` or `raw_stdout` about quota (429,
RESOURCE_EXHAUSTED) or region ("location is not supported"): stop and tell the user. Do not loop
against a quota error.

## Editing an existing photo instead of drawing from scratch

Same loop, but the starting point is the user's photo. Verified: given `input.png` in the work folder,
Gemini edits it (a ribbon added to an apple, everything else unchanged).

Getting the photo to Gemini: Gemini can only see files in its work folder, so copy the photo in as
`input.png` (more photos: `input-2.png`, ...) and never point the work folder at the user's own
folder. Copy, do not move: the original stays untouched.
- The user pasted or attached the photo in the chat: the client saves it to a file and shows its path
  with the message (for example `[Image: source: C:\...\images\1.png]`). Copy that file into the work
  folder. If no path is shown, ask the user to give the file path or to drop the file into the work folder.
- The photo is in a folder: copy it from there.

Before writing the prompt, Read the photo yourself so you know what is in it. The prompt then says what
to keep and what to change:

```text
Edit the image input.png in the current directory: <the edit, concrete and visual, one or two
sentences>. Leave the rest of the picture as it is<, including the few things that matter>. Save the
result as v1.png in the current directory. Do not overwrite input.png. Use only your image generation
tool for this. Do not use Python or any image library, and do not post-process the result. Reply with
the file path and one line on what you changed. If you cannot edit an existing image and can only
draw from scratch, reply exactly CANNOT-EDIT and say why.
```

Rules from Step 2 still apply (English prompt, short, meaning is the user's, no "exactly", no Python).
Reference images (a logo or character the user wants copied) go into the work folder too, as
`ref-<name>.png`, and the prompt says "the character shown in ref-<name>.png" plus a one-line plain
description of it. In Step 3, also compare with `input.png`: whatever mattered must be unchanged; small
drift elsewhere (a different output size, slightly redrawn details) is expected and not a failure.
Step 4 rewrites the prompt as usual.

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
only to recolor a mug, it also changed the background and the room), so name the few
parts that matter in the prompt itself instead of relying on Gemini's memory of the last image (still
short, see Step 2). The meaning
stays the user's: you are making the prompt clearer, not changing the request.

Send the full revised prompt with `agy_run` (same `workdir`, new file name `v<N+1>.png`), in the same
conversation by default (pass the `conversation_id`). If the same flaw survives two rewrites, start a
fresh conversation (no `conversation_id`) with the reworded prompt, because Gemini may be anchored on
its earlier attempts.

Limits: at most **5 iterations** in total (v1 counts as the first). At most **3 tries in a row**
without the user's OK: after the third failed check, show the user the latest image path, what is
still wrong, and ask whether to continue, change the request, or stop. After the 5th, stop and report.
When you think the image matches, do not just finish: show it and ask the user whether it is right or
needs changes. The user decides when it is done.

## Step 5: report

Give the user the image itself (attach or display the PNG wherever the client allows it, not only its
path) and: the final file path (`<workdir>/v<N>.png`), the acceptance list with a pass or fail per
point, how many iterations it took, and any point that never passed. If the prompt grew details the
user did not mention, say which. Then ask whether it is right or needs changes. If the image should go
into the user's project, ask before copying it there.

## Rules

- You judge every image yourself; never ask Gemini whether its image is good.
- Same work folder for the whole loop, new file name per version (`v1`, `v2`, ...) so nothing is
  overwritten and the user can compare.
- The user's meaning never changes; only the clarity of the prompt does.
- Never use a workdir outside the work root. Gemini runs with auto-approve.
- Quota or region errors: stop and report; no retry loops.
