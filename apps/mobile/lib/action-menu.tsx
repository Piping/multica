import { useCallback } from "react";
import {
  ActionSheetIOS,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { create } from "zustand";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

export interface ActionMenuOption {
  key: string;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
}

interface ActionMenuConfig {
  title?: string;
  message?: string;
  options: ActionMenuOption[];
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
  if (Platform.OS === "ios") {
    return new Promise((resolve) => {
      const options = [...config.options.map((option) => option.label), "Cancel"];
      const cancelButtonIndex = options.length - 1;
      const destructiveButtonIndex = config.options.findIndex(
        (option) => option.destructive,
      );
      const disabledButtonIndices = config.options.flatMap((option, index) =>
        option.disabled ? [index] : [],
      );

      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: config.title,
          message: config.message,
          options,
          cancelButtonIndex,
          ...(destructiveButtonIndex >= 0 ? { destructiveButtonIndex } : {}),
          ...(disabledButtonIndices.length > 0
            ? { disabledButtonIndices }
            : {}),
        },
        (index) => {
          const option = config.options[index];
          resolve(option && !option.disabled ? option.key : null);
        },
      );
    });
  }

  return useActionMenuStore.getState().show(config);
}

export function ActionMenuHost() {
  const current = useActionMenuStore((state) => state.current);
  const close = useActionMenuStore((state) => state.close);
  const select = useActionMenuStore((state) => state.select);

  const onPick = useCallback(
    (key: string, disabled?: boolean) => {
      if (disabled) return;
      select(key);
    },
    [select],
  );

  return (
    <Modal
      visible={!!current}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <View className="flex-1 bg-black/40 justify-end">
        <Pressable className="flex-1" onPress={close} />
        <SafeAreaView edges={["bottom"]}>
          <View className="px-3 pb-3 gap-2">
            <View className="rounded-[28px] bg-popover overflow-hidden">
              {current?.title || current?.message ? (
                <View className="px-5 pt-4 pb-3 border-b border-border">
                  {current.title ? (
                    <Text className="text-base font-semibold text-foreground text-center">
                      {current.title}
                    </Text>
                  ) : null}
                  {current.message ? (
                    <Text className="text-sm text-muted-foreground text-center mt-1">
                      {current.message}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <ScrollView className="max-h-96">
                {current?.options.map((option, index) => (
                  <Pressable
                    key={option.key}
                    onPress={() => onPick(option.key, option.disabled)}
                    disabled={option.disabled}
                    className={cn(
                      "px-5 py-4 active:bg-secondary",
                      index > 0 && "border-t border-border",
                      option.disabled && "opacity-50",
                    )}
                  >
                    <Text
                      className={cn(
                        "text-center text-base",
                        option.destructive
                          ? "text-destructive"
                          : "text-foreground",
                      )}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            <Pressable
              onPress={close}
              className="rounded-[22px] bg-popover px-5 py-4 active:bg-secondary"
            >
              <Text className="text-center text-base font-medium text-foreground">
                Cancel
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
