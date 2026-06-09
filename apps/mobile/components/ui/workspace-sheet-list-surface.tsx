import type { ReactNode } from "react";
import {
  Platform,
  ScrollView,
  View,
  type ScrollViewProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  subtitle?: string;
  headerRight?: ReactNode;
  children: ReactNode;
  contentContainerClassName?: string;
  showsVerticalScrollIndicator?: boolean;
  keyboardDismissMode?: ScrollViewProps["keyboardDismissMode"];
  keyboardShouldPersistTaps?: ScrollViewProps["keyboardShouldPersistTaps"];
}

/**
 * Workspace sheet-list surface — body-owned header + Android top safe area
 * + scroll shell. Callers bring only content and any trailing header action.
 */
export function WorkspaceSheetListSurface({
  title,
  subtitle,
  headerRight,
  children,
  contentContainerClassName,
  showsVerticalScrollIndicator = false,
  keyboardDismissMode,
  keyboardShouldPersistTaps,
}: Props) {
  return (
    <SafeAreaView
      className="flex-1 bg-background"
      edges={Platform.OS === "android" ? ["top"] : []}
    >
      <View
        className={cn(
          "px-4 pt-4 pb-3",
          headerRight ? "flex-row items-start justify-between gap-3" : "gap-1",
        )}
      >
        <View className="flex-1 gap-1 min-w-0">
          <Text className="text-base font-semibold text-foreground">
            {title}
          </Text>
          {subtitle ? (
            <Text className="text-xs text-muted-foreground">{subtitle}</Text>
          ) : null}
        </View>
        {headerRight ? <View className="shrink-0">{headerRight}</View> : null}
      </View>
      <ScrollView
        className="flex-1"
        contentContainerClassName={cn("pb-4", contentContainerClassName)}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        keyboardDismissMode={keyboardDismissMode}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
