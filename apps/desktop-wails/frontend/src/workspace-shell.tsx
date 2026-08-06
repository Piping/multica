import { useEffect } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@multica/core/auth";
import { paths, WorkspaceSlugProvider } from "@multica/core/paths";
import { setCurrentWorkspace } from "@multica/core/platform";
import { workspaceBySlugOptions } from "@multica/core/workspace";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";
import { NoAccessPage } from "@multica/views/workspace/no-access-page";
import { WelcomeAfterOnboarding } from "@multica/views/workspace/welcome-after-onboarding";
import { useWorkspaceSeen } from "@multica/views/workspace/use-workspace-seen";

export function WorkspaceShell() {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const authLoading = useAuthStore((state) => state.isLoading);
  const { data: workspace, isFetched } = useQuery({
    ...workspaceBySlugOptions(workspaceSlug),
    enabled: !!user && !!workspaceSlug,
  });
  const seen = useWorkspaceSeen(workspaceSlug, !!workspace);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate(paths.login(), { replace: true });
    }
  }, [authLoading, navigate, user]);

  useEffect(() => {
    setCurrentWorkspace(
      workspace ? workspaceSlug : null,
      workspace?.id ?? null,
    );
    return () => setCurrentWorkspace(null, null);
  }, [workspace, workspaceSlug]);

  if (authLoading || (!!user && !isFetched)) {
    return (
      <div className="flex h-svh items-center justify-center">
        <MulticaIcon className="size-6 animate-pulse" />
      </div>
    );
  }
  if (!user) return null;
  if (!workspace) return seen ? null : <NoAccessPage />;

  return (
    <WorkspaceSlugProvider slug={workspaceSlug}>
      <Outlet />
      <WelcomeAfterOnboarding />
    </WorkspaceSlugProvider>
  );
}
