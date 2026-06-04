import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PWARegistration } from "./pwa-registration";

const originalServiceWorker = Object.getOwnPropertyDescriptor(window.navigator, "serviceWorker");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (originalServiceWorker) {
    Object.defineProperty(window.navigator, "serviceWorker", originalServiceWorker);
  } else {
    Reflect.deleteProperty(window.navigator, "serviceWorker");
  }
});

describe("PWARegistration", () => {
  it("registers the service worker in production", async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    vi.stubEnv("NODE_ENV", "production");
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });

    render(<PWARegistration />);

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
    });
  });

  it("skips registration outside production", () => {
    const register = vi.fn();
    vi.stubEnv("NODE_ENV", "test");
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });

    render(<PWARegistration />);

    expect(register).not.toHaveBeenCalled();
  });
});
