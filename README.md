# Swift Web Studio

A browser IDE for building SwiftUI interfaces with editable Swift source, an interactive iPhone preview, and project export.

## Quick start

Requires **Node.js 22** and **npm 11**.

```bash
npm ci
npm run dev --workspace @studio/web
```

Open [localhost:3000](http://localhost:3000). Choose a template, import Swift files or a project ZIP, or create an app from a prompt using your own provider key.

## Workflow

- **Design:** select, add, move, hide, or delete views. Canvas edits update the Swift source. The Add palette contains starter snippets; use Code for bindings, actions, modifiers, and custom views.
- **Code:** edit Swift with diagnostics, completion, symbol navigation, and rename. The preview stays centered; Run resets its state.
- **Organize:** double-click a file or the app name to rename it. Collapse panels from their headers and restore them from the window edges. Layers includes collapse all.
- **Navigate:** the keyboard button beside Export opens searchable shortcuts. Quick Open finds files; Add finds view snippets.
- **Save and share:** projects save locally in IndexedDB. Share links carry the project in the URL, subject to a size limit.
- **Export:** download an Xcode project, Swift Playgrounds app, Swift package, or XcodeGen specification. Swift source is preserved in every format.

## Preview scope

The browser parses and interprets a supported subset of Swift and SwiftUI in a Web Worker. It does not run Apple's Swift compiler or the iOS Simulator. Rendering, language semantics, and framework behavior have documented limits; validate exported apps in Xcode before release.

The [Swift subset](docs/04-SWIFT-SUBSET.md) and [SwiftUI coverage matrix](docs/05-SWIFTUI-COVERAGE.md) describe support. In particular, async work runs synchronously, generic constraints are not enforced, and native services and named image assets are not fully supported.

## Development

| Command | Purpose |
| --- | --- |
| `npm run verify` | Type checks, lint, and unit tests |
| `npm run build` | Production build |
| `npm run budget` | Check bundle limits after a build |
| `npx playwright install chromium` | Install the browser for end-to-end tests |
| `npm run e2e` | Run browser tests against a production build |

## Structure

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js workspace, editor, dialogs, and worker host |
| `packages/swift-syntax` | Lexer, parser, AST, and source edits |
| `packages/swift-sema` | Name resolution and semantic analysis |
| `packages/swift-runtime` | Swift interpreter |
| `packages/swiftui-runtime` | SwiftUI state, view composition, and interactions |
| `packages/swiftui-layout` | Layout and text measurement |
| `packages/swiftui-render-dom` | Render-tree presentation |
| `packages/project-model` | Projects, files, templates, persistence, and sharing |
| `packages/exporter` | Project scaffolding and ZIP import/export |
| `packages/shared`, `packages/sim-shell` | Shared types and device specifications |

The compiler, interpreter, and layout packages are independent of React and the DOM.

## Deployment and reference

For Vercel, set the project root to `apps/web`; its configuration supplies security headers. See [architecture](docs/02-ARCHITECTURE.md), [requirements](docs/01-REQUIREMENTS.md), and [prompt creation](docs/prompt-creation.md) for implementation details and provider setup. Product plans and known gaps are tracked in the [roadmap](docs/03-ROADMAP.md) and [defect register](docs/07-DEFECT-REGISTER.md).
