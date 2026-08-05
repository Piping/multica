import { Outlet } from "react-router-dom";
import { DashboardLayout } from "@multica/views/layout";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";
import { SearchCommand, SearchTrigger } from "@multica/views/search";
import { FloatingChat } from "@multica/views/chat";
import { SourceBackfillModal } from "@multica/views/onboarding";
import { WebNotificationBridge } from "@/components/web-notification-bridge";

export function DashboardShell() {
  return (
    <DashboardLayout
      loadingIndicator={<MulticaIcon className="size-6" />}
      searchSlot={<SearchTrigger />}
      extra={
        <>
          <SearchCommand />
          <WebNotificationBridge />
          <FloatingChat />
          <SourceBackfillModal />
        </>
      }
    >
      <Outlet />
    </DashboardLayout>
  );
}
