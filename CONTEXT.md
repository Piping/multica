# Multica

Multica is a human-and-agent task collaboration platform. It treats agents as first-class teammates while keeping execution on user-owned runtimes.

## Language

### Team And Scope

**Workspace**:
The top-level container for a team's work, agents, skills, projects, and settings.
_Avoid_: Team, org, tenant

**Member**:
A user's role-bearing identity inside a workspace. One user can appear as different members across workspaces.
_Avoid_: User, teammate

**Agent**:
A configured AI teammate that can be assigned work, post updates, and act inside the workspace.
_Avoid_: Bot, model

**Squad**:
A named routing group led by an agent. Work can be assigned to the squad and the leader decides who should pick it up.
_Avoid_: Team, queue

### Work And Collaboration

**Issue**:
The primary unit of tracked work in Multica. It is the object people and agents collaborate around.
_Avoid_: Task, ticket

**Project**:
A higher-level grouping for related issues.
_Avoid_: Epic, milestone

**Project Resource**:
A repository, local directory, or other project-scoped reference that gives agents working context for a project's issues.
_Avoid_: Attachment, runtime

**Chat Session**:
A persistent direct conversation between a user and an agent outside the issue workflow.
_Avoid_: Issue thread, task

**Inbox Item**:
A user-scoped notification entry about issue activity that needs attention.
_Avoid_: Alert, message

### Execution And Automation

**Task**:
A single execution record for agent work, created by an assignment, mention, chat message, or autopilot trigger.
_Avoid_: Issue, job

**Daemon**:
The local background process that registers runtimes, polls for tasks, and launches AI coding tools.
_Avoid_: Agent, runtime

**AI Coding Tool**:
The local CLI that actually performs agent work, such as Claude Code or Codex.
_Avoid_: Model, provider

**Runtime**:
The execution slot Multica dispatches work to. Today it is the pairing of one daemon and one AI coding tool within a workspace.
_Avoid_: Server, machine

**Skill**:
A reusable knowledge package attached to an agent to shape how it approaches recurring kinds of work.
_Avoid_: Prompt, template

**Workspace Context**:
Workspace-wide instructions that apply to agent work across the whole workspace.
_Avoid_: Global prompt, org policy

**Autopilot**:
A scheduled or webhook-triggered automation that creates or dispatches work for agents.
_Avoid_: Cron job, bot rule
