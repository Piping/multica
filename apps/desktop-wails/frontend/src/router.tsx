import { Suspense, useEffect } from "react";
import {
  MemoryRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@multica/core/auth";
import {
  paths,
  resolvePostAuthDestination,
  useHasOnboarded,
} from "@multica/core/paths";
import { workspaceListOptions } from "@multica/core/workspace/queries";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";
import { IssuesPage } from "@multica/views/issues/components/issues-page";
import { ProjectsPage } from "@multica/views/projects/components";
import { AutopilotsPage } from "@multica/views/autopilots/components";
import {
  AiCreateAgentPage,
  ChooseCreateMethodPage,
  ManualCreateAgentPage,
} from "@multica/views/agents";
import { BillingTestPage } from "@multica/views/billing";
import { ChatPage } from "@multica/views/chat";
import { InboxPage } from "@multica/views/inbox";
import { MyIssuesPage } from "@multica/views/my-issues";
import { SettingsPage } from "@multica/views/settings";
import { SkillsPage } from "@multica/views/skills";
import { SquadDetailPage, SquadsPage } from "@multica/views/squads";
import { DashboardPage } from "@multica/views/dashboard";
import { WailsNavigationProvider } from "./navigation";
import {
  AgentDetailRoutePage,
  AiBuilderSessionRoutePage,
  AttachmentPreviewRoutePage,
  AutopilotDetailRoutePage,
  DashboardShell,
  InvitationsRoute,
  IssueDetailRoutePage,
  LoginRoute,
  MemberDetailRoutePage,
  NewWorkspaceRoute,
  NotFoundRoute,
  OnboardingRoute,
  ProjectDetailRoutePage,
  RuntimeDetailRoutePage,
  RuntimeSettingsRoutePage,
  SkillDetailRoutePage,
} from "./pages";
import { WailsAgentsPage, WailsRuntimesPage } from "./runtime-context";
import { WorkspaceShell } from "./workspace-shell";

function RootRedirect() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.isLoading);
  const onboarded = useHasOnboarded();
  const { data: workspaces = [], isFetched } = useQuery({
    ...workspaceListOptions(),
    enabled: !!user,
  });

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate(paths.login(), { replace: true });
      return;
    }
    if (!isFetched) return;
    navigate(resolvePostAuthDestination(workspaces, onboarded), {
      replace: true,
    });
  }, [isFetched, loading, navigate, onboarded, user, workspaces]);

  return (
    <div className="flex h-svh items-center justify-center">
      <MulticaIcon className="size-6 animate-pulse" />
    </div>
  );
}

function NativeWindowBridge() {
  const navigate = useNavigate();

  useEffect(
    () =>
      window.desktopAPI.onAuthToken((token) => {
        void useAuthStore
          .getState()
          .loginWithToken(token)
          .then(() => navigate(paths.root(), { replace: true }));
      }),
    [navigate],
  );

  useEffect(
    () =>
      window.desktopAPI.onInviteOpen((invitationId) => {
        navigate(paths.invite(invitationId));
      }),
    [navigate],
  );

  useEffect(
    () =>
      window.desktopAPI.onInboxOpen(({ slug, issueKey }) => {
        if (!slug) return;
        navigate(
          `${paths.workspace(slug).inbox()}?issue=${encodeURIComponent(issueKey)}`,
        );
      }),
    [navigate],
  );

  useEffect(
    () =>
      window.desktopAPI.onCloseActiveTab(() => {
        window.desktopAPI.closeWindow();
      }),
    [],
  );

  return <Outlet />;
}

export function AppRouter() {
  const context = window.desktopAPI.windowContext;
  const documentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const initialPath =
    context.kind === "issue"
      ? context.path
      : window.location.pathname !== "/"
        ? documentPath
        : paths.root();

  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <WailsNavigationProvider>
        <Suspense
          fallback={
            <div className="flex h-svh items-center justify-center">
              <MulticaIcon className="size-6 animate-pulse" />
            </div>
          }
        >
          <Routes>
            <Route element={<NativeWindowBridge />}>
              <Route index element={<RootRedirect />} />
              <Route path="login" element={<LoginRoute />} />
              <Route path="onboarding" element={<OnboardingRoute />} />
              <Route path="invitations" element={<InvitationsRoute />} />
              <Route path="workspaces/new" element={<NewWorkspaceRoute />} />
              <Route path="invite/:id" element={<Navigate to="/" replace />} />

              <Route path=":workspaceSlug" element={<WorkspaceShell />}>
                <Route
                  path="attachments/:id/preview"
                  element={<AttachmentPreviewRoutePage />}
                />
                <Route element={<DashboardShell />}>
                  <Route index element={<Navigate to="issues" replace />} />
                  <Route path="issues" element={<IssuesPage />} />
                  <Route
                    path="issues/:id"
                    element={<IssueDetailRoutePage />}
                  />
                  <Route path="projects" element={<ProjectsPage />} />
                  <Route
                    path="projects/:id"
                    element={<ProjectDetailRoutePage />}
                  />
                  <Route path="autopilots" element={<AutopilotsPage />} />
                  <Route
                    path="autopilots/:id"
                    element={<AutopilotDetailRoutePage />}
                  />
                  <Route path="my-issues" element={<MyIssuesPage />} />
                  <Route path="runtimes" element={<WailsRuntimesPage />} />
                  <Route
                    path="runtimes/:id"
                    element={<RuntimeDetailRoutePage />}
                  />
                  <Route
                    path="runtimes/:id/runtime/:runtimeId"
                    element={<RuntimeSettingsRoutePage />}
                  />
                  <Route path="skills" element={<SkillsPage />} />
                  <Route
                    path="skills/:id"
                    element={<SkillDetailRoutePage />}
                  />
                  <Route path="agents" element={<WailsAgentsPage />} />
                  <Route
                    path="agents/new"
                    element={<ChooseCreateMethodPage />}
                  />
                  <Route
                    path="agents/new/manual"
                    element={<ManualCreateAgentPage />}
                  />
                  <Route
                    path="agents/new/ai"
                    element={<AiCreateAgentPage />}
                  />
                  <Route
                    path="agents/new/ai/:sessionId"
                    element={<AiBuilderSessionRoutePage />}
                  />
                  <Route
                    path="agents/:id"
                    element={<AgentDetailRoutePage />}
                  />
                  <Route
                    path="members/:id"
                    element={<MemberDetailRoutePage />}
                  />
                  <Route path="squads" element={<SquadsPage />} />
                  <Route path="squads/:id" element={<SquadDetailPage />} />
                  <Route path="inbox" element={<InboxPage />} />
                  <Route path="chat" element={<ChatPage />} />
                  <Route path="billing" element={<BillingTestPage />} />
                  <Route path="usage" element={<DashboardPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
              </Route>
              <Route path="*" element={<NotFoundRoute />} />
            </Route>
          </Routes>
        </Suspense>
      </WailsNavigationProvider>
    </MemoryRouter>
  );
}
