import { useCallback, useMemo } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { UpdateAutopilotRequest } from "@multica/core/types";
import {
  AutopilotForm,
  buildAssigneeValue,
  NONE_PROJECT,
  type AutopilotFormPayload,
} from "@/components/autopilot/autopilot-form";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useUpdateAutopilot } from "@/data/mutations/autopilots";
import { autopilotDetailOptions } from "@/data/queries/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";

export default function EditAutopilotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const detail = useQuery(autopilotDetailOptions(wsId, id));
  const update = useUpdateAutopilot(id);

  const initialValues = useMemo(() => {
    const autopilot = detail.data?.autopilot;
    if (!autopilot) {
      return null;
    }
    return {
      title: autopilot.title,
      description: autopilot.description ?? "",
      executionMode: autopilot.execution_mode,
      assigneeValue: buildAssigneeValue(
        autopilot.assignee_type,
        autopilot.assignee_id,
      ),
      projectValue: autopilot.project_id ?? NONE_PROJECT,
      issueTitleTemplate: autopilot.issue_title_template ?? "",
    };
  }, [detail.data?.autopilot]);

  const onSubmit = useCallback(
    (payload: AutopilotFormPayload) => {
      const body: UpdateAutopilotRequest = {
        title: payload.title,
        description: payload.description || null,
        assignee_type: payload.assignee_type,
        assignee_id: payload.assignee_id,
        execution_mode: payload.execution_mode,
        project_id: payload.project_id,
        issue_title_template: payload.issue_title_template,
      };
      update.mutate(body, {
        onSuccess: () => router.back(),
        onError: (err) => {
          Alert.alert(
            "Save failed",
            err instanceof Error ? err.message : "Unknown error",
          );
        },
      });
    },
    [update],
  );

  if (detail.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (detail.error) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-background px-6">
        <Text className="text-center text-sm text-destructive">
          Failed to load autopilot:{" "}
          {detail.error instanceof Error ? detail.error.message : "unknown error"}
        </Text>
        <Button variant="outline" onPress={() => detail.refetch()}>
          <Text>Retry</Text>
        </Button>
      </View>
    );
  }

  if (!initialValues) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-background px-6">
        <Text className="text-center text-sm text-destructive">
          Autopilot not found.
        </Text>
        <Button variant="outline" onPress={() => router.back()}>
          <Text>Back</Text>
        </Button>
      </View>
    );
  }

  return (
    <AutopilotForm
      submitLabel="Save"
      submittingLabel="Saving..."
      isSubmitting={update.isPending}
      initialValues={initialValues}
      nextStepDescription="Trigger setup stays on the detail screen. Use the detail page to manage schedules, webhook URLs, token rotation, and manual runs."
      onSubmit={onSubmit}
      onDismiss={() => router.back()}
      requireDirty
      discardTitle="Discard changes?"
      discardMessage="Your edits will be lost."
    />
  );
}
