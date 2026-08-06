DELETE FROM agent_invocation_target
WHERE agent_id IN (
    SELECT id
    FROM agent
    WHERE system_key = 'runtime_default'
);

DELETE FROM agent
WHERE system_key = 'runtime_default';
