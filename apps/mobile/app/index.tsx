import { Redirect } from "expo-router";
import { AppLaunchSkeleton } from "@/components/app/app-launch-skeleton";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";

/**
 * Entry redirect. AuthInitializer (in _layout.tsx) finishes auth + slug
 * hydration before this renders meaningfully — until then, isLoading is true.
 *
 *   no user            → /login
 *   user, no slug      → /select-workspace
 *   user, slug         → /[slug]/chat
 */
export default function Index() {
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const slug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  if (isLoading) {
    return <AppLaunchSkeleton />;
  }

  if (!user) return <Redirect href="/login" />;
  if (!slug) return <Redirect href="/select-workspace" />;
  return <Redirect href={`/${slug}/chat`} />;
}
