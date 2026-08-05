"use client";

import { Suspense } from "react";
import { useSearchParams } from "@/platform/router-compat";
import { SlackBindPage } from "@multica/views/slack";

// /slack/bind?token=<raw> is the bot's "link your account" destination.
function SlackBindPageContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  return <SlackBindPage token={token} />;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SlackBindPageContent />
    </Suspense>
  );
}
