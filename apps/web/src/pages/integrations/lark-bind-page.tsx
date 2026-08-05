"use client";

import { Suspense } from "react";
import { useSearchParams } from "@/platform/router-compat";
import { LarkBindPage } from "@multica/views/lark";

// /lark/bind?token=<raw> is the Bot's "you're not bound yet, click here"
// destination. The redemption page renders its own in-progress state.
function LarkBindPageContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  return <LarkBindPage token={token} />;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <LarkBindPageContent />
    </Suspense>
  );
}
