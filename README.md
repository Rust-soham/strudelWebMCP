# Strudel WebMCP Lab

**An AI agent does not merely fill in a music editor—it uses the website as an instrument, listens through deterministic measurements, preserves every attempt, and improves its live-coded composition in a visible loop.**

[Launch the live demo](https://strudel-web-mcp.vercel.app/) · [Inspect the WebMCP tools](src/adapters/webmcp/register-workspace-tools.ts)

## The problem

Music software is built for humans to operate manually. An agent can suggest code in chat, but it normally cannot place that code in the musician's real workspace, render the audible result, inspect what changed, or safely return to a better earlier attempt. The human becomes a clipboard and repeatedly carries code and feedback between the model and the instrument.

Strudel WebMCP Lab removes that handoff. The musician supplies a creative goal and an optional reference recording. The browser agent operates the same Strudel editor the musician sees, while the website owns audio capture, comparison, and durable version history.

## Why WebMCP is essential

This experience depends on a browser-native action-and-observation loop:

```text
human provides intent and reference
  → agent reads the live workspace
  → agent writes Strudel into the visible editor
  → website evaluates and records the master output
  → website returns acoustic measurements
  → agent revises its program without another user prompt
  → human can hear, inspect, restore, and steer every checkpoint
```

Without WebMCP, the agent could produce a one-shot code suggestion but could not operate the live instrument or consume structured evaluation results. With WebMCP, the page exposes six semantic tools through `document.modelContext.registerTool(...)`; no embedded agent, hidden backend, or pixel-driven browser automation is involved.

## What humans and agents can do together

- A musician describes a sound or attaches a reference; the agent turns that intent into executable Strudel.
- The agent performs several write → render → evaluate iterations from one prompt.
- Every successful render becomes an immutable checkpoint containing code, captured audio, measurements, observations, and lineage.
- The musician and agent can inspect the same history, restore an older attempt, and create a new branch without deleting later work.
- Reference audio and the active branch survive reload through browser-local IndexedDB.

In browser testing, one prompt produced four consecutive revisions (`a3`–`a6`) as the agent reacted to each tool result. A separate reload test restored `a3` into the editor and successfully committed `a4` with `parentId: "a3"`—demonstrating durable agent-operable branching rather than a decorative history list.

## Judge walkthrough

The core interaction takes about 90 seconds after the reference is loaded:

1. Open the [live demo](https://strudel-web-mcp.vercel.app/) in ChatGPT's in-app browser, or Chrome 149+ with `chrome://flags/#enable-webmcp-testing` enabled.
2. Upload a short recording you created or otherwise have permission to use. Analysis uses its first 10 seconds; the full file remains playable.
3. Press **Play** once to satisfy the browser's Web Audio user-gesture requirement, then press **Stop**.
4. Give the browser agent the same recording as prompt context and paste:

```text
Use the attached audio's first 10 seconds as the reconstruction target.

Use Website Tools only. Do not use visual UI automation or edit repository files.

Starting from the current checkpoint, repeatedly:
1. Inspect the workspace state.
2. Revise the Strudel program from the latest measurements and observations.
3. Call write_program.
4. Call evaluate_attempt.
5. Use the returned feedback to begin the next iteration yourself.

Continue for up to three checkpoints. Do not ask me to prompt between attempts.
When finished, report every checkpoint's similarity and explain each revision.
```

5. Watch the editor change and each checkpoint appear. Select an older checkpoint in the timeline—or ask the agent to call `checkout_checkpoint`—then create a branch from it.
6. Refresh the page. The reference, checkpoint history, selected branch, exact editor code, captured audio, and comparison are restored.

> Use only original, public-domain, or properly licensed audio in recordings and submission materials.

## WebMCP implementation

| Website tool          | Agent capability                                                  | Visible consequence                                         |
| --------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| `get_workspace_state` | Read the draft, reference readiness, operation, and active branch | Grounds the agent in the same state as the musician         |
| `write_program`       | Replace the Strudel draft                                         | Code changes in the live editor                             |
| `evaluate_attempt`    | Evaluate, capture four cycles, compare, and commit                | Audio plays and a checkpoint appears                        |
| `list_checkpoints`    | Read compact history and lineage                                  | Enables deliberate iteration planning                       |
| `inspect_checkpoint`  | Recover exact code and acoustic feedback                          | Lets the agent compare earlier decisions                    |
| `checkout_checkpoint` | Restore an immutable attempt as the active parent                 | Editor, audio, comparison, and branch point change together |

The registrations are intentionally task-level rather than wrappers around DOM methods. Tool inputs are parsed at the page boundary, expected failures return stable serializable envelopes, read-only tools are annotated, and registration follows an `AbortSignal` lifecycle so React remounts do not leave duplicate tools.

## Product execution

- **Shared instrument:** `@strudel/repl` supplies the editor, synthesis engine, native event highlighting, and playback.
- **Audible evaluation:** `MediaRecorder` taps Strudel's post-effects master output and captures complete musical cycles.
- **Comparable media:** Mediabunny decodes both uploaded and captured containers into mono 16 kHz PCM.
- **Deterministic feedback:** the first analyzer measures relative energy contour and loudness over the first 10 seconds.
- **Durable iteration:** IndexedDB stores code, audio blobs, comparisons, parent links, and branch-head metadata. Checkpoint and head updates share one atomic transaction.
- **Typed boundaries:** `better-result` distinguishes evaluation, capture, normalization, analysis, cancellation, stale-parent, and persistence failures.

```text
React composition root
├── StrudelReplWorkspace
├── StrudelAttemptRenderer
├── BrowserReferenceRepository
├── MediabunnyAudioNormalizer
├── EnergyEnvelopeAnalyzer
├── IndexedDbCheckpointRepository
└── WebMCP adapter → document.modelContext.registerTool(...)
```

## Potential impact

The music demo represents a broader interaction pattern for creative production software. Agents become more useful when an application exposes meaningful operations and domain observations—not just buttons or raw document mutation. The same structure can support graphics, CAD, animation, video editing, simulation, and other environments where good work emerges through repeated action, evaluation, comparison, and rollback.

For musicians specifically, this turns AI assistance from one-shot generation into inspectable collaboration. The human retains the live instrument and audible judgment; the agent handles rapid structured experimentation; checkpoint lineage makes the process reversible and legible.

## Creativity and ambition

Most agent integrations end when content is inserted. Strudel WebMCP Lab treats creative work as a stateful feedback process: the website captures the consequence of an agent action, converts it into observations the agent can reason over, and lets both participants navigate the resulting history. The result is closer to an agent using a studio than an agent filling a text box.

The current deterministic analyzer deliberately remains small and honest. It proves the feedback architecture without claiming that loudness contour equals musical understanding. Tempo, onset alignment, chroma, and spectral-profile analyzers can be added behind the same comparison port without changing the WebMCP workflow.

## Run locally

Requirements: Node.js and pnpm 11.

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173/` in a WebMCP-enabled browser. Run all checks with:

```bash
pnpm check
pnpm build
```

The test suite covers domain orchestration, Strudel workspace behavior, WebMCP registration and input parsing, audio analysis, branch restoration, and IndexedDB durability/atomicity.

## Current limitations

- Similarity currently reflects energy contour and loudness, not complete musical resemblance; different rhythm, harmony, or timbre can receive similar scores.
- A user must press **Play** after opening or refreshing the page before agent-triggered capture because browsers gate Web Audio behind user activation.
- Reference audio and checkpoints are private to the current browser origin; there is no account or cloud synchronization.
- Reference-free composition works through `write_program`, but `evaluate_attempt` requires reference audio by design.
- WebMCP is experimental and must be enabled in a compatible browser or agent environment.
