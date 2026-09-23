<div align="center">

# Swift Web Studio

**Design SwiftUI interfaces in your browser. Keep the Swift source.**

[![CI](https://github.com/Danyals-code/Swift-Cloud-Simmulator/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Danyals-code/Swift-Cloud-Simmulator/actions/workflows/ci.yml)
[![Node.js 22](https://img.shields.io/badge/Node.js-22-417E38?logo=nodedotjs&logoColor=white)](#quick-start)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)

[Designer guide](docs/authoring/DESIGNER-GUIDE.md) · [Architecture](docs/02-ARCHITECTURE.md) · [SwiftUI coverage](docs/05-SWIFTUI-COVERAGE.md)

</div>

Swift Web Studio brings visual editing, a Swift code editor, and an interactive device preview into one workspace. Start with a template or your own Swift files, refine the design, and export a project for native development.

## Highlights

- **Design with Swift.** Edit text, colors, spacing, layout, and supported interactions directly on the underlying source. Organize screens and layers with shared undo and redo.
- **Build reusable designs.** Create components, edit instance inputs, save input variants, and manage shared colors, spacing, and text styles. Import PNG/JPEG images with optional dark variants.
- **Work with real content.** Edit collection records and their shared row design. Use preview scenarios to explore content without changing the app's initial data.
- **Review and present.** Compare device sizes, appearance, and text sizes. Check for potential contrast, touch-target, and overflow issues; present screens or export PNGs and contact sheets.
- **Move into code.** Edit Swift with diagnostics, completion, symbol navigation, and rename. Unsupported visual edits remain available in the code editor.
- **Save and hand off.** Autosave locally, download an editable archive, or export an Xcode project, Swift Playgrounds app, Swift package, or XcodeGen specification. Swift source is preserved in every format.

## Quick start

Requires **Node.js 22** and **npm 11**. Run from the repository root:

```bash
npm ci
npm run dev --workspace @studio/web
```

Open [localhost:3000](http://localhost:3000), then choose a template, start a blank design, or import Swift files or a project ZIP. Optional prompt-based creation uses your own provider key; see [provider setup](docs/prompt-creation.md).

Projects autosave in your browser using IndexedDB. Use **Save editable** to download a portable `.swiftstudio.zip` containing source, images, settings, and designer metadata. Share links support image-free projects within the URL size limit.

## Preview scope

The preview parses and interprets a supported subset of Swift and SwiftUI in a Web Worker. It does **not** run Apple's Swift compiler or the iOS Simulator. Build and review exported apps in Xcode before release.

Rendering, language semantics, and native framework behavior have documented limits. For example, async work runs synchronously, generic constraints are not enforced, and symbols, fonts, materials, and motion can differ from native SwiftUI. See the [Swift subset](docs/04-SWIFT-SUBSET.md) and [SwiftUI coverage matrix](docs/05-SWIFTUI-COVERAGE.md) for details.

## Development

| Command | Purpose |
| --- | --- |
| `npm run verify` | Type checks, lint, and unit tests |
| `npm run build` | Production build |
| `npm run budget` | Check bundle limits after a build |
| `npx playwright install chromium` | Install the browser for end-to-end tests |
| `npm run e2e` | Run browser tests after a production build |

For Vercel deployment, set the project root to `apps/web`. Its configuration supplies the security headers.

## Project structure

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js workspace, editor, dialogs, and worker host |
| `packages/swift-syntax` | Lexer, parser, AST, and source edits |
| `packages/swift-sema` | Name resolution, semantic analysis, and design edits |
| `packages/swift-runtime` | Swift interpreter |
| `packages/swiftui-runtime` | SwiftUI state, view composition, and interactions |
| `packages/swiftui-layout` | Layout and text measurement |
| `packages/swiftui-render-dom` | Render-tree presentation |
| `packages/project-model` | Projects, files, templates, persistence, and sharing |
| `packages/exporter` | Project scaffolding and ZIP import/export |
| `packages/shared`, `packages/sim-shell` | Shared types and device specifications |

The compiler, interpreter, and layout packages are independent of React and the DOM.

## Documentation

- [Designer guide](docs/authoring/DESIGNER-GUIDE.md): visual editing, resources, saving, and developer handoff.
- [Extension guide](docs/authoring/EXTENSION-GUIDE.md): extending the authoring system.
- [Architecture](docs/02-ARCHITECTURE.md) and [requirements](docs/01-REQUIREMENTS.md): system design and product scope.
- [Roadmap](docs/03-ROADMAP.md) and [defect register](docs/07-DEFECT-REGISTER.md): planned work and known gaps.
- [Release acceptance](docs/authoring/RELEASE-ACCEPTANCE.md): validation requirements and remaining gates.
