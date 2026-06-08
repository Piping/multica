/**
 * Today attention derivation. The screen remains mobile-owned, but the status
 * semantics mirror web/core: runtime health comes from @multica/core/runtimes
 * and task active/terminal buckets use AgentTask.status directly.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { deriveRuntimeHealth, type RuntimeHealth } from "@multica/core/runtimes";
import type {
  Agent,
  AgentTask,
  ChatSession,
  PendingChatTaskItem,
  RuntimeDevice,
} from "@multica/core/types";
import { agentListOptions } from "@/data/queries/agents";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { agentTaskSnapshotOptions } from "@/data/queries/agent-task-snapshot";
import { pendingChatTasksOptions } from "@/data/queries/chat";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const ACTIVE_TASK_STATUSES = new Set<AgentTask["status"]>([
  "queued",
  "dispatched",
  "waiting_local_directory",
  "running",
]);

const HARD_FAILURE_REASONS = new Set<string>([
  "timeout",
  "codex_semantic_inactivity",
  "runtime_offline",
  "runtime_recovery",
]);

export type TodayAttentionSeverity = "critical" | "warning" | "info";

export type TodayAttentionSignal =
  | {
      id: string;
      kind: "runtime";
      severity: TodayAttentionSeverity;
      runtime: RuntimeDevice;
      health: RuntimeHealth;
      affectedAgents: Agent[];
    }
  | {
      id: string;
      kind: "task_overdue";
      severity: TodayAttentionSeverity;
      task: AgentTask;
      agent: Agent | null;
      chatSession: ChatSession | null;
      ageMs: number;
    }
  | {
      id: string;
      kind: "task_failed";
      severity: TodayAttentionSeverity;
      task: AgentTask;
      agent: Agent | null;
      chatSession: ChatSession | null;
      ageMs: number;
    };

interface BuildArgs {
  agents: readonly Agent[];
  runtimes: readonly RuntimeDevice[];
  tasks: readonly AgentTask[];
  pendingChatTasks: readonly PendingChatTaskItem[];
  chatSessions: readonly ChatSession[];
  now: number;
}

export function buildTodayAttentionSignals(args: BuildArgs): TodayAttentionSignal[] {
  const agentsById = new Map(args.agents.map((a) => [a.id, a]));
  const sessionsById = new Map(args.chatSessions.map((s) => [s.id, s]));
  const pendingChatTaskIds = new Set(args.pendingChatTasks.map((t) => t.task_id));
  const activeAgents = args.agents.filter((a) => !a.archived_at);
  const agentsByRuntime = new Map<string, Agent[]>();

  for (const agent of activeAgents) {
    const list = agentsByRuntime.get(agent.runtime_id);
    if (list) list.push(agent);
    else agentsByRuntime.set(agent.runtime_id, [agent]);
  }

  const signals: TodayAttentionSignal[] = [];

  for (const runtime of args.runtimes) {
    const affectedAgents = agentsByRuntime.get(runtime.id) ?? [];
    if (affectedAgents.length === 0) continue;
    const health = deriveRuntimeHealth(runtime, args.now);
    if (health === "online") continue;
    signals.push({
      id: `runtime:${runtime.id}`,
      kind: "runtime",
      severity: health === "recently_lost" ? "warning" : "critical",
      runtime,
      health,
      affectedAgents,
    });
  }

  for (const task of args.tasks) {
    const createdAt = parseTime(task.created_at);
    const finishedAt = parseTime(task.completed_at ?? task.created_at);
    const ageMs = args.now - (createdAt || args.now);
    const agent = agentsById.get(task.agent_id) ?? null;
    const chatSession = task.chat_session_id
      ? sessionsById.get(task.chat_session_id) ?? null
      : null;

    if (task.status === "failed") {
      const finishedAgeMs = args.now - (finishedAt || args.now);
      const hardFailure = HARD_FAILURE_REASONS.has(task.failure_reason ?? "");
      if (finishedAgeMs <= DAY_MS || hardFailure) {
        signals.push({
          id: `task-failed:${task.id}`,
          kind: "task_failed",
          severity: hardFailure ? "critical" : "warning",
          task,
          agent,
          chatSession,
          ageMs: finishedAgeMs,
        });
      }
      continue;
    }

    if (!ACTIVE_TASK_STATUSES.has(task.status)) continue;

    const thresholdMs = task.status === "waiting_local_directory"
      ? MINUTE_MS
      : task.chat_session_id || pendingChatTaskIds.has(task.id)
        ? 2 * MINUTE_MS
        : 5 * MINUTE_MS;

    if (ageMs >= thresholdMs) {
      signals.push({
        id: `task-overdue:${task.id}`,
        kind: "task_overdue",
        severity: task.status === "waiting_local_directory" ? "warning" : "critical",
        task,
        agent,
        chatSession,
        ageMs,
      });
    }
  }

  return signals.sort(compareSignals);
}

export function useTodayAttentionCount(wsId: string | null | undefined): number {
  const { data: agents = [] } = useQuery(agentListOptions(wsId ?? null));
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId ?? null));
  const { data: tasks = [] } = useQuery(agentTaskSnapshotOptions(wsId ?? null));
  const { data: pendingChatTasks } = useQuery(pendingChatTasksOptions(wsId ?? null));

  const count = useMemo(
    () => buildTodayAttentionSignals({
      agents,
      runtimes,
      tasks,
      pendingChatTasks: pendingChatTasks?.tasks ?? [],
      chatSessions: [],
      now: Date.now(),
    }).length,
    [agents, runtimes, tasks, pendingChatTasks],
  );

  return count;
}

function compareSignals(a: TodayAttentionSignal, b: TodayAttentionSignal): number {
  const severityDelta = severityRank(b.severity) - severityRank(a.severity);
  if (severityDelta !== 0) return severityDelta;
  return signalTime(b) - signalTime(a);
}

function severityRank(severity: TodayAttentionSeverity): number {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function signalTime(signal: TodayAttentionSignal): number {
  if (signal.kind === "runtime") return parseTime(signal.runtime.last_seen_at) || 0;
  return parseTime(signal.task.completed_at ?? signal.task.created_at) || 0;
}

function parseTime(value: string | null | undefined): number {
  if (!value) return 0;
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : 0;
}
