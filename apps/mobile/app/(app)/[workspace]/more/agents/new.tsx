import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { Stack, router } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useQuery } from "@tanstack/react-query";
import type { AgentVisibility, CreateAgentRequest, RuntimeDevice } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { Separator } from "@/components/ui/separator";
import { AgentOptionSheet, type AgentOption } from "@/components/agent/agent-option-sheet";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useCreateAgent } from "@/data/mutations/agents";
import { useWorkspaceStore } from "@/data/workspace-store";

const THINKING_OPTIONS = [
  { key: "", label: "CLI config" },
  { key: "minimal", label: "Minimal" },
  { key: "low", label: "Low" },
  { key: "medium", label: "Medium" },
  { key: "high", label: "High" },
  { key: "xhigh", label: "XHigh" },
] as const;
type ThinkingLevel = (typeof THINKING_OPTIONS)[number]["key"];

const VISIBILITY_OPTIONS: AgentOption<AgentVisibility>[] = [
  {
    value: "private",
    title: "Private",
    subtitle: "Only you and workspace admins can assign or edit this agent.",
  },
  {
    value: "workspace",
    title: "Workspace",
    subtitle: "Any workspace member can assign work to this agent.",
  },
];

export default function NewAgentScreen() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const create = useCreateAgent();
  const usableRuntimes = runtimes.filter((runtime) => runtime.status === "online");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [runtimeId, setRuntimeId] = useState("");
  const [model, setModel] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState("");
  const [visibility, setVisibility] = useState<AgentVisibility>("workspace");
  const [maxConcurrentTasks, setMaxConcurrentTasks] = useState("6");
  const [customArgsText, setCustomArgsText] = useState("");
  const [runtimeSheetOpen, setRuntimeSheetOpen] = useState(false);
  const [thinkingSheetOpen, setThinkingSheetOpen] = useState(false);
  const [visibilitySheetOpen, setVisibilitySheetOpen] = useState(false);

  const selectedRuntime = runtimes.find((runtime) => runtime.id === runtimeId) ?? usableRuntimes[0] ?? null;
  const nextCustomArgs = useMemo(
    () => customArgsText.split(/\n+/).map((arg) => arg.trim()).filter(Boolean),
    [customArgsText],
  );
  const canSave = name.trim().length > 0 && !!selectedRuntime && Number(maxConcurrentTasks) >= 1 && !create.isPending;

  const runtimeOptions = useMemo<AgentOption<string>[]>(
    () => runtimes.map(runtimeToOption),
    [runtimes],
  );
  const thinkingOptions = useMemo<AgentOption<ThinkingLevel>[]>(
    () => THINKING_OPTIONS.map((option) => ({
      value: option.key,
      title: option.label,
      subtitle: option.key === "" ? "Use the local CLI config for this runtime." : `Pass ${option.key} as the runtime-native reasoning effort.`,
    })),
    [],
  );

  const openRuntimePicker = () => {
    if (runtimes.length === 0) {
      Alert.alert("No runtime", "Connect a runtime before creating an agent.", [
        { text: "Cancel", style: "cancel" },
        { text: "Add Runtime", onPress: () => wsSlug && router.push(`/${wsSlug}/more/runtimes/new`) },
      ]);
      return;
    }
    setRuntimeSheetOpen(true);
  };

  const onCancel = useCallback(() => router.back(), []);
  const onSave = useCallback(() => {
    if (!selectedRuntime || !canSave) return;
    const payload: CreateAgentRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
      instructions: instructions.trim() || undefined,
      runtime_id: selectedRuntime.id,
      visibility,
      model: model.trim() || undefined,
      thinking_level: thinkingLevel || undefined,
      max_concurrent_tasks: Math.max(1, Math.floor(Number(maxConcurrentTasks))),
      custom_args: nextCustomArgs,
    };
    create.mutate(payload, {
      onSuccess: (agent) => {
        router.replace(`/${wsSlug}/more/agents/${agent.id}`);
      },
      onError: (err) => Alert.alert("Create failed", err instanceof Error ? err.message : "Unknown error"),
    });
  }, [selectedRuntime, canSave, name, description, instructions, visibility, model, thinkingLevel, maxConcurrentTasks, nextCustomArgs, create, wsSlug]);

  const headerLeft = useCallback(() => (
    <Pressable onPress={onCancel} className="px-1 py-1"><Text className="text-base text-brand">Cancel</Text></Pressable>
  ), [onCancel]);
  const headerRight = useCallback(() => (
    <Pressable onPress={onSave} disabled={!canSave} className={canSave ? "px-1 py-1" : "px-1 py-1 opacity-40"}>
      <Text className="text-base text-brand font-semibold">{create.isPending ? "Creating..." : "Create"}</Text>
    </Pressable>
  ), [canSave, onSave, create.isPending]);

  return (
    <>
      <Stack.Screen options={{ headerLeft, headerRight }} />
      <KeyboardAwareScrollView className="flex-1 bg-background" contentContainerClassName="px-4 pt-4 pb-8 gap-5" keyboardShouldPersistTaps="handled" bottomOffset={16}>
        <Section title="Identity">
          <Field label="Name"><TextField value={name} onChangeText={setName} placeholder="Agent name" autoFocus /></Field>
          <Field label="Description"><TextField value={description} onChangeText={setDescription} placeholder="Short description" /></Field>
        </Section>

        <Section title="Runtime">
          <Field label="Runtime">
            <PickerRow title={selectedRuntime?.name ?? "Select runtime"} subtitle={selectedRuntime ? `${selectedRuntime.provider} · ${selectedRuntime.status}` : "Choose where this agent will run"} onPress={openRuntimePicker} />
          </Field>
          <Field label="Model"><TextField value={model} onChangeText={setModel} placeholder="CLI default" autoCapitalize="none" autoCorrect={false} /></Field>
          <Field label="Thinking">
            <PickerRow title={THINKING_OPTIONS.find((option) => option.key === thinkingLevel)?.label ?? thinkingLevel} subtitle="Reasoning effort override" onPress={() => setThinkingSheetOpen(true)} />
          </Field>
          <Field label="Max concurrent tasks">
            <View className="flex-row items-center gap-2">
              <Button variant="outline" size="icon" onPress={() => setMaxConcurrentTasks(String(Math.max(1, Number(maxConcurrentTasks || 1) - 1)))}><Text>-</Text></Button>
              <TextField value={maxConcurrentTasks} onChangeText={setMaxConcurrentTasks} keyboardType="number-pad" className="flex-1 text-center" />
              <Button variant="outline" size="icon" onPress={() => setMaxConcurrentTasks(String(Math.max(1, Number(maxConcurrentTasks || 1) + 1)))}><Text>+</Text></Button>
            </View>
          </Field>
        </Section>

        <Section title="Access">
          <PickerRow title={visibility === "workspace" ? "Workspace" : "Private"} subtitle={visibility === "workspace" ? "Any workspace member can assign work." : "Only you and admins can assign work."} onPress={() => setVisibilitySheetOpen(true)} />
        </Section>

        <Section title="Instructions">
          <AutosizeTextArea value={instructions} onChangeText={setInstructions} placeholder="How should this agent behave?" className="rounded-md bg-secondary/50 px-3 py-2" minHeight={120} maxHeight={240} />
        </Section>

        <Section title="Codex / CLI args">
          <AutosizeTextArea value={customArgsText} onChangeText={setCustomArgsText} placeholder={'One argument per line, for example:\n-c model_provider="kfcode"\n-c model_reasoning_effort="low"'} className="rounded-md bg-secondary/50 px-3 py-2 font-mono" minHeight={116} maxHeight={220} autoCapitalize="none" autoCorrect={false} />
        </Section>
      </KeyboardAwareScrollView>
      <AgentOptionSheet visible={runtimeSheetOpen} title="Runtime" subtitle="Choose where this agent will run." value={selectedRuntime?.id ?? ""} options={runtimeOptions} onSelect={setRuntimeId} onClose={() => setRuntimeSheetOpen(false)} />
      <AgentOptionSheet visible={thinkingSheetOpen} title="Thinking effort" subtitle="Leave on CLI config unless this agent needs a fixed reasoning level." value={thinkingLevel as ThinkingLevel} options={thinkingOptions} onSelect={setThinkingLevel} onClose={() => setThinkingSheetOpen(false)} />
      <AgentOptionSheet visible={visibilitySheetOpen} title="Visibility" subtitle="Controls who can assign work to this agent." value={visibility} options={VISIBILITY_OPTIONS} onSelect={setVisibility} onClose={() => setVisibilitySheetOpen(false)} />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View className="rounded-md border border-border bg-card"><View className="px-4 py-3"><Text className="text-xs uppercase tracking-wider text-muted-foreground">{title}</Text></View><Separator /><View className="p-4 gap-4">{children}</View></View>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View className="gap-1.5"><Text className="text-xs text-muted-foreground">{label}</Text>{children}</View>;
}

function PickerRow({ title, subtitle, onPress }: { title: string; subtitle?: string; onPress: () => void }) {
  return <Pressable onPress={onPress} className="min-h-11 rounded-md bg-secondary/50 px-3 py-2 flex-row items-center justify-between active:bg-secondary"><View className="flex-1 min-w-0"><Text className="text-sm text-foreground" numberOfLines={1}>{title}</Text>{subtitle ? <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>{subtitle}</Text> : null}</View><Text className="text-lg text-muted-foreground">›</Text></Pressable>;
}

function runtimeToOption(runtime: RuntimeDevice): AgentOption<string> {
  return {
    value: runtime.id,
    title: runtime.name,
    subtitle: `${runtime.provider || runtime.runtime_mode} · ${runtime.visibility === "public" ? "public" : "private"}`,
    meta: runtime.status,
    disabled: false,
  };
}
