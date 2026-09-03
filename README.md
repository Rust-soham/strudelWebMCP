# Strudel WebMCP Lab

A WebMCP-enabled live-coding workspace where an AI agent writes Strudel, captures the audible result, compares it with reference audio, and improves its work through durable checkpoints.

**Live demo:** [strudel-web-mcp.vercel.app](https://strudel-web-mcp.vercel.app/)

## Why WebMCP

The website is the instrument and evaluation environment. It registers task-level tools through `document.modelContext.registerTool(...)`; a browser-integrated agent discovers those tools and operates the same editor, audio engine, and history that the human sees.

There is no embedded agent or hidden backend orchestration. WebMCP closes the loop between agent reasoning and visible application state:

```text
creative goal or reference audio
  → agent writes Strudel
  → page evaluates and records four cycles
  → deterministic audio comparison
  → immutable checkpoint and structured feedback
  → agent revises the program
```

## Capabilities

- Native Strudel editor, playback highlighting, and Web Audio synthesis.
- One-time reference upload with comparisons limited to its first 10 seconds.
- Automatic capture of four complete Strudel cycles.
- Deterministic energy-envelope similarity and written observations.
- Immutable, playable checkpoints stored in IndexedDB.
- Checkpoint restoration and branching through both the visible timeline and WebMCP.
- Reference audio and active checkpoint restoration after page reload.

## Website tools

| Tool                  | Purpose                                                                              |
| --------------------- | ------------------------------------------------------------------------------------ |
| `get_workspace_state` | Read the visible draft, operation state, reference readiness, and active checkpoint. |
| `write_program`       | Replace the visible Strudel draft without evaluating it.                             |
| `evaluate_attempt`    | Evaluate, record four cycles, compare with the reference, and commit a checkpoint.   |
| `list_checkpoints`    | List compact checkpoint summaries and lineage.                                       |
| `inspect_checkpoint`  | Read one checkpoint's exact code, measurements, and observations.                    |
| `checkout_checkpoint` | Restore a checkpoint and make it the parent of the next attempt.                     |

## Try the reconstruction loop

1. Open the live demo in a browser with WebMCP website tools enabled.
2. Choose an audio file. The entire file remains playable, while analysis uses only the first 10 seconds.
3. Press **Play** once after opening or refreshing the page. Browsers require a user gesture before Web Audio can start.
4. Give the browser agent the same audio as prompt context and use a prompt such as:

```text
Use the attached song's first 10 seconds as the reconstruction target.

Use Website Tools only. Do not use visual UI automation or edit repository files.

Starting from the current checkpoint, repeatedly:
1. Inspect the workspace state.
2. Revise the Strudel program from the latest measurements and observations.
3. Call write_program.
4. Call evaluate_attempt.
5. Use the returned feedback to begin the next iteration yourself.

Continue for up to four new checkpoints, or stop early if similarity reaches 0.85.
When finished, report every checkpoint's similarity and explain why you stopped.
```

The timeline exposes every successful attempt. Select an older checkpoint to restore its code and audio; the next evaluation creates a new child from that point without deleting newer history.

## Reference-free composition

An agent can also translate a creative brief directly into Strudel with `write_program`. Do not call `evaluate_attempt` without a reference: the current evaluator intentionally requires reference audio and will return `ReferenceNotLoaded`.

## Local development

Requirements: Node.js and pnpm 11.

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173/` in a WebMCP-enabled browser.

Run the complete verification suite with:

```bash
pnpm check
pnpm build
```

## Architecture

- React owns visible application state and composes the adapters.
- `@strudel/repl` owns code evaluation, synthesis, highlighting, and playback.
- `MediaRecorder` captures Strudel's post-effects master output.
- Mediabunny decodes reference and attempt containers into normalized mono PCM.
- The analyzer returns measurements and observations; it never generates Strudel code.
- IndexedDB commits checkpoint audio, code, comparison, and branch-head metadata atomically.
- `better-result` keeps expected browser, audio, analysis, and persistence failures typed.

## Current limitations

- Similarity currently measures relative energy contours and loudness, not full musical resemblance. Different harmony, rhythm, and timbre can receive similar scores.
- Browsers may require **Play** to be pressed once after every refresh before an agent-triggered capture.
- Uploaded reference audio and checkpoint history remain local to the current browser origin.
- WebMCP is experimental and must be enabled in a compatible browser or agent environment.

The next meaningful analysis upgrades would be tempo, onset alignment, chroma, and spectral-profile comparisons.
