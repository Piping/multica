import { useEffect, useState } from "react";
import { Modal, Pressable, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ChatMessage } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";

interface Props {
  message: ChatMessage | null;
  submitting: boolean;
  onClose: () => void;
  onSave: (message: ChatMessage, content: string) => void;
}

export function EditMessageSheet({
  message,
  submitting,
  onClose,
  onSave,
}: Props) {
  const [text, setText] = useState("");

  useEffect(() => {
    setText(message?.content ?? "");
  }, [message]);

  const canSave = !!message && text.trim().length > 0 && !submitting;

  return (
    <Modal
      visible={!!message}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
        <View className="h-12 flex-row items-center border-b border-border px-3">
          <Pressable onPress={onClose} className="px-2 py-2 active:opacity-70">
            <Text className="text-sm text-muted-foreground">Cancel</Text>
          </Pressable>
          <Text className="flex-1 text-center text-base font-semibold text-foreground">
            Edit Message
          </Text>
          <Button
            size="sm"
            disabled={!canSave}
            onPress={() => message && onSave(message, text)}
          >
            <Text>Save</Text>
          </Button>
        </View>
        <View className="flex-1 p-4">
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message…"
            placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
            multiline
            autoFocus
            editable={!submitting}
            className="min-h-40 rounded-md border border-border bg-secondary/40 px-3 py-3 text-base text-foreground"
            textAlignVertical="top"
          />
          <Text className="mt-2 text-xs text-muted-foreground">
            Saving removes later replies. Retry from the edited message to run the agent again.
          </Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
