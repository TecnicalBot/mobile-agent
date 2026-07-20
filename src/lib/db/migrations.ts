import type { SQLiteDatabase } from "expo-sqlite";

const DATABASE_VERSION = 10;

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
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  );

  CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation_updated_at
  ON agent_runs(conversation_id, updated_at);

  CREATE INDEX IF NOT EXISTS idx_agent_runs_status_updated_at
  ON agent_runs(status, updated_at);
`;

export async function migrateAppDatabase(db: SQLiteDatabase) {
  const versionRow = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version",
  );
  let currentVersion = versionRow?.user_version ?? 0;

  await db.execAsync(CORE_SCHEMA_REPAIR_SQL);

  if (currentVersion >= DATABASE_VERSION) {
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
        selected_file_ids_json TEXT NOT NULL DEFAULT '[]',
        selected_skill_ids_json TEXT NOT NULL DEFAULT '[]',
        external_folder_session_json TEXT,
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
        enabled INTEGER NOT NULL DEFAULT 1,
        auto_match INTEGER NOT NULL DEFAULT 0,
        match_keywords_json TEXT NOT NULL DEFAULT '[]',
        recommended_mcp_server_ids_json TEXT NOT NULL DEFAULT '[]',
        recommended_built_in_tool_keys_json TEXT NOT NULL DEFAULT '[]',
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
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation_sequence
      ON messages(conversation_id, sequence);

      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
      ON conversations(updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_mcp_servers_updated_at
      ON mcp_servers(updated_at);

      CREATE INDEX IF NOT EXISTS idx_skills_updated_at
      ON skills(updated_at);

      CREATE INDEX IF NOT EXISTS idx_memories_updated_at
      ON memories(updated_at);

      CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation_updated_at
      ON agent_runs(conversation_id, updated_at);

      CREATE INDEX IF NOT EXISTS idx_agent_runs_status_updated_at
      ON agent_runs(status, updated_at);
    `);

    currentVersion = DATABASE_VERSION;
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

  await db.execAsync(`PRAGMA user_version = ${currentVersion}`);
}
