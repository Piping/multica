"use client";

import type { ReactNode } from "react";
import { SidebarProvider, SidebarInset } from "@multica/ui/components/ui/sidebar";
import { ModalRegistry } from "../modals/registry";
import { SourceBackfillModal } from "../onboarding";
import { AppSidebar } from "./app-sidebar";
import { DashboardGuard } from "./dashboard-guard";
import { NavigationProgress } from "./navigation-progress";
import { WorkspacePresencePrefetch } from "./workspace-presence-prefetch";
import { GlobalShortcuts } from "./global-shortcuts";

interface DashboardLayoutProps {
  children: ReactNode;
  /** Rendered inside SidebarInset (e.g. ChatWindow, ChatFab — absolute-positioned overlays) */
  extra?: ReactNode;
  /** Keep the sidebar expanded and remove every collapse affordance. */
  sidebarCollapsible?: boolean;
  /** Rendered above the sidebar header for host-specific window chrome. */
  sidebarTopSlot?: ReactNode;
  /** Rendered inside sidebar header as a search trigger */
  searchSlot?: ReactNode;
  /** Loading indicator */
  loadingIndicator?: ReactNode;
}

export function DashboardLayout({
  children,
  extra,
  sidebarCollapsible = true,
  sidebarTopSlot,
  searchSlot,
  loadingIndicator,
}: DashboardLayoutProps) {
  return (
    <DashboardGuard
      loadingFallback={
        <div className="flex h-svh items-center justify-center">
          {loadingIndicator}
        </div>
      }
    >
      <SidebarProvider
        className="h-svh bg-app-shell"
        open={sidebarCollapsible ? undefined : true}
        toggleEnabled={sidebarCollapsible}
      >
        <GlobalShortcuts sidebarToggleEnabled={sidebarCollapsible} />
        <WorkspacePresencePrefetch />
        <AppSidebar
          topSlot={sidebarTopSlot}
          searchSlot={searchSlot}
        />
        <SidebarInset className="relative overflow-hidden">
          <NavigationProgress />
          {children}
          <ModalRegistry />
          <SourceBackfillModal />
          {extra}
        </SidebarInset>
      </SidebarProvider>
    </DashboardGuard>
  );
}
