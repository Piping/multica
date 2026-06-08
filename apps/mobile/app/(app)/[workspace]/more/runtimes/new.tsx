import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useWorkspaceStore } from "@/data/workspace-store";
import { getCurrentApiUrl, getCurrentWebUrl } from "@/data/backend-config";

const INSTALL_CMD = "curl -fsSL https://raw.githubusercontent.com/multica-ai/multica/main/scripts/install.sh | bash";
const SETUP_CMD = "multica setup";

export default function NewRuntimeScreen() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: runtimes = [], refetch, isRefetching } = useQuery(runtimeListOptions(wsId));
  const [copied, setCopied] = useState<string | null>(null);

  const tokenCommand = useMemo(() => {
    const lines = [
      `multica config set server_url ${getCurrentApiUrl()}`,
      ...(getCurrentWebUrl() ? [`multica config set app_url ${getCurrentWebUrl()}`] : []),
      "multica login --token <YOUR_TOKEN>",
      "multica daemon start",
    ];
    return lines.join("\n");
  }, []);

  const copy = async (key: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 1800);
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-4 py-4 gap-4 pb-8">
      <View className="rounded-md border border-border bg-card p-4 gap-3">
        <View className="flex-row items-start gap-3">
          <View className="size-10 rounded-md bg-secondary items-center justify-center">
            <Ionicons name="hardware-chip-outline" size={20} color="#71717a" />
          </View>
          <View className="flex-1 min-w-0">
            <Text className="text-lg font-semibold text-foreground">Connect a runtime</Text>
            <Text className="text-sm text-muted-foreground mt-1">
              Run these commands on the machine that should execute agents. The runtime appears here after the daemon registers.
            </Text>
          </View>
        </View>
        <Button variant="outline" onPress={() => refetch()} disabled={isRefetching}>
          <Text>{isRefetching ? "Checking..." : `Check connected runtimes (${runtimes.length})`}</Text>
        </Button>
      </View>

      <CommandStep number={1} title="Install Multica CLI" command={INSTALL_CMD} copied={copied === "install"} onCopy={() => copy("install", INSTALL_CMD)} />
      <CommandStep number={2} title="Interactive setup" command={SETUP_CMD} copied={copied === "setup"} onCopy={() => copy("setup", SETUP_CMD)} />
      <CommandStep number={3} title="Manual setup" command={tokenCommand} copied={copied === "manual"} onCopy={() => copy("manual", tokenCommand)} />

      <View className="rounded-md border border-border bg-card overflow-hidden">
        <View className="px-4 py-3"><Text className="text-xs uppercase tracking-wider text-muted-foreground">Connected runtimes</Text></View>
        <Separator />
        {runtimes.length === 0 ? (
          <View className="p-4"><Text className="text-sm text-muted-foreground">No runtime has registered yet.</Text></View>
        ) : (
          runtimes.map((runtime, index) => (
            <View key={runtime.id}>
              {index > 0 ? <Separator /> : null}
              <View className="px-4 py-3">
                <Text className="text-sm font-medium text-foreground">{runtime.name}</Text>
                <Text className="text-xs text-muted-foreground mt-0.5">{runtime.provider} · {runtime.status}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      <Pressable
        onPress={() => Alert.alert("Token", "Create or copy a login token from the web/desktop app, then replace <YOUR_TOKEN> in the manual setup command.")}
        className="rounded-md bg-secondary px-3 py-2 active:opacity-80"
      >
        <Text className="text-xs text-muted-foreground">Need token help?</Text>
      </Pressable>
    </ScrollView>
  );
}

function CommandStep({ number, title, command, copied, onCopy }: { number: number; title: string; command: string; copied: boolean; onCopy: () => void }) {
  return (
    <View className="rounded-md border border-border bg-card overflow-hidden">
      <View className="px-4 py-3 flex-row items-center justify-between gap-3">
        <Text className="text-sm font-medium text-foreground">{number}. {title}</Text>
        <Button variant="ghost" size="sm" onPress={onCopy}>
          <Ionicons name={copied ? "checkmark" : "copy-outline"} size={15} color="#71717a" />
          <Text>{copied ? "Copied" : "Copy"}</Text>
        </Button>
      </View>
      <Separator />
      <View className="bg-muted px-4 py-3">
        <Text className="font-mono text-xs text-foreground" selectable>{command}</Text>
      </View>
    </View>
  );
}
