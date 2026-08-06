import { useEffect, useRef } from "react";
import {
  Outlet,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorBoundary } from "@multica/ui/components/common/error-boundary";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";
import { useAuthStore } from "@multica/core/auth";
import { api } from "@multica/core/api";
import {
  paths,
  resolvePostAuthDestination,
  useHasOnboarded,
} from "@multica/core/paths";
import type { Workspace } from "@multica/core/types";
import {
  workspaceKeys,
  workspaceListOptions,
} from "@multica/core/workspace/queries";
import { LoginPage } from "@multica/views/auth";
import { InvitationsPage } from "@multica/views/invitations";
import { CliInstallInstructions, OnboardingFlow } from "@multica/views/onboarding";
import { NewWorkspacePage } from "@multica/views/workspace/new-workspace-page";
import { IssueDetailRoute } from "@multica/views/issues/components";
import { ProjectDetail } from "@multica/views/projects/components";
import { AutopilotDetailPage } from "@multica/views/autopilots/components";
import { AgentDetailPage, AiBuilderSessionPage } from "@multica/views/agents";
import { MemberDetailPage } from "@multica/views/members";
import {
  RuntimeDetailPage,
  RuntimeSettingsPage,
} from "@multica/views/runtimes";
import { SkillDetailPage } from "@multica/views/skills";
import { AttachmentPreviewPage } from "@multica/views/attachments";
import { DashboardLayout } from "@multica/views/layout";
import { SearchCommand, SearchTrigger } from "@multica/views/search";
import { FloatingChat } from "@multica/views/chat";

async function resolveLoginDestination(
  workspaces: Workspace[],
): Promise<string> {
  const onboarded = useAuthStore.getState().user?.onboarded_at != null;
  if (!onboarded) {
    try {
      if ((await api.listMyInvitations()).length > 0) {
        return paths.invitations();
      }
    } catch {
      // The standard resolver remains a usable fallback.
    }
  }
  return resolvePostAuthDestination(workspaces, onboarded);
}

export function LoginRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.isLoading);
  const appUrl = window.desktopAPI.runtimeConfig.ok
    ? window.desktopAPI.runtimeConfig.config.appUrl
    : "";

  useEffect(() => {
    if (loading || !user) return;
    void queryClient
      .ensureQueryData(workspaceListOptions())
      .then(resolveLoginDestination)
      .then((path) => navigate(path, { replace: true }));
  }, [loading, navigate, queryClient, user]);

  return (
    <div className="flex h-svh flex-col">
      <div
        aria-hidden
        className="h-12 shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />
      <LoginPage
        logo={<MulticaIcon bordered size="lg" />}
        onSuccess={() => {
          const list =
            queryClient.getQueryData<Workspace[]>(workspaceKeys.list()) ?? [];
          void resolveLoginDestination(list).then((path) => navigate(path));
        }}
        onGoogleLogin={() => {
          void window.desktopAPI.openExternal(
            `${appUrl}/login?platform=desktop`,
          );
        }}
      />
    </div>
  );
}

export function DashboardShell() {
  return (
    <DashboardLayout
      loadingIndicator={<MulticaIcon className="size-6" />}
      sidebarCollapsible={false}
      sidebarTopSlot={<WailsTitlebarSpacer />}
      searchSlot={<SearchTrigger />}
      extra={
        <>
          <SearchCommand />
          <FloatingChat />
        </>
      }
    >
      <Outlet />
    </DashboardLayout>
  );
}

function WailsTitlebarSpacer() {
  return (
    <div
      aria-hidden
      className="h-12 shrink-0"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    />
  );
}

export function OnboardingRoute() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.isLoading);
  const onboarded = useHasOnboarded();
  const { data: workspaces = [], isFetched } = useQuery({
    ...workspaceListOptions(),
    enabled: !!user,
  });
  const completing = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate(paths.login(), { replace: true });
      return;
    }
    if (isFetched && onboarded && !completing.current) {
      navigate(resolvePostAuthDestination(workspaces, true), {
        replace: true,
      });
    }
  }, [isFetched, loading, navigate, onboarded, user, workspaces]);

  if (loading || !user || onboarded) return null;
  return (
    <div className="h-full overflow-y-auto bg-background">
      <OnboardingFlow
        runtimeInstructions={<CliInstallInstructions />}
        onRuntimeRefresh={async () => {
          await window.daemonAPI.restart();
        }}
        onComplete={(workspace, issueId) => {
          completing.current = true;
          if (workspace && issueId) {
            navigate(paths.workspace(workspace.slug).issueDetail(issueId));
          } else if (workspace) {
            navigate(paths.workspace(workspace.slug).issues());
          } else {
            navigate(paths.root());
          }
        }}
      />
    </div>
  );
}

export function InvitationsRoute() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.isLoading);
  useEffect(() => {
    if (!loading && !user) navigate(paths.login(), { replace: true });
  }, [loading, navigate, user]);
  return loading || !user ? null : <InvitationsPage />;
}

export function NewWorkspaceRoute() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.isLoading);
  const { data: workspaces = [] } = useQuery({
    ...workspaceListOptions(),
    enabled: !!user,
  });
  useEffect(() => {
    if (!loading && !user) navigate(paths.login(), { replace: true });
  }, [loading, navigate, user]);
  if (loading || !user) return null;
  return (
    <NewWorkspacePage
      onSuccess={(workspace) =>
        navigate(paths.workspace(workspace.slug).issues())
      }
      onBack={
        workspaces.length > 0 ? () => navigate(paths.root()) : undefined
      }
    />
  );
}

function requiredParam(
  name: string,
  params: Record<string, string | undefined>,
): string {
  const value = params[name];
  if (!value) throw new Error(`Missing route parameter: ${name}`);
  return value;
}

export function IssueDetailRoutePage() {
  const id = requiredParam("id", useParams());
  return (
    <ErrorBoundary resetKeys={[id]}>
      <IssueDetailRoute routeId={id} />
    </ErrorBoundary>
  );
}

export function ProjectDetailRoutePage() {
  return <ProjectDetail projectId={requiredParam("id", useParams())} />;
}

export function AutopilotDetailRoutePage() {
  return <AutopilotDetailPage autopilotId={requiredParam("id", useParams())} />;
}

export function AgentDetailRoutePage() {
  return <AgentDetailPage agentId={requiredParam("id", useParams())} />;
}

export function AiBuilderSessionRoutePage() {
  return (
    <AiBuilderSessionPage
      sessionId={requiredParam("sessionId", useParams())}
    />
  );
}

export function MemberDetailRoutePage() {
  return <MemberDetailPage userId={requiredParam("id", useParams())} />;
}

export function RuntimeDetailRoutePage() {
  return <RuntimeDetailPage runtimeId={requiredParam("id", useParams())} />;
}

export function RuntimeSettingsRoutePage() {
  const params = useParams();
  return (
    <RuntimeSettingsPage
      machineId={requiredParam("id", params)}
      runtimeId={requiredParam("runtimeId", params)}
    />
  );
}

export function SkillDetailRoutePage() {
  return <SkillDetailPage skillId={requiredParam("id", useParams())} />;
}

export function AttachmentPreviewRoutePage() {
  const id = requiredParam("id", useParams());
  const [search] = useSearchParams();
  return (
    <ErrorBoundary resetKeys={[id]}>
      <AttachmentPreviewPage
        attachmentId={id}
        filename={search.get("name") ?? undefined}
      />
    </ErrorBoundary>
  );
}

export function NotFoundRoute() {
  const navigate = useNavigate();
  return (
    <div className="flex h-svh flex-col items-center justify-center gap-4 bg-background">
      <p className="text-body text-muted-foreground">Page not found</p>
      <button
        type="button"
        className="text-body font-medium underline"
        onClick={() => navigate(paths.root())}
      >
        Return to Multica
      </button>
    </div>
  );
}
