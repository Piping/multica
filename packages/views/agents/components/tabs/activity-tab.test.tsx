// @vitest-environment jsdom

import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@multica/core/i18n/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Agent, AgentTask, Issue } from "@multica/core/types";
import enCommon from "../../../locales/en/common.json";
import enAgents from "../../../locales/en/agents.json";
import { TaskRow } from "./activity-tab";

const TEST_RESOURCES = { en: { common: enCommon, agents: enAgents } };

const mockRerunIssue = vi.hoisted(() => vi.fn());
const mockCancelTaskById = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/api", () => ({
  api: {
    rerunIssue: mockRerunIssue,
    cancelTaskById: mockCancelTaskById,
  },
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    issueDetail: (id: string) => `/test/issues/${id}`,
  }),
}));

vi.mock("../../../navigation", () => ({
  AppLink: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("../../../common/task-transcript", () => ({
  TranscriptButton: ({ title }: { title: string }) => (
    <button type="button" aria-label={title}>
      transcript
    </button>
  ),
}));

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    workspace_id: "ws-1",
    runtime_id: "rt-1",
    name: "Squirtle",
    description: "",
    instructions: "",
    avatar_url: null,
    runtime_mode: "local",
    runtime_config: {},
    custom_args: [],
    visibility: "private",
    status: "idle",
    max_concurrent_tasks: 1,
    model: "",
    owner_id: "user-1",
    skills: [],
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    archived_at: null,
    archived_by: null,
    ...overrides,
  };
}

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "task-1",
    agent_id: "agent-1",
    runtime_id: "rt-1",
    issue_id: "issue-1",
    status: "failed",
    priority: 0,
    dispatched_at: "2026-05-29T08:00:00Z",
    started_at: "2026-05-29T08:01:00Z",
    completed_at: "2026-05-29T08:05:00Z",
    result: null,
    error: "boom",
    created_at: "2026-05-29T08:00:00Z",
    failure_reason: "agent_error",
    ...overrides,
  };
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    workspace_id: "ws-1",
    number: 1,
    identifier: "MUL-1",
    project_id: null,
    title: "Broken task",
    description: "",
    status: "todo",
    priority: "medium",
    assignee_type: null,
    assignee_id: null,
    creator_type: "member",
    creator_id: "user-1",
    parent_issue_id: null,
    position: 0,
    start_date: null,
    due_date: null,
    metadata: {},
    reactions: [],
    labels: [],
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

function renderRow(task: AgentTask, issue?: Issue) {
  const issueMap = new Map<string, Issue>();
  if (issue) issueMap.set(issue.id, issue);
  return render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <TaskRow
        task={task}
        issueMap={issueMap}
        timeMode="completed"
        agent={makeAgent()}
      />
    </I18nProvider>,
  );
}

describe("TaskRow retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows retry for failed issue-backed tasks and reruns the clicked task", () => {
    renderRow(makeTask(), makeIssue());

    fireEvent.click(screen.getByLabelText("Retry task"));

    expect(mockRerunIssue).toHaveBeenCalledWith("issue-1", "task-1");
  });

  it("does not show retry for failed tasks without an issue", () => {
    renderRow(
      makeTask({
        issue_id: "",
        kind: "quick_create",
      }),
    );

    expect(screen.queryByLabelText("Retry task")).toBeNull();
  });
});
