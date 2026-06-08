import { useState } from "react";
import { Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { CustomBackendModal } from "@/components/settings/custom-backend-modal";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import { MulticaLogo } from "@/components/brand/multica-logo";
import { useAuthStore } from "@/data/auth-store";
import { BACKEND_OPTIONS, useBackendStore } from "@/data/backend-config";
import { showActionMenu } from "@/lib/action-menu";
import { mapAuthError } from "@/lib/auth-error";

const CUSTOM_BACKEND_ACTION = "__custom_backend__";

export default function Login() {
  const sendCode = useAuthStore((s) => s.sendCode);
  const currentBackend = useBackendStore((s) => s.current);
  const setBackend = useBackendStore((s) => s.setBackend);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customBackendVisible, setCustomBackendVisible] = useState(false);

  const onSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    void Haptics.selectionAsync();
    setSubmitting(true);
    setError(null);
    try {
      await sendCode(trimmed);
      router.push({ pathname: "/verify", params: { email: trimmed } });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(mapAuthError(err, "Couldn't send the code. Try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const onSelectBackend = () => {
    void (async () => {
      const action = await showActionMenu({
        title: "Default backend",
        message: "Choose which Multica deployment this device signs into.",
        options: [
          ...BACKEND_OPTIONS.map((backend) => ({
            key: backend.apiUrl,
            label:
              backend.apiUrl === currentBackend.apiUrl
                ? `${backend.label} (Current)`
                : backend.label,
          })),
          {
            key: CUSTOM_BACKEND_ACTION,
            label:
              BACKEND_OPTIONS.some(
                (backend) => backend.apiUrl === currentBackend.apiUrl,
              )
                ? "Custom backend..."
                : "Edit custom backend...",
          },
        ],
      });
      if (!action) return;
      if (action === CUSTOM_BACKEND_ACTION) {
        setCustomBackendVisible(true);
        return;
      }
      if (action === currentBackend.apiUrl) return;
      const nextBackend = BACKEND_OPTIONS.find(
        (backend) => backend.apiUrl === action,
      );
      if (!nextBackend) return;
      await setBackend(nextBackend);
    })();
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAwareScrollView
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingHorizontal: 24,
          rowGap: 24,
        }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={16}
      >
        <View className="items-center gap-3">
          <MulticaLogo size={32} />
          <View className="gap-1 items-center">
            <Text className="text-2xl font-semibold text-foreground">
              Sign in to Multica
            </Text>
            <Text className="text-sm text-muted-foreground text-center">
              Enter your email and we&apos;ll send you a verification code.
            </Text>
          </View>
        </View>

        <View className="gap-3">
          <Pressable
            onPress={onSelectBackend}
            className="rounded-md border border-border bg-card px-4 py-3 active:bg-secondary"
          >
            <Text className="text-sm font-medium text-foreground">
              Backend
            </Text>
            <Text className="mt-1 text-sm text-muted-foreground">
              {currentBackend.label} · {currentBackend.subtitle}
            </Text>
          </Pressable>
          <TextField
            autoCapitalize="none"
            autoComplete="email"
            autoFocus
            keyboardType="email-address"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={onSubmit}
            returnKeyType="send"
            editable={!submitting}
            invalid={!!error}
          />
          {error ? (
            <Text className="text-sm text-destructive">{error}</Text>
          ) : null}
        </View>

        <Button
          size="lg"
          disabled={submitting || !email.trim()}
          onPress={onSubmit}
        >
          <Text>{submitting ? "Sending..." : "Send code"}</Text>
        </Button>

        <CustomBackendModal
          visible={customBackendVisible}
          title="Custom backend"
          message="Sign this device into a manually entered Multica deployment."
          initialBackend={currentBackend}
          saveLabel="Use backend"
          onClose={() => setCustomBackendVisible(false)}
          onSave={async (backend) => {
            await setBackend(backend);
            setCustomBackendVisible(false);
          }}
        />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
