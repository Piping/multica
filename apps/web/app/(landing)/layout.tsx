import { LocaleProvider } from "@/features/landing/i18n";
import { getRequestLocale } from "@/lib/request-locale";

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
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
  ],
};

export default async function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialLocale = await getRequestLocale();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div
        className="landing-light h-full overflow-x-hidden overflow-y-auto bg-white"
        style={
          {
            "--font-serif": [
              '"Source Serif 4"',
              '"Instrument Serif"',
              "ui-serif",
              '"Iowan Old Style"',
              '"Apple Garamond"',
              "Baskerville",
              '"Times New Roman"',
              "serif",
            ].join(", "),
            "--font-serif-zh": [
              '"Noto Serif SC"',
              '"Songti SC"',
              "STSong",
              '"Noto Serif CJK SC"',
              "serif",
            ].join(", "),
          } as React.CSSProperties
        }
      >
        <LocaleProvider initialLocale={initialLocale}>{children}</LocaleProvider>
      </div>
    </>
  );
}
