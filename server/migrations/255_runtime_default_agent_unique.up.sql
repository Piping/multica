CREATE UNIQUE INDEX CONCURRENTLY runtime_default_agent_runtime_unique
    ON agent (runtime_id)
    WHERE system_key = 'runtime_default';
