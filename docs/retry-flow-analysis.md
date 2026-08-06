# Retry 流程专题分析

> Status: Draft
> Last updated: 2026-05-29

## TL;DR

- `issue` 侧并不是“没有重试”。
- `issue` 已有手动 retry 按钮，也有后端 rerun API。
- `issue` 和 `chat` 都已有一部分自动重试，但只覆盖少数基础设施型失败。
- `chat` 当前没有手动 retry 按钮，也没有独立的手动 retry API。
- 当前最大的产品问题不是“完全没重试”，而是“能力不对称 + 状态不可见 + chat 历史 turn 无法安全精确重试”。

## 1. 结论先行

当前代码库里的 retry 能力可以分成三层：

| 场景 | 手动重试 | 自动重试 | UI 是否可见 |
|---|---|---|---|
| issue task | 有 | 有，限少数 failure reason | 部分可见 |
| chat task | 没有 | 有，限少数 failure reason | 基本不可见 |
| daemon -> server 终态上报 | 不需要用户触发 | 有，HTTP 重试 | 不对用户可见 |
| daemon 恢复旧 session 失败 | 不需要用户触发 | 有，一次 fresh-session fallback | 不对用户可见 |

所以用户感知上的主要问题是：

1. `issue` 和 `chat` 的 retry 产品行为不一致。
2. 自动重试虽然存在，但前端几乎看不出“正在自动重试 / 还能否重试 / 已经第几次”。
3. `chat` 的“重试某一条失败回复”在当前数据模型下并不是一个简单按钮问题。

## 2. 当前实现

### 2.1 Issue 手动 retry 已经存在

前端：

- `packages/views/issues/components/execution-log-section.tsx`
- 失败或取消的历史任务行会显示 retry 按钮。
- 点击后调用 `api.rerunIssue(issueId, task.id)`。

后端：

- `POST /api/issues/{id}/rerun`
- handler: `server/internal/handler/task_lifecycle.go`
- service: `server/internal/service/task.go` 中的 `RerunIssue`

当前行为不是简单“重跑 issue 当前 assignee”，而是：

- 可以按被点击的那一行 task 精确锁定 agent。
- 会继承必要的 trigger provenance。
- 只取消该 agent 在这个 issue 上的 active task，不会误伤别的 agent。
- 手动 rerun 默认 `force_fresh_session=true`，避免复用已经“有毒”的旧会话。

这部分从产品能力上是成立的。

### 2.2 Issue / Chat 都已有自动 retry，但范围很窄

核心逻辑：

- `server/internal/service/task.go`
- `MaybeRetryFailedTask`

当前自动 retry 只对这些 failure reason 生效：

- `runtime_offline`
- `runtime_recovery`
- `timeout`
- `codex_semantic_inactivity`

并且还受这些条件限制：

- `attempt < max_attempts`
- 不是 autopilot task
- 必须是 issue 或 chat task

自动 retry 会通过 `CreateRetryTask` 生成新的 child task：

- `attempt + 1`
- 继承 `max_attempts`
- 记录 `parent_task_id`
- 对 `codex_semantic_inactivity` 这类 resume-unsafe 场景切 fresh session
- 其他可恢复场景尽量保留 session / work_dir

这意味着：

- “runtime 失败完全不重试”不准确。
- 准确说法是：只有一小类基础设施型失败会自动重试，agent 输出错误、业务错误、模型拒答之类不会自动重试。

### 2.3 Chat 当前没有手动 retry 入口

前端现状：

- `packages/views/chat/components/chat-message-list.tsx`
- 失败消息会渲染 `FailureBubble`
- 只展示失败原因、details、timeline、elapsed
- 没有 retry 按钮

API / mutation 现状：

- `packages/core/api/client.ts`
- 有 `rerunIssue(...)`
- 没有 `rerunChat(...)` / `retryChat(...)`

后端路由现状：

- `server/internal/handler/chat.go`
- 有 create session / send message / list messages / pending task / cancel task
- 没有 chat rerun endpoint

所以 `chat` 的“失败后用户一键重试”目前确实不存在。

### 2.4 Chat 自动 retry 存在，但用户几乎感知不到

`FailTask` 在 chat task 上也会走 `MaybeRetryFailedTask`。

行为是：

- 如果会自动 retry，则不写失败 assistant message。
- 如果不会自动 retry，才会往 `chat_message` 写一条失败消息。

这带来一个副作用：

- 对用户来说，auto-retry 是“静默”的。
- 前端只知道 pending-task 还在不在，并不知道“刚刚失败了一次但系统又排了第二次”。

### 2.5 Runtime / Daemon 层其实也有 retry，但不是产品级 retry

这层需要和“task 是否重试”分开看。

已有能力包括：

- `server/internal/daemon/client.go`
- daemon 对 `/complete` 和 `/fail` 这类终态回调使用 `postJSONWithRetry`
- 也就是说，daemon 向 server 上报“任务完成/失败”时，网络抖动会重试

另外还有两个恢复路径：

- `server/internal/handler/task_lifecycle.go`
  - daemon 重启后会调用 `RecoverOrphanedTasks`
  - server 会把 orphan task 标 failed，并触发共享的 auto-retry 流程
- `server/internal/daemon/daemon.go`
  - 如果 session resume 在真正建起 session 前就失败，会自动再试一次 fresh session

所以“runtime 执行失败没有任何 retry”也不准确。

准确说法是：

- 传输层和 daemon 恢复层已经有 retry
- 任务业务层只有少数 failure reason 会自动 retry
- 用户层只有 issue 提供了手动 retry

## 3. 现在最关键的结构性问题

### 3.1 Issue 和 Chat 的 retry 模型不一致

现在的心智模型是割裂的：

- issue: 有历史执行日志，有 retry 按钮
- chat: 只有失败气泡，没有 retry 按钮

这会让用户自然得出“chat 不支持重试，issue 才支持”的产品结论，即使后端 chat 其实已经有自动 retry。

### 3.2 自动 retry 的元数据没有完整透出到前端

后端 task 响应已经有：

- `attempt`
- `max_attempts`
- `parent_task_id`

但前端现状并不完整：

- `packages/core/types/agent.ts` 里有 `attempt`、`parent_task_id`
- 没有 `max_attempts`
- `task:*` WS payload 只带 `task_id / status / issue_id / chat_session_id / agent_id`
- 不带 `attempt / max_attempts / parent_task_id / failure_reason / will_retry`
- `GET /api/chat/sessions/{id}/pending-task` 也只返回 `task_id / status / created_at`

结果是：

- UI 很难判断“这次失败是否还会自动重试”
- UI 很难显示“Retry #2 / 2”
- chat 几乎无法表达“系统正在自动重试”

### 3.3 Chat 的“重试某个历史失败 turn”在当前模型下不安全

这是这次分析里最重要的技术点。

当前 chat task 在 daemon claim 时，不是绑定某个明确的用户消息，而是：

- 从整个 session 里取“最新一条 user message”
- 作为这次 task 的 `ChatMessage`

相关位置：

- `server/internal/handler/daemon.go`
- `server/internal/daemon/prompt.go`

这意味着当前数据模型里，task 和“哪一条 user turn”并没有稳定外键。

因此如果直接在失败 bubble 上放“Retry”：

- 当这个失败 bubble 不是 session 最后一个 turn 时，重试可能会错误地响应更新后的更晚 user message。
- 用户会以为在 retry 老失败，但系统实际跑的是最新一轮对话。

所以 chat retry 不能只做一个按钮，还必须先定义“retry 的对象到底是什么”。

### 3.4 Issue 的自动 retry 也没有很好地被 UI 表达

虽然 issue 已有 retry，但仍有两个明显缺口：

1. 父失败行和子 retry 行之间没有显式关系提示，用户只能靠 execution log 猜。
2. 当系统已经自动 retry 生成 child task 时，父行上的手动 retry 按钮仍可能继续可点，容易触发重复重试。

## 4. 建议方案

### 4.1 第一阶段：先把产品语义补齐

目标不是先做大一统重构，而是先把“用户看得见、用得对”的行为补齐。

建议：

1. 明确定义两类 retry
   - `自动重试`: 基础设施抖动恢复
   - `手动重试`: 用户判断结果不对，明确要求再跑一次

2. UI 上把两类 retry 分开表达
   - 自动重试显示状态，不要求用户点按钮
   - 手动重试显示按钮，但只在语义安全时出现

3. 所有 retry 文案都带 attempt 语义
   - `Retrying 2/2`
   - `Retry available`
   - `Auto-retry exhausted`

### 4.2 第二阶段：先做一个“安全的 chat retry”

我不建议第一步就支持“任意历史失败 bubble 的逐条重试”。

更稳妥的方案是先支持：

- `Retry last turn`
- 只对“当前 session 最后一条失败 assistant turn”开放
- 并且要求 session 当前没有 active task

这样可以复用当前 chat prompt 的语义：

- 系统本来就会读取 session 里最新 user message
- 只要 retry 的是最后一轮，就不会跑偏

后端 API 建议：

- `POST /api/chat/sessions/{id}/rerun-latest`

后端语义建议：

- 校验当前 session 无 active task
- 校验最后一条 assistant message 是失败消息
- 重新 enqueue 一个 chat task
- 手动 rerun 默认 `force_fresh_session=true`

前端 UI 建议：

- 在 `FailureBubble` 上显示 retry 按钮
- 只对最后一个失败 turn 显示
- 如果已存在新 pending task，则显示 `Retrying...` 而不是继续给按钮

这是一个成本最低、语义最安全的落地版本。

### 4.3 第三阶段：如果要支持“重试历史 turn”，必须补 task <-> message 绑定

如果产品目标是“任何失败 bubble 都能单独 retry”，建议先改数据模型：

1. 在 `agent_task_queue` 上记录这次 chat task 绑定的 source user message
   - 比如 `source_chat_message_id`
   - 或放进 task `context`

2. daemon claim 时不要再读“session 里最新 user message”
   - 改成读取 task 绑定的那条 user message

3. chat rerun API 也要按 source task / source message 精确重建

否则“重试第 3 轮失败回复”这个交互没有可靠语义。

这是我认为比“加按钮”更关键的架构前置条件。

### 4.4 第四阶段：统一前端可观察性

建议把 retry 元数据作为统一 contract 暴露给前端：

- `attempt`
- `max_attempts`
- `parent_task_id`
- `failure_reason`
- `retry_state`

`retry_state` 建议新增为显式枚举，而不是让前端自己猜：

- `none`
- `auto_retry_pending`
- `auto_retry_exhausted`
- `manual_retry_available`

优点：

- chat / issue UI 不需要各自推导
- 可直接在 failure bubble、execution log、agent activity 上复用
- 更适合以后做 analytics

如果暂时不想加 `retry_state`，至少也要把这些字段补齐到：

- `task:*` WS payload
- `GET /api/chat/sessions/{id}/pending-task`
- 相关 task list / snapshot 响应

### 4.5 Issue 侧建议的小改动

`issue` 不需要重做，只需要补体验：

1. 当某个 failed row 已经派生出 active child retry 时：
   - 父行隐藏 retry 按钮
   - 或显示 `Retrying...`

2. 在 execution log 中更明显地关联 parent / child
   - 现在虽然能显示 `Retry #N`
   - 但仍不够直观

3. 显式展示 retry budget
   - 例如 `Retry #2 of 2`

## 5. 推荐的实施顺序

我建议按这个顺序做：

1. 文案和状态定义统一
2. 给 chat 做“只支持 last failed turn”的手动 retry
3. 补前端可观察字段：`max_attempts`、`retry_state`、WS payload
4. 优化 issue 的 auto-retry 可见性
5. 如果产品确认需要，再做“历史 turn 精确 retry”的数据模型升级

## 6. 我的判断

如果目标是尽快解决用户最强烈的体感问题，我的建议是：

- 不要先做一个“看起来有按钮，但语义不稳”的 chat retry。
- 先做 `Retry last turn`，把最常见失败恢复场景补上。
- 同时把 retry 状态显式化，不然自动重试永远像“系统没反应”。

当前代码库已经有一半基础设施：

- task attempt 链
- auto-retry clone
- issue manual rerun
- daemon 终态 HTTP 重试
- daemon 恢复 orphan task 时触发 retry

真正缺的是：

- chat 的手动 retry 产品面
- 前端可观察性
- chat turn 级别的精确绑定
