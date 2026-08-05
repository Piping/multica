export interface Env {
  MULTICA_ORIGIN_URL: string;
  STATIC_ORIGIN_URL: string;
  DOCS_ORIGIN_URL?: string;
}

function isFrontendAuthPath(pathname: string): boolean {
  return (
    pathname === "/auth/callback" ||
    pathname.startsWith("/auth/callback/") ||
    pathname === "/auth/hg-sso/callback" ||
    pathname.startsWith("/auth/hg-sso/callback/")
  );
}

function isBackendPath(pathname: string): boolean {
  if (pathname === "/api" || pathname.startsWith("/api/")) return true;
  if (pathname === "/uploads" || pathname.startsWith("/uploads/")) return true;
  if (pathname === "/ws") return true;
  return (
    !isFrontendAuthPath(pathname) &&
    (pathname === "/auth" || pathname.startsWith("/auth/"))
  );
}

function upstreamForPath(pathname: string, env: Env): string | undefined {
  if (isBackendPath(pathname)) return env.MULTICA_ORIGIN_URL;
  if (
    env.DOCS_ORIGIN_URL &&
    (pathname === "/docs" || pathname.startsWith("/docs/"))
  ) {
    return env.DOCS_ORIGIN_URL;
  }
  return env.STATIC_ORIGIN_URL;
}

export function createUpstreamRequest(
  request: Request,
  upstream: string,
): Request {
  const incoming = new URL(request.url);
  const target = new URL(upstream);
  if (incoming.origin === target.origin) {
    throw new Error("Worker upstream must use a different origin");
  }

  target.pathname = `${target.pathname.replace(/\/+$/, "")}${incoming.pathname}`;
  target.search = incoming.search;
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.slice(0, -1));

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
    redirect: "manual",
  };
  if (init.body) init.duplex = "half";
  return new Request(target, init);
}

function withStaticCacheHeaders(request: Request, response: Response): Response {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/assets/") || response.status !== 200) {
    return response;
  }

  const cached = new Response(response.body, response);
  cached.headers.set("cache-control", "public, max-age=31536000, immutable");
  return cached;
}

export async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const upstream = upstreamForPath(pathname, env);

  try {
    const response = await fetch(createUpstreamRequest(request, upstream));
    const isStaticRead =
      upstream === env.STATIC_ORIGIN_URL &&
      (request.method === "GET" || request.method === "HEAD");
    if (isStaticRead && response.status >= 500) {
      const retry = await fetch(createUpstreamRequest(request, upstream));
      return withStaticCacheHeaders(request, retry);
    }
    return withStaticCacheHeaders(request, response);
  } catch (error) {
    console.error("[proxy] upstream request failed", error);
    return new Response("Upstream unavailable", { status: 502 });
  }
}

export default {
  fetch: handleRequest,
};
