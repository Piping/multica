import { useEffect } from "react";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { AppLaunchSkeleton } from "@/components/app/app-launch-skeleton";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useWorkspaceStore } from "@/data/workspace-store";
import { RealtimeProvider } from "@/data/realtime/realtime-provider";
import { useInboxRealtime } from "@/data/realtime/use-inbox-realtime";
import { useIssuesRealtime } from "@/data/realtime/use-issues-realtime";
import { useMyIssuesRealtime } from "@/data/realtime/use-my-issues-realtime";
import { useChatSessionsRealtime } from "@/data/realtime/use-chat-sessions-realtime";
import { useProjectsRealtime } from "@/data/realtime/use-projects-realtime";
import { usePinsRealtime } from "@/data/realtime/use-pins-realtime";
import { usePresenceRealtime } from "@/data/realtime/use-presence-realtime";
import { useAutopilotsRealtime } from "@/data/realtime/use-autopilots-realtime";
import { useWorkspacePresencePrefetch } from "@/lib/use-workspace-presence-prefetch";
import { useNewIssueDraftResetOnWorkspaceChange } from "@/data/stores/new-issue-draft-store";
import { useNewProjectDraftResetOnWorkspaceChange } from "@/data/stores/new-project-draft-store";
import { useChatSessionPickerResetOnWorkspaceChange } from "@/data/stores/chat-session-picker-store";
import { workspaceRouteOptions } from "@/lib/workspace-route-surface";

/**
 * Cold-start deep-link anchor. Expo Router otherwise treats whatever
 * route resolves the URL as the root of the stack — if the user opens a
 * notification that targets `issue/[id]/picker/status` directly, they
 * land on the formSheet with NO parent under it, no way to go back to
 * the tabs. `anchor: "(tabs)"` tells the router to mount the tab UI as
 * the implicit underlying screen so back/swipe-dismiss returns the user
 * to a sensible base state.
 */
export const unstable_settings = { anchor: "(tabs)" } as const;

/**
 * Mounts every per-feature realtime subscription. Lives inside
 * RealtimeProvider so the WSClient context is available, and stays alive
 * for the whole workspace session — the inbox unread count must keep
 * refreshing even while the user is on an issue page or settings, not
 * just when the inbox tab is foregrounded.
 *
 * Add new realtime feature hooks here as they land (issue, chat, etc).
 */
function RealtimeSubscriptions() {
  useInboxRealtime();
  useIssuesRealtime();
  useMyIssuesRealtime();
  useChatSessionsRealtime();
  useProjectsRealtime();
  usePinsRealtime();
  useAutopilotsRealtime();
  // Presence: warm the three queries up front so avatars don't flash a
  // dotless first render, and listen for daemon/agent/task events to keep
  // the runtime + snapshot caches fresh. See use-presence-realtime.ts for
  // the deliberately-skipped high-frequency events.
  useWorkspacePresencePrefetch();
  usePresenceRealtime();
  return null;
}

/**
 * Workspace context layout. Reads the slug from the URL (the route is the
 * source of truth — see apps/mobile/CLAUDE.md "Behavioral parity"), validates
 * membership against the workspaces list, then syncs id+slug into the
 * Zustand store so ApiClient.fetch can read the slug synchronously when
 * injecting the X-Workspace-Slug header.
 *
 * If the slug doesn't match any workspace the user belongs to, redirect to
 * /select-workspace (covers stale persisted slugs after the user lost
 * membership, deep links to wrong slugs, etc.).
 */
export default function WorkspaceLayout() {
  const { workspace: slug } = useLocalSearchParams<{ workspace: string }>();
  const { data: workspaces, isLoading } = useQuery(workspaceListOptions());
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);

  const matched = workspaces?.find((w) => w.slug === slug);

  useEffect(() => {
    if (matched) {
      setCurrentWorkspace(matched.id, matched.slug);
    }
  }, [matched, setCurrentWorkspace]);

  // Wipe cross-route Zustand draft stores whenever the active workspace
  // changes — a draft picked under workspace A (assignee id, draft
  // session id, etc.) is invalid in workspace B and must not leak.
  useNewIssueDraftResetOnWorkspaceChange(matched?.id ?? null);
  useNewProjectDraftResetOnWorkspaceChange(matched?.id ?? null);
  useChatSessionPickerResetOnWorkspaceChange(matched?.id ?? null);

  // Wait for the workspaces list before deciding membership — otherwise a
  // valid deep link would briefly redirect away on cold start.
  if (isLoading) return <AppLaunchSkeleton />;

  if (!matched) return <Redirect href="/select-workspace" />;

  // Tabs hide their own header; pushed screens (issue/[id]) get a native
  // iOS Stack header with the standard back button + swipe-to-dismiss.
  return (
    <RealtimeProvider>
      <RealtimeSubscriptions />
      <Stack>
        <Stack.Screen
          name="(tabs)"
          options={workspaceRouteOptions({ surface: "tabs-root" })}
        />
        <Stack.Screen
          name="issue/[id]"
          options={workspaceRouteOptions({
            surface: "push-detail",
            title: "Issue",
          })}
        />
        <Stack.Screen
          name="project/[id]"
          options={workspaceRouteOptions({
            surface: "push-detail",
            title: "Project",
          })}
        />
        <Stack.Screen
          name="project/[id]/edit"
          options={workspaceRouteOptions({
            surface: "modal-form",
            title: "Edit Project",
          })}
        />
        <Stack.Screen
          name="issue/[id]/edit"
          options={workspaceRouteOptions({
            surface: "modal-form",
            title: "Edit Issue",
          })}
        />
        <Stack.Screen
          name="project/new"
          options={workspaceRouteOptions({
            surface: "modal-form",
            title: "New Project",
          })}
        />
        {/* Issue-detail formSheet pickers. All share the same sheet config:
            explicit numeric detents to dodge expo/expo#42904+#42965 (the
            `fitToContents` zero-size / padding bugs on iOS 26 + Expo 55),
            iOS native grabber, and contentStyle.height=100% as a safety
            net against the same zero-size class of bugs. */}
        <Stack.Screen
          name="issue/[id]/picker/status"
          options={workspaceRouteOptions({ surface: "sheet-list" })}
        />
        <Stack.Screen
          name="issue/[id]/picker/priority"
          options={workspaceRouteOptions({ surface: "sheet-list" })}
        />
        {/* Experiment: assignee uses iOS-native nav header + UISearchController
            instead of the body-rendered header pattern in SHEET_OPTIONS.
            Eliminates the #3634 overlap class of bugs and the focus-loss
            footgun of a custom TextInput inside ListHeaderComponent. The
            route file wires `headerSearchBarOptions` via setOptions. If this
            proves out, propagate to label / project / other search pickers
            and update CLAUDE.md Lesson 6 with a carve-out. */}
        <Stack.Screen
          name="issue/[id]/picker/assignee"
          options={workspaceRouteOptions({
            surface: "sheet-native-header",
            title: "Assignee",
          })}
        />
        <Stack.Screen
          name="issue/[id]/picker/label"
          options={workspaceRouteOptions({
            surface: "sheet-native-header",
            title: "Labels",
          })}
        />
        <Stack.Screen
          name="mention-picker"
          options={workspaceRouteOptions({
            surface: "sheet-native-header",
            title: "Mention",
          })}
        />
        <Stack.Screen
          name="issue/[id]/picker/project"
          options={workspaceRouteOptions({
            surface: "sheet-native-header",
            title: "Project",
          })}
        />
        <Stack.Screen
          name="issue/[id]/picker/due-date"
          options={workspaceRouteOptions({ surface: "sheet-list" })}
        />
        <Stack.Screen
          name="issue/[id]/runs"
          options={workspaceRouteOptions({ surface: "sheet-list" })}
        />
        {/* Full emoji picker for a comment reaction. Pushed from the "+"
            button inside the comment long-press tapback row — see
            components/issue/comment-context-menu.tsx. */}
        <Stack.Screen
          name="issue/[id]/comment/[commentId]/emoji-picker"
          options={workspaceRouteOptions({ surface: "sheet-list" })}
        />
        <Stack.Screen
          name="issue/[id]/history"
          options={workspaceRouteOptions({ surface: "sheet-list" })}
        />
        {/* Project-detail formSheet pickers. */}
        <Stack.Screen
          name="project/[id]/picker/status"
          options={workspaceRouteOptions({ surface: "sheet-list" })}
        />
        <Stack.Screen
          name="project/[id]/picker/priority"
          options={workspaceRouteOptions({ surface: "sheet-list" })}
        />
        <Stack.Screen
          name="project/[id]/picker/lead"
          options={workspaceRouteOptions({
            surface: "sheet-native-header",
            title: "Lead",
          })}
        />
        <Stack.Screen
          name="project/[id]/add-resource"
          options={workspaceRouteOptions({ surface: "sheet-list" })}
        />
        {/* New-issue draft formSheet pickers — stacked on top of the
            new-issue.tsx Stack.Screen (which is itself a `modal`).
            Expo Router 55 / RN Screens 4 support a formSheet pushed on top
            of a modal in the same Stack. */}
        <Stack.Screen
          name="new-issue-picker/status"
          options={workspaceRouteOptions({ surface: "sheet-list" })}
        />
        <Stack.Screen
          name="new-issue-picker/priority"
          options={workspaceRouteOptions({ surface: "sheet-list" })}
        />
        <Stack.Screen
          name="new-issue-picker/assignee"
          options={workspaceRouteOptions({
            surface: "sheet-native-header",
            title: "Assignee",
          })}
        />
        <Stack.Screen
          name="new-issue-picker/project"
          options={workspaceRouteOptions({
            surface: "sheet-native-header",
            title: "Project",
          })}
        />
        <Stack.Screen
          name="new-issue-picker/due-date"
          options={workspaceRouteOptions({ surface: "sheet-list" })}
        />
        {/* New-project draft formSheet pickers — same pattern as
            new-issue-picker/*. Stacked on top of `project/new` (a modal). */}
        <Stack.Screen
          name="new-project-picker/status"
          options={workspaceRouteOptions({ surface: "sheet-list" })}
        />
        <Stack.Screen
          name="new-project-picker/priority"
          options={workspaceRouteOptions({ surface: "sheet-list" })}
        />
        {/* Shared filter sheet for My Issues and the workspace Issues page —
            chooses the right view-store via `?scope=my|all` URL param. */}
        <Stack.Screen
          name="issues-filter"
          options={workspaceRouteOptions({ surface: "sheet-list" })}
        />
        {/* Chat session-switch sheet. */}
        <Stack.Screen
          name="chat-sessions"
          options={workspaceRouteOptions({ surface: "sheet-list" })}
        />
        {/* Workspace switcher — reached from the More popover's collapsed
            WorkspaceCard. Two-step (pick → iOS Alert confirm → switch). */}
        <Stack.Screen
          name="switch-workspace"
          options={workspaceRouteOptions({ surface: "sheet-list" })}
        />
        <Stack.Screen
          name="more/autopilots"
          options={workspaceRouteOptions({
            surface: "push-detail",
            title: "Autopilots",
          })}
        />
        <Stack.Screen
          name="more/autopilots/new"
          options={workspaceRouteOptions({
            surface: "modal-form",
            title: "New Autopilot",
          })}
        />
        <Stack.Screen
          name="more/autopilots/[id]"
          options={workspaceRouteOptions({
            surface: "push-detail",
            title: "Autopilot",
            headerBackTitle: "Autopilots",
          })}
        />
        <Stack.Screen
          name="more/autopilots/[id]/edit"
          options={workspaceRouteOptions({
            surface: "modal-form",
            title: "Edit Autopilot",
          })}
        />
        <Stack.Screen
          name="more/issues"
          options={workspaceRouteOptions({
            surface: "push-detail",
            title: "Issues",
          })}
        />
        <Stack.Screen
          name="more/projects"
          options={workspaceRouteOptions({
            surface: "push-detail",
            title: "Projects",
          })}
        />
        <Stack.Screen
          name="more/agents"
          options={workspaceRouteOptions({
            surface: "push-detail",
            title: "Agents",
          })}
        />
        <Stack.Screen
          name="more/agents/new"
          options={workspaceRouteOptions({
            surface: "modal-form",
            title: "New Agent",
          })}
        />
        <Stack.Screen
          name="more/runtimes/new"
          options={workspaceRouteOptions({
            surface: "push-detail",
            title: "Add Runtime",
            headerBackTitle: "Workspace",
          })}
        />
        <Stack.Screen
          name="more/agents/[id]"
          options={workspaceRouteOptions({
            surface: "push-detail",
            title: "Agent",
            headerBackTitle: "Agents",
          })}
        />
        <Stack.Screen
          name="more/agents/[id]/edit"
          options={workspaceRouteOptions({
            surface: "modal-form",
            title: "Edit Agent",
          })}
        />
        <Stack.Screen
          name="more/pins"
          options={workspaceRouteOptions({
            surface: "push-detail",
            title: "Pinned",
          })}
        />
        <Stack.Screen
          name="more/settings"
          options={workspaceRouteOptions({
            surface: "push-detail",
            title: "Settings",
          })}
        />
        <Stack.Screen
          name="more/settings/profile"
          options={workspaceRouteOptions({
            surface: "push-detail",
            title: "Profile",
            headerBackTitle: "Settings",
          })}
        />
        <Stack.Screen
          name="more/settings/notifications"
          options={workspaceRouteOptions({
            surface: "push-detail",
            title: "Notifications",
            headerBackTitle: "Settings",
          })}
        />
        <Stack.Screen
          name="new-issue"
          options={workspaceRouteOptions({
            surface: "modal-form",
            title: "New Issue",
          })}
        />
        <Stack.Screen
          name="search"
          options={workspaceRouteOptions({
            surface: "modal-form",
            title: "Search",
          })}
        />
      </Stack>
    </RealtimeProvider>
  );
}
