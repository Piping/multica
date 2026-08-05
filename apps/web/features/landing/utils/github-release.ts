import {
  parseReleaseAssets,
  type DownloadAssets,
} from "./parse-release-assets";

/**
 * Browser fetcher for the latest Multica release. The public GitHub API is
 * queried after the download page mounts; failures degrade to links to the
 * releases page instead of blocking the static application.
 *
 * Desktop assets don't all land at the same time: CI uploads Linux
 * and Windows within a minute of each other, but macOS is packaged
 * manually (notarization credentials aren't wired into CI yet) and
 * lands tens of minutes later. To avoid showing the half-filled
 * mid-flight state on /download, the fetcher pulls the two most
 * recent releases and falls back to the previous one for the first
 * hour after publish. Empirically full desktop uploads complete in
 * ~20 min; 1 h gives 3x buffer for commonly-variable manual steps.
 *
 * On any failure (network, rate limit, malformed payload) returns a
 * `null`-shaped result and logs — the page degrades to a "version
 * unavailable" view rather than 500ing.
 */

export interface LatestRelease {
  version: string | null;
  publishedAt: string | null;
  htmlUrl: string | null;
  assets: DownloadAssets;
}

const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/multica-ai/multica/releases?per_page=2";

const FRESH_RELEASE_WINDOW_MS = 60 * 60 * 1000;

interface GitHubReleasePayload {
  tag_name?: string;
  published_at?: string;
  html_url?: string;
  prerelease?: boolean;
  draft?: boolean;
  assets?: Array<{ name: string; browser_download_url: string }>;
}

export async function fetchLatestRelease(): Promise<LatestRelease> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  try {
    const res = await fetch(GITHUB_RELEASES_URL, {
      headers,
    });
    if (!res.ok) {
      throw new Error(`GitHub API responded ${res.status}`);
    }
    const data = (await res.json()) as GitHubReleasePayload[];

    // Defensive filter — Multica doesn't publish prereleases or drafts
    // today, but the endpoint returns them if that ever changes. A
    // prerelease shadowing a stable version on /download would be a
    // regression.
    const stable = data.filter((r) => !r.prerelease && !r.draft);
    const latest = stable[0];
    if (!latest) {
      return emptyRelease();
    }
    const previous = stable[1];
    const chosen =
      previous && isWithinFreshWindow(latest) ? previous : latest;

    return {
      version: chosen.tag_name ?? null,
      publishedAt: chosen.published_at ?? null,
      htmlUrl: chosen.html_url ?? null,
      assets: parseReleaseAssets(chosen.assets ?? []),
    };
  } catch (err) {
    console.warn("[download] fetchLatestRelease failed:", err);
    return emptyRelease();
  }
}

function isWithinFreshWindow(release: GitHubReleasePayload): boolean {
  if (!release.published_at) return false;
  const publishedAt = Date.parse(release.published_at);
  if (Number.isNaN(publishedAt)) return false;
  return Date.now() - publishedAt < FRESH_RELEASE_WINDOW_MS;
}

function emptyRelease(): LatestRelease {
  return {
    version: null,
    publishedAt: null,
    htmlUrl: null,
    assets: {},
  };
}
