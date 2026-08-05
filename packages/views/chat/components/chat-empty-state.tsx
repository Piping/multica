"use client";

import type { Agent } from "@multica/core/types";
import type { RuntimeDevice } from "@multica/core/types";
import { runtimeDisplayName } from "@multica/core/runtimes";
import { ActorAvatar } from "../../common/actor-avatar";
import { ProviderLogo } from "../../runtimes/components/provider-logo";
import { useT } from "../../i18n";

/**
 * Empty compose placeholder shown when a chat has no messages yet. Agent-aware:
 * it leads with the chosen agent's avatar + name + description so the user knows
 * exactly who they're about to talk to. The composer below is the entry point —
 * no starter prompts, they read as filler more than help.
 */
export function EmptyState({
  agent,
  runtime,
}: {
  agent: Agent | null;
  runtime?: RuntimeDevice | null;
}) {
  const { t } = useT("chat");
  const description = agent?.description?.trim();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-8">
      {runtime ? (
        <span className="flex size-14 items-center justify-center rounded-md border bg-background">
          <ProviderLogo provider={runtime.provider} className="size-7" />
        </span>
      ) : agent ? (
        <ActorAvatar
          actorType="agent"
          actorId={agent.id}
          size="2xl"
          className="ring-1 ring-inset ring-border"
        />
      ) : null}
      <div className="max-w-sm space-y-1 text-center">
        <h3 className="text-title-sm font-semibold">
          {runtime
            ? t(($) => $.empty_state.runtime_session, {
                name: runtimeDisplayName(runtime),
              })
            : agent
            ? t(($) => $.empty_state.chat_with_named, { name: agent.name })
            : t(($) => $.empty_state.first_time_title)}
        </h3>
        {runtime ? (
          <p className="text-body text-muted-foreground">
            {runtime.device_info || runtime.provider}
          </p>
        ) : description ? (
          <p className="text-body text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  );
}
