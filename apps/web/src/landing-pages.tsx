import { useEffect, useState } from "react";
import { MulticaLanding } from "@/features/landing/components/multica-landing";
import { RedirectIfAuthenticated } from "@/features/landing/components/redirect-if-authenticated";
import { AboutPageClient } from "@/features/landing/components/about-page-client";
import { ChangelogPageClient } from "@/features/landing/components/changelog-page-client";
import { ContactSalesPageClient } from "@/features/landing/components/contact-sales-page-client";
import { DownloadClient } from "./pages/landing/download-page";
import {
  fetchLatestRelease,
  type LatestRelease,
} from "@/features/landing/utils/github-release";

const EMPTY_RELEASE: LatestRelease = {
  version: null,
  publishedAt: null,
  htmlUrl: null,
  assets: {},
};

export function LandingPage() {
  return (
    <>
      <RedirectIfAuthenticated />
      <MulticaLanding />
    </>
  );
}

export function HomepagePage() {
  return <MulticaLanding />;
}

export { AboutPageClient as AboutPage };
export { ChangelogPageClient as ChangelogPage };
export { ContactSalesPageClient as ContactSalesPage };

export function DownloadPage() {
  const [release, setRelease] = useState<LatestRelease>(EMPTY_RELEASE);

  useEffect(() => {
    let active = true;
    void fetchLatestRelease().then((value) => {
      if (active) setRelease(value);
    });
    return () => {
      active = false;
    };
  }, []);

  return <DownloadClient release={release} />;
}
