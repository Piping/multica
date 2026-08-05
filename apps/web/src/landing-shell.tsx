import { Outlet } from "react-router-dom";
import { LocaleProvider } from "@/features/landing/i18n";
import { resolveBrowserLocale } from "@/lib/browser-locale";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Multica",
      url: "https://www.multica.ai",
      sameAs: ["https://github.com/multica-ai/multica"],
    },
    {
      "@type": "SoftwareApplication",
      name: "Multica",
      applicationCategory: "ProjectManagement",
      operatingSystem: "Web",
      description:
        "Open-source project management platform that turns coding agents into real teammates.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  ],
};

export function LandingShell() {
  return (
    <>
      <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      <div className="landing-light h-full overflow-x-hidden overflow-y-auto bg-white">
        <LocaleProvider initialLocale={resolveBrowserLocale()}>
          <Outlet />
        </LocaleProvider>
      </div>
    </>
  );
}
