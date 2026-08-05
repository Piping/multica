import type { ComponentPropsWithoutRef, ComponentType, ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import type { SupportedLocale } from "@multica/core/i18n";
import { cn } from "@multica/ui/lib/utils";
import { LandingHeader } from "@/features/landing/components/landing-header";
import { LandingFooter } from "@/features/landing/components/landing-footer";
import { Screenshot } from "@/features/landing/components/mdx/screenshot";
import { useLocale } from "@/features/landing/i18n";
import { docsHrefForLocale } from "@/lib/docs-href";
import { useCaseText } from "@/lib/use-cases-i18n";
import EnContent, {
  frontmatter as enFrontmatter,
} from "@/content/use-cases/auto-data-analysis.en.mdx";
import JaContent, {
  frontmatter as jaFrontmatter,
} from "@/content/use-cases/auto-data-analysis.ja.mdx";
import KoContent, {
  frontmatter as koFrontmatter,
} from "@/content/use-cases/auto-data-analysis.ko.mdx";
import ZhContent, {
  frontmatter as zhFrontmatter,
} from "@/content/use-cases/auto-data-analysis.zh.mdx";

type UseCaseModule = {
  Content: ComponentType<{
    components?: Record<string, ComponentType<any>>;
  }>;
  frontmatter: typeof enFrontmatter;
};

const modules: Record<SupportedLocale, UseCaseModule> = {
  en: { Content: EnContent, frontmatter: enFrontmatter },
  ja: { Content: JaContent, frontmatter: jaFrontmatter },
  ko: { Content: KoContent, frontmatter: koFrontmatter },
  "zh-Hans": {
    Content: ZhContent,
    frontmatter: zhFrontmatter,
  },
};

function nodeToString(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToString).join("");
  return "";
}

function PlaceholderImage({ label }: { label: string }) {
  return (
    <figure className="my-10 -mx-4 sm:mx-0">
      <div className="flex aspect-[16/9] items-center justify-center rounded-lg border-2 border-dashed border-[#0a0d12]/15 bg-[#fafafa] px-6 text-center text-label italic leading-relaxed text-[#0a0d12]/55">
        {label}
      </div>
    </figure>
  );
}

function MdxCta({
  href,
  label,
  variant,
}: {
  href: string;
  label: string;
  variant: "primary" | "secondary";
}) {
  return (
    <Link
      to={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-[12px] px-5 py-3 text-body font-semibold not-italic transition-colors",
        variant === "primary"
          ? "bg-[#0a0d12] text-white hover:bg-[#0a0d12]/88"
          : "border border-[#0a0d12]/15 text-[#0a0d12] hover:bg-[#0a0d12]/[0.04]",
      )}
    >
      {label}
    </Link>
  );
}

function createMdxComponents(locale: SupportedLocale) {
  function SmartParagraph(props: ComponentPropsWithoutRef<"p">) {
    const text = nodeToString(props.children).trim();
    if (text.startsWith("[占位图")) {
      return (
        <PlaceholderImage
          label={text.replace(/^\[占位图[::]\s*/, "").replace(/\]$/, "")}
        />
      );
    }
    if (/^\[(?:副 |Secondary )?CTA[::]/.test(text)) {
      const items = Array.from(text.matchAll(/\[([^\]]+)\]/g)).map(
        (match) => match[1]!,
      );
      return (
        <div className="my-8 flex flex-wrap items-center gap-3">
          {items.map((item) => {
            const primary = /^CTA[::]/.test(item);
            return (
              <MdxCta
                key={item}
                label={item.replace(/^(?:副 |Secondary )?CTA[::]\s*/, "")}
                variant={primary ? "primary" : "secondary"}
                href={primary ? "/" : docsHrefForLocale(locale)}
              />
            );
          })}
        </div>
      );
    }
    return <p {...props} />;
  }

  return {
    Screenshot,
    h2: (props: ComponentPropsWithoutRef<"h2">) => (
      <h2
        className="mt-16 mb-4 scroll-mt-[100px] text-title-lg font-semibold text-[#0a0d12] sm:text-display-sm"
        {...props}
      />
    ),
    h3: (props: ComponentPropsWithoutRef<"h3">) => (
      <h3
        className="mt-10 mb-3 scroll-mt-[100px] text-title font-semibold text-[#0a0d12] sm:text-title-lg"
        {...props}
      />
    ),
    p: SmartParagraph,
    strong: (props: ComponentPropsWithoutRef<"strong">) => (
      <strong className="font-semibold text-[#0a0d12]" {...props} />
    ),
    hr: (props: ComponentPropsWithoutRef<"hr">) => (
      <hr className="my-12 border-[#0a0d12]/8" {...props} />
    ),
    blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => (
      <blockquote
        className="my-6 border-l-2 border-[#0a0d12]/15 pl-5 text-[#0a0d12]/65 italic"
        {...props}
      />
    ),
    ul: (props: ComponentPropsWithoutRef<"ul">) => (
      <ul className="my-4 list-disc space-y-2 pl-6" {...props} />
    ),
    ol: (props: ComponentPropsWithoutRef<"ol">) => (
      <ol className="my-4 list-decimal space-y-2 pl-6" {...props} />
    ),
    li: (props: ComponentPropsWithoutRef<"li">) => (
      <li className="pl-1" {...props} />
    ),
    a: ({ href, ...props }: ComponentPropsWithoutRef<"a">) =>
      href?.startsWith("/") ? (
        <Link
          to={href}
          className="underline decoration-[#0a0d12]/25 underline-offset-4"
          {...props}
        />
      ) : (
        <a href={href} {...props} />
      ),
    code: (props: ComponentPropsWithoutRef<"code">) => (
      <code
        className="rounded bg-[#0a0d12]/[0.06] px-1.5 py-0.5 font-mono text-label"
        {...props}
      />
    ),
    pre: (props: ComponentPropsWithoutRef<"pre">) => (
      <pre
        className="my-6 overflow-x-auto rounded-lg bg-[#0a0d12]/[0.04] p-4 text-label leading-[1.65]"
        {...props}
      />
    ),
  };
}

export function UseCasesIndexPage() {
  const { locale } = useLocale();
  const text = useCaseText[locale];
  const page = modules[locale];
  const href = "/usecases/auto-data-analysis";

  return (
    <>
      <div className="relative">
        <LandingHeader variant="dark" />
        <section className="relative overflow-hidden bg-[#05070b] text-white">
          <div className="relative z-10 mx-auto max-w-[1120px] px-4 pb-20 pt-32 text-center sm:px-6 sm:pt-40">
            <h1 className="landing-serif text-display-lg leading-[1.02] sm:text-display-xl">
              {text.indexTitle}
            </h1>
            <p className="mx-auto mt-6 max-w-[620px] text-body-lg text-white/84">
              {text.indexSubtitle}
            </p>
          </div>
        </section>
      </div>
      <section className="bg-white py-20 text-[#0a0d12]">
        <div className="mx-auto grid max-w-[1120px] grid-cols-1 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
          <Link to={href} className="group flex flex-col">
            <div className="aspect-[4/3] overflow-hidden rounded-lg bg-[#f5f5f5]">
              <img
                src={page.frontmatter.hero_image}
                alt=""
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              />
            </div>
            {page.frontmatter.category ? (
              <div className="mt-5 text-caption uppercase text-[#0a0d12]/50">
                {page.frontmatter.category}
              </div>
            ) : null}
            <h2 className="mt-2 text-title font-semibold">
              {page.frontmatter.title}
            </h2>
            <p className="mt-2 text-body text-[#0a0d12]/60">
              {page.frontmatter.description}
            </p>
            <span className="mt-3 text-label">{text.cardReadMore}</span>
          </Link>
        </div>
      </section>
      <LandingFooter />
    </>
  );
}

export function UseCasePage() {
  const { slug } = useParams();
  const { locale } = useLocale();
  if (slug !== "auto-data-analysis") return null;

  const { Content, frontmatter } = modules[locale];

  return (
    <>
      <div className="sticky top-0 z-40 bg-white">
        <LandingHeader variant="light" />
      </div>
      <main className="bg-white text-[#0a0d12]">
        <div className="mx-auto max-w-[720px] px-4 py-16 sm:px-6 lg:py-24">
          <article>
            <h1 className="landing-serif text-display-lg leading-[1.05] sm:text-display-xl">
              {frontmatter.title}
            </h1>
            <div className="mt-10 text-title-sm leading-[1.85] text-[#0a0d12]/72 [&>:first-child]:mt-0 [&>p]:my-5">
              <Content components={createMdxComponents(locale)} />
            </div>
          </article>
        </div>
      </main>
      <LandingFooter />
    </>
  );
}
