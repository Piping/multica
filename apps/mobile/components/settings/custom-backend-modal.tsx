import { useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import type { BackendOption } from "@/data/backend-config";
import { createCustomBackend } from "@/data/backend-config";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TextField } from "@/components/ui/text-field";
import { Text } from "@/components/ui/text";

interface Props {
  visible: boolean;
  title: string;
  message: string;
  initialBackend: BackendOption;
  saveLabel?: string;
  onClose: () => void;
  onSave: (backend: BackendOption) => Promise<void> | void;
}

export function CustomBackendModal({
  visible,
  title,
  message,
  initialBackend,
  saveLabel = "Save",
  onClose,
  onSave,
}: Props) {
  const [apiUrl, setApiUrl] = useState(initialBackend.apiUrl);
  const [webUrl, setWebUrl] = useState(initialBackend.webUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setApiUrl(initialBackend.apiUrl);
    setWebUrl(initialBackend.webUrl ?? "");
    setError(null);
    setSubmitting(false);
  }, [initialBackend.apiUrl, initialBackend.webUrl, visible]);

  const onSubmit = async () => {
    try {
      setSubmitting(true);
      setError(null);
      const next = createCustomBackend(apiUrl, webUrl);
      await onSave(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save backend.");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/40">
        <Pressable className="absolute inset-0" onPress={onClose} />
        <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
          <KeyboardAwareScrollView
            className="flex-1"
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: "center",
              paddingHorizontal: 16,
              paddingVertical: 24,
            }}
            keyboardShouldPersistTaps="handled"
            bottomOffset={16}
          >
            <Pressable onPress={() => {}}>
              <View className="rounded-2xl border border-border bg-card overflow-hidden">
                <View className="px-4 py-4 gap-1">
                  <Text className="text-base font-semibold text-foreground">
                    {title}
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    {message}
                  </Text>
                </View>
                <Separator />
                <View className="px-4 py-4 gap-4">
                  <View className="gap-2">
                    <Text className="text-sm font-medium text-foreground">
                      API URL
                    </Text>
                    <TextField
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      placeholder="https://agent.diff.host"
                      returnKeyType="next"
                      value={apiUrl}
                      onChangeText={setApiUrl}
                      editable={!submitting}
                    />
                  </View>
                  <View className="gap-2">
                    <Text className="text-sm font-medium text-foreground">
                      Web URL
                    </Text>
                    <TextField
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      placeholder="Optional override"
                      returnKeyType="done"
                      value={webUrl}
                      onChangeText={setWebUrl}
                      onSubmitEditing={() => void onSubmit()}
                      editable={!submitting}
                    />
                    <Text className="text-xs text-muted-foreground">
                      Leave blank to derive it from the API host.
                    </Text>
                  </View>
                  {error ? (
                    <Text className="text-sm text-destructive">{error}</Text>
                  ) : null}
                </View>
                <Separator />
                <View className="flex-row items-center justify-end gap-3 px-4 py-3">
                  <Button
                    variant="ghost"
                    onPress={onClose}
                    disabled={submitting}
                  >
                    <Text>Cancel</Text>
                  </Button>
                  <Button
                    onPress={() => void onSubmit()}
                    disabled={submitting || apiUrl.trim().length === 0}
                  >
                    <Text>{submitting ? "Saving..." : saveLabel}</Text>
                  </Button>
                </View>
              </View>
            </Pressable>
          </KeyboardAwareScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
