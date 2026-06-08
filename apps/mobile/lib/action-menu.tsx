import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { create } from "zustand";
import { Text } from "@/components/ui/text";
import { Separator } from "@/components/ui/separator";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";

export interface ActionMenuAnchor {
  x: number;
  y: number;
}

export interface ActionMenuOption {
  key: string;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>["name"] | null;
}

interface ActionMenuConfig {
  title?: string;
  message?: string;
  options: ActionMenuOption[];
  anchor?: ActionMenuAnchor | null;
}

interface ActionMenuState {
  current: ActionMenuConfig | null;
  resolver: ((value: string | null) => void) | null;
  show: (config: ActionMenuConfig) => Promise<string | null>;
  close: () => void;
  select: (key: string) => void;
}

const useActionMenuStore = create<ActionMenuState>((set, get) => ({
  current: null,
  resolver: null,
  show: (config) =>
    new Promise((resolve) => {
      get().resolver?.(null);
      set({ current: config, resolver: resolve });
    }),
  close: () => {
    const { resolver } = get();
    resolver?.(null);
    set({ current: null, resolver: null });
  },
  select: (key) => {
    const { resolver } = get();
    resolver?.(key);
    set({ current: null, resolver: null });
  },
}));

export function showActionMenu(
  config: ActionMenuConfig,
): Promise<string | null> {
  return useActionMenuStore.getState().show(config);
}

export function ActionMenuHost() {
  const current = useActionMenuStore((state) => state.current);
  const close = useActionMenuStore((state) => state.close);
  const select = useActionMenuStore((state) => state.select);
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [contentSize, setContentSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    setContentSize(null);
  }, [current]);

  const onPick = useCallback(
    (key: string, disabled?: boolean) => {
      if (disabled) return;
      select(key);
    },
    [select],
  );

  const shadowStyle = useMemo(
    () => ({
      shadowColor: theme.foreground,
      shadowOpacity: colorScheme === "dark" ? 0.34 : 0.12,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 12 },
      elevation: 18,
    }),
    [colorScheme, theme.foreground],
  );

  const popoverLayout = useMemo(() => {
    if (!current?.anchor) return null;

    const margin = 12;
    const gap = 10;
    const minWidth = 196;
    const maxWidth = Math.min(
      260,
      window.width - insets.left - insets.right - margin * 2,
    );
    const width = contentSize?.width
      ? Math.min(contentSize.width, maxWidth)
      : Math.max(minWidth, maxWidth);

    if (!contentSize) {
      return {
        left: Math.max(
          insets.left + margin,
          Math.min(
            current.anchor.x - width / 2,
            window.width - insets.right - margin - width,
          ),
        ),
        top: current.anchor.y + gap,
        width,
        opacity: 0,
      };
    }

    const spaceAbove = current.anchor.y - insets.top - margin;
    const spaceBelow =
      window.height - insets.bottom - margin - current.anchor.y;
    const placeAbove =
      spaceBelow < contentSize.height + gap && spaceAbove > spaceBelow;
    const unclampedTop = placeAbove
      ? current.anchor.y - contentSize.height - gap
      : current.anchor.y + gap;
    const top = Math.max(
      insets.top + margin,
      Math.min(
        unclampedTop,
        window.height - insets.bottom - margin - contentSize.height,
      ),
    );
    const left = Math.max(
      insets.left + margin,
      Math.min(
        current.anchor.x - width / 2,
        window.width - insets.right - margin - width,
      ),
    );

    return {
      left,
      top,
      width,
      opacity: 1,
    };
  }, [contentSize, current?.anchor, insets.bottom, insets.left, insets.right, insets.top, window.height, window.width]);

  const contextual = !!current?.anchor;

  return (
    <Modal
      visible={!!current}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <View className={cn("flex-1", contextual ? "bg-black/12" : "bg-black/28 justify-end")}>
        <Pressable
          className="absolute inset-0"
          onPress={close}
        />

        {contextual && current && popoverLayout ? (
          <View
            className="absolute rounded-2xl border border-border bg-popover overflow-hidden"
            style={[shadowStyle, popoverLayout]}
            onLayout={(event) => {
              const { width, height } = event.nativeEvent.layout;
              setContentSize((prev) =>
                prev?.width === width && prev?.height === height
                  ? prev
                  : { width, height },
              );
            }}
          >
            <ActionMenuOptions
              config={current}
              onPick={onPick}
              iconColor={theme.mutedForeground}
              destructiveColor={theme.destructive}
              maxHeight={320}
            />
          </View>
        ) : current ? (
          <SafeAreaView edges={["bottom"]}>
            <View className="px-3 pb-3 gap-2">
              <View
                className="rounded-2xl border border-border bg-popover overflow-hidden"
                style={shadowStyle}
              >
                <ActionMenuOptions
                  config={current}
                  onPick={onPick}
                  iconColor={theme.mutedForeground}
                  destructiveColor={theme.destructive}
                  maxHeight={420}
                />
              </View>
              <View
                className="rounded-2xl border border-border bg-popover overflow-hidden"
                style={shadowStyle}
              >
                <Pressable
                  onPress={close}
                  className="items-center px-4 py-3.5 active:bg-accent"
                >
                  <Text className="text-[15px] font-medium text-foreground">
                    Cancel
                  </Text>
                </Pressable>
              </View>
            </View>
          </SafeAreaView>
        ) : null}
      </View>
    </Modal>
  );
}

function ActionMenuOptions({
  config,
  onPick,
  iconColor,
  destructiveColor,
  maxHeight,
}: {
  config: ActionMenuConfig;
  onPick: (key: string, disabled?: boolean) => void;
  iconColor: string;
  destructiveColor: string;
  maxHeight: number;
}) {
  const showHeader = !!(config.title || config.message);

  return (
    <>
      {showHeader ? (
        <View className="px-4 pt-3 pb-2.5">
          {config.title ? (
            <Text className="text-[13px] font-semibold text-foreground">
              {config.title}
            </Text>
          ) : null}
          {config.message ? (
            <Text
              className="mt-0.5 text-xs leading-4 text-muted-foreground"
              numberOfLines={3}
            >
              {config.message}
            </Text>
          ) : null}
        </View>
      ) : null}
      {showHeader ? <Separator /> : null}

      <ScrollView
        className={cn(maxHeight <= 320 ? "max-h-[320px]" : "max-h-[420px]")}
        showsVerticalScrollIndicator={false}
      >
        {config.options.map((option, index) => {
          const iconName =
            option.icon !== undefined
              ? option.icon
              : iconForAction(option.key, option.label, option.destructive);

          return (
            <View key={option.key}>
              {index > 0 ? <Separator className="ml-11" /> : null}
              <Pressable
                onPress={() => onPick(option.key, option.disabled)}
                disabled={option.disabled}
                className={cn(
                  "flex-row items-center gap-3 px-3.5 py-3 active:bg-accent",
                  option.disabled && "opacity-45",
                )}
              >
                <View className="w-5 items-center">
                  {iconName ? (
                    <Ionicons
                      name={iconName}
                      size={18}
                      color={
                        option.destructive ? destructiveColor : iconColor
                      }
                    />
                  ) : null}
                </View>
                <Text
                  className={cn(
                    "flex-1 text-[15px] font-medium",
                    option.destructive
                      ? "text-destructive"
                      : "text-foreground",
                  )}
                  numberOfLines={1}
                >
                  {option.label}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </>
  );
}

function iconForAction(
  key: string,
  label: string,
  destructive?: boolean,
): React.ComponentProps<typeof Ionicons>["name"] | null {
  if (destructive) return "trash-outline";
  if (isEmojiOnlyLabel(label)) return null;
  if (key.includes("copy")) return "copy-outline";
  if (key.includes("select")) return "text-outline";
  if (key.includes("edit")) return "create-outline";
  if (key.includes("resend") || key.includes("retry")) return "refresh-outline";
  if (key.includes("withdraw")) return "arrow-undo-outline";
  if (key.includes("regenerate")) return "sparkles-outline";
  if (key.includes("reply")) return "return-down-back-outline";
  if (key.includes("react")) return "happy-outline";
  if (key.includes("resolve")) return "checkmark-circle-outline";
  if (key.includes("open")) return "open-outline";
  if (key.includes("pin")) return "pin-outline";
  if (key.includes("archive")) return "archive-outline";
  if (key.includes("read")) return "checkmark-done-outline";
  return "ellipse-outline";
}

function isEmojiOnlyLabel(label: string): boolean {
  return /\p{Extended_Pictographic}/u.test(label) && label.trim().length <= 4;
}
