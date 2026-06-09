import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { buildAutopilotWebhookUrl } from "@multica/core/autopilots";
import type {
  AutopilotRun,
  AutopilotStatus,
  AutopilotTrigger,
  AutopilotTriggerKind,
  UpdateAutopilotTriggerRequest,
} from "@multica/core/types";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import {
  useCreateAutopilotTrigger,
  useDeleteAutopilot,
  useDeleteAutopilotTrigger,
  useRotateAutopilotTriggerWebhookToken,
  useTriggerAutopilot,
  useUpdateAutopilot,
  useUpdateAutopilotTrigger,
} from "@/data/mutations/autopilots";
import {
  autopilotDetailOptions,
  autopilotRunsOptions,
} from "@/data/queries/autopilots";
import { projectListOptions } from "@/data/queries/projects";
import { useActorLookup } from "@/data/use-actor-name";
import { getCurrentApiUrl, getCurrentWebUrl } from "@/data/backend-config";
import { useWorkspaceStore } from "@/data/workspace-store";
import { showActionMenu } from "@/lib/action-menu";
import { timeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";

const DEFAULT_TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export default function AutopilotDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const detail = useQuery(autopilotDetailOptions(wsId, id));
  const runs = useQuery(autopilotRunsOptions(wsId, id));
  const { data: projects = [] } = useQuery(projectListOptions(wsId));
  const { getName } = useActorLookup();
  const updateAutopilot = useUpdateAutopilot(id);
  const deleteAutopilot = useDeleteAutopilot(id);
  const triggerAutopilot = useTriggerAutopilot(id);

  const autopilot = detail.data?.autopilot ?? null;
  const triggers = detail.data?.triggers ?? [];
  const project = autopilot?.project_id
    ? projects.find((item) => item.id === autopilot.project_id) ?? null
    : null;
  const assigneeName = autopilot
    ? getName(autopilot.assignee_type, autopilot.assignee_id)
    : "";

  const onRefresh = useCallback(async () => {
    await Promise.all([detail.refetch(), runs.refetch()]);
  }, [detail, runs]);

  const setStatus = useCallback(
    (status: AutopilotStatus) => {
      if (!autopilot || updateAutopilot.isPending) return;
      updateAutopilot.mutate(
        { status },
        {
          onError: (err) => {
            Alert.alert(
              "Update failed",
              err instanceof Error ? err.message : "Unknown error",
            );
          },
        },
      );
    },
    [autopilot, updateAutopilot],
  );

  const onTriggerNow = useCallback(() => {
    if (!autopilot || autopilot.status !== "active") return;
    triggerAutopilot.mutate(undefined, {
      onError: (err) => {
        Alert.alert(
          "Trigger failed",
          err instanceof Error ? err.message : "Unknown error",
        );
      },
    });
  }, [autopilot, triggerAutopilot]);

  const onDelete = useCallback(() => {
    Alert.alert(
      "Delete autopilot?",
      "This removes the autopilot and its triggers.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteAutopilot.mutate(undefined, {
              onSuccess: () => router.back(),
              onError: (err) => {
                Alert.alert(
                  "Delete failed",
                  err instanceof Error ? err.message : "Unknown error",
                );
              },
            });
          },
        },
      ],
    );
  }, [deleteAutopilot]);

  const onPressMore = useCallback(() => {
    if (!autopilot) return;
    const webUrl = getCurrentWebUrl();
    void (async () => {
      const action = await showActionMenu({
        options: [
          { key: "edit", label: "Edit configuration" },
          {
            key: "status",
            label:
              autopilot.status === "active" ? "Pause autopilot" : "Activate autopilot",
          },
          ...(autopilot.status === "archived"
            ? []
            : [{ key: "archive", label: "Archive autopilot", destructive: true }]),
          ...(webUrl ? [{ key: "open", label: "Open on web" }] : []),
          { key: "delete", label: "Delete", destructive: true },
        ],
      });
      if (action === "edit" && wsSlug) {
        router.push(`/${wsSlug}/more/autopilots/${id}/edit`);
        return;
      }
      if (action === "status") {
        setStatus(autopilot.status === "active" ? "paused" : "active");
        return;
      }
      if (action === "archive") {
        setStatus("archived");
        return;
      }
      if (action === "open" && webUrl) {
        Linking.openURL(`${webUrl}/${wsSlug}/autopilots/${id}`);
        return;
      }
      if (action === "delete") {
        onDelete();
      }
    })();
  }, [autopilot, id, onDelete, setStatus, wsSlug]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen
        options={{
          title: autopilot?.title || "Autopilot",
          headerRight: autopilot
            ? () => (
                <IconButton
                  name="ellipsis-horizontal"
                  onPress={onPressMore}
                  accessibilityLabel="Autopilot actions"
                />
              )
            : undefined,
        }}
      />
      {detail.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : detail.error || !autopilot || autopilot.id === "" ? (
        <View className="flex-1 items-center justify-center px-6 gap-3">
          <Text className="text-sm text-destructive text-center">
            Failed to load autopilot:{" "}
            {detail.error instanceof Error
              ? detail.error.message
              : "not found"}
          </Text>
          <Button variant="outline" onPress={() => detail.refetch()}>
            <Text>Retry</Text>
          </Button>
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="px-4 py-4 gap-4 pb-10"
          refreshControl={
            <RefreshControl
              refreshing={detail.isRefetching || runs.isRefetching}
              onRefresh={onRefresh}
            />
          }
        >
          <View className="rounded-md border border-border bg-card p-4 gap-4">
            <View className="flex-row items-start gap-3">
              <ActorAvatar
                type={autopilot.assignee_type}
                id={autopilot.assignee_id}
                size={52}
                showPresence={autopilot.assignee_type === "agent"}
              />
              <View className="flex-1 min-w-0 gap-1">
                <Text
                  className="text-xl font-semibold text-foreground"
                  numberOfLines={2}
                >
                  {autopilot.title}
                </Text>
                <Text className="text-sm text-muted-foreground" numberOfLines={3}>
                  {autopilot.description || "No runbook description"}
                </Text>
                <View className="flex-row flex-wrap gap-2 mt-1">
                  <StatusPill status={autopilot.status} />
                  <MetaPill
                    label={
                      autopilot.execution_mode === "create_issue"
                        ? "Create issue"
                        : "Run only"
                    }
                  />
                  <MetaPill label={assigneeName} />
                </View>
              </View>
            </View>

            <View className="flex-row gap-2">
              <Button
                className="flex-1"
                onPress={onTriggerNow}
                disabled={
                  autopilot.status !== "active" || triggerAutopilot.isPending
                }
              >
                <Ionicons name="play-outline" size={16} color="white" />
                <Text>
                  {triggerAutopilot.isPending ? "Starting..." : "Run now"}
                </Text>
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onPress={() =>
                  setStatus(
                    autopilot.status === "active" ? "paused" : "active",
                  )
                }
                disabled={updateAutopilot.isPending}
              >
                <Text>
                  {autopilot.status === "active" ? "Pause" : "Activate"}
                </Text>
              </Button>
            </View>
          </View>

          <Section title="Configuration">
            <InfoRow label="Assignee" value={assigneeName} />
            <InfoRow
              label="Mode"
              value={
                autopilot.execution_mode === "create_issue"
                  ? "Create issue"
                  : "Run only"
              }
            />
            {project ? <InfoRow label="Project" value={project.title} /> : null}
            {autopilot.issue_title_template ? (
              <InfoRow
                label="Issue title"
                value={autopilot.issue_title_template}
              />
            ) : null}
            <InfoRow
              label="Last run"
              value={
                autopilot.last_run_at
                  ? formatDateTime(autopilot.last_run_at)
                  : "Never"
              }
            />
          </Section>

          <Section title="Triggers">
            <View className="gap-3">
              {triggers.length > 0 ? (
                triggers.map((trigger) => (
                  <TriggerCard
                    key={trigger.id}
                    autopilotId={id}
                    trigger={trigger}
                  />
                ))
              ) : (
                <Text className="text-sm text-muted-foreground">
                  No triggers yet. Add a schedule or webhook to make this
                  autopilot run automatically.
                </Text>
              )}
              <TriggerComposer autopilotId={id} />
            </View>
          </Section>

          <Section title="Recent runs">
            {runs.isLoading ? (
              <View className="py-4 items-center">
                <ActivityIndicator />
              </View>
            ) : runs.data && runs.data.length > 0 ? (
              <View className="gap-2">
                {runs.data.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </View>
            ) : (
              <Text className="text-sm text-muted-foreground">
                No runs yet.
              </Text>
            )}
          </Section>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function TriggerComposer({ autopilotId }: { autopilotId: string }) {
  const createTrigger = useCreateAutopilotTrigger(autopilotId);
  const [mode, setMode] = useState<AutopilotTriggerKind | null>(null);
  const [cronExpression, setCronExpression] = useState("0 9 * * *");
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);

  const createSchedule = () => {
    createTrigger.mutate(
      {
        kind: "schedule",
        cron_expression: cronExpression.trim(),
        timezone: timezone.trim() || DEFAULT_TIMEZONE,
      },
      {
        onSuccess: () => {
          setMode(null);
        },
        onError: (err) => {
          Alert.alert(
            "Create failed",
            err instanceof Error ? err.message : "Unknown error",
          );
        },
      },
    );
  };

  const createWebhook = () => {
    createTrigger.mutate(
      { kind: "webhook" },
      {
        onSuccess: () => {
          setMode(null);
        },
        onError: (err) => {
          Alert.alert(
            "Create failed",
            err instanceof Error ? err.message : "Unknown error",
          );
        },
      },
    );
  };

  if (mode === "schedule") {
    return (
      <View className="rounded-md border border-border bg-background p-3 gap-3">
        <Text className="text-sm font-medium text-foreground">
          New schedule trigger
        </Text>
        <Field label="Cron expression">
          <TextField
            value={cronExpression}
            onChangeText={setCronExpression}
            placeholder="0 9 * * *"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>
        <Field label="Timezone">
          <TextField
            value={timezone}
            onChangeText={setTimezone}
            placeholder="UTC"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>
        <View className="flex-row gap-2">
          <Button
            className="flex-1"
            onPress={createSchedule}
            disabled={
              createTrigger.isPending ||
              cronExpression.trim().length === 0 ||
              timezone.trim().length === 0
            }
          >
            <Text>{createTrigger.isPending ? "Creating..." : "Create"}</Text>
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onPress={() => setMode(null)}
            disabled={createTrigger.isPending}
          >
            <Text>Cancel</Text>
          </Button>
        </View>
      </View>
    );
  }

  if (mode === "webhook") {
    return (
      <View className="rounded-md border border-border bg-background p-3 gap-3">
        <Text className="text-sm font-medium text-foreground">
          New webhook trigger
        </Text>
        <Text className="text-sm text-muted-foreground">
          Creates a generic bearer-token webhook. After creation you can copy
          the URL or rotate the token from the trigger card.
        </Text>
        <View className="flex-row gap-2">
          <Button
            className="flex-1"
            onPress={createWebhook}
            disabled={createTrigger.isPending}
          >
            <Text>{createTrigger.isPending ? "Creating..." : "Create"}</Text>
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onPress={() => setMode(null)}
            disabled={createTrigger.isPending}
          >
            <Text>Cancel</Text>
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-row gap-2">
      <Button
        variant="outline"
        className="flex-1"
        onPress={() => setMode("schedule")}
      >
        <Ionicons name="time-outline" size={16} color="#71717a" />
        <Text>Add schedule</Text>
      </Button>
      <Button
        variant="outline"
        className="flex-1"
        onPress={() => setMode("webhook")}
      >
        <Ionicons name="link-outline" size={16} color="#71717a" />
        <Text>Add webhook</Text>
      </Button>
    </View>
  );
}

function TriggerCard({
  autopilotId,
  trigger,
}: {
  autopilotId: string;
  trigger: AutopilotTrigger;
}) {
  const updateTrigger = useUpdateAutopilotTrigger(autopilotId, trigger.id);
  const deleteTrigger = useDeleteAutopilotTrigger(autopilotId, trigger.id);
  const rotateToken = useRotateAutopilotTriggerWebhookToken(
    autopilotId,
    trigger.id,
  );
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [cronExpression, setCronExpression] = useState(
    trigger.cron_expression ?? "",
  );
  const [timezone, setTimezone] = useState(trigger.timezone ?? DEFAULT_TIMEZONE);

  const webhookUrl =
    trigger.kind === "webhook"
      ? buildAutopilotWebhookUrl({
          trigger,
          apiBaseUrl: getCurrentApiUrl(),
        })
      : null;

  const onToggleEnabled = (enabled: boolean) => {
    updateTrigger.mutate(
      { enabled },
      {
        onError: (err) => {
          Alert.alert(
            "Update failed",
            err instanceof Error ? err.message : "Unknown error",
          );
        },
      },
    );
  };

  const onDelete = () => {
    Alert.alert("Delete trigger?", "This trigger will stop firing.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deleteTrigger.mutate(undefined, {
            onError: (err) => {
              Alert.alert(
                "Delete failed",
                err instanceof Error ? err.message : "Unknown error",
              );
            },
          });
        },
      },
    ]);
  };

  const saveSchedule = () => {
    const patch: UpdateAutopilotTriggerRequest = {
      cron_expression: cronExpression.trim(),
      timezone: timezone.trim() || DEFAULT_TIMEZONE,
    };
    updateTrigger.mutate(patch, {
      onSuccess: () => setEditingSchedule(false),
      onError: (err) => {
        Alert.alert(
          "Save failed",
          err instanceof Error ? err.message : "Unknown error",
        );
      },
    });
  };

  const rotateWebhookToken = () => {
    rotateToken.mutate(undefined, {
      onError: (err) => {
        Alert.alert(
          "Rotate failed",
          err instanceof Error ? err.message : "Unknown error",
        );
      },
    });
  };

  const copyWebhookUrl = async () => {
    if (!webhookUrl) return;
    await Clipboard.setStringAsync(webhookUrl);
    Alert.alert("Copied", "Webhook URL copied to clipboard.");
  };

  return (
    <View className="rounded-md border border-border bg-background p-3 gap-3">
      <View className="flex-row items-center gap-3">
        <View className="size-9 rounded-md bg-secondary items-center justify-center">
          <Ionicons
            name={trigger.kind === "schedule" ? "time-outline" : "link-outline"}
            size={18}
            color="#71717a"
          />
        </View>
        <View className="flex-1 min-w-0">
          <View className="flex-row items-center gap-2">
            <Text className="text-sm font-medium text-foreground capitalize">
              {trigger.kind}
            </Text>
            <MetaPill label={trigger.enabled ? "Enabled" : "Disabled"} />
          </View>
          <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={2}>
            {trigger.kind === "schedule"
              ? trigger.cron_expression || "No cron expression"
              : webhookUrl || "Webhook URL pending"}
          </Text>
        </View>
        <Switch checked={trigger.enabled} onCheckedChange={onToggleEnabled} />
      </View>

      {trigger.kind === "schedule" ? (
        <>
          {editingSchedule ? (
            <View className="gap-3">
              <Field label="Cron expression">
                <TextField
                  value={cronExpression}
                  onChangeText={setCronExpression}
                  placeholder="0 9 * * *"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </Field>
              <Field label="Timezone">
                <TextField
                  value={timezone}
                  onChangeText={setTimezone}
                  placeholder="UTC"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </Field>
              <View className="flex-row gap-2">
                <Button
                  className="flex-1"
                  onPress={saveSchedule}
                  disabled={updateTrigger.isPending}
                >
                  <Text>{updateTrigger.isPending ? "Saving..." : "Save"}</Text>
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onPress={() => {
                    setEditingSchedule(false);
                    setCronExpression(trigger.cron_expression ?? "");
                    setTimezone(trigger.timezone ?? DEFAULT_TIMEZONE);
                  }}
                  disabled={updateTrigger.isPending}
                >
                  <Text>Cancel</Text>
                </Button>
              </View>
            </View>
          ) : (
            <View className="gap-2">
              <InfoRow
                label="Timezone"
                value={trigger.timezone || DEFAULT_TIMEZONE}
              />
              <InfoRow
                label="Next run"
                value={
                  trigger.next_run_at
                    ? formatDateTime(trigger.next_run_at)
                    : "Pending"
                }
              />
              <InfoRow
                label="Last fired"
                value={
                  trigger.last_fired_at
                    ? formatDateTime(trigger.last_fired_at)
                    : "Never"
                }
              />
              <View className="flex-row gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onPress={() => setEditingSchedule(true)}
                >
                  <Text>Edit schedule</Text>
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onPress={onDelete}
                  disabled={deleteTrigger.isPending}
                >
                  <Text>Delete</Text>
                </Button>
              </View>
            </View>
          )}
        </>
      ) : (
        <View className="gap-2">
          <InfoRow
            label="Last fired"
            value={
              trigger.last_fired_at
                ? formatDateTime(trigger.last_fired_at)
                : "Never"
            }
          />
          {webhookUrl ? (
            <Pressable
              onPress={copyWebhookUrl}
              className="rounded-md bg-secondary/50 px-3 py-2 active:bg-secondary"
            >
              <Text className="text-xs font-mono text-foreground">
                {webhookUrl}
              </Text>
              <Text className="text-[11px] text-muted-foreground mt-1">
                Tap to copy
              </Text>
            </Pressable>
          ) : null}
          <View className="flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onPress={copyWebhookUrl}
              disabled={!webhookUrl}
            >
              <Text>Copy URL</Text>
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onPress={rotateWebhookToken}
              disabled={rotateToken.isPending}
            >
              <Text>{rotateToken.isPending ? "Rotating..." : "Rotate token"}</Text>
            </Button>
          </View>
          <Button
            variant="outline"
            onPress={onDelete}
            disabled={deleteTrigger.isPending}
          >
            <Text>Delete trigger</Text>
          </Button>
        </View>
      )}
    </View>
  );
}

function RunRow({ run }: { run: AutopilotRun }) {
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const isLinkedIssue = !!run.issue_id;

  const content = (
    <View className="rounded-md border border-border bg-background px-3 py-3 gap-2">
      <View className="flex-row items-center gap-2">
        <RunStatusPill status={run.status} />
        <Text className="text-xs text-muted-foreground capitalize">
          {run.source}
        </Text>
        <Text className="ml-auto text-xs text-muted-foreground">
          {formatDateTime(run.triggered_at || run.created_at)}
        </Text>
      </View>
      <Text className="text-sm text-foreground">
        {run.issue_id
          ? "Created or linked to an issue"
          : run.failure_reason || "No linked issue"}
      </Text>
      {run.completed_at ? (
        <Text className="text-xs text-muted-foreground">
          Finished {timeAgo(run.completed_at)}
        </Text>
      ) : null}
    </View>
  );

  if (isLinkedIssue && wsSlug) {
    return (
      <Pressable onPress={() => router.push(`/${wsSlug}/issue/${run.issue_id}`)}>
        {content}
      </Pressable>
    );
  }
  return content;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="rounded-md border border-border bg-card">
      <View className="px-4 py-3">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground">
          {title}
        </Text>
      </View>
      <Separator />
      <View className="p-4 gap-3">{children}</View>
    </View>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-xs text-muted-foreground">{label}</Text>
      {children}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start gap-3">
      <Text className="w-24 text-xs text-muted-foreground">{label}</Text>
      <Text className="flex-1 text-sm text-foreground" numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}

function StatusPill({ status }: { status: AutopilotStatus }) {
  const containerClass =
    status === "active"
      ? "bg-brand/10"
      : status === "paused"
        ? "bg-amber-500/10"
        : "bg-secondary";
  const textClass =
    status === "active"
      ? "text-brand"
      : status === "paused"
        ? "text-amber-700"
        : "text-muted-foreground";

  return (
    <View className={cn("rounded-full px-2 py-1", containerClass)}>
      <Text className={cn("text-xs capitalize", textClass)}>
        {status}
      </Text>
    </View>
  );
}

function MetaPill({ label }: { label: string }) {
  return (
    <View className="rounded-full bg-secondary px-2 py-1">
      <Text className="text-xs text-muted-foreground">{label}</Text>
    </View>
  );
}

function RunStatusPill({ status }: { status: AutopilotRun["status"] }) {
  const containerClass =
    status === "completed" || status === "issue_created"
      ? "bg-brand/10"
      : status === "running"
        ? "bg-secondary"
        : status === "failed"
          ? "bg-destructive/10"
          : "bg-muted";
  const textClass =
    status === "completed" || status === "issue_created"
      ? "text-brand"
      : status === "running"
        ? "text-foreground"
        : status === "failed"
          ? "text-destructive"
          : "text-muted-foreground";

  return (
    <View className={cn("rounded-full px-2 py-1", containerClass)}>
      <Text className={cn("text-xs capitalize", textClass)}>
        {status.replace("_", " ")}
      </Text>
    </View>
  );
}

function formatDateTime(value: string): string {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
