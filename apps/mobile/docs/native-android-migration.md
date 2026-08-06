# Native Android Migration Plan

This plan tracks the move from the current Expo/React Native mobile app to a
feature-complete Jetpack Compose Android app. The target is not a visual clone:
Compose may use native Android navigation and controls, but product semantics
must match web and the existing mobile app.

## Decision

- Android native is the long-term target for the Android app.
- The current Compose implementation is a prototype baseline, not yet a
  replacement for `apps/mobile/app`.
- Migration work proceeds by vertical feature slices. Each slice includes API
  coverage, state, realtime behavior, UI, empty/loading/error states, and parity
  checks against web/RN.

## Parity Rules

- Counts and visibility must match web/RN for the same workspace and filters.
- Server state must not be copied into unrelated local state when a cache layer
  owns it.
- Enum drift must degrade to readable fallback labels rather than hiding data.
- List endpoints must mirror client-side shaping from web/RN, including inbox
  deduplication and timeline coalescing.
- Mobile UI may differ where the native Android interaction is better, but the
  underlying task model must remain the same.

## Current Native Baseline

The current native app has these files:

- `ApiClient.kt`
- `AppViewModel.kt`
- `MainActivity.kt`
- `MainApplication.kt`
- `Models.kt`
- `MulticaApp.kt`
- `Theme.kt`

Current product coverage:

- Auth: send code, verify code, persisted token.
- Workspace: list and select workspace.
- Chat: list sessions, open a session, send a basic message.
- Issues: list only.
- Inbox: list only, archived filtering and basic issue-id dedup.
- Profile: user, backend URL, workspace list, sign out.

Known missing foundations:

- Navigation graph and route arguments.
- Feature-scoped ViewModels/repositories.
- Query/cache layer.
- WebSocket lifecycle and per-feature realtime handlers.
- Offline and retry states.
- Rich markdown rendering.
- File attachments.
- Detail/edit/create screens.
- Permission-aware actions.
- Notification preferences.
- Native design-system primitives beyond basic Material components.

## Feature Gap Matrix

| Domain | RN mobile coverage | Native status | Priority |
| --- | --- | --- | --- |
| Auth | Login, verify, backend selection, persisted auth | Partial | P0 |
| Workspace | Launch routing, workspace selection, switching | Partial | P0 |
| Chat | Sessions, agent picker, composer, drafts, realtime, edit/resend/regenerate/withdraw | Partial list/send only | P0 |
| Inbox | Deduped inbox, swipe actions, read/archive, deep link to issue/comment | Partial list only | P0 |
| My Issues | Grouping/filtering, issue rows, status actions | Partial flat list only | P0 |
| Issue Detail | Header, properties, description, timeline, comments, reactions, edit, delete, pin, realtime | Missing | P0 |
| Issue Create/Edit | Drafts, pickers, validation, optimistic updates | Missing | P1 |
| Projects | List/detail/create/edit/resources/related issues | Missing | P1 |
| Agents | List/detail/create/edit, runtime state | Missing | P1 |
| Autopilots | List/detail/create/edit | Missing | P2 |
| Pins | List and pin/unpin issue/project | Missing | P2 |
| Settings | Profile, notifications, backend, appearance | Partial profile only | P1 |
| Search | Workspace search | Missing | P2 |
| Realtime | Workspace-level and record-level WS subscriptions | Missing | P0 |
| Markdown | Rich message/comment rendering, code blocks, images | Missing | P1 |

## Target Native Architecture

Use package boundaries inside `ai.multica.mobile`:

- `core/`: app session, result wrappers, date/format helpers, display labels.
- `data/api/`: OkHttp client, serializers, endpoint services.
- `data/repository/`: feature repositories that hide endpoint details.
- `data/realtime/`: WebSocket client and feature event dispatch.
- `feature/<domain>/`: ViewModels and screen state.
- `ui/components/`: reusable Compose primitives.
- `ui/theme/`: color, typography, spacing, shape, icon conventions.
- `navigation/`: routes, deep links, and bottom-tab graph.

Do not keep growing a single app-wide ViewModel. New feature work should move
state to feature-owned ViewModels as part of the slice.

## Migration Sequence

1. Foundation: native design system, navigation graph, feature package layout,
   result/loading/error primitives, screenshot baseline.
2. Auth and workspace: login/verify/backend/workspace switch with stable
   launch routing.
3. Inbox slice: deduped list, unread/read/archive, deep link to issue/comment,
   reconnect refresh.
4. Issues slice: my issues and workspace issues, filters, issue row actions,
   create issue entry point.
5. Issue detail slice: detail header, properties, description, timeline,
   comments, reactions, edit/delete/pin, per-issue realtime.
6. Chat slice: session picker, agent picker, composer parity, drafts, realtime,
   edit/resend/regenerate/withdraw actions.
7. Projects and agents: list/detail/create/edit flows and picker reuse.
8. Settings and polish: notifications, appearance, backend management, offline
   states, performance pass.

## Visual System Requirements

- Every screen has a native top app bar title and an explicit empty/loading/error
  state.
- List rows are dense, icon-led, and metadata-first, matching the existing RN
  mobile information density.
- Issue, inbox, project, agent, priority, and status visuals are domain
  primitives, not ad hoc text labels.
- Prefer Material 3 components, but wrap them in Multica primitives where
  spacing, shape, or density must be consistent.
- Support dark mode before release candidacy, not after.

## Done Criteria For Each Slice

- API responses parse unknown/missing fields without white-screen style failure.
- The slice has screenshots on at least one phone-sized emulator.
- Counts and list ordering are compared against RN/web for the same account.
- WebSocket or reconnect behavior is covered if the slice displays mutable
  workspace data.
- `./gradlew assembleDebug` passes from `apps/mobile/android`.
