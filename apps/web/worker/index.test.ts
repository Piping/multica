import { afterEach, describe, expect, it, vi } from "vitest";
import { createUpstreamRequest, handleRequest, type Env } from "./index";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    MULTICA_ORIGIN_URL: "https://origin.multica.example",
    STATIC_ORIGIN_URL: "https://static.multica.example",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Cloudflare Worker routing", () => {
  it.each([
    "/api/config",
    "/auth/send-code",
    "/uploads/workspaces/avatar.png",
    "/ws",
  ])("proxies %s to the backend origin", async (path) => {
    const upstreamFetch = vi.fn(async () => new Response("backend"));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await handleRequest(
      new Request(`https://multica.diff.host${path}?a=1`),
      makeEnv(),
    );

    expect(await response.text()).toBe("backend");
    const upstream = upstreamFetch.mock.calls[0]![0] as Request;
    expect(upstream.url).toBe(
      `https://origin.multica.example${path}?a=1`,
    );
    expect(upstream.headers.get("x-forwarded-host")).toBe(
      "multica.diff.host",
    );
  });

  it.each(["/", "/login", "/acme/issues/123", "/auth/callback"])(
    "proxies %s to the static origin",
    async (path) => {
      const upstreamFetch = vi.fn(async () => new Response("asset"));
      vi.stubGlobal("fetch", upstreamFetch);

      const response = await handleRequest(
        new Request(`https://multica.diff.host${path}`),
        makeEnv(),
      );

      expect(await response.text()).toBe("asset");
      const upstream = upstreamFetch.mock.calls[0]![0] as Request;
      expect(upstream.url).toBe(`https://static.multica.example${path}`);
    },
  );

  it("uses the optional docs origin only for docs paths", async () => {
    const upstreamFetch = vi.fn(async () => new Response("docs"));
    vi.stubGlobal("fetch", upstreamFetch);

    await handleRequest(
      new Request("https://multica.diff.host/docs/agents"),
      makeEnv({ DOCS_ORIGIN_URL: "https://docs.example/base" }),
    );

    const upstream = upstreamFetch.mock.calls[0]![0] as Request;
    expect(upstream.url).toBe("https://docs.example/base/docs/agents");
  });

  it("retries one failed static read", async () => {
    const upstreamFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 522 }))
      .mockResolvedValueOnce(new Response("asset"));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await handleRequest(
      new Request("https://multica.diff.host/login"),
      makeEnv(),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("asset");
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry backend writes", async () => {
    const upstreamFetch = vi.fn(async () => {
      return new Response("backend unavailable", { status: 503 });
    });
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await handleRequest(
      new Request("https://multica.diff.host/auth/send-code", {
        method: "POST",
        body: "{}",
      }),
      makeEnv(),
    );

    expect(response.status).toBe(503);
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it("marks hashed static assets immutable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("javascript")),
    );

    const response = await handleRequest(
      new Request("https://multica.diff.host/assets/index-abc123.js"),
      makeEnv(),
    );

    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("preserves method, body, and same-origin cookie", async () => {
    const upstreamFetch = vi.fn(async (request: Request) => {
      expect(request.method).toBe("POST");
      expect(request.headers.get("cookie")).toBe("session=abc");
      expect(await request.text()).toBe('{"email":"a@example.com"}');
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await handleRequest(
      new Request("https://multica.diff.host/auth/send-code", {
        method: "POST",
        headers: {
          cookie: "session=abc",
          "content-type": "application/json",
        },
        body: '{"email":"a@example.com"}',
      }),
      makeEnv(),
    );

    expect(response.status).toBe(204);
  });

  it("rejects an upstream pointing back at the Worker origin", () => {
    expect(() =>
      createUpstreamRequest(
        new Request("https://multica.diff.host/api/config"),
        "https://multica.diff.host",
      ),
    ).toThrow("different origin");
  });
});
