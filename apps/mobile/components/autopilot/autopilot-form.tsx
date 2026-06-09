import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, Pressable, View } from "react-native";
import { Stack } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useQuery } from "@tanstack/react-query";
import type {
  AutopilotAssigneeType,
  AutopilotExecutionMode,
} from "@multica/core/types";
import { AgentOptionSheet, type AgentOption } from "@/components/agent/agent-option-sheet";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { agentListOptions } from "@/data/queries/agents";
import { projectListOptions } from "@/data/queries/projects";
import { squadListOptions } from "@/data/queries/squads";
import { useWorkspaceStore } from "@/data/workspace-store";

export const NONE_PROJECT = "__none__";

const EXECUTION_MODE_OPTIONS: AgentOption<AutopilotExecutionMode>[] = [
  {
    value: "create_issue",
    title: "Create issue",
    subtitle: "Each run creates a tracked issue for the assigned actor.",
  },
  {
    value: "run_only",
    title: "Run only",
    subtitle: "Run work immediately without creating a new issue.",
  },
];

export interface AutopilotFormValues {
  title: string;
  description: string;
  executionMode: AutopilotExecutionMode;
  assigneeValue: string;
  projectValue: string;
  issueTitleTemplate: string;
}

export interface AutopilotFormPayload {
  title: string;
  description: string;
  assignee_type: AutopilotAssigneeType;
  assignee_id: string;
  execution_mode: AutopilotExecutionMode;
  project_id: string | null;
  issue_title_template: string | null;
}

interface AutopilotFormProps {
  submitLabel: string;
  submittingLabel: string;
  isSubmitting: boolean;
  initialValues?: Partial<AutopilotFormValues>;
  nextStepDescription: string;
  onSubmit: (payload: AutopilotFormPayload) => void;
  onDismiss: () => void;
  requireDirty?: boolean;
  discardTitle?: string;
  discardMessage?: string;
}

export function buildAssigneeValue(
  type: AutopilotAssigneeType,
  id: string,
): string {
  return `${type}:${id}`;
}

export function decodeAssignee(value: string): {
  type: AutopilotAssigneeType;
  id: string;
} {
  const [type, ...rest] = value.split(":");
  return {
    type: type === "squad" ? "squad" : "agent",
    id: rest.join(":"),
  };
}

export function AutopilotForm({
  submitLabel,
  submittingLabel,
  isSubmitting,
  initialValues,
  nextStepDescription,
  onSubmit,
  onDismiss,
  requireDirty = false,
  discardTitle = "Discard changes?",
  discardMessage = "Your draft will be lost.",
}: AutopilotFormProps) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: squads = [] } = useQuery(squadListOptions(wsId));
  const { data: projects = [] } = useQuery(projectListOptions(wsId));

  const assigneeOptions = useMemo<AgentOption<string>[]>(() => {
    const next: AgentOption<string>[] = [];
    for (const agent of agents) {
      next.push({
        value: buildAssigneeValue("agent", agent.id),
        title: agent.name,
        subtitle: agent.description || "Agent",
        meta: agent.archived_at ? "archived" : "agent",
        disabled: !!agent.archived_at,
      });
    }
    for (const squad of squads) {
      next.push({
        value: buildAssigneeValue("squad", squad.id),
        title: squad.name,
        subtitle: squad.description || "Squad",
        meta: squad.archived_at ? "archived" : "squad",
        disabled: !!squad.archived_at,
      });
    }
    return next;
  }, [agents, squads]);

  const projectOptions = useMemo<AgentOption<string>[]>(
    () => [
      {
        value: NONE_PROJECT,
        title: "No project",
        subtitle: "This autopilot will create ungrouped work.",
      },
      ...projects.map((project) => ({
        value: project.id,
        title: project.title,
        subtitle: project.description ?? "Project",
      })),
    ],
    [projects],
  );

  const firstAvailableAssignee =
    assigneeOptions.find((option) => !option.disabled)?.value ?? "";

  const normalizedInitial = useMemo<AutopilotFormValues>(
    () => ({
      title: initialValues?.title ?? "",
      description: initialValues?.description ?? "",
      executionMode: initialValues?.executionMode ?? "create_issue",
      assigneeValue:
        initialValues?.assigneeValue ?? firstAvailableAssignee,
      projectValue: initialValues?.projectValue ?? NONE_PROJECT,
      issueTitleTemplate: initialValues?.issueTitleTemplate ?? "",
    }),
    [firstAvailableAssignee, initialValues],
  );

  const [title, setTitle] = useState(normalizedInitial.title);
  const [description, setDescription] = useState(normalizedInitial.description);
  const [executionMode, setExecutionMode] = useState(normalizedInitial.executionMode);
  const [assigneeValue, setAssigneeValue] = useState(normalizedInitial.assigneeValue);
  const [projectValue, setProjectValue] = useState(normalizedInitial.projectValue);
  const [issueTitleTemplate, setIssueTitleTemplate] = useState(
    normalizedInitial.issueTitleTemplate,
  );
  const [assigneeSheetOpen, setAssigneeSheetOpen] = useState(false);
  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  const [projectSheetOpen, setProjectSheetOpen] = useState(false);

  useEffect(() => {
    if (!assigneeValue && firstAvailableAssignee) {
      setAssigneeValue(firstAvailableAssignee);
    }
  }, [assigneeValue, firstAvailableAssignee]);

  const selectedAssignee = assigneeOptions.find(
    (option) => option.value === assigneeValue,
  );
  const selectedProject = projectOptions.find(
    (option) => option.value === projectValue,
  );

  const serializedInitial = useMemo(
    () => serializeFormValues(normalizedInitial),
    [normalizedInitial],
  );
  const serializedCurrent = serializeFormValues({
    title,
    description,
    executionMode,
    assigneeValue,
    projectValue,
    issueTitleTemplate,
  });
  const dirty = serializedCurrent !== serializedInitial;

  const canSubmit =
    title.trim().length > 0 &&
    assigneeValue.length > 0 &&
    !isSubmitting &&
    (!requireDirty || dirty);

  const handleDismiss = useCallback(() => {
    if (!dirty) {
      onDismiss();
      return;
    }
    Alert.alert(discardTitle, discardMessage, [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onDismiss },
    ]);
  }, [dirty, discardMessage, discardTitle, onDismiss]);

  const handleSubmit = useCallback(() => {
    if (!canSubmit) {
      return;
    }
    const assignee = decodeAssignee(assigneeValue);
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      assignee_type: assignee.type,
      assignee_id: assignee.id,
      execution_mode: executionMode,
      project_id:
        executionMode === "create_issue" && projectValue !== NONE_PROJECT
          ? projectValue
          : null,
      issue_title_template:
        executionMode === "create_issue" && issueTitleTemplate.trim()
          ? issueTitleTemplate.trim()
          : null,
    });
  }, [
    assigneeValue,
    canSubmit,
    description,
    executionMode,
    issueTitleTemplate,
    onSubmit,
    projectValue,
    title,
  ]);

  const headerLeft = useCallback(
    () => (
      <Pressable onPress={handleDismiss} className="px-1 py-1">
        <Text className="text-base text-brand">Cancel</Text>
      </Pressable>
    ),
    [handleDismiss],
  );

  const headerRight = useCallback(
    () => (
      <Pressable
        onPress={handleSubmit}
        disabled={!canSubmit}
        className={canSubmit ? "px-1 py-1" : "px-1 py-1 opacity-40"}
      >
        <Text className="text-base font-semibold text-brand">
          {isSubmitting ? submittingLabel : submitLabel}
        </Text>
      </Pressable>
    ),
    [canSubmit, handleSubmit, isSubmitting, submitLabel, submittingLabel],
  );

  return (
    <>
      <Stack.Screen options={{ headerLeft, headerRight }} />
      <KeyboardAwareScrollView
        className="flex-1 bg-background"
        contentContainerClassName="px-4 pt-4 pb-8 gap-5"
        keyboardShouldPersistTaps="handled"
        bottomOffset={16}
      >
        <Section title="Identity">
          <Field label="Title">
            <TextField
              value={title}
              onChangeText={setTitle}
              placeholder="Autopilot title"
              autoFocus
            />
          </Field>
          <Field label="Runbook">
            <AutosizeTextArea
              value={description}
              onChangeText={setDescription}
              placeholder="What should this autopilot do on each run?"
              className="rounded-md bg-secondary/50 px-3 py-2"
              minHeight={120}
              maxHeight={240}
            />
          </Field>
        </Section>

        <Section title="Routing">
          <Field label="Assignee">
            <PickerRow
              title={selectedAssignee?.title ?? "Select assignee"}
              subtitle={
                selectedAssignee?.subtitle ??
                "Choose the agent or squad that will receive the work."
              }
              onPress={() => setAssigneeSheetOpen(true)}
            />
          </Field>
          <Field label="Output">
            <PickerRow
              title={
                executionMode === "create_issue" ? "Create issue" : "Run only"
              }
              subtitle={
                executionMode === "create_issue"
                  ? "Runs create a new issue."
                  : "Runs execute without creating a new issue."
              }
              onPress={() => setModeSheetOpen(true)}
            />
          </Field>
          {executionMode === "create_issue" ? (
            <>
              <Field label="Project">
                <PickerRow
                  title={selectedProject?.title ?? "No project"}
                  subtitle={
                    selectedProject?.subtitle ??
                    "Optional parent project for newly created issues."
                  }
                  onPress={() => setProjectSheetOpen(true)}
                />
              </Field>
              <Field label="Issue title template">
                <TextField
                  value={issueTitleTemplate}
                  onChangeText={setIssueTitleTemplate}
                  placeholder="Defaults to autopilot title"
                />
              </Field>
            </>
          ) : null}
        </Section>

        <Section title="Next step">
          <Text className="text-sm text-muted-foreground">
            {nextStepDescription}
          </Text>
        </Section>
      </KeyboardAwareScrollView>

      <AgentOptionSheet
        visible={assigneeSheetOpen}
        title="Assignee"
        subtitle="Choose the agent or squad that should receive runs from this autopilot."
        value={assigneeValue}
        options={assigneeOptions}
        onSelect={setAssigneeValue}
        onClose={() => setAssigneeSheetOpen(false)}
      />
      <AgentOptionSheet
        visible={modeSheetOpen}
        title="Output mode"
        subtitle="Choose whether runs create a tracked issue or execute directly."
        value={executionMode}
        options={EXECUTION_MODE_OPTIONS}
        onSelect={setExecutionMode}
        onClose={() => setModeSheetOpen(false)}
      />
      <AgentOptionSheet
        visible={projectSheetOpen}
        title="Project"
        subtitle="Optional parent project for created issues."
        value={projectValue}
        options={projectOptions}
        onSelect={setProjectValue}
        onClose={() => setProjectSheetOpen(false)}
      />
    </>
  );
}

function serializeFormValues(values: AutopilotFormValues): string {
  return JSON.stringify({
    title: values.title.trim(),
    description: values.description.trim(),
    executionMode: values.executionMode,
    assigneeValue: values.assigneeValue,
    projectValue:
      values.executionMode === "create_issue" ? values.projectValue : NONE_PROJECT,
    issueTitleTemplate:
      values.executionMode === "create_issue"
        ? values.issueTitleTemplate.trim()
        : "",
  });
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View className="rounded-md border border-border bg-card">
      <View className="px-4 py-3">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground">
          {title}
        </Text>
      </View>
      <Separator />
      <View className="gap-4 p-4">{children}</View>
    </View>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-xs text-muted-foreground">{label}</Text>
      {children}
    </View>
  );
}

function PickerRow({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="min-h-11 flex-row items-center justify-between rounded-md bg-secondary/50 px-3 py-2 active:bg-secondary"
    >
      <View className="min-w-0 flex-1">
        <Text className="text-sm text-foreground" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            className="mt-0.5 text-xs text-muted-foreground"
            numberOfLines={2}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Text className="text-lg text-muted-foreground">›</Text>
    </Pressable>
  );
}
