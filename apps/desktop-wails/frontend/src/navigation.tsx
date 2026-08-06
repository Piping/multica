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

  useEffect(() => {
    const preventInternalDocumentNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      ) {
        return;
      }
      const url = new URL(anchor.href, window.location.href);
      if (
        url.origin !== window.location.origin ||
        !url.pathname.startsWith("/")
      ) {
        return;
      }
      event.preventDefault();
    };
    // Capture before drag-and-drop ancestors can stop propagation. AppLink's
    // React handler still receives the event and owns the MemoryRouter push;
    // this listener only suppresses WebKit's native document navigation.
    document.addEventListener("click", preventInternalDocumentNavigation, true);
    return () =>
      document.removeEventListener(
        "click",
        preventInternalDocumentNavigation,
        true,
      );
  }, []);

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
