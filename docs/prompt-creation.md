# Prompt-to-app creation

Open **the project menu (top left) → From a prompt**, choose OpenAI or Anthropic, enter a model ID and API key, and describe the app. Choose 1 to 6 pages (3 at first, counting details, forms and settings), navigation, accent color, sample content, and an optional settings page. Generate, review the files and preview check, then open the draft as a separate project.

The result is ordinary SwiftUI source. It can be edited visually or in code, previewed, shared, and exported with the existing tools. The creation prompt, options and AI summary are saved when the draft is opened.

Every screen of a draft is checked in the preview, on the device and target a new project gets (iPhone 18 Pro, iOS 27), including a view that stops on a screen other than the first. A draft with errors is asked for once more, with those errors, and the second draft is the one shown. A draft that still has errors is shown with them: it can be opened and fixed, or thrown away. When asking again fails, as when the rate limit turns it away, the first draft is kept and says why. A draft with one page more or fewer than asked for is accepted, and one further off is asked for again. Warnings, and views the preview cannot draw, are not errors.

A draft is kept for the browser tab until it is opened or thrown away. Closing the sheet, choosing another item in it, or reloading the page keeps it, and choosing **From a prompt** again shows it. A click beside the sheet does not close it while a draft is shown, and **Back to prompt** asks before throwing the draft away.

## Prompt Editing

The left panel has **Layers** and **Prompt Editing** tabs (Files in the Code workspace). Select a view on the canvas to attach its source context above the composer; remove the tag to request an app-wide change. Open the connection settings to choose a provider/model and enter a key. Enter sends; Shift+Enter inserts a new line. Replies describe the changes in one short sentence.

Each request sends current Swift files, resource names, the last 24 successful conversation messages, and the optional selected source range. The `/api/edit` endpoint returns complete changed files and explicit deletions. File paths and project size are validated, then a disposable preview worker checks the candidate before any source is changed. Only the errors the answer brings count, so an error the project already had does not block an AI edit. An answer that brings errors, or that cannot be used, is asked for once more, with them, while the banner says the AI is fixing its change. If the second answer still has errors, nothing changes, and the conversation says which. A successful edit is one Undo step. While the request runs, the AI holds the project: typing, Design edits, Undo, renaming, file changes and opening another project wait, and a banner says so with **Stop**, which cancels the request and frees the project at once. The answer is planned against the project as it was sent, so a change made meanwhile would have thrown it away after the provider billed for it. Collapsing the left panel leaves the request running, and reloading or closing the tab asks first.

The conversation is saved locally with the project, survives Undo/Redo, and reopens with an exported archive. Failed/cancelled attempts stay visible but are excluded from the next request's context. The provider, model and key are kept for the browser tab, shared with prompt-to-app creation, and cleared when the tab closes. No provider request is made until Send. Prompt editing supports up to 256 input files / 600,000 source characters and 32 changed files per response; history is limited to 1,000 messages / 2 MB without silent truncation. Browser preview checks do not replace an Xcode build.

## Default export

**Export** downloads a complete Xcode ZIP with the original Swift files, project/scheme/assets, individual screen PNGs, the project's event log (`.swiftstudio/events.jsonl`), and a **Studio Report** folder containing `report.md`, `settings.json`, `screens.json`, `chat-history.md`, and `chat-history.json`. The report records deployment/signing defaults, preview settings, resources, designer metadata, capture diagnostics and limitations. It includes only conversation history actually saved in this project; earlier unsaved prompts cannot be recovered.

Screenshots are fresh 2× browser previews at the current device, appearance and text size, using starting app content. They include discoverable destinations/presentations and saved standalone screens, beyond the normal twelve-screen gallery cap. The export never refuses: a saved screen nothing draws any more, a preview that fails, and an image over the size limits are left out and listed under Known issues in `report.md`. Data-dependent routes still need native review. Code-only formats and separate image review remain in **Export options**.

## Data and credentials

- The API key, with its provider and model, is kept in this browser tab's session storage until the tab closes, for both prompt-to-app creation and Prompt Editing. It is never written to a project, an export or local storage. Changing provider clears it.
- Both AI routes answer only a POST whose `Origin` is the studio's own, and forward the key to the selected provider's fixed HTTPS endpoint. Keys are not written to project storage, URLs, telemetry, or server logs by application code. Production hosting should not log authorization headers or request bodies.
- Each prompt, with its provider, model and options, and how the request ended are written to the project's event log, which every export carries. The key never is.
- Only the submitted description/options are sent for generation. The existing project is not included. Provider retention and billing policies still apply.
- OpenAI uses Responses with `store: false` and strict JSON schema; Anthropic uses Messages with `output_config.format`. An answer the preview finds broken is asked for once more, automatically, with the errors it brought rather than the earlier answer. There are no shared server credentials.
- Cancellation aborts the local request and upstream signal. It cannot undo tokens the provider has already processed.

## Validation and limits

Input is bounded to 6,000 prompt characters and six pages. The endpoint accepts 1–24 Swift files under `Sources/`, rejects unsafe/colliding paths and oversized/empty content, checks page references and one matching app entry point, and handles incomplete/refused responses before a draft can be opened.

A disposable instance of the compiler worker evaluates every screen, within 30 seconds. It cannot modify the active project's runtime. A passing check is not a guarantee that every interaction or native Xcode compilation works. Problems are listed before opening, and a draft whose check could not finish is kept and says so. Source is rendered as escaped text, never executed as JavaScript.

Imported and generated projects are retained even when untouched. Only an unchanged project explicitly created from a catalog template is eligible for automatic removal when replaced. Existing projects without recorded template provenance are kept conservatively.

## Deployment

Requires a Next.js server or Vercel deployment; a static-only host cannot serve the generation endpoint. No server API-key environment variable is needed. The AI routes allow up to 180 seconds. On Vercel, Fluid compute, on by default, lets functions run up to 300 seconds on every plan: check that it is on under the project's Settings, then Functions. Models are editable because account access and available models vary.

Defaults: `gpt-5.4-mini` and `claude-sonnet-5`. Provider documentation consulted September 17, 2026:

- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI model](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
- [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Anthropic models](https://platform.claude.com/docs/en/models/overview)

### The AI routes' rate limit

The routes answer only the studio's own page, but anyone can open that page. A limit per IP address keeps a script from running up function time. Add it once, in the Vercel dashboard:

1. Open the project, then **Firewall** in the sidebar.
2. Select **Configure**, then **+ New Rule**, and name it `AI requests`.
3. Under **If**, choose **Request Path**, **Starts with**, and `/api/`. The two AI routes are the only routes there.
4. Under **Then**, choose **Rate Limit**. The first time, review the **Rate Limiting Pricing** dialog and select **Continue**.
5. Choose **Fixed Window**, a **Time Window** of 600 seconds, a **Request Limit** of 30, and **IP** as the key. Keep the **Default (429)** action.
6. Select **Save Rule**, then **Review Changes**, then **Publish**.

A Hobby project allows one rate limit rule, which this is. The limit allows about three times what fast work with the AI needs, counting its automatic second tries. A participant who reaches it is told: "Too many AI requests came from this network. Wait a few minutes, then try again." Vercel counts the limit in each region separately.

## Checks

Unit tests cover provider request formats, credentials, foreign and missing origins, request limits, unsafe output, refusals, incomplete responses, cancellation, sanitized errors, the note a second request carries, the page count, and the rules both prompts share, whose example the preview draws without a warning and the Design view can edit. Playwright fixtures cover review/open, failed requests, cancellation, the second try in both panels, a draft still broken after it, and a Firewall rate limit, without spending API credits. A real API key is required for a live-provider check; it is deliberately not part of CI.

The gallery now contains seven complete apps and 18 feature examples. Dispatch adds task management, creation, activity, and preferences; Market adds browsing, favorites, quantity changes, checkout, and order history. Both use local data, shared observable state, and native adaptive controls.

The total gzipped client budget was 470 KB at this release (measured about 457 KB), which accommodated the two apps and the lazy-loaded prompt/review feature. It is 600 KB now, raised by decision after the design tools took the old ceiling to 99%. The largest initial chunk is the gate that still describes the critical path, and it keeps its 172 KB ceiling (about 166 KB measured).
