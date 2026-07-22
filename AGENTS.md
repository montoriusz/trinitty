# AGENTS.md

## Overview

A Tauri 2 desktop terminal app. The frontend is TypeScript + Vite using xterm.js; the backend is Rust in `src-tauri`.

**IMPORTANT**: If you find any discrepancies between this document and the actual codebase, always flag them to the user.

## Layout

- `src/` — frontend TypeScript + React, with generated Tauri bindings in `src/generated/`.
  - `src/app/` — app components and feature logic, grouped by domain into `chat/`, `terminal/`, `settings/`, and `shared/` (plus top-level `window-manager.tsx`, `window-manager-builder.tsx`, `providers.tsx`).
  - `src/ui/` - Pure UI components, isolated from business logic.
    - `primitives/` - Panda CSS / Ark UI primitive components.
    - `composites/` - Composites and domain-specific components.
  - `src/theme/` + `panda.config.ts` (project root) - Panda CSS theme configuration.
  - `src/main.tsx` — React entry point.
- `src-tauri/` — Rust backend (`src/`, `Cargo.toml`, `tauri.conf.json`).
  - `src-tauri/src/chat/` — chat backend; `generation.rs` owns all `genai` LLM calls.
- `index.html` — Vite entry point.

## Commands

Uses pnpm.

- `pnpm install` — install dependencies.
- `pnpm typecheck` — run the TypeScript type checker (`tsc --noEmit`).
- `pnpm lint:check` run Biome read-only check.
- `pnpm lint` — run Biome with autofix (`biome check --write`).
- `pnpm build` — type-check and build the frontend (`tsc && vite build`).
- `pnpm tauri build` — build the desktop app (via the `tauri` CLI passthrough script).
- `pnpm tauri-typegen` — regenerate Tauri type bindings (see **tauri-typegen** skill before using)

## Conventions

- Save implementation plans in the project-root `implementation-plans/` directory.
- Frontend is TypeScript + React; keep `typecheck` passing.
- Pick Tanstack Query for simple data fetching and caching.
- Pick Zustand for two-way backend sync and other stores.
- xterm.js used as a terminal emulator.
- There are two view modes:
  - Split: an assistant chat next to the terminal,
  - Notebook: a single stream of interleaved terminal output and chat messages.
- Do not edit generated files in `src/generated/`; regenerate them instead and apply lint fixes if necessary.
- Styling uses Panda CSS (`styled-system/`) and Ark UI primitives — avoid raw CSS unless necessary.
- Backend is Rust; run `cargo check` in `src-tauri/`.
- In Rust, write async code using `tokio` where it has advantages.

### AI / `genai`

- The `genai` crate drives the assistant. All generation lives in `src-tauri/src/chat/generation.rs`; keep `genai` calls out of `chat.rs` (Tauri/event concerns).
- The system prompt and each user turn are rendered with Askama templates in `src-tauri/templates/`.

### File Naming (`src/`)

**Kebab Case** must be used for all file and directory names in `src/`. E.g. `my-function.ts`, `my-component/helpers.ts`) for everything that is not a React component name.
If a component needs to group more sub-components, private hooks, or other helpers, they should be placed in a folder. The folder should contain an index file re-exporting public symbols.
If more further grouping is needed, files that group multiple declarations of the same type/purpose can include type suffixes such as `constants`, `helpers`, or `types` in their names; e.g., `oidc.constants.ts`, `sub-component.helpers.ts`.

### File Naming (`src-tauri/`)

Prefer **Snake Case** for all file and directory names in `src-tauri/`. Adhere to Rust conventions.
