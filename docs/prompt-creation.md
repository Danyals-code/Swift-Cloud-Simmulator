# Prompt-to-app creation

Open **the project menu (top left) → From a prompt**, choose OpenAI or Anthropic, enter a model ID and API key, and describe the app. Choose 1–6 pages (including details/forms/settings), navigation, accent color, sample content, and an optional settings page. Generate, review the files and preview check, then open the draft as a separate project.

The result is ordinary SwiftUI source. It can be edited, previewed, shared, and exported with the existing tools. No attribution or watermark is appended. Simulator visual editing is not implemented in this release.

## Data and credentials

- The API key exists only in the open creator component's memory. Closing the window or switching away clears it. Changing provider also clears it.
- A same-origin POST to `/api/generate` forwards the key to the selected provider's fixed HTTPS endpoint. Keys are not written to project storage, URLs, telemetry, or server logs by application code. Production hosting should not log authorization headers or request bodies.
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

The total gzipped client budget is 470 KB (measured about 457 KB after this release). This explicitly accommodates the two apps and the lazy-loaded prompt/review feature. The largest initial chunk remains about 162 KB with its existing 172 KB ceiling.
