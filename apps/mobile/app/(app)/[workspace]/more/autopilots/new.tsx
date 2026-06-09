import { useCallback } from "react";
import { Alert, InteractionManager } from "react-native";
import { router } from "expo-router";
import type { CreateAutopilotRequest } from "@multica/core/types";
import {
  AutopilotForm,
  type AutopilotFormPayload,
} from "@/components/autopilot/autopilot-form";
import { useCreateAutopilot } from "@/data/mutations/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";

export default function NewAutopilotScreen() {
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const create = useCreateAutopilot();

  const onSubmit = useCallback(
    (payload: AutopilotFormPayload) => {
      const body: CreateAutopilotRequest = {
        title: payload.title,
        description: payload.description || undefined,
        assignee_type: payload.assignee_type,
        assignee_id: payload.assignee_id,
        execution_mode: payload.execution_mode,
        project_id: payload.project_id,
        issue_title_template: payload.issue_title_template || undefined,
      };
      create.mutate(body, {
        onSuccess: (autopilot) => {
          router.back();
          InteractionManager.runAfterInteractions(() => {
            if (wsSlug) {
              router.push(`/${wsSlug}/more/autopilots/${autopilot.id}`);
            }
          });
        },
        onError: (err) => {
          Alert.alert(
            "Create failed",
            err instanceof Error ? err.message : "Unknown error",
          );
        },
      });
    },
    [create, wsSlug],
  );

  return (
    <AutopilotForm
      submitLabel="Create"
      submittingLabel="Creating..."
      isSubmitting={create.isPending}
      nextStepDescription="Trigger setup happens on the autopilot detail screen. After creation you can add a schedule or webhook, rotate webhook tokens, and trigger runs manually."
      onSubmit={onSubmit}
      onDismiss={() => router.back()}
      discardTitle="Discard autopilot?"
      discardMessage="Your draft will be lost."
    />
  );
}
