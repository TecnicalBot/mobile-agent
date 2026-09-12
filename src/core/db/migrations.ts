import type { SQLiteDatabase } from "expo-sqlite";

import {
  serializeAgentToMarkdown,
} from "@/modules/agents/agent-markdown";
import { serializeSkillToMarkdown } from "@/modules/skills/skill-markdown";

const DATABASE_VERSION = 30;

const CORE_SCHEMA_REPAIR_SQL = `
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY NOT NULL,
    conversation_id TEXT NOT NULL,
    status TEXT NOT NULL,
    user_message_id TEXT NOT NULL,
    assistant_message_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    input TEXT NOT NULL,
    file_context_source TEXT,
    selected_file_ids_json TEXT NOT NULL DEFAULT '[]',
    external_folder_session_json TEXT,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    last_error TEXT,
    resume_count INTEGER NOT NULL DEFAULT 0,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    last_retry_at TEXT,
    agent_mode TEXT NOT NULL DEFAULT 'build',
    agent_id TEXT,
    auto_approve INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  );

  CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation_updated_at
  ON agent_runs(conversation_id, updated_at);

  CREATE INDEX IF NOT EXISTS idx_agent_runs_status_updated_at
  ON agent_runs(status, updated_at);

  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    expression TEXT NOT NULL,
    timezone TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    agent_id TEXT,
    auto_approve INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    conversation_id TEXT,
    external_folder_session_json TEXT,
    last_run_at TEXT,
    next_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    prompt TEXT,
    mode TEXT NOT NULL DEFAULT 'all',
    model_provider_id TEXT,
    model_model_id TEXT,
    temperature REAL,
    enabled INTEGER NOT NULL DEFAULT 1,
    hidden INTEGER NOT NULL DEFAULT 0,
    source_markdown TEXT,
    tool_permissions_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_agents_updated_at ON agents(updated_at);

  CREATE TABLE IF NOT EXISTS schedule_runs (
    id TEXT PRIMARY KEY NOT NULL,
    schedule_id TEXT NOT NULL,
    run_id TEXT,
    status TEXT NOT NULL,
    error TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_schedules_enabled_next_run_at
  ON schedules(enabled, next_run_at);

  CREATE INDEX IF NOT EXISTS idx_schedules_updated_at
  ON schedules(updated_at);

  CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule_started_at
  ON schedule_runs(schedule_id, started_at);

  CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    description TEXT,
    author TEXT,
    file_path TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    options_json TEXT DEFAULT '{}',
    source_url TEXT,
    last_update_check TEXT,
    last_error TEXT,
    required_secrets_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_plugins_updated_at
  ON plugins(updated_at);

  CREATE TABLE IF NOT EXISTS plugin_storage (
    plugin_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (plugin_id, key)
  );

  CREATE INDEX IF NOT EXISTS idx_plugin_storage_plugin_id
  ON plugin_storage(plugin_id);
`;

export async function migrateAppDatabase(db: SQLiteDatabase) {
  const versionRow = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version",
  );
  let currentVersion = versionRow?.user_version ?? 0;

  await db.execAsync(CORE_SCHEMA_REPAIR_SQL);

  const ensureAgentIdColumns = async () => {
    const runColumns = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(agent_runs)",
    );
    if (!runColumns.some((column) => column.name === "agent_id")) {
      await db.execAsync(`
        ALTER TABLE agent_runs
        ADD COLUMN agent_id TEXT;
      `);
    }

    const scheduleColumns = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(schedules)",
    );
    if (!scheduleColumns.some((column) => column.name === "agent_id")) {
      await db.execAsync(`
        ALTER TABLE schedules
        ADD COLUMN agent_id TEXT;
      `);
    }
  };
  await ensureAgentIdColumns();

  const ensureMcpServersOauthModeColumn = async () => {
    const columns = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(mcp_servers)",
    );

    if (!columns.some((column) => column.name === "oauth_mode")) {
      await db.execAsync(`ALTER TABLE mcp_servers ADD COLUMN oauth_mode TEXT;`);
    }
  };
  await ensureMcpServersOauthModeColumn();

  if (currentVersion >= DATABASE_VERSION) {
    const conversationColumns = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(conversations)",
    );

    if (
      !conversationColumns.some(
        (column) => column.name === "selected_mcp_server_ids_json",
      )
    ) {
      await db.execAsync(`
        ALTER TABLE conversations
        ADD COLUMN selected_mcp_server_ids_json TEXT;
      `);
    }

    if (!conversationColumns.some((column) => column.name === "pinned_at")) {
      await db.execAsync(`
        ALTER TABLE conversations
        ADD COLUMN pinned_at TEXT;
      `);
    }

    if (!conversationColumns.some((column) => column.name === "agent_mode")) {
      await db.execAsync(`
        ALTER TABLE conversations
        ADD COLUMN agent_mode TEXT NOT NULL DEFAULT 'build';
      `);
    }

    if (!conversationColumns.some((column) => column.name === "agent_id")) {
      await db.execAsync(`
        ALTER TABLE conversations
        ADD COLUMN agent_id TEXT;
      `);

      await db.execAsync(`
        UPDATE conversations
        SET agent_id = CASE WHEN agent_mode = 'plan' THEN 'plan' ELSE 'build' END
        WHERE agent_id IS NULL;
      `);
    }

    const runColumns = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(agent_runs)",
    );

    if (!runColumns.some((column) => column.name === "agent_id")) {
      await db.execAsync(`
        ALTER TABLE agent_runs
        ADD COLUMN agent_id TEXT;
      `);
    }

    const scheduleColumns = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(schedules)",
    );

    if (!scheduleColumns.some((column) => column.name === "agent_id")) {
      await db.execAsync(`
        ALTER TABLE schedules
        ADD COLUMN agent_id TEXT;
      `);
    }

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        prompt TEXT,
        mode TEXT NOT NULL DEFAULT 'all',
        model_provider_id TEXT,
        model_model_id TEXT,
        temperature REAL,
        enabled INTEGER NOT NULL DEFAULT 1,
        hidden INTEGER NOT NULL DEFAULT 0,
        source_markdown TEXT,
        tool_permissions_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    return;
  }

  if (currentVersion === 0) {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        provider_id TEXT,
        model_id TEXT,
        reasoning_effort TEXT NOT NULL DEFAULT 'medium',
        agent_mode TEXT NOT NULL DEFAULT 'build',
        agent_id TEXT,
        selected_file_ids_json TEXT NOT NULL DEFAULT '[]',
        selected_mcp_server_ids_json TEXT,
        selected_skill_ids_json TEXT NOT NULL DEFAULT '[]',
        external_folder_session_json TEXT,
        pinned_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY NOT NULL,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT,
        status TEXT NOT NULL,
        error TEXT,
        sequence INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE TABLE IF NOT EXISTS provider_configs (
        id TEXT PRIMARY KEY NOT NULL,
        family TEXT NOT NULL,
        label TEXT NOT NULL,
        auth_type TEXT NOT NULL,
        base_url TEXT,
        enabled INTEGER NOT NULL DEFAULT 0,
        oauth_account_email TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_presets (
        id TEXT PRIMARY KEY NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        label TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        options_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider_id, model_id)
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS provider_accounts (
        id TEXT PRIMARY KEY NOT NULL,
        provider_id TEXT NOT NULL,
        label TEXT NOT NULL,
        credential_kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_provider_accounts_provider_id
      ON provider_accounts(provider_id);

      CREATE TABLE IF NOT EXISTS provider_account_state (
        provider_id TEXT PRIMARY KEY NOT NULL,
        active_account_id TEXT
      );

      CREATE TABLE IF NOT EXISTS workspace_files (
        id TEXT PRIMARY KEY NOT NULL,
        display_name TEXT NOT NULL,
        original_name TEXT,
        mime_type TEXT,
        size INTEGER,
        relative_path TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(relative_path)
      );

      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY NOT NULL,
        label TEXT NOT NULL,
        url TEXT NOT NULL,
        transport TEXT NOT NULL,
        auth_mode TEXT NOT NULL,
        oauth_mode TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        header_names_json TEXT NOT NULL DEFAULT '[]',
        oauth_client_id TEXT,
        oauth_authorization_url TEXT,
        oauth_token_url TEXT,
        oauth_scopes TEXT,
        oauth_allowed_auth_origin TEXT,
        last_status TEXT NOT NULL DEFAULT 'untested',
        last_error TEXT,
        tool_count INTEGER,
        server_info_json TEXT,
        server_instructions TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        instructions TEXT NOT NULL,
        source_markdown TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        auto_match INTEGER NOT NULL DEFAULT 0,
        match_keywords_json TEXT NOT NULL DEFAULT '[]',
        recommended_mcp_server_ids_json TEXT NOT NULL DEFAULT '[]',
        recommended_built_in_tool_keys_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS saved_prompts (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY NOT NULL,
        content TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        source_conversation_id TEXT,
        source_message_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY NOT NULL,
        conversation_id TEXT NOT NULL,
        status TEXT NOT NULL,
        user_message_id TEXT NOT NULL,
        assistant_message_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        input TEXT NOT NULL,
        file_context_source TEXT,
        selected_file_ids_json TEXT NOT NULL DEFAULT '[]',
        external_folder_session_json TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        last_error TEXT,
        resume_count INTEGER NOT NULL DEFAULT 0,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        last_retry_at TEXT,
        agent_mode TEXT NOT NULL DEFAULT 'build',
        agent_id TEXT,
        auto_approve INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        prompt TEXT,
        mode TEXT NOT NULL DEFAULT 'all',
        model_provider_id TEXT,
        model_model_id TEXT,
        temperature REAL,
        enabled INTEGER NOT NULL DEFAULT 1,
        hidden INTEGER NOT NULL DEFAULT 0,
        source_markdown TEXT,
        tool_permissions_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS agents_name_unique ON agents(name);
      CREATE INDEX IF NOT EXISTS idx_agents_updated_at ON agents(updated_at);

      CREATE INDEX IF NOT EXISTS idx_messages_conversation_sequence
      ON messages(conversation_id, sequence);

      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
      ON conversations(updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_mcp_servers_updated_at
      ON mcp_servers(updated_at);

      CREATE INDEX IF NOT EXISTS idx_skills_updated_at
      ON skills(updated_at);

      CREATE INDEX IF NOT EXISTS idx_saved_prompts_updated_at
      ON saved_prompts(updated_at);

      CREATE INDEX IF NOT EXISTS idx_memories_updated_at
      ON memories(updated_at);

      CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation_updated_at
      ON agent_runs(conversation_id, updated_at);

      CREATE INDEX IF NOT EXISTS idx_agent_runs_status_updated_at
      ON agent_runs(status, updated_at);

      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        expression TEXT NOT NULL,
        timezone TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        agent_id TEXT,
        auto_approve INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        conversation_id TEXT,
        external_folder_session_json TEXT,
        last_run_at TEXT,
        next_run_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schedule_runs (
        id TEXT PRIMARY KEY NOT NULL,
        schedule_id TEXT NOT NULL,
        run_id TEXT,
        status TEXT NOT NULL,
        error TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_schedules_enabled_next_run_at
      ON schedules(enabled, next_run_at);

      CREATE INDEX IF NOT EXISTS idx_schedules_updated_at
      ON schedules(updated_at);

      CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule_started_at
      ON schedule_runs(schedule_id, started_at);
    `);

    // The fresh-install schema intentionally matches pre-v29 (full content
    // columns, supporting tables) so the version-29 migration below converts
    // it to the file-backed slim schema on first launch.
    currentVersion = 28;
  }

  if (currentVersion === 1) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS model_presets (
        id TEXT PRIMARY KEY NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        label TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        options_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider_id, model_id)
      );

      INSERT OR IGNORE INTO model_presets
        (id, provider_id, model_id, label, is_default, options_json, created_at, updated_at)
      SELECT
        provider_id || ':' || model_id,
        provider_id,
        model_id,
        label,
        is_default,
        options_json,
        created_at,
        updated_at
      FROM model_configs;
    `);

    currentVersion = 2;
  }

  if (currentVersion === 2) {
    await db.execAsync(`
      ALTER TABLE messages ADD COLUMN metadata_json TEXT;

      CREATE TABLE IF NOT EXISTS workspace_files (
        id TEXT PRIMARY KEY NOT NULL,
        display_name TEXT NOT NULL,
        original_name TEXT,
        mime_type TEXT,
        size INTEGER,
        relative_path TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(relative_path)
      );
    `);

    currentVersion = 3;
  }

  if (currentVersion === 3) {
    await db.execAsync(`
      ALTER TABLE conversations
      ADD COLUMN selected_file_ids_json TEXT NOT NULL DEFAULT '[]';
    `);

    currentVersion = 4;
  }

  if (currentVersion === 4) {
    await db.execAsync(`
      ALTER TABLE conversations
      ADD COLUMN external_folder_session_json TEXT;
    `);

    currentVersion = 5;
  }

  if (currentVersion === 5) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY NOT NULL,
        conversation_id TEXT NOT NULL,
        status TEXT NOT NULL,
        user_message_id TEXT NOT NULL,
        assistant_message_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        input TEXT NOT NULL,
        file_context_source TEXT,
        selected_file_ids_json TEXT NOT NULL DEFAULT '[]',
        external_folder_session_json TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        last_error TEXT,
        resume_count INTEGER NOT NULL DEFAULT 0,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        last_retry_at TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation_updated_at
      ON agent_runs(conversation_id, updated_at);

      CREATE INDEX IF NOT EXISTS idx_agent_runs_status_updated_at
      ON agent_runs(status, updated_at);
    `);

    currentVersion = 6;
  }

  if (currentVersion === 6) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY NOT NULL,
        label TEXT NOT NULL,
        url TEXT NOT NULL,
        transport TEXT NOT NULL,
        auth_mode TEXT NOT NULL,
        oauth_mode TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        header_names_json TEXT NOT NULL DEFAULT '[]',
        oauth_client_id TEXT,
        oauth_authorization_url TEXT,
        oauth_token_url TEXT,
        oauth_scopes TEXT,
        oauth_allowed_auth_origin TEXT,
        last_status TEXT NOT NULL DEFAULT 'untested',
        last_error TEXT,
        tool_count INTEGER,
        server_info_json TEXT,
        server_instructions TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_mcp_servers_updated_at
      ON mcp_servers(updated_at);
    `);

    currentVersion = 7;
  }

  if (currentVersion === 7) {
    await db.execAsync(`
      ALTER TABLE conversations
      ADD COLUMN selected_skill_ids_json TEXT NOT NULL DEFAULT '[]';

      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        instructions TEXT NOT NULL,
        source_markdown TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        auto_match INTEGER NOT NULL DEFAULT 0,
        match_keywords_json TEXT NOT NULL DEFAULT '[]',
        recommended_mcp_server_ids_json TEXT NOT NULL DEFAULT '[]',
        recommended_built_in_tool_keys_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_skills_updated_at
      ON skills(updated_at);
    `);

    currentVersion = 8;
  }

  if (currentVersion === 8) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY NOT NULL,
        content TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        source_conversation_id TEXT,
        source_message_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_memories_updated_at
      ON memories(updated_at);
    `);

    currentVersion = 9;
  }

  if (currentVersion === 9) {
    await db.execAsync(`
      ALTER TABLE conversations
      ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'medium';
    `);

    currentVersion = 10;
  }

  if (currentVersion === 10) {
    await db.execAsync(`
      ALTER TABLE agent_runs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE agent_runs ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 3;
      ALTER TABLE agent_runs ADD COLUMN last_retry_at TEXT;
    `);

    currentVersion = 11;
  }

  if (currentVersion === 11) {
    await db.execAsync(`
      DELETE FROM model_presets WHERE provider_id = 'openai-compatible';
      DELETE FROM provider_configs WHERE id = 'openai-compatible';
    `);

    currentVersion = 12;
  }

  if (currentVersion === 12) {
    await db.execAsync(`
      ALTER TABLE conversations
      ADD COLUMN selected_mcp_server_ids_json TEXT;
    `);

    currentVersion = 13;
  }

  if (currentVersion === 13) {
    const conversationColumns = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(conversations)",
    );

    if (
      !conversationColumns.some(
        (column) => column.name === "selected_mcp_server_ids_json",
      )
    ) {
      await db.execAsync(`
        ALTER TABLE conversations
        ADD COLUMN selected_mcp_server_ids_json TEXT;
      `);
    }

    currentVersion = 14;
  }

  if (currentVersion === 14) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS saved_prompts (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_saved_prompts_updated_at
      ON saved_prompts(updated_at);
    `);

    currentVersion = 15;
  }

  if (currentVersion === 15) {
    await db.execAsync(`
      ALTER TABLE conversations
      ADD COLUMN pinned_at TEXT;
    `);

    currentVersion = 16;
  }

  if (currentVersion === 16) {
    await db.execAsync(`
      UPDATE workspace_files
      SET source_kind = 'artifact'
      WHERE relative_path LIKE 'prompts/%'
         OR relative_path LIKE 'tools/%';
    `);

    currentVersion = 17;
  }

  if (currentVersion === 17) {
    await db.execAsync(`
      ALTER TABLE conversations
      ADD COLUMN agent_mode TEXT NOT NULL DEFAULT 'build';

      ALTER TABLE agent_runs
      ADD COLUMN agent_mode TEXT NOT NULL DEFAULT 'build';
    `);

    currentVersion = 18;
  }

  if (currentVersion === 18) {
    const skillColumns = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(skills)",
    );

    if (!skillColumns.some((column) => column.name === "source_markdown")) {
      await db.execAsync(`
        ALTER TABLE skills
        ADD COLUMN source_markdown TEXT;
      `);
    }

    const rows = await db.getAllAsync<{
      auto_match: number;
      description: string | null;
      id: string;
      instructions: string;
      match_keywords_json: string;
      recommended_built_in_tool_keys_json: string;
      recommended_mcp_server_ids_json: string;
      title: string;
    }>(
      `SELECT id, title, description, instructions, auto_match,
              match_keywords_json, recommended_built_in_tool_keys_json,
              recommended_mcp_server_ids_json
       FROM skills`,
    );

    for (const row of rows) {
      let sourceMarkdown: string | null = null;

      try {
        sourceMarkdown = serializeSkillToMarkdown({
          autoMatch: row.auto_match === 1,
          description: row.description,
          instructions: row.instructions,
          matchKeywords: JSON.parse(row.match_keywords_json),
          recommendedBuiltInToolKeys: JSON.parse(
            row.recommended_built_in_tool_keys_json,
          ),
          recommendedMcpServerIds: JSON.parse(
            row.recommended_mcp_server_ids_json,
          ),
          title: row.title,
        });
      } catch {
        sourceMarkdown = null;
      }

      if (sourceMarkdown) {
        await db.runAsync(
          `UPDATE skills SET source_markdown = ? WHERE id = ?`,
          [sourceMarkdown, row.id],
        );
      }
    }

    currentVersion = 19;
  }

  if (currentVersion === 19) {
    await db.execAsync(`
      UPDATE provider_configs
      SET label = 'OpenCode Zen'
      WHERE id = 'opencode' AND label IN ('OpenCode', 'opencode');
    `);

    currentVersion = 20;
  }

  if (currentVersion === 20) {
    const runColumns = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(agent_runs)",
    );

    if (!runColumns.some((column) => column.name === "auto_approve")) {
      await db.execAsync(`
        ALTER TABLE agent_runs
        ADD COLUMN auto_approve INTEGER NOT NULL DEFAULT 0;
      `);
    }

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        expression TEXT NOT NULL,
        timezone TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        auto_approve INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        conversation_id TEXT,
        external_folder_session_json TEXT,
        last_run_at TEXT,
        next_run_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schedule_runs (
        id TEXT PRIMARY KEY NOT NULL,
        schedule_id TEXT NOT NULL,
        run_id TEXT,
        status TEXT NOT NULL,
        error TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_schedules_enabled_next_run_at
      ON schedules(enabled, next_run_at);

      CREATE INDEX IF NOT EXISTS idx_schedules_updated_at
      ON schedules(updated_at);

      CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule_started_at
      ON schedule_runs(schedule_id, started_at);
    `);

    currentVersion = 21;
  }

  if (currentVersion === 21) {
    const scheduleColumns = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(schedules)",
    );

    if (
      !scheduleColumns.some(
        (column) => column.name === "external_folder_session_json",
      )
    ) {
      await db.execAsync(`
        ALTER TABLE schedules
        ADD COLUMN external_folder_session_json TEXT;
      `);
    }

    currentVersion = 22;
  }

  if (currentVersion === 22) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        prompt TEXT,
        mode TEXT NOT NULL DEFAULT 'all',
        model_provider_id TEXT,
        model_model_id TEXT,
        temperature REAL,
        enabled INTEGER NOT NULL DEFAULT 1,
        hidden INTEGER NOT NULL DEFAULT 0,
        source_markdown TEXT,
        tool_permissions_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS agents_name_unique ON agents(name);
      CREATE INDEX IF NOT EXISTS idx_agents_updated_at ON agents(updated_at);
    `);

    const conversationColumns = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(conversations)",
    );

    if (!conversationColumns.some((column) => column.name === "agent_id")) {
      await db.execAsync(`
        ALTER TABLE conversations
        ADD COLUMN agent_id TEXT;
      `);
    }

    const agentRunColumns = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(agent_runs)",
    );

    if (!agentRunColumns.some((column) => column.name === "agent_id")) {
      await db.execAsync(`
        ALTER TABLE agent_runs
        ADD COLUMN agent_id TEXT;
      `);
    }

    const scheduleColumns = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(schedules)",
    );

    if (!scheduleColumns.some((column) => column.name === "agent_id")) {
      await db.execAsync(`
        ALTER TABLE schedules
        ADD COLUMN agent_id TEXT;
      `);
    }

    await db.execAsync(`
      UPDATE conversations
      SET agent_id = CASE WHEN agent_mode = 'plan' THEN 'plan' ELSE 'build' END
      WHERE agent_id IS NULL;
    `);

    currentVersion = 23;
  }

  if (currentVersion === 23) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS skill_files (
        id TEXT PRIMARY KEY NOT NULL,
        skill_id TEXT NOT NULL,
        path TEXT NOT NULL,
        content TEXT NOT NULL,
        mime_type TEXT,
        size INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS skill_files_skill_id_path_unique
      ON skill_files(skill_id, path);

      CREATE INDEX IF NOT EXISTS idx_skill_files_skill_id
      ON skill_files(skill_id);
    `);

    currentVersion = 24;
  }

  if (currentVersion === 24) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS agent_docs (
        id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        mime_type TEXT,
        size INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_docs_agent_id
      ON agent_docs(agent_id);
    `);

    currentVersion = 25;
  }

  if (currentVersion === 25) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS provider_accounts (
        id TEXT PRIMARY KEY NOT NULL,
        provider_id TEXT NOT NULL,
        label TEXT NOT NULL,
        credential_kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_provider_accounts_provider_id
      ON provider_accounts(provider_id);

      CREATE TABLE IF NOT EXISTS provider_account_state (
        provider_id TEXT PRIMARY KEY NOT NULL,
        active_account_id TEXT
      );
    `);

    currentVersion = 26;
  }

  if (currentVersion === 26) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        description TEXT,
        author TEXT,
        file_path TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        options_json TEXT DEFAULT '{}',
        source_url TEXT,
        last_update_check TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_plugins_updated_at
      ON plugins(updated_at);

      CREATE TABLE IF NOT EXISTS plugin_storage (
        plugin_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (plugin_id, key)
      );

      CREATE INDEX IF NOT EXISTS idx_plugin_storage_plugin_id
      ON plugin_storage(plugin_id);
    `);

    currentVersion = 27;
  }

  if (currentVersion === 27) {
    const hasSourceColumn = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(plugins)",
    ).then((cols) => cols.some((c) => c.name === "source"));

    if (hasSourceColumn) {
      await db.execAsync(`
        ALTER TABLE plugins RENAME COLUMN source TO _source_old;
        ALTER TABLE plugins ADD COLUMN file_path TEXT NOT NULL DEFAULT '';
        ALTER TABLE plugins ADD COLUMN source_url TEXT;
        ALTER TABLE plugins ADD COLUMN last_update_check TEXT;
      `);

      const rows = await db.getAllAsync<{ id: string; _source_old: string }>(
        "SELECT id, _source_old FROM plugins",
      );

      const { Directory, File, Paths } = await import("expo-file-system");
      const pluginsDir = new Directory(Paths.document, "mobile-agent/plugins");
      if (!pluginsDir.exists) {
        pluginsDir.create({ idempotent: true, intermediates: true });
      }

      for (const row of rows) {
        const file = new File(pluginsDir, `${row.id}.js`);
        file.create({ intermediates: true });
        file.write(row._source_old);
        await db.runAsync(
          "UPDATE plugins SET file_path = ? WHERE id = ?",
          file.uri,
          row.id,
        );
      }

      await db.execAsync(`
        ALTER TABLE plugins DROP COLUMN _source_old;
      `);
    } else {
      const cols = await db.getAllAsync<{ name: string }>(
        "PRAGMA table_info(plugins)",
      ).then((c) => new Set(c.map((x) => x.name)));
      if (!cols.has("source_url")) {
        await db.execAsync(`ALTER TABLE plugins ADD COLUMN source_url TEXT`);
      }
      if (!cols.has("last_update_check")) {
        await db.execAsync(`ALTER TABLE plugins ADD COLUMN last_update_check TEXT`);
      }
    }

    currentVersion = 28;
  }

  if (currentVersion === 28) {
    const { Directory, File, Paths } = await import("expo-file-system");

    const skillsBase = new Directory(Paths.document, "mobile-agent/skills");
    const agentsBase = new Directory(Paths.document, "mobile-agent/agents");

    await db.execAsync(`
      ALTER TABLE skills ADD COLUMN file_path TEXT;
      ALTER TABLE agents ADD COLUMN file_path TEXT;
    `);

    const skillRows = await db.getAllAsync<{
      auto_match: number;
      description: string | null;
      id: string;
      instructions: string;
      match_keywords_json: string;
      recommended_built_in_tool_keys_json: string;
      recommended_mcp_server_ids_json: string;
      source_markdown: string | null;
      title: string;
    }>(
      `SELECT id, title, description, instructions, auto_match,
              match_keywords_json, recommended_built_in_tool_keys_json,
              recommended_mcp_server_ids_json, source_markdown
       FROM skills`,
    );

    for (const skill of skillRows) {
      let markdown: string | null = null;

      try {
        markdown = serializeSkillToMarkdown({
          autoMatch: skill.auto_match === 1,
          description: skill.description,
          instructions: skill.instructions,
          matchKeywords: JSON.parse(skill.match_keywords_json),
          recommendedBuiltInToolKeys: JSON.parse(
            skill.recommended_built_in_tool_keys_json,
          ),
          recommendedMcpServerIds: JSON.parse(
            skill.recommended_mcp_server_ids_json,
          ),
          title: skill.title,
        });
      } catch {
        markdown = skill.source_markdown;
      }

      if (!markdown) {
        continue;
      }

      const skillDir = new Directory(skillsBase, skill.id);
      skillDir.create({ idempotent: true, intermediates: true });

      const markdownFile = new File(skillDir, "SKILL.md");
      markdownFile.create({ intermediates: true, overwrite: true });
      markdownFile.write(markdown);

      const fileRows = await db.getAllAsync<{
        content: string;
        created_at: string;
        id: string;
        mime_type: string | null;
        path: string;
        size: number | null;
        updated_at: string;
      }>(
        `SELECT path, content, mime_type, size, created_at, updated_at
         FROM skill_files WHERE skill_id = ?`,
        [skill.id],
      );

      if (fileRows.length > 0) {
        const filesDir = new Directory(skillDir, "files");
        filesDir.create({ idempotent: true, intermediates: true });

        for (const fileRow of fileRows) {
          const file = new File(filesDir, ...fileRow.path.split("/"));
          file.create({ intermediates: true, overwrite: true });
          file.write(fileRow.content);
        }

        const manifestFile = new File(skillDir, "files.json");
        manifestFile.create({ intermediates: true, overwrite: true });
        manifestFile.write(
          JSON.stringify({
            version: 1,
            files: fileRows.map((fileRow) => ({
              path: fileRow.path,
              mimeType: fileRow.mime_type,
              size: fileRow.size,
              createdAt: fileRow.created_at,
              updatedAt: fileRow.updated_at,
            })),
          }),
        );
      }

      await db.runAsync(
        "UPDATE skills SET file_path = ? WHERE id = ?",
        markdownFile.uri,
        skill.id,
      );
    }

    const agentRows = await db.getAllAsync<{
      description: string | null;
      id: string;
      mode: string;
      model_model_id: string | null;
      model_provider_id: string | null;
      name: string;
      prompt: string | null;
      source_markdown: string | null;
      temperature: number | null;
      tool_permissions_json: string;
    }>(
      `SELECT id, name, description, prompt, mode, model_provider_id,
              model_model_id, temperature, tool_permissions_json, source_markdown
       FROM agents`,
    );

    for (const agent of agentRows) {
      let markdown: string | null = null;

      try {
        markdown = serializeAgentToMarkdown(
          {
            description: agent.description,
            mode: agent.mode as "all" | "primary" | "subagent",
            modelModelId: agent.model_model_id,
            modelProviderId: agent.model_provider_id,
            name: agent.name,
            prompt: agent.prompt,
            temperature: agent.temperature,
            toolPermissions: JSON.parse(agent.tool_permissions_json),
          },
          { allowEmptyPrompt: true },
        );
      } catch {
        markdown = agent.source_markdown;
      }

      if (!markdown) {
        continue;
      }

      const agentDir = new Directory(agentsBase, agent.id);
      agentDir.create({ idempotent: true, intermediates: true });

      const markdownFile = new File(agentDir, "AGENT.md");
      markdownFile.create({ intermediates: true, overwrite: true });
      markdownFile.write(markdown);

      const docRows = await db.getAllAsync<{
        content: string;
        created_at: string;
        id: string;
        mime_type: string | null;
        name: string;
        size: number | null;
        updated_at: string;
      }>(
        `SELECT name, content, mime_type, size, created_at, updated_at
         FROM agent_docs WHERE agent_id = ?`,
        [agent.id],
      );

      if (docRows.length > 0) {
        const docsDir = new Directory(agentDir, "docs");
        docsDir.create({ idempotent: true, intermediates: true });

        for (const doc of docRows) {
          const fileName = doc.name
            .trim()
            .replace(/[\\/\u0000-\u001f\u007f]/g, "-")
            .replace(/^\.+/g, "")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-+|-+$/g, "") || "doc";

          const file = new File(docsDir, fileName);
          file.create({ intermediates: true, overwrite: true });
          file.write(doc.content);
        }

        const manifestFile = new File(agentDir, "docs.json");
        manifestFile.create({ intermediates: true, overwrite: true });
        manifestFile.write(
          JSON.stringify({
            version: 1,
            docs: docRows.map((doc) => ({
              file: doc.name
                .trim()
                .replace(/[\\/\u0000-\u001f\u007f]/g, "-")
                .replace(/^\.+/g, "")
                .replace(/\s+/g, "-")
                .replace(/-+/g, "-")
                .replace(/^-+|-+$/g, "") || "doc",
              name: doc.name,
              mimeType: doc.mime_type,
              size: doc.size,
              createdAt: doc.created_at,
              updatedAt: doc.updated_at,
            })),
          }),
        );
      }

      await db.runAsync(
        "UPDATE agents SET file_path = ? WHERE id = ?",
        markdownFile.uri,
        agent.id,
      );
    }

    await db.execAsync(`
      DROP TABLE IF EXISTS skill_files;
      DROP TABLE IF EXISTS agent_docs;

      DROP INDEX IF EXISTS agents_name_unique;

      ALTER TABLE agents DROP COLUMN name;
      ALTER TABLE agents DROP COLUMN description;
      ALTER TABLE agents DROP COLUMN prompt;
      ALTER TABLE agents DROP COLUMN mode;
      ALTER TABLE agents DROP COLUMN model_provider_id;
      ALTER TABLE agents DROP COLUMN model_model_id;
      ALTER TABLE agents DROP COLUMN temperature;
      ALTER TABLE agents DROP COLUMN source_markdown;
      ALTER TABLE agents DROP COLUMN tool_permissions_json;

      ALTER TABLE skills DROP COLUMN title;
      ALTER TABLE skills DROP COLUMN description;
      ALTER TABLE skills DROP COLUMN instructions;
      ALTER TABLE skills DROP COLUMN source_markdown;
      ALTER TABLE skills DROP COLUMN auto_match;
      ALTER TABLE skills DROP COLUMN match_keywords_json;
      ALTER TABLE skills DROP COLUMN recommended_mcp_server_ids_json;
      ALTER TABLE skills DROP COLUMN recommended_built_in_tool_keys_json;
    `);

    currentVersion = 29;
  }

  if (currentVersion === 29) {
    const pluginColumns = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(plugins)",
    );
    if (!pluginColumns.some((column) => column.name === "required_secrets_json")) {
      await db.execAsync(`
        ALTER TABLE plugins
        ADD COLUMN required_secrets_json TEXT NOT NULL DEFAULT '[]';
      `);
    }

    currentVersion = 30;
  }

  await db.execAsync(`PRAGMA user_version = ${currentVersion}`);
}
