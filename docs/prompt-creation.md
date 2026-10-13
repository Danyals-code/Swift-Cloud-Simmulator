# Prompt-to-app creation

Open **the project menu (top left) → From a prompt**, choose OpenAI or Anthropic, enter a model ID and API key, and describe the app. Choose 1–6 pages (including details/forms/settings), navigation, accent color, sample content, and an optional settings page. Generate, review the files and preview check, then open the draft as a separate project.

The result is ordinary SwiftUI source. It can be edited visually or in code, previewed, shared, and exported with the existing tools. The creation prompt, options and AI summary are saved when the draft is opened.

## Prompt Editing

The left panel has **Hierarchy** and **Prompt Editing** tabs. Select a view on the canvas to attach its source context above the composer; remove the tag to request an app-wide change. Open the connection settings to choose a provider/model and enter a key. Enter sends; Shift+Enter inserts a new line. Replies describe the changes in one short sentence.

Each request sends current Swift files, resource names, the last 24 successful conversation messages, the optional selected source range, and up to 40 of the preview's current errors and warnings. The warnings tell the model what the preview does not draw, so it can choose something it does, or say the change will only show in Xcode. The `/api/edit` endpoint returns complete changed files and explicit deletions. File paths and project size are validated, then a disposable preview worker checks the candidate before any source is changed. A successful edit is one Undo step. Typing, switching projects, or otherwise changing the document while the request runs invalidates the result instead of overwriting newer work. Stop cancels the request.

The conversation is saved locally with the project, survives Undo/Redo, and reopens with an exported archive. Failed/cancelled attempts stay visible but are excluded from the next request's context. Keys stay only in component memory and clear when the panel is closed or the project changes. No provider request is made until Send. Prompt editing supports up to 256 input files / 600,000 source characters and 32 changed files per response; history is limited to 1,000 messages / 2 MB without silent truncation. Browser preview checks do not replace an Xcode build.

## Default export

**Export** downloads a complete Xcode ZIP with the original Swift files, project/scheme/assets, individual screen PNGs, and a **Studio Report** folder containing `report.md`, `settings.json`, `screens.json`, `chat-history.md`, and `chat-history.json`. The report records deployment/signing defaults, preview settings, resources, designer metadata, capture diagnostics and limitations. It includes only conversation history actually saved in this project; earlier unsaved prompts cannot be recovered.

Screenshots are fresh 2× browser previews at the current device, appearance and text size, using starting app content. They include discoverable destinations/presentations and saved standalone screens, beyond the normal twelve-screen gallery cap. The export refuses a missing saved screen, failed preview, oversized image, or screen-count limit rather than silently omitting it. Data-dependent routes still need native review. Code-only formats and separate image review remain in **Export options**.

## Data and credentials

- The API key exists only in the open creator component's memory. Closing the window or switching away clears it. Changing provider also clears it.
- A same-origin POST to `/api/generate` forwards the key to the selected provider's fixed HTTPS endpoint. Keys are not written to project storage, URLs, telemetry, or server logs by application code. Production hosting should not log authorization headers or request bodies.
- Only the submitted description/options are sent for generation. The existing project is not included. Provider retention and billing policies still apply.
- OpenAI uses Responses with `store: false` and strict JSON schema; Anthropic uses Messages with `output_config.format` and `medium` effort, because current Claude models think by default and thinking counts against the 24,000-token output limit. A response that hits that limit and one the provider declines get different errors. There are no generation retries or shared server credentials; the only follow-up request sent without a click is the single automatic repair described below.
- Both providers' answers stream to the server, which assembles them and returns one JSON response to the browser. A long answer can run until the route's limit; one that sends nothing for two minutes is treated as stuck.
- Cancellation aborts the local request and upstream signal. It cannot undo tokens the provider has already processed.

## Validation and limits

Input is bounded to 6,000 prompt characters and six pages. The endpoint accepts 1–24 Swift files under `Sources/`, rejects unsafe/colliding paths and oversized/empty content, checks page references and one matching app entry point, and handles incomplete/refused responses before a draft can be opened.

A disposable instance of the existing compiler worker evaluates every screen it can reach - each tab, pushed details, sheets and full-screen covers - with a 15-second timeout. It cannot modify the active project's runtime. A sheet or detail that fails to build is reported with the file and line that failed rather than left out. Item-driven presentations (`.sheet(item:)`) need a real selected item and are not exercised, and a passing check is not a guarantee that native Xcode compilation works. Source is rendered as escaped text, never executed as JavaScript.

Issues are listed before opening, errors first. When the check finds at least one error, the review opens with the draft and one repair request starts straight away: the draft's files, the errors (each with its file and line) and the original description go to the same provider and model through the prompt-editing endpoint, with a fixed instruction to fix only those errors. It is billed like any other request, and the creator says so next to the API key. The repaired files must still form a complete app with its pages and entry point, and are checked again before the review updates; a repair that fails either check leaves the draft unchanged and says why. Cancelling it keeps the draft as generated.

The automatic repair runs once per generation. If errors remain, **Try again with AI** sends one more request per click; nothing retries on its own. The user can always open a draft as it is and correct it in the editor.

## What the model is told the preview runs

Both the generation and the edit instructions end with the preview's standard library: every member it runs on `String`, `Array`, `Set`, `Dictionary`, the numbers, `Date`, `URL`, `UUID` and ranges, its free functions and ways to make values, plus named examples of valid Swift it does not run. The list is built from the editor's member table (`packages/swift-sema/src/stdlib-symbols.ts`), which `tests/editor.test.ts` runs member by member through the interpreter, so a member can only appear in the prompt if the preview has it. `apps/web/lib/generation/preview-stdlib.test.ts` runs every listed way to make a value, and checks that every named counter-example really fails, so neither half of the instruction can drift from the runtime.

Imported and generated projects are retained even when untouched. Only an unchanged project explicitly created from a catalog template is eligible for automatic removal when replaced. Existing projects without recorded template provenance are kept conservatively.

## Deployment

Requires a Next.js server or Vercel deployment; a static-only host cannot serve the generation endpoint. No server API-key environment variable is needed. The generation and edit routes allow up to 300 seconds and give up at 290 so they can answer with a clear error; check the hosting plan's actual execution timeout. Models are editable because account access and available models vary.

Defaults: `gpt-5.4-mini` and `claude-sonnet-5`. Provider documentation consulted September 17, 2026:

- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI model](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
- [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Anthropic models](https://platform.claude.com/docs/en/models/overview)

## Checks

Unit tests cover provider request formats, credentials, foreign origins, request limits, unsafe output, refusals, incomplete responses, cancellation, and sanitized errors. Playwright fixtures cover review/open, failed requests, and cancellation without spending API credits. A real API key is required for a live-provider check; it is deliberately not part of CI.

The gallery now contains seven complete apps and 18 feature examples. Dispatch adds task management, creation, activity, and preferences; Market adds browsing, favorites, quantity changes, checkout, and order history. Both use local data, shared observable state, and native adaptive controls.

The total gzipped client budget was 470 KB at this release (measured about 457 KB), which accommodated the two apps and the lazy-loaded prompt/review feature. It is 600 KB now, raised by decision after the design tools took the old ceiling to 99%. The largest initial chunk is the gate that still describes the critical path, and it keeps its 172 KB ceiling (about 166 KB measured).
