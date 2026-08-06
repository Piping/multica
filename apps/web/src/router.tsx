import { lazy, Suspense, type ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useStartPageStore } from "@multica/core/navigation";
import { resolveWorkspaceStartPath } from "@multica/core/paths";
import { useRequiredWorkspaceSlug } from "@multica/core/paths";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";

function lazyNamed<T extends Record<string, ComponentType>>(
  loader: () => Promise<T>,
  name: keyof T,
) {
  return lazy(async () => ({ default: (await loader())[name] }));
}

const LandingShell = lazyNamed(() => import("./landing-shell"), "LandingShell");
const LandingPage = lazyNamed(() => import("./landing-pages"), "LandingPage");
const HomepagePage = lazyNamed(() => import("./landing-pages"), "HomepagePage");
const AboutPage = lazyNamed(() => import("./landing-pages"), "AboutPage");
const ChangelogPage = lazyNamed(
  () => import("./landing-pages"),
  "ChangelogPage",
);
const ContactSalesPage = lazyNamed(
  () => import("./landing-pages"),
  "ContactSalesPage",
);
const DownloadPage = lazyNamed(() => import("./landing-pages"), "DownloadPage");
const UseCasesIndexPage = lazyNamed(
  () => import("./use-case-pages"),
  "UseCasesIndexPage",
);
const UseCasePage = lazyNamed(() => import("./use-case-pages"), "UseCasePage");

const LoginPage = lazy(() => import("./pages/auth/login-page"));
const OnboardingPage = lazy(() => import("./pages/auth/onboarding-page"));
const InvitationsPage = lazy(() => import("./pages/auth/invitations-page"));
const InvitePage = lazy(() => import("./pages/auth/invite-page"));
const NewWorkspacePage = lazy(() => import("./pages/auth/new-workspace-page"));
const AuthCallbackPage = lazy(() => import("./pages/auth/auth-callback-page"));
const LarkBindPage = lazy(
  () => import("./pages/integrations/lark-bind-page"),
);
const SlackBindPage = lazy(
  () => import("./pages/integrations/slack-bind-page"),
);

const WorkspaceShell = lazyNamed(
  () => import("./workspace-shell"),
  "WorkspaceShell",
);
const DashboardShell = lazyNamed(
  () => import("./dashboard-shell"),
  "DashboardShell",
);
const NotFoundPage = lazyNamed(
  () => import("./not-found-page"),
  "NotFoundPage",
);

const workspacePages = () => import("./workspace-pages");
const detailPages = () => import("./route-pages");
const IssuesPage = lazyNamed(workspacePages, "IssuesPage");
const ProjectsPage = lazyNamed(workspacePages, "ProjectsPage");
const AutopilotsPage = lazyNamed(workspacePages, "AutopilotsPage");
const MyIssuesPage = lazyNamed(workspacePages, "MyIssuesPage");
const WebRuntimesPage = lazyNamed(workspacePages, "WebRuntimesPage");
const SkillsPage = lazyNamed(workspacePages, "SkillsPage");
const AgentsPage = lazyNamed(workspacePages, "AgentsPage");
const ChooseCreateMethodPage = lazyNamed(
  workspacePages,
  "ChooseCreateMethodPage",
);
const ManualCreateAgentPage = lazyNamed(
  workspacePages,
  "ManualCreateAgentPage",
);
const AiCreateAgentPage = lazyNamed(workspacePages, "AiCreateAgentPage");
const SquadsPage = lazyNamed(workspacePages, "SquadsPage");
const SquadDetailPage = lazyNamed(workspacePages, "SquadDetailPage");
const InboxPage = lazyNamed(workspacePages, "InboxPage");
const ChatPage = lazyNamed(workspacePages, "ChatPage");
const BillingTestPage = lazyNamed(workspacePages, "BillingTestPage");
const DashboardPage = lazyNamed(workspacePages, "DashboardPage");
const SettingsPage = lazyNamed(workspacePages, "SettingsPage");
const IssueDetailRoutePage = lazyNamed(detailPages, "IssueDetailRoutePage");
const ProjectDetailRoutePage = lazyNamed(detailPages, "ProjectDetailRoutePage");
const AutopilotDetailRoutePage = lazyNamed(
  detailPages,
  "AutopilotDetailRoutePage",
);
const AgentDetailRoutePage = lazyNamed(detailPages, "AgentDetailRoutePage");
const AiBuilderSessionRoutePage = lazyNamed(
  detailPages,
  "AiBuilderSessionRoutePage",
);
const MemberDetailRoutePage = lazyNamed(detailPages, "MemberDetailRoutePage");
const RuntimeDetailRoutePage = lazyNamed(detailPages, "RuntimeDetailRoutePage");
const RuntimeSettingsRoutePage = lazyNamed(
  detailPages,
  "RuntimeSettingsRoutePage",
);
const SkillDetailRoutePage = lazyNamed(detailPages, "SkillDetailRoutePage");
const AttachmentPreviewRoutePage = lazyNamed(
  detailPages,
  "AttachmentPreviewRoutePage",
);

function WorkspaceIndexRedirect() {
  const slug = useRequiredWorkspaceSlug();
  const startPage = useStartPageStore((state) => state.startPage);
  return <Navigate to={resolveWorkspaceStartPath(slug, startPage)} replace />;
}

export function AppRouter() {
  return (
    <Suspense
      fallback={
        <div className="flex h-svh items-center justify-center">
          <MulticaIcon className="size-6 animate-pulse" />
        </div>
      }
    >
      <Routes>
      <Route element={<LandingShell />}>
        <Route index element={<LandingPage />} />
        <Route path="homepage" element={<HomepagePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="changelog" element={<ChangelogPage />} />
        <Route path="contact-sales" element={<ContactSalesPage />} />
        <Route path="download" element={<DownloadPage />} />
        <Route path="usecases" element={<UseCasesIndexPage />} />
        <Route path="usecases/:slug" element={<UseCasePage />} />
      </Route>

      <Route path="login" element={<LoginPage />} />
      <Route path="onboarding" element={<OnboardingPage />} />
      <Route path="invitations" element={<InvitationsPage />} />
      <Route path="invite/:id" element={<InvitePage />} />
      <Route path="workspaces/new" element={<NewWorkspacePage />} />
      <Route path="auth/callback" element={<AuthCallbackPage />} />
      <Route path="lark/bind" element={<LarkBindPage />} />
      <Route path="slack/bind" element={<SlackBindPage />} />

      <Route path=":workspaceSlug" element={<WorkspaceShell />}>
        <Route
          path="attachments/:id/preview"
          element={<AttachmentPreviewRoutePage />}
        />
        <Route element={<DashboardShell />}>
          <Route index element={<WorkspaceIndexRedirect />} />
          <Route path="issues" element={<IssuesPage />} />
          <Route path="issues/:id" element={<IssueDetailRoutePage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectDetailRoutePage />} />
          <Route path="autopilots" element={<AutopilotsPage />} />
          <Route
            path="autopilots/:id"
            element={<AutopilotDetailRoutePage />}
          />
          <Route path="my-issues" element={<MyIssuesPage />} />
          <Route
            path="runtimes"
            element={<WebRuntimesPage />}
          />
          <Route path="runtimes/:id" element={<RuntimeDetailRoutePage />} />
          <Route
            path="runtimes/:id/runtime/:runtimeId"
            element={<RuntimeSettingsRoutePage />}
          />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="skills/:id" element={<SkillDetailRoutePage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/new" element={<ChooseCreateMethodPage />} />
          <Route path="agents/new/manual" element={<ManualCreateAgentPage />} />
          <Route path="agents/new/ai" element={<AiCreateAgentPage />} />
          <Route
            path="agents/new/ai/:sessionId"
            element={<AiBuilderSessionRoutePage />}
          />
          <Route path="agents/:id" element={<AgentDetailRoutePage />} />
          <Route path="members/:id" element={<MemberDetailRoutePage />} />
          <Route path="squads" element={<SquadsPage />} />
          <Route path="squads/:id" element={<SquadDetailPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="billing" element={<BillingTestPage />} />
          <Route path="usage" element={<DashboardPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
