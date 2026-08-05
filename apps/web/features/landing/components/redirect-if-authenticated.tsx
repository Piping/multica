"use client";

import { useEffect } from "react";
import { useRouter } from "@/platform/router-compat";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@multica/core/auth";
import { workspaceListOptions } from "@multica/core/workspace";
import { resolvePostAuthDestination, useHasOnboarded } from "@multica/core/paths";
import { isOfficialMarketingHost } from "@/lib/public-host";

/**
 * Client-side fallback redirect for authenticated visitors on the landing page.
 *
 * The SPA resolves authenticated root visits after the workspace list is
 * available. The last workspace cookie remains useful to other clients, but
 * browser navigation no longer relies on server-render middleware.
 *
 * On the official marketing origins, `/` must remain public even for logged-in
 * users. Explicit workspace routes still open the app.
 *
 * Renders nothing. Uses `router.replace` so the landing page never enters
 * browser history for authenticated users.
 */
export function RedirectIfAuthenticated() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const hasOnboarded = useHasOnboarded();

  const { data: list = [], isFetched } = useQuery({
    ...workspaceListOptions(),
    enabled: !!user,
  });

  useEffect(() => {
    if (isLoading || !user || !isFetched) return;
    if (isOfficialMarketingHost(window.location.hostname)) return;
    router.replace(resolvePostAuthDestination(list, hasOnboarded));
  }, [isLoading, user, isFetched, list, hasOnboarded, router]);

  return null;
}
