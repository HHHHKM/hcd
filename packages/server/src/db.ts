import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type HcdDatabase = InstanceType<typeof Database>;

export function openDatabase(path: string): HcdDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, locale TEXT NOT NULL DEFAULT 'zh-CN', is_admin INTEGER NOT NULL DEFAULT 0,
      disabled_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('invite','reset')),
      user_id TEXT NOT NULL REFERENCES users(id), token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL, used_at TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS invites_user_kind ON invites(user_id,kind,used_at);
    CREATE TABLE IF NOT EXISTS login_attempts (
      email TEXT NOT NULL, ip TEXT NOT NULL, attempted_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS password_reset_attempts (
      email_hash TEXT NOT NULL, attempted_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS password_reset_attempts_email_time ON password_reset_attempts(email_hash,attempted_at);
    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS space_members (
      space_id TEXT NOT NULL REFERENCES spaces(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL,
      PRIMARY KEY(space_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id), title TEXT NOT NULL,
      current_version INTEGER NOT NULL, ai_enabled INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS document_members (
      doc_id TEXT NOT NULL REFERENCES documents(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL,
      PRIMARY KEY(doc_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS versions (
      doc_id TEXT NOT NULL REFERENCES documents(id), version INTEGER NOT NULL, kind TEXT NOT NULL,
      content TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(doc_id,version)
    );
    CREATE TABLE IF NOT EXISTS drafts (
      doc_id TEXT NOT NULL REFERENCES documents(id), user_id TEXT NOT NULL REFERENCES users(id),
      base_version INTEGER NOT NULL, content TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(doc_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES documents(id), author_id TEXT NOT NULL REFERENCES users(id),
      base_version INTEGER NOT NULL, message TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at TEXT NOT NULL,
      published_version INTEGER, UNIQUE(doc_id,author_id,idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS submissions_doc_status ON submissions(doc_id,status,created_at);
    CREATE TABLE IF NOT EXISTS previews (
      id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES documents(id), base_version INTEGER NOT NULL,
      revision INTEGER NOT NULL, submission_ids TEXT NOT NULL, resolutions TEXT NOT NULL,
      candidate TEXT NOT NULL, conflicts TEXT NOT NULL, publishable INTEGER NOT NULL, status TEXT NOT NULL,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'merge',
      published_version INTEGER
    );
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES documents(id), thread_id TEXT NOT NULL,
      parent_id TEXT, user_id TEXT REFERENCES users(id), guest_id TEXT REFERENCES guests(id), body TEXT NOT NULL, anchor TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, edited_at TEXT
      , deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), doc_id TEXT NOT NULL,
      kind TEXT NOT NULL, payload TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id TEXT NOT NULL REFERENCES users(id), event TEXT NOT NULL, email_enabled INTEGER NOT NULL,
      PRIMARY KEY(user_id,event)
    );
    CREATE TABLE IF NOT EXISTS security_mail (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, ref_id TEXT NOT NULL, recipient TEXT NOT NULL, locale TEXT NOT NULL,
      sealed TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mail_digests (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), date_key TEXT NOT NULL,
      created_at TEXT NOT NULL, UNIQUE(user_id,date_key)
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY, notification_id TEXT UNIQUE REFERENCES notifications(id), security_mail_id TEXT UNIQUE REFERENCES security_mail(id), digest_id TEXT REFERENCES mail_digests(id), dedupe_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL, lease_token TEXT, lease_until TEXT, last_error TEXT,
      created_at TEXT NOT NULL, sent_at TEXT
    );
    CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status,next_attempt_at);
    CREATE TRIGGER IF NOT EXISTS notification_outbox AFTER INSERT ON notifications BEGIN
      INSERT OR IGNORE INTO outbox(id,notification_id,dedupe_key,next_attempt_at,created_at)
      VALUES('mail_' || NEW.id,NEW.id,'notification:' || NEW.id,NEW.created_at,NEW.created_at);
    END;
    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, doc_ids TEXT, expires_at TEXT, created_at TEXT NOT NULL, revoked_at TEXT, last_used_at TEXT, last_used_ip TEXT
    );
    CREATE TABLE IF NOT EXISTS cli_auth_requests (
      code TEXT PRIMARY KEY, poll_hash TEXT UNIQUE, client_name TEXT NOT NULL, hostname TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','denied','expired')),
      user_id TEXT REFERENCES users(id), session_hash TEXT, token_id TEXT REFERENCES api_tokens(id),
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_poll_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS cli_auth_expiry ON cli_auth_requests(expires_at);
    CREATE TABLE IF NOT EXISTS imports (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id), created_by TEXT NOT NULL REFERENCES users(id),
      filename TEXT NOT NULL, source_html TEXT NOT NULL, content TEXT NOT NULL, report TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready', created_at TEXT NOT NULL, confirmed_doc_id TEXT, source_data BLOB
    );
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES documents(id), hash TEXT NOT NULL,
      mime TEXT NOT NULL, size INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL, UNIQUE(doc_id,hash)
    );
    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES documents(id), version INTEGER NOT NULL,
      format TEXT NOT NULL CHECK(format IN ('html','pdf','zip')), include_pending INTEGER NOT NULL,
      snapshot TEXT, excluded_ids TEXT NOT NULL DEFAULT '[]', locale TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', filename TEXT, mime TEXT, size INTEGER, error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until TEXT,
      created_by TEXT NOT NULL REFERENCES users(id), token_hash TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS exports_queue ON exports(status,created_at);
    CREATE TABLE IF NOT EXISTS import_assets (
      id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES imports(id), hash TEXT NOT NULL,
      mime TEXT NOT NULL, size INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS share_links (
      id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES documents(id), token_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('viewer','commenter')), version_pin INTEGER, show_comments INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT, revoked_at TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS guests (
      id TEXT PRIMARY KEY, link_id TEXT NOT NULL REFERENCES share_links(id), email TEXT NOT NULL, name TEXT NOT NULL,
      locale TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(link_id,email)
    );
    CREATE TABLE IF NOT EXISTS guest_challenges (
      id TEXT PRIMARY KEY, link_id TEXT NOT NULL REFERENCES share_links(id), email TEXT NOT NULL, name TEXT NOT NULL,
      locale TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS guest_challenges_email ON guest_challenges(link_id,email,used_at);
    CREATE TABLE IF NOT EXISTS guest_verification_limits (
      email_hash TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, window_start INTEGER NOT NULL,
      locked_until INTEGER NOT NULL DEFAULT 0, last_sent INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS guest_sessions (
      id TEXT PRIMARY KEY, guest_id TEXT NOT NULL REFERENCES guests(id), link_id TEXT NOT NULL REFERENCES share_links(id),
      token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_tasks (
      id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES documents(id), requested_by TEXT REFERENCES users(id), guest_id TEXT REFERENCES guests(id),
      kind TEXT NOT NULL, status TEXT NOT NULL, instruction TEXT NOT NULL, module_ids TEXT NOT NULL,
      result TEXT, claimed_by TEXT, approved_by TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS space_integrations (
      space_id TEXT NOT NULL REFERENCES spaces(id), kind TEXT NOT NULL CHECK(kind IN ('feishu_webhook','feishu_app')),
      revision INTEGER NOT NULL, config_enc TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, summary TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(space_id,kind)
    );
    CREATE TABLE IF NOT EXISTS integration_users (
      space_id TEXT NOT NULL REFERENCES spaces(id), revision INTEGER NOT NULL, email TEXT NOT NULL, open_id TEXT NOT NULL, expires_at TEXT NOT NULL,
      PRIMARY KEY(space_id,revision,email)
    );
    CREATE TABLE IF NOT EXISTS feishu_outbox (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id), kind TEXT NOT NULL, config_revision INTEGER NOT NULL,
      doc_id TEXT NOT NULL REFERENCES documents(id), event TEXT NOT NULL, source_id TEXT NOT NULL,
      notification_id TEXT REFERENCES notifications(id), user_id TEXT REFERENCES users(id), dedupe_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
      lease_token TEXT, lease_until TEXT, last_error TEXT, created_at TEXT NOT NULL, sent_at TEXT
    );
    CREATE INDEX IF NOT EXISTS feishu_outbox_due ON feishu_outbox(status,next_attempt_at);
    CREATE TRIGGER IF NOT EXISTS feishu_submission AFTER INSERT ON submissions WHEN NEW.status='pending' BEGIN
      INSERT OR IGNORE INTO feishu_outbox(id,space_id,kind,config_revision,doc_id,event,source_id,dedupe_key,next_attempt_at,created_at)
        SELECT 'fj_'||lower(hex(randomblob(16))),i.space_id,i.kind,i.revision,NEW.doc_id,'submission_pending',NEW.id,
          i.space_id||':'||i.kind||':'||i.revision||':submission:'||NEW.id,NEW.created_at,NEW.created_at
        FROM space_integrations i JOIN documents d ON d.space_id=i.space_id WHERE d.id=NEW.doc_id AND i.enabled=1 AND i.kind='feishu_webhook';
    END;
    CREATE TRIGGER IF NOT EXISTS feishu_publication AFTER INSERT ON versions WHEN NEW.version>1 AND NEW.kind IN ('publish','restore') BEGIN
      INSERT OR IGNORE INTO feishu_outbox(id,space_id,kind,config_revision,doc_id,event,source_id,dedupe_key,next_attempt_at,created_at)
        SELECT 'fj_'||lower(hex(randomblob(16))),i.space_id,i.kind,i.revision,NEW.doc_id,'submission_published',CAST(NEW.version AS TEXT),
          i.space_id||':'||i.kind||':'||i.revision||':publish:'||NEW.doc_id||':'||NEW.version,NEW.created_at,NEW.created_at
        FROM space_integrations i JOIN documents d ON d.space_id=i.space_id WHERE d.id=NEW.doc_id AND i.enabled=1 AND i.kind='feishu_webhook';
    END;
    CREATE TRIGGER IF NOT EXISTS feishu_notification AFTER INSERT ON notifications WHEN NEW.kind IN ('submission_pending','submission_published','mention','ai_task_requested') BEGIN
      INSERT OR IGNORE INTO feishu_outbox(id,space_id,kind,config_revision,doc_id,event,source_id,notification_id,user_id,dedupe_key,next_attempt_at,created_at)
        SELECT 'fj_'||lower(hex(randomblob(16))),i.space_id,i.kind,i.revision,NEW.doc_id,NEW.kind,
          CASE WHEN NEW.kind='mention' THEN json_extract(NEW.payload,'$.commentId') WHEN NEW.kind='ai_task_requested' THEN json_extract(NEW.payload,'$.taskId') ELSE NEW.id END,
          CASE WHEN i.kind='feishu_app' THEN NEW.id ELSE NULL END,CASE WHEN i.kind='feishu_app' THEN NEW.user_id ELSE NULL END,
          i.space_id||':'||i.kind||':'||i.revision||':'||CASE WHEN i.kind='feishu_app' THEN NEW.id ELSE NEW.kind||':'||COALESCE(json_extract(NEW.payload,'$.commentId'),json_extract(NEW.payload,'$.taskId')) END,
          NEW.created_at,NEW.created_at
        FROM space_integrations i JOIN documents d ON d.space_id=i.space_id WHERE d.id=NEW.doc_id AND i.enabled=1 AND
          (i.kind='feishu_app' OR NEW.kind IN ('mention','ai_task_requested'));
    END;
  `);
  const outboxColumns = db.prepare('PRAGMA table_info(outbox)').all() as Array<{ name: string }>;
  if (!outboxColumns.some((column) => column.name === 'security_mail_id')) db.transaction(() => {
    db.exec(`DROP TRIGGER IF EXISTS notification_outbox;
      CREATE TABLE outbox_updated (
        id TEXT PRIMARY KEY, notification_id TEXT UNIQUE REFERENCES notifications(id), security_mail_id TEXT UNIQUE REFERENCES security_mail(id), digest_id TEXT REFERENCES mail_digests(id), dedupe_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
        lease_token TEXT, lease_until TEXT, last_error TEXT, created_at TEXT NOT NULL, sent_at TEXT
      );
      INSERT INTO outbox_updated(id,notification_id,dedupe_key,status,attempts,next_attempt_at,lease_token,lease_until,last_error,created_at,sent_at)
        SELECT id,notification_id,dedupe_key,status,attempts,next_attempt_at,lease_token,lease_until,last_error,created_at,sent_at FROM outbox;
      DROP TABLE outbox; ALTER TABLE outbox_updated RENAME TO outbox;
      CREATE INDEX outbox_due ON outbox(status,next_attempt_at);
      CREATE TRIGGER notification_outbox AFTER INSERT ON notifications BEGIN
        INSERT OR IGNORE INTO outbox(id,notification_id,dedupe_key,next_attempt_at,created_at)
        VALUES('mail_' || NEW.id,NEW.id,'notification:' || NEW.id,NEW.created_at,NEW.created_at);
      END;
    `);
  })();
  const digestColumns = db.prepare('PRAGMA table_info(outbox)').all() as Array<{ name: string }>;
  if (!digestColumns.some((column) => column.name === 'digest_id')) db.exec('ALTER TABLE outbox ADD COLUMN digest_id TEXT REFERENCES mail_digests(id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS outbox_digest ON outbox(digest_id)');
  // Additive migration for databases created by early builds.
  const previewColumns = new Set((db.prepare('PRAGMA table_info(previews)').all() as Array<{ name: string }>).map((row) => row.name));
  if (!previewColumns.has('kind')) db.exec("ALTER TABLE previews ADD COLUMN kind TEXT NOT NULL DEFAULT 'merge'");
  if (!previewColumns.has('published_version')) db.exec('ALTER TABLE previews ADD COLUMN published_version INTEGER');
  if (!previewColumns.has('items')) db.transaction(() => {
    db.exec("ALTER TABLE previews ADD COLUMN items TEXT NOT NULL DEFAULT '[]'");
    db.prepare("UPDATE previews SET status='stale' WHERE status='open' AND kind='merge'").run();
  })();
  if (!previewColumns.has('presentation')) db.exec('ALTER TABLE previews ADD COLUMN presentation TEXT');
  const tokenColumns = new Set((db.prepare('PRAGMA table_info(api_tokens)').all() as Array<{ name: string }>).map((row) => row.name));
  if (!tokenColumns.has('doc_ids')) db.exec('ALTER TABLE api_tokens ADD COLUMN doc_ids TEXT');
  if (!tokenColumns.has('expires_at')) db.exec('ALTER TABLE api_tokens ADD COLUMN expires_at TEXT');
  if (!tokenColumns.has('last_used_at')) db.exec('ALTER TABLE api_tokens ADD COLUMN last_used_at TEXT');
  if (!tokenColumns.has('last_used_ip')) db.exec('ALTER TABLE api_tokens ADD COLUMN last_used_ip TEXT');
  for (const [column, definition] of Object.entries({ kind: "TEXT NOT NULL DEFAULT 'pat'", client_id: 'TEXT', grant_id: 'TEXT', consumed_at: 'TEXT', resource: 'TEXT' })) {
    if (!tokenColumns.has(column)) db.exec(`ALTER TABLE api_tokens ADD COLUMN ${column} ${definition}`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS tokens_grant ON api_tokens(grant_id);
    CREATE TABLE IF NOT EXISTS oauth_clients (
      id TEXT PRIMARY KEY, metadata TEXT NOT NULL, source TEXT NOT NULL, expires_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_requests (
      id TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, user_id TEXT REFERENCES users(id),
      client_id TEXT NOT NULL, metadata TEXT NOT NULL, redirect_uri TEXT NOT NULL, scopes TEXT NOT NULL,
      resource TEXT NOT NULL, state TEXT, challenge TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS oauth_grants (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), client_id TEXT NOT NULL,
      name TEXT NOT NULL, scopes TEXT NOT NULL, doc_ids TEXT NOT NULL, resource TEXT NOT NULL,
      refresh_allowed INTEGER NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS oauth_codes (
      token_hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES oauth_grants(id),
      redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS oauth_requests_expiry ON oauth_requests(expires_at);
    CREATE INDEX IF NOT EXISTS oauth_grants_user ON oauth_grants(user_id);
  `);
  const taskColumns = new Set((db.prepare('PRAGMA table_info(ai_tasks)').all() as Array<{ name: string }>).map((row) => row.name));
  if (!taskColumns.has('claimed_by')) db.exec('ALTER TABLE ai_tasks ADD COLUMN claimed_by TEXT');
  if (!taskColumns.has('attempts')) db.exec('ALTER TABLE ai_tasks ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
  if (!taskColumns.has('approved_by')) db.exec('ALTER TABLE ai_tasks ADD COLUMN approved_by TEXT');
  const commentColumns = new Set((db.prepare('PRAGMA table_info(comments)').all() as Array<{ name: string }>).map((row) => row.name));
  if (!commentColumns.has('deleted_at')) db.exec('ALTER TABLE comments ADD COLUMN deleted_at TEXT');
  if (!commentColumns.has('anchor_state')) db.exec("ALTER TABLE comments ADD COLUMN anchor_state TEXT NOT NULL DEFAULT 'ok'");
  if (!commentColumns.has('anchor_range')) db.exec('ALTER TABLE comments ADD COLUMN anchor_range TEXT');
  // Rebuild legacy author columns so guests remain separate from workspace accounts.
  if (!commentColumns.has('guest_id')) db.transaction(() => {
    db.exec(`CREATE TABLE comments_updated (
      id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES documents(id), thread_id TEXT NOT NULL,
      parent_id TEXT, user_id TEXT REFERENCES users(id), guest_id TEXT REFERENCES guests(id), body TEXT NOT NULL,
      anchor TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, edited_at TEXT,
      deleted_at TEXT, anchor_state TEXT NOT NULL DEFAULT 'ok', anchor_range TEXT
    );
    INSERT INTO comments_updated(id,doc_id,thread_id,parent_id,user_id,body,anchor,status,created_at,edited_at,deleted_at,anchor_state,anchor_range)
      SELECT id,doc_id,thread_id,parent_id,user_id,body,anchor,status,created_at,edited_at,deleted_at,anchor_state,anchor_range FROM comments;
    DROP TABLE comments; ALTER TABLE comments_updated RENAME TO comments;`);
  })();
  // Creation versions are immutable; publishing only relocates the separate anchor.
  if (!(db.prepare('PRAGMA table_info(comments)').all() as Array<{ name: string }>).some(row => row.name === 'created_version')) db.transaction(() => {
    db.exec('ALTER TABLE comments ADD COLUMN created_version INTEGER NOT NULL DEFAULT 1');
    db.exec(`UPDATE comments SET created_version=COALESCE(
      (SELECT l.version_pin FROM guests g JOIN share_links l ON l.id=g.link_id WHERE g.id=comments.guest_id AND l.version_pin IS NOT NULL),
      (SELECT v.version FROM versions v WHERE v.doc_id=comments.doc_id AND v.created_at<=comments.created_at ORDER BY v.created_at DESC,v.version DESC LIMIT 1),
      1
    )`);
  })();
  if (!taskColumns.has('guest_id')) db.transaction(() => {
    db.exec(`CREATE TABLE ai_tasks_updated (
      id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES documents(id), requested_by TEXT REFERENCES users(id), guest_id TEXT REFERENCES guests(id),
      kind TEXT NOT NULL, status TEXT NOT NULL, instruction TEXT NOT NULL, module_ids TEXT NOT NULL,
      result TEXT, claimed_by TEXT, approved_by TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO ai_tasks_updated(id,doc_id,requested_by,kind,status,instruction,module_ids,result,claimed_by,approved_by,attempts,created_at,updated_at)
      SELECT id,doc_id,requested_by,kind,status,instruction,module_ids,result,claimed_by,approved_by,attempts,created_at,updated_at FROM ai_tasks;
    DROP TABLE ai_tasks; ALTER TABLE ai_tasks_updated RENAME TO ai_tasks;`);
  })();
  if (!(db.prepare('PRAGMA table_info(comments)').all() as Array<{ name: string }>).some((row) => row.name === 'related_submission')) db.exec('ALTER TABLE comments ADD COLUMN related_submission TEXT');
  const leaseColumns = new Set((db.prepare('PRAGMA table_info(ai_tasks)').all() as Array<{ name: string }>).map((row) => row.name));
  for (const name of ['claimed_token', 'claim_id', 'claimed_at', 'claim_expires_at', 'comment_id', 'last_error', 'preview_id', 'conflict_id', 'conflict_fingerprint', 'result_claim_id']) {
    if (!leaseColumns.has(name)) db.exec(`ALTER TABLE ai_tasks ADD COLUMN ${name} TEXT`);
  }
  if (!leaseColumns.has('preview_revision')) db.exec('ALTER TABLE ai_tasks ADD COLUMN preview_revision INTEGER');
  if (!leaseColumns.has('base_version')) db.exec('ALTER TABLE ai_tasks ADD COLUMN base_version INTEGER');
  const taskSubmissionColumns = new Set((db.prepare('PRAGMA table_info(submissions)').all() as Array<{ name: string }>).map((row) => row.name));
  for (const name of ['ai_task_id', 'ai_claim_id', 'created_token', 'request_hash', 'id_map', 'operations', 'uncertain_ids']) {
    if (!taskSubmissionColumns.has(name)) db.exec(`ALTER TABLE submissions ADD COLUMN ${name} TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS ai_tasks_doc_status ON ai_tasks(doc_id,status);
    CREATE TABLE IF NOT EXISTS ai_task_attempts (
      claim_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES ai_tasks(id), attempt INTEGER NOT NULL,
      user_id TEXT NOT NULL, token_id TEXT NOT NULL, base_version INTEGER NOT NULL, status TEXT NOT NULL,
      started_at TEXT NOT NULL, expires_at TEXT NOT NULL, finished_at TEXT, reason TEXT, submission_id TEXT,
      UNIQUE(task_id,attempt)
    );`);
  const importColumns = new Set((db.prepare('PRAGMA table_info(imports)').all() as Array<{ name: string }>).map((row) => row.name));
  if (!importColumns.has('source_data')) db.exec('ALTER TABLE imports ADD COLUMN source_data BLOB');
  db.exec(`CREATE TRIGGER IF NOT EXISTS feishu_ai_request AFTER INSERT ON ai_tasks WHEN NEW.status='requested' BEGIN
    INSERT OR IGNORE INTO feishu_outbox(id,space_id,kind,config_revision,doc_id,event,source_id,dedupe_key,next_attempt_at,created_at)
      SELECT 'fj_'||lower(hex(randomblob(16))),i.space_id,i.kind,i.revision,NEW.doc_id,'ai_task_requested',NEW.id,
        i.space_id||':'||i.kind||':'||i.revision||':ai_task_requested:'||NEW.id,NEW.created_at,NEW.created_at
      FROM space_integrations i JOIN documents d ON d.space_id=i.space_id WHERE d.id=NEW.doc_id AND i.enabled=1 AND i.kind='feishu_webhook';
  END;`);
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  db.transaction(() => {
    const migration = 'snapshot-operation-previews-v1';
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE id=?').get(migration)) return;
    db.prepare("UPDATE previews SET status='stale' WHERE status='open' AND kind='merge'").run();
    db.prepare('INSERT INTO schema_migrations(id,applied_at) VALUES(?,?)').run(migration, new Date().toISOString());
  })();
  return db;
}
