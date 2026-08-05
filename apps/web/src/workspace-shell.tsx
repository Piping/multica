import { useEffect } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { WorkspaceSlugProvider, paths } from "@multica/core/paths";
import { workspaceBySlugOptions } from "@multica/core/workspace";
import { setCurrentWorkspace } from "@multica/core/platform";
import { useAuthStore } from "@multica/core/auth";
import { NoAccessPage } from "@multica/views/workspace/no-access-page";
import { WelcomeAfterOnboarding } from "@multica/views/workspace/welcome-after-onboarding";
import { useWorkspaceSeen } from "@multica/views/workspace/use-workspace-seen";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";

export function WorkspaceShell() {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const isAuthLoading = useAuthStore((state) => state.isLoading);
  const { data: workspace, isFetched } = useQuery({
    ...workspaceBySlugOptions(workspaceSlug),
    enabled: !!user && !!workspaceSlug,
  });

  useEffect(() => {
    if (!isAuthLoading && !user) {
      navigate(paths.login(), { replace: true });
    } else if (user?.onboarded_at == null) {
      navigate(paths.onboarding(), { replace: true });
    }
  }, [isAuthLoading, navigate, user]);

  if (workspace) {
    setCurrentWorkspace(workspaceSlug, workspace.id);
  }

  useEffect(() => {
    if (!workspace) return;
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `last_workspace_slug=${encodeURIComponent(workspaceSlug)}; path=/; max-age=31536000; SameSite=Lax${secure}`;
  }, [workspace, workspaceSlug]);

  const hasBeenSeen = useWorkspaceSeen(workspaceSlug, !!workspace);
  const loading = (
    <div className="flex h-svh items-center justify-center">
      <MulticaIcon className="size-6 animate-pulse" />
    </div>
  );

  if (isAuthLoading || (!!user && !isFetched)) return loading;
  if (!user) return null;
  if (!workspace) return hasBeenSeen ? null : <NoAccessPage />;

  return (
    <WorkspaceSlugProvider slug={workspaceSlug}>
      <Outlet />
      <WelcomeAfterOnboarding />
    </WorkspaceSlugProvider>
  );
}
