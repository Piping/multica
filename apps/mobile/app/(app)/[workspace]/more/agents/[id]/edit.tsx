import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useQuery } from "@tanstack/react-query";
import type { AgentVisibility, UpdateAgentRequest } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { Separator } from "@/components/ui/separator";
import { AgentOptionSheet, type AgentOption } from "@/components/agent/agent-option-sheet";
import { agentListOptions } from "@/data/queries/agents";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useUpdateAgent } from "@/data/mutations/agents";
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

export default function EditAgentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const update = useUpdateAgent(id);
  const agent = agents.find((candidate) => candidate.id === id) ?? null;
  const runtime = agent ? runtimes.find((candidate) => candidate.id === agent.runtime_id) ?? null : null;

  const [seededId, setSeededId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [model, setModel] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState("");
  const [visibility, setVisibility] = useState<AgentVisibility>("private");
  const [maxConcurrentTasks, setMaxConcurrentTasks] = useState("1");
  const [customArgsText, setCustomArgsText] = useState("");
  const [thinkingSheetOpen, setThinkingSheetOpen] = useState(false);
  const [visibilitySheetOpen, setVisibilitySheetOpen] = useState(false);

  useEffect(() => {
    if (!agent || seededId === agent.id) return;
    setSeededId(agent.id);
    setName(agent.name);
    setDescription(agent.description ?? "");
    setInstructions(agent.instructions ?? "");
    setModel(agent.model ?? "");
    setThinkingLevel(agent.thinking_level ?? "");
    setVisibility(agent.visibility);
    setMaxConcurrentTasks(String(agent.max_concurrent_tasks));
    setCustomArgsText((agent.custom_args ?? []).join("\n"));
  }, [agent, seededId]);

  const nextCustomArgs = useMemo(
    () => customArgsText.split(/\n+/).map((arg) => arg.trim()).filter(Boolean),
    [customArgsText],
  );

  const dirty = useMemo(() => {
    if (!agent) return false;
    return (
      name.trim() !== agent.name ||
      description.trim() !== (agent.description ?? "") ||
      instructions.trim() !== (agent.instructions ?? "") ||
      model.trim() !== (agent.model ?? "") ||
      thinkingLevel !== (agent.thinking_level ?? "") ||
      visibility !== agent.visibility ||
      Number(maxConcurrentTasks) !== agent.max_concurrent_tasks ||
      JSON.stringify(nextCustomArgs) !== JSON.stringify(agent.custom_args ?? [])
    );
  }, [agent, name, description, instructions, model, thinkingLevel, visibility, maxConcurrentTasks, nextCustomArgs]);

  const canSave = !!agent && name.trim().length > 0 && Number.isFinite(Number(maxConcurrentTasks)) && Number(maxConcurrentTasks) >= 1 && dirty && !update.isPending;

  const thinkingOptions = useMemo<AgentOption<ThinkingLevel>[]>(
    () => THINKING_OPTIONS.map((option) => ({
      value: option.key,
      title: option.label,
      subtitle: option.key === "" ? "Use the local CLI config for this runtime." : `Pass ${option.key} as the runtime-native reasoning effort.`,
    })),
    [],
  );

  const onCancel = useCallback(() => {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert("Discard changes?", "Your edits to this agent will be lost.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => router.back() },
    ]);
  }, [dirty]);

  const onSave = useCallback(() => {
    if (!agent || !canSave) return;
    const patch: UpdateAgentRequest = {
      name: name.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
      model: model.trim(),
      thinking_level: thinkingLevel,
      visibility,
      max_concurrent_tasks: Math.max(1, Math.floor(Number(maxConcurrentTasks))),
      custom_args: nextCustomArgs,
    };
    update.mutate(patch, {
      onSuccess: () => router.back(),
      onError: (err) => Alert.alert("Save failed", err instanceof Error ? err.message : "Unknown error"),
    });
  }, [agent, canSave, name, description, instructions, model, thinkingLevel, visibility, maxConcurrentTasks, nextCustomArgs, update]);

  const headerLeft = useCallback(() => (
    <Pressable onPress={onCancel} className="px-1 py-1"><Text className="text-base text-brand">Cancel</Text></Pressable>
  ), [onCancel]);
  const headerRight = useCallback(() => (
    <Pressable onPress={onSave} disabled={!canSave} className={canSave ? "px-1 py-1" : "px-1 py-1 opacity-40"}>
      <Text className="text-base text-brand font-semibold">{update.isPending ? "Saving..." : "Save"}</Text>
    </Pressable>
  ), [canSave, onSave, update.isPending]);

  return (
    <>
      <Stack.Screen options={{ headerLeft, headerRight }} />
      <KeyboardAwareScrollView className="flex-1 bg-background" contentContainerClassName="px-4 pt-4 pb-8 gap-5" keyboardShouldPersistTaps="handled" bottomOffset={16}>
        {!agent ? <Text className="text-sm text-muted-foreground">Loading...</Text> : (
          <>
            <Section title="Identity">
              <Field label="Name"><TextField value={name} onChangeText={setName} placeholder="Agent name" /></Field>
              <Field label="Description"><TextField value={description} onChangeText={setDescription} placeholder="Short description" /></Field>
            </Section>

            <Section title="Runtime">
              <ReadOnly label="Runtime" value={runtime?.name ?? "Unknown runtime"} />
              <ReadOnly label="Provider" value={runtime?.provider || agent.runtime_mode} />
              <Field label="Model">
                <TextField value={model} onChangeText={setModel} placeholder="CLI default" autoCapitalize="none" autoCorrect={false} />
              </Field>
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
              <Text className="text-xs text-muted-foreground">For Codex, these args are appended to `codex app-server`. Endpoint overrides can be set with `-c model_provider=...`; global CODEX_HOME config remains the default when this is empty.</Text>
            </Section>
          </>
        )}
      </KeyboardAwareScrollView>
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

function ReadOnly({ label, value }: { label: string; value: string }) {
  return <View className="gap-1.5"><Text className="text-xs text-muted-foreground">{label}</Text><View className="rounded-md bg-muted px-3 py-2.5"><Text className="text-sm text-muted-foreground">{value}</Text></View></View>;
}

function PickerRow({ title, subtitle, onPress }: { title: string; subtitle?: string; onPress: () => void }) {
  return <Pressable onPress={onPress} className="min-h-11 rounded-md bg-secondary/50 px-3 py-2 flex-row items-center justify-between active:bg-secondary"><View className="flex-1 min-w-0"><Text className="text-sm text-foreground" numberOfLines={1}>{title}</Text>{subtitle ? <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>{subtitle}</Text> : null}</View><Text className="text-lg text-muted-foreground">›</Text></Pressable>;
}
