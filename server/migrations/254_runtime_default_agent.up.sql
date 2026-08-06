-- Backfill one visible, configuration-free vanilla Agent for every Runtime.
-- The separate concurrent unique index in migration 255 makes future
-- registration upserts idempotent; this migration runs first so the index build
-- also validates the backfill invariant.
INSERT INTO agent (
    workspace_id,
    name,
    description,
    runtime_mode,
    runtime_config,
    runtime_id,
    visibility,
    permission_mode,
    max_concurrent_tasks,
    owner_id,
    instructions,
    custom_env,
    custom_args,
    kind,
    system_key
)
SELECT
    runtime.workspace_id,
    (
        CASE
            WHEN NULLIF(BTRIM(runtime.custom_name), '') IS NOT NULL
                THEN BTRIM(runtime.custom_name) || ' (' || runtime.provider || ')'
            ELSE runtime.name
        END
    ) || ' [' || LEFT(runtime.id::text, 8) || ']',
    '',
    runtime.runtime_mode,
    '{}'::jsonb,
    runtime.id,
    CASE WHEN runtime.visibility = 'public' THEN 'workspace' ELSE 'private' END,
    CASE WHEN runtime.visibility = 'public' THEN 'public_to' ELSE 'private' END,
    6,
    COALESCE(runtime.owner_id, workspace_owner.user_id),
    '',
    '{}'::jsonb,
    '[]'::jsonb,
    'user',
    'runtime_default'
FROM agent_runtime runtime
JOIN LATERAL (
    SELECT user_id
    FROM member
    WHERE workspace_id = runtime.workspace_id
      AND role = 'owner'
    ORDER BY created_at ASC
    LIMIT 1
) workspace_owner ON true
WHERE NOT EXISTS (
    SELECT 1
    FROM agent existing
    WHERE existing.runtime_id = runtime.id
      AND existing.system_key = 'runtime_default'
);

INSERT INTO agent_invocation_target (
    agent_id,
    target_type,
    target_id,
    created_by
)
SELECT
    vanilla.id,
    'workspace',
    vanilla.workspace_id,
    vanilla.owner_id
FROM agent vanilla
JOIN agent_runtime runtime ON runtime.id = vanilla.runtime_id
WHERE vanilla.system_key = 'runtime_default'
  AND runtime.visibility = 'public'
ON CONFLICT (agent_id, target_type, target_id) DO NOTHING;
