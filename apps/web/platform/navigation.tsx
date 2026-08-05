import { useEffect, useMemo } from "react";
import {
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  NavigationProvider,
  type NavigationAdapter,
} from "@multica/views/navigation";
import { canGoBackInApp } from "./in-app-history";

/**
 * Web half of the `multica:navigate` bridge — the event shared content
 * (comments, chat, issue descriptions) fires when a link resolves to an in-app
 * destination. Desktop's shell answers it by opening a tab; on the web the
 * equivalent is a router push in place. Without this the event has no listener
 * and such links do nothing at all.
 */
function useInternalLinkHandler(push: (path: string) => void) {
  useEffect(() => {
    const handler = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (!path) return;
      push(path);
    };
    window.addEventListener("multica:navigate", handler);
    return () => window.removeEventListener("multica:navigate", handler);
  }, [push]);
}

function NavigationProviderInner({
  children,
}: {
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const push = useMemo(
    () => (path: string) => navigate(path),
    [navigate],
  );
  const replace = useMemo(
    () => (path: string) => navigate(path, { replace: true }),
    [navigate],
  );
  const back = useMemo(() => () => navigate(-1), [navigate]);
  useInternalLinkHandler(push);

  const adapter: NavigationAdapter = {
    push,
    replace,
    back,
    canGoBack: canGoBackInApp,
    pathname,
    searchParams: new URLSearchParams(searchParams),
    getShareableUrl: (path: string) =>
      typeof window === "undefined" ? path : window.location.origin + path,
    prefetch: () => undefined,
  };

  return <NavigationProvider value={adapter}>{children}</NavigationProvider>;
}

export function WebNavigationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <NavigationProviderInner>{children}</NavigationProviderInner>;
}
