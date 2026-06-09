import { createElement, type ComponentProps } from "react";
import { Platform } from "react-native";
import { Stack } from "expo-router";
import { ModalCloseButton } from "@/components/ui/modal-close-button";

type StackScreenOptions = ComponentProps<typeof Stack.Screen>["options"];

/**
 * Workspace route surface — one seam for how route intent maps onto Expo
 * Router / RN Screens presentation. Callers describe the surface kind;
 * Android fallback, iOS sheet policy, and close chrome stay here.
 */
export type WorkspaceRouteSurface =
  | { surface: "tabs-root" }
  | {
      surface: "push-detail";
      title: string;
      headerBackTitle?: string;
    }
  | { surface: "modal-form"; title: string }
  | { surface: "sheet-list" }
  | { surface: "sheet-native-header"; title: string };

/**
 * Shared options for every Workspace formSheet route.
 *
 * iOS gets UISheetPresentationController. Android falls back to the stable
 * `modal` card path that Expo Router maps from this presentation. Numeric
 * detents stay here so callers do not learn sheet physics details.
 */
const WORKSPACE_SHEET_OPTIONS: StackScreenOptions = {
  presentation: Platform.OS === "ios" ? "formSheet" : "modal",
  ...(Platform.OS === "ios"
    ? {
        sheetGrabberVisible: true,
        sheetAllowedDetents: [0.6, 0.95],
        sheetCornerRadius: 20,
      }
    : {}),
  contentStyle: { flex: 1 },
  headerShown: false,
};

export function workspaceRouteOptions(
  config: WorkspaceRouteSurface,
): StackScreenOptions {
  switch (config.surface) {
    case "tabs-root":
      return { headerShown: false };
    case "push-detail":
      return {
        title: config.title,
        headerBackTitle: config.headerBackTitle ?? "Back",
      };
    case "modal-form":
      return {
        title: config.title,
        presentation: "modal",
        headerLeft: () => createElement(ModalCloseButton),
      };
    case "sheet-list":
      return WORKSPACE_SHEET_OPTIONS;
    case "sheet-native-header":
      return {
        ...WORKSPACE_SHEET_OPTIONS,
        headerShown: true,
        title: config.title,
      };
  }
}
