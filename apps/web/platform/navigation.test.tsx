/**
 * MUL-5208 — the web half of the `multica:navigate` bridge.
 *
 * Shared content (comments, chat, issue descriptions) fires this event whenever
 * a link resolves to an in-app destination, including an absolute URL on this
 * deployment's own origin. Desktop answers it by opening a tab; the web must
 * answer it with a router push, or those links silently do nothing.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import { WebNavigationProvider } from "./navigation";
import { useNavigation, type NavigationAdapter } from "@multica/views/navigation";

function navigate(path: string) {
  window.dispatchEvent(
    new CustomEvent("multica:navigate", { detail: { path } }),
  );
}

function renderWithRouter(children: React.ReactNode) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <WebNavigationProvider>{children}</WebNavigationProvider>
        ),
      },
    ],
    { initialEntries: ["/acme/issues"] },
  );
  const result = render(<RouterProvider router={router} />);
  return { ...result, router };
}

function renderAdapter(): {
  adapter: () => NavigationAdapter;
  router: ReturnType<typeof createMemoryRouter>;
} {
  let adapter: NavigationAdapter | null = null;
  function Probe() {
    adapter = useNavigation();
    return null;
  }
  const { router } = renderWithRouter(<Probe />);
  return { adapter: () => adapter!, router };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("WebNavigationProvider internal link bridge", () => {
  it("pushes the path a content link resolved to", () => {
    const { router } = renderWithRouter(null);

    act(() => navigate("/acme/issues/MUL-1"));

    expect(router.state.location.pathname).toBe("/acme/issues/MUL-1");
  });

  it("ignores an event without a path", () => {
    const { router } = renderWithRouter(null);

    act(() => {
      window.dispatchEvent(new CustomEvent("multica:navigate", { detail: {} }));
    });

    expect(router.state.location.pathname).toBe("/acme/issues");
  });

  it("stops listening once unmounted", () => {
    const { unmount, router } = renderWithRouter(null);

    unmount();
    act(() => navigate("/acme/issues/MUL-1"));

    expect(router.state.location.pathname).toBe("/acme/issues");
  });
});

/**
 * `canGoBack` decides whether a page whose subject was just deleted steps back
 * or replaces with a fallback. A wrong `true` walks the user out of Multica,
 * so the adapter must expose the browser's own answer and nothing derived.
 */
describe("WebNavigationProvider canGoBack", () => {
  const win = window as unknown as { navigation?: unknown };

  afterEach(() => {
    delete win.navigation;
  });

  it("passes through the Navigation API's answer", () => {
    win.navigation = { canGoBack: true };

    expect(renderAdapter().adapter().canGoBack!()).toBe(true);
  });

  it("reads the answer live rather than freezing it at render", () => {
    win.navigation = { canGoBack: true };
    const { adapter } = renderAdapter();

    win.navigation = { canGoBack: false };

    expect(adapter().canGoBack!()).toBe(false);
  });

  // Regression (PR review, twice): a count of `push` calls stood in for real
  // history here. It could not — Next drops a push to `replaceState` when the
  // canonical URL is unchanged, so a push that committed no entry still made
  // this claim `true`. Calling push must not move this answer at all.
  it("is unmoved by a push that committed no history entry", () => {
    win.navigation = { canGoBack: false };
    const { adapter, router } = renderAdapter();

    act(() => adapter().push("/acme/issues"));

    expect(router.state.location.pathname).toBe("/acme/issues");
    expect(adapter().canGoBack!()).toBe(false);
  });

  it("reports false where the browser cannot answer, so callers use the fallback", () => {
    expect(renderAdapter().adapter().canGoBack!()).toBe(false);
  });
});
