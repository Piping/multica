import { Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/ui/text";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface AgentOption<T extends string> {
  value: T;
  title: string;
  subtitle?: string;
  meta?: string;
  disabled?: boolean;
}

interface Props<T extends string> {
  visible: boolean;
  title: string;
  subtitle?: string;
  value: T;
  options: AgentOption<T>[];
  onSelect: (value: T) => void;
  onClose: () => void;
}

export function AgentOptionSheet<T extends string>({
  visible,
  title,
  subtitle,
  value,
  options,
  onSelect,
  onClose,
}: Props<T>) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <SafeAreaView
          className="flex-1 justify-end"
          edges={Platform.OS === "android" ? ["top", "bottom"] : ["bottom"]}
        >
          <Pressable onPress={() => {}} className="px-3 pb-3">
            <View className="rounded-lg border border-border bg-popover overflow-hidden">
              <View className="px-4 py-3">
                <Text className="text-base font-semibold text-foreground">{title}</Text>
                {subtitle ? (
                  <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={2}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <Separator />
              <ScrollView className="max-h-[420px]" showsVerticalScrollIndicator={false}>
                {options.map((option, index) => {
                  const selected = option.value === value;
                  return (
                    <View key={option.value}>
                      {index > 0 ? <Separator className="ml-4" /> : null}
                      <Pressable
                        disabled={option.disabled}
                        onPress={() => {
                          onSelect(option.value);
                          onClose();
                        }}
                        className={cn(
                          "flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
                          selected && "bg-secondary/70",
                          option.disabled && "opacity-45",
                        )}
                      >
                        <View className="flex-1 min-w-0 gap-0.5">
                          <View className="flex-row items-center gap-2">
                            <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                              {option.title}
                            </Text>
                            {option.meta ? (
                              <View className="rounded-full bg-secondary px-2 py-0.5">
                                <Text className="text-[10px] text-muted-foreground">{option.meta}</Text>
                              </View>
                            ) : null}
                          </View>
                          {option.subtitle ? (
                            <Text className="text-xs text-muted-foreground" numberOfLines={2}>
                              {option.subtitle}
                            </Text>
                          ) : null}
                        </View>
                        {selected ? <Ionicons name="checkmark" size={18} color="#2563eb" /> : null}
                      </Pressable>
                    </View>
                  );
                })}
              </ScrollView>
              <Separator />
              <Pressable onPress={onClose} className="items-center px-4 py-3 active:bg-secondary">
                <Text className="text-sm font-medium text-muted-foreground">Cancel</Text>
              </Pressable>
            </View>
          </Pressable>
        </SafeAreaView>
      </Pressable>
    </Modal>
  );
}
