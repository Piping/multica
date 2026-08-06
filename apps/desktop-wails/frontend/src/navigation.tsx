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

function canGoBack(): boolean {
  const navigation = (
    window as unknown as { navigation?: { canGoBack?: unknown } }
  ).navigation;
  return navigation?.canGoBack === true;
}

export function WailsNavigationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const appUrl = window.desktopAPI.runtimeConfig.ok
    ? window.desktopAPI.runtimeConfig.config.appUrl
    : "";

  const adapter = useMemo<NavigationAdapter>(
    () => ({
      push: (path) => navigate(path),
      replace: (path) => navigate(path, { replace: true }),
      back: () => navigate(-1),
      canGoBack,
      pathname,
      searchParams: new URLSearchParams(searchParams),
      getShareableUrl: (path) => `${appUrl}${path}`,
      prefetch: () => undefined,
    }),
    [appUrl, navigate, pathname, searchParams],
  );

  useEffect(() => {
    const navigateInternal = (event: Event) => {
      const path = (event as CustomEvent<{ path?: string }>).detail?.path;
      if (path) navigate(path);
    };
    window.addEventListener("multica:navigate", navigateInternal);
    return () =>
      window.removeEventListener("multica:navigate", navigateInternal);
  }, [navigate]);

  useEffect(
    () =>
      window.desktopAPI.onNavigationGesture((gesture) => {
        navigate(gesture === "back" ? -1 : 1);
      }),
    [navigate],
  );

  return (
    <NavigationProvider value={adapter}>{children}</NavigationProvider>
  );
}
