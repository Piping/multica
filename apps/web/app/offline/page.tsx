"use client";

import Link from "next/link";
import { buttonVariants } from "@multica/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@multica/ui/components/ui/card";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";
import { useT } from "@multica/views/i18n";

export default function OfflinePage() {
  const { t } = useT("common");

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(17,24,39,0.07),_transparent_42%),linear-gradient(180deg,_#f8fafc_0%,_#eef2f7_100%)] px-6 py-12">
      <Card className="w-full max-w-md border-border/60 bg-background/95 shadow-xl backdrop-blur">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-border/60 bg-background shadow-sm">
            <MulticaIcon className="size-7 text-foreground" noSpin />
          </div>
          <div className="space-y-2">
            <CardTitle>{t(($) => $.offline_page.title)}</CardTitle>
            <CardDescription>
              {t(($) => $.offline_page.description)}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Link href="/" className={buttonVariants({ size: "lg" })}>
            {t(($) => $.offline_page.retry)}
          </Link>
          <p className="text-center text-xs text-muted-foreground">
            {t(($) => $.offline_page.detail)}
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
