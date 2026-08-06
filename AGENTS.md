# Repository Guidelines

This file provides guidance to AI agents when working with code in this repository.

> **Single source of truth:** This file is a concise pointer document.
> All authoritative architecture, coding rules, and conventions
> live in **CLAUDE.md** at the project root. Read that file first.
> Use `Makefile`, `package.json`, and `pnpm-workspace.yaml` as the
> source of truth for the full command list.

## Quick Reference

### Architecture

Go backend + monorepo frontend (pnpm workspaces + Turborepo) with shared packages.

- `server/` - Go backend (Chi router, sqlc, gorilla/websocket)
- `apps/web/` - Vite React SPA (React Router)
- `apps/desktop/` - Electron desktop app
- `apps/desktop-wails/` - Go + Wails v3 desktop app; owns its renderer shell and reuses only shared frontend packages
- `apps/mobile/` - Expo / React Native iOS app (read `apps/mobile/CLAUDE.md` first)
- `apps/docs/` - Fumadocs documentation site
- `packages/core/` - Headless business logic (Zustand stores, React Query hooks, API client)
- `packages/ui/` - Atomic UI components (shadcn/Base UI, zero business logic)
- `packages/views/` - Shared business pages/components
- `packages/tsconfig/` - Shared TypeScript config
- `packages/eslint-config/` - Shared ESLint config

### State Management (critical)

- **React Query** owns all server state (issues, members, agents, inbox, workspace list)
- **Zustand** owns client/view state (view filters, drafts, modals, desktop tab state); current workspace identity is route-driven and only mirrored for platform plumbing
- All Zustand stores live in `packages/core/` - never in `packages/views/` or app directories
- WS events update React Query for server data; store writes are only for clearing client-owned pointers with a single responder/self-event guard

### Package Boundaries (hard rules)

- `packages/core/` - zero react-dom, zero localStorage, zero process.env
- `packages/ui/` - zero `@multica/core` imports
- `packages/views/` - zero `next/*`, zero `react-router-dom`, use `NavigationAdapter` for routing
- `apps/web/platform/` - Web browser and routing adapter boundary
- `apps/desktop-wails/` - must not import from `apps/desktop/`; Wails and Electron are independent host/rendering containers
- `apps/desktop-wails/` keeps the main sidebar expanded because its top-left area also owns native macOS window controls; do not expose sidebar collapse controls or shortcuts in this host

### Database Migrations (hard rules)

- Never add database foreign keys or cascading actions. Enforce relationships and perform dependent cleanup explicitly in the application layer, using transactions when the operation must be atomic.
- Every index created by a migration, including unique indexes and indexes on new tables, must use `CREATE [UNIQUE] INDEX CONCURRENTLY`. Keep each concurrent index build in its own single-statement migration file.

### Commands

```bash
make dev              # Auto-setup + start everything
pnpm typecheck        # TypeScript check
pnpm test             # TS unit tests (Vitest)
make test             # Go tests
make check            # Full verification pipeline
```

### Deployment

- After completing deployable changes, deploy the affected production service and verify its public endpoint before reporting completion, unless the user explicitly asks not to deploy or the required credentials/environment are unavailable.
- Build the Vite production bundle locally or in CI. Deployment hosts only receive and serve the built `apps/web/dist` artifact; never run frontend compilation on a deployment host.
- Build `apps/desktop-wails` frontend locally before its Go binary (`pnpm --filter @multica/desktop-wails build:frontend`, then `pnpm --filter @multica/desktop-wails build:go`); do not compile its renderer on a remote host.
- For the `ten` bare-metal release/update procedure, use `docs/bare-metal-remote-deployment.zh-CN.md`.

See CLAUDE.md for the authoritative rules and common commands.
