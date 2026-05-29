"use client";

import { ErrorBoundary } from "@multica/ui/components/common/error-boundary";
import { ChatPage } from "@multica/views/chat";

export default function Page() {
  return (
    <ErrorBoundary>
      <ChatPage />
    </ErrorBoundary>
  );
}
