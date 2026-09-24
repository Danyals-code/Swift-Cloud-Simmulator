# Prompt-to-app creation

Open **the project menu (top left) → From a prompt**, choose OpenAI or Anthropic, enter a model ID and API key, and describe the app. Choose 1–6 pages (including details/forms/settings), navigation, accent color, sample content, and an optional settings page. Generate, review the files and preview check, then open the draft as a separate project.

The result is ordinary SwiftUI source. It can be edited visually or in code, previewed, shared, and exported with the existing tools. The creation prompt, options and AI summary are saved when the draft is opened.

## Prompt Editing

The left panel has **Layers** and **Prompt Editing** tabs (Files in the Code workspace). Select a view on the canvas to attach its source context above the composer; remove the tag to request an app-wide change. Open the connection settings to choose a provider/model and enter a key. Enter sends; Shift+Enter inserts a new line. Replies describe the changes in one short sentence.

Each request sends current Swift files, resource names, the last 24 successful conversation messages, and the optional selected source range. The `/api/edit` endpoint returns complete changed files and explicit deletions. File paths and project size are validated, then a disposable preview worker checks the candidate before any source is changed. A successful edit is one Undo step. Typing, switching projects, or otherwise changing the document while the request runs invalidates the result instead of overwriting newer work. Stop cancels the request.

The conversation is saved locally with the project, survives Undo/Redo, and reopens with an exported archive. Failed/cancelled attempts stay visible but are excluded from the next request's context. Keys stay only in component memory and clear when the panel is closed or the project changes. No provider request is made until Send. Prompt editing supports up to 256 input files / 600,000 source characters and 32 changed files per response; history is limited to 1,000 messages / 2 MB without silent truncation. Browser preview checks do not replace an Xcode build.

## Default export

**Export** downloads a complete Xcode ZIP with the original Swift files, project/scheme/assets, individual screen PNGs, the project's event log (`.swiftstudio/events.jsonl`), and a **Studio Report** folder containing `report.md`, `settings.json`, `screens.json`, `chat-history.md`, and `chat-history.json`. The report records deployment/signing defaults, preview settings, resources, designer metadata, capture diagnostics and limitations. It includes only conversation history actually saved in this project; earlier unsaved prompts cannot be recovered.

Screenshots are fresh 2× browser previews at the current device, appearance and text size, using starting app content. They include discoverable destinations/presentations and saved standalone screens, beyond the normal twelve-screen gallery cap. The export never refuses: a saved screen nothing draws any more, a preview that fails, and an image over the size limits are left out and listed under Known issues in `report.md`. Data-dependent routes still need native review. Code-only formats and separate image review remain in **Export options**.

## Data and credentials

- The API key exists only in the open creator component's memory. Closing the window or switching away clears it. Changing provider also clears it.
- A same-origin POST to `/api/generate` forwards the key to the selected provider's fixed HTTPS endpoint. Keys are not written to project storage, URLs, telemetry, or server logs by application code. Production hosting should not log authorization headers or request bodies.
- Each prompt, with its provider, model and options, and how the request ended are written to the project's event log, which every export carries. The key never is.
- Only the submitted description/options are sent for generation. The existing project is not included. Provider retention and billing policies still apply.
- OpenAI uses Responses with `store: false` and strict JSON schema; Anthropic uses Messages with `output_config.format`. There are no automatic retries, repair requests, or shared server credentials.
- Cancellation aborts the local request and upstream signal. It cannot undo tokens the provider has already processed.

## Validation and limits

Input is bounded to 6,000 prompt characters and six pages. The endpoint accepts 1–24 Swift files under `Sources/`, rejects unsafe/colliding paths and oversized/empty content, checks page references and one matching app entry point, and handles incomplete/refused responses before a draft can be opened.

A disposable instance of the existing compiler worker evaluates the first screen, with a 12-second timeout. It cannot modify the active project's runtime. A passing first screen is not a guarantee that every route or native Xcode compilation works. Issues are listed before opening; the user can open a draft to correct them. Source is rendered as escaped text, never executed as JavaScript.

Imported and generated projects are retained even when untouched. Only an unchanged project explicitly created from a catalog template is eligible for automatic removal when replaced. Existing projects without recorded template provenance are kept conservatively.

## Deployment

Requires a Next.js server or Vercel deployment; a static-only host cannot serve the generation endpoint. No server API-key environment variable is needed. The route allows up to 180 seconds; check the hosting plan's actual execution timeout. Models are editable because account access and available models vary.

Defaults: `gpt-5.4-mini` and `claude-sonnet-5`. Provider documentation consulted September 17, 2026:

- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI model](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
- [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Anthropic models](https://platform.claude.com/docs/en/models/overview)

## Checks

Unit tests cover provider request formats, credentials, foreign origins, request limits, unsafe output, refusals, incomplete responses, cancellation, and sanitized errors. Playwright fixtures cover review/open, failed requests, and cancellation without spending API credits. A real API key is required for a live-provider check; it is deliberately not part of CI.

The gallery now contains seven complete apps and 18 feature examples. Dispatch adds task management, creation, activity, and preferences; Market adds browsing, favorites, quantity changes, checkout, and order history. Both use local data, shared observable state, and native adaptive controls.

The total gzipped client budget was 470 KB at this release (measured about 457 KB), which accommodated the two apps and the lazy-loaded prompt/review feature. It is 600 KB now, raised by decision after the design tools took the old ceiling to 99%. The largest initial chunk is the gate that still describes the critical path, and it keeps its 172 KB ceiling (about 166 KB measured).
