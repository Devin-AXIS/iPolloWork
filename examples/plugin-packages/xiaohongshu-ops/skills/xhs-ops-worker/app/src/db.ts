import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type {
  AccountBinding,
  AccountSessionStatus,
  BrandProfile,
  BrowserJob,
  BrowserJobPayload,
  Campaign,
  CampaignSchedule,
  CampaignStatus,
  ContentItem,
  DiscoveredComment,
  Interaction,
  JobStatus,
  SessionOperation,
  JobType,
  KnowledgeItem,
  MediaAsset,
  PlatformSnapshot,
  ReviewItem,
} from './types.js'
import { classifyCommentRisk } from './safety.js'
import { localDayUtcRange } from './scheduling.js'
import { config } from './config.js'

type Row = Record<string, unknown>

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS brand_profiles (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    allowed_claims_json TEXT NOT NULL,
    banned_phrases_json TEXT NOT NULL,
    rules_version TEXT NOT NULL,
    visual_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS knowledge_items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('fact', 'product', 'campaign', 'policy')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('upload', 'generated')),
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    relative_path TEXT NOT NULL UNIQUE,
    sha256 TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    expected_profile_id TEXT NOT NULL UNIQUE,
    profile_url TEXT NOT NULL,
    avatar_url TEXT,
    worker_thread_id TEXT UNIQUE,
    browser_profile_id TEXT,
    deleted_at TEXT,
    position TEXT NOT NULL,
    audience TEXT NOT NULL,
    note_tone TEXT NOT NULL,
    comment_tone TEXT NOT NULL,
    content_columns_json TEXT NOT NULL,
    banned_topics_json TEXT NOT NULL,
    daily_limit INTEGER NOT NULL CHECK (daily_limit BETWEEN 1 AND 20),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    session_status TEXT NOT NULL DEFAULT 'setup' CHECK (session_status IN ('setup', 'healthy', 'blocked', 'reauthorize', 'offline')),
    last_verified_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS platform_snapshots (
    account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    snapshot_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    theme TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'completed')),
    account_ids_json TEXT NOT NULL,
    comment_account_ids_json TEXT NOT NULL,
    knowledge_ids_json TEXT NOT NULL,
    asset_ids_json TEXT NOT NULL,
    note_tones_json TEXT NOT NULL,
    comment_tones_json TEXT NOT NULL,
    schedule_json TEXT NOT NULL,
    min_comments INTEGER NOT NULL,
    max_comments INTEGER NOT NULL,
    comment_window_start_minutes INTEGER NOT NULL,
    comment_window_end_minutes INTEGER NOT NULL,
    generate_lead_minutes INTEGER NOT NULL,
    authorization_locked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS content_items (
    id TEXT PRIMARY KEY,
    campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    status TEXT NOT NULL CHECK (status IN ('planned', 'generating', 'ready', 'scheduled', 'publishing', 'published', 'failed', 'missed', 'cancelled')),
    scheduled_at TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    topics_json TEXT NOT NULL,
    card_data_json TEXT NOT NULL,
    media_asset_ids_json TEXT NOT NULL,
    source_knowledge_ids_json TEXT NOT NULL,
    content_hash TEXT,
    result_url TEXT,
    published_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(campaign_id, account_id, scheduled_at)
  );

  CREATE TABLE IF NOT EXISTS browser_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('publish_note', 'create_comment', 'scan_comments', 'reply_comment', 'verify_session')),
    status TEXT NOT NULL CHECK (status IN ('queued', 'dispatched', 'running', 'succeeded', 'blocked', 'needs_reconcile', 'failed', 'skipped', 'cancelled')),
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    content_item_id TEXT REFERENCES content_items(id) ON DELETE CASCADE,
    parent_job_id TEXT REFERENCES browser_jobs(id) ON DELETE SET NULL,
    scheduled_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    worker_thread_id TEXT,
    lease_token_hash TEXT,
    lease_until TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    actual_account TEXT,
    result_url TEXT,
    screenshot_path TEXT,
    error_code TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS interactions (
    id TEXT PRIMARY KEY,
    content_item_id TEXT REFERENCES content_items(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('managed_comment', 'organic_comment', 'reply')),
    account_id INTEGER REFERENCES accounts(id),
    remote_author TEXT,
    remote_comment_id TEXT,
    body TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('planned', 'queued', 'published', 'review', 'skipped', 'failed')),
    risk_labels_json TEXT NOT NULL,
    scheduled_at TEXT,
    result_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(content_item_id, kind, remote_comment_id)
  );

  CREATE TABLE IF NOT EXISTS review_items (
    id TEXT PRIMARY KEY,
    interaction_id TEXT NOT NULL UNIQUE REFERENCES interactions(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    source_text TEXT NOT NULL,
    suggested_text TEXT NOT NULL,
    risk_labels_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
    content_item_id TEXT REFERENCES content_items(id) ON DELETE SET NULL,
    job_id TEXT REFERENCES browser_jobs(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS content_schedule_idx ON content_items(status, scheduled_at);
  CREATE INDEX IF NOT EXISTS content_account_schedule_idx ON content_items(account_id, scheduled_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS jobs_due_idx ON browser_jobs(status, scheduled_at);
  CREATE INDEX IF NOT EXISTS interactions_content_idx ON interactions(content_item_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS reviews_status_idx ON review_items(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_log(created_at DESC);
`

function now(): string {
  return new Date().toISOString()
}

function json<T>(value: unknown, fallback: T): T {
  try {
    return typeof value === 'string' ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

function strings(value: unknown): string[] {
  return json<unknown[]>(value, []).flatMap((item) => typeof item === 'string' ? [item] : [])
}

function numbers(value: unknown): number[] {
  return json<unknown[]>(value, []).flatMap((item) => typeof item === 'number' && Number.isInteger(item) ? [item] : [])
}

function accountFromRow(row: Row): AccountBinding {
  return {
    id: Number(row.id),
    handle: String(row.handle),
    displayName: String(row.display_name),
    expectedProfileId: String(row.expected_profile_id),
    profileUrl: String(row.profile_url),
    avatarUrl: row.avatar_url === null ? null : String(row.avatar_url),
    workerThreadId: row.worker_thread_id === null ? null : String(row.worker_thread_id),
    browserProfileId: row.browser_profile_id === null ? null : String(row.browser_profile_id),
    position: String(row.position),
    audience: String(row.audience),
    noteTone: String(row.note_tone),
    commentTone: String(row.comment_tone),
    contentColumns: strings(row.content_columns_json),
    bannedTopics: strings(row.banned_topics_json),
    dailyLimit: Number(row.daily_limit),
    enabled: Number(row.enabled) === 1,
    sessionStatus: String(row.session_status) as AccountSessionStatus,
    lastVerifiedAt: row.last_verified_at === null ? null : String(row.last_verified_at),
    lastError: row.last_error === null ? null : String(row.last_error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function campaignFromRow(row: Row): Campaign {
  return {
    id: String(row.id),
    name: String(row.name),
    theme: String(row.theme),
    status: String(row.status) as CampaignStatus,
    accountIds: numbers(row.account_ids_json),
    commentAccountIds: numbers(row.comment_account_ids_json),
    knowledgeIds: strings(row.knowledge_ids_json),
    assetIds: strings(row.asset_ids_json),
    noteTones: strings(row.note_tones_json),
    commentTones: strings(row.comment_tones_json),
    schedule: json<CampaignSchedule>(row.schedule_json, {
      kind: 'single', timezone: 'Asia/Shanghai', scheduledLocal: null, weekdays: [], publishTime: null,
    }),
    minComments: Number(row.min_comments),
    maxComments: Number(row.max_comments),
    commentWindowStartMinutes: Number(row.comment_window_start_minutes),
    commentWindowEndMinutes: Number(row.comment_window_end_minutes),
    generateLeadMinutes: Number(row.generate_lead_minutes),
    authorizationLockedAt: row.authorization_locked_at === null ? null : String(row.authorization_locked_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function contentFromRow(row: Row): ContentItem {
  return {
    id: String(row.id),
    campaignId: row.campaign_id === null ? null : String(row.campaign_id),
    accountId: Number(row.account_id),
    status: String(row.status) as ContentItem['status'],
    scheduledAt: String(row.scheduled_at),
    title: String(row.title),
    body: String(row.body),
    topics: strings(row.topics_json),
    cardData: json<ContentItem['cardData']>(row.card_data_json, []),
    mediaAssetIds: strings(row.media_asset_ids_json),
    sourceKnowledgeIds: strings(row.source_knowledge_ids_json),
    contentHash: row.content_hash === null ? null : String(row.content_hash),
    resultUrl: row.result_url === null ? null : String(row.result_url),
    publishedAt: row.published_at === null ? null : String(row.published_at),
    error: row.error === null ? null : String(row.error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function jobFromRow(row: Row): BrowserJob {
  return {
    id: String(row.id),
    type: String(row.type) as JobType,
    status: String(row.status) as JobStatus,
    accountId: Number(row.account_id),
    contentItemId: row.content_item_id === null ? null : String(row.content_item_id),
    parentJobId: row.parent_job_id === null ? null : String(row.parent_job_id),
    scheduledAt: String(row.scheduled_at),
    payload: json<BrowserJobPayload>(row.payload_json, {
      destinationUrl: 'https://creator.xiaohongshu.com/', expectedHandle: '', expectedProfileId: '', expectedProfileUrl: '',
    }),
    idempotencyKey: String(row.idempotency_key),
    workerThreadId: row.worker_thread_id === null ? null : String(row.worker_thread_id),
    leaseUntil: row.lease_until === null ? null : String(row.lease_until),
    attempts: Number(row.attempts),
    actualAccount: row.actual_account === null ? null : String(row.actual_account),
    resultUrl: row.result_url === null ? null : String(row.result_url),
    screenshotPath: row.screenshot_path === null ? null : String(row.screenshot_path),
    errorCode: row.error_code === null ? null : String(row.error_code),
    error: row.error === null ? null : String(row.error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function interactionFromRow(row: Row): Interaction {
  return {
    id: String(row.id), contentItemId: row.content_item_id === null ? null : String(row.content_item_id), kind: String(row.kind) as Interaction['kind'],
    accountId: row.account_id === null ? null : Number(row.account_id),
    remoteAuthor: row.remote_author === null ? null : String(row.remote_author),
    remoteCommentId: row.remote_comment_id === null ? null : String(row.remote_comment_id),
    body: String(row.body), status: String(row.status) as Interaction['status'], riskLabels: strings(row.risk_labels_json),
    scheduledAt: row.scheduled_at === null ? null : String(row.scheduled_at),
    resultUrl: row.result_url === null ? null : String(row.result_url), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }
}

function reviewFromRow(row: Row): ReviewItem {
  return {
    id: String(row.id), interactionId: String(row.interaction_id), accountId: Number(row.account_id),
    sourceText: String(row.source_text), suggestedText: String(row.suggested_text), riskLabels: strings(row.risk_labels_json),
    status: String(row.status) as ReviewItem['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }
}

function leaseHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export class OpsDatabase {
  readonly database: DatabaseSync

  constructor(path: string) {
    this.database = new DatabaseSync(path)
    try {
      this.database.exec(SCHEMA)
      // Session-authored posts have no campaign; comments on external posts have no local content item.
      for (const [table, column] of [['content_items', 'campaign_id'], ['interactions', 'content_item_id']]) {
        if (!table || !column || !this.database.prepare(`PRAGMA table_info(${table})`).all().some(item => item.name === column && item.notnull === 1)) continue
        const row = this.database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
        if (typeof row?.sql !== 'string') throw new Error('找不到待迁移的数据表')
        const definition = row.sql.replace(new RegExp('^CREATE TABLE "?' + table + '"?'), `CREATE TABLE ${table}_session_migration`).replace(`${column} TEXT NOT NULL`, `${column} TEXT`)
        this.database.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE')
        try {
          this.database.exec(`${definition}; INSERT INTO ${table}_session_migration SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_session_migration RENAME TO ${table};`)
          if (this.database.prepare('PRAGMA foreign_key_check').all().length) throw new Error('迁移后关联记录校验失败')
          this.database.exec('COMMIT')
        } catch (error) { this.database.exec('ROLLBACK'); throw error }
        finally { this.database.exec('PRAGMA foreign_keys = ON') }
      }
      this.database.exec(SCHEMA)
      const columns = this.database.prepare('PRAGMA table_info(accounts)').all()
      if (!columns.some(column => column.name === 'browser_profile_id')) {
        this.database.exec('ALTER TABLE accounts ADD COLUMN browser_profile_id TEXT')
      }
      if (!columns.some(column => column.name === 'deleted_at')) {
        this.database.exec('ALTER TABLE accounts ADD COLUMN deleted_at TEXT')
      }
      this.database.exec('CREATE UNIQUE INDEX IF NOT EXISTS accounts_browser_profile_idx ON accounts(browser_profile_id)')
      this.seedBrand()
    } catch (error) { this.database.close(); throw error }
  }

  close(): void {
    this.database.close()
  }

  private seedBrand(): void {
    const timestamp = now()
    this.database.prepare(`INSERT OR IGNORE INTO brand_profiles
      (id, name, description, allowed_claims_json, banned_phrases_json, rules_version, visual_json, updated_at)
      VALUES (1, '未命名品牌', '', '[]', '[]', '2026-07', ?, ?)`)
      .run(JSON.stringify({ background: '#f2f4ef', foreground: '#171a18', accent: '#1769e0' }), timestamp)
  }

  audit(input: { accountId?: number; campaignId?: string; contentItemId?: string | null; jobId?: string; action: string; status: string; detail?: unknown }): void {
    this.database.prepare(`INSERT INTO audit_log
      (account_id, campaign_id, content_item_id, job_id, action, status, detail_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.accountId ?? null, input.campaignId ?? null, input.contentItemId ?? null, input.jobId ?? null, input.action, input.status, JSON.stringify(input.detail ?? {}), now())
  }

  getBrand(): BrandProfile {
    const row = this.database.prepare('SELECT * FROM brand_profiles WHERE id = 1').get() as Row
    return {
      id: 1, name: String(row.name), description: String(row.description), allowedClaims: strings(row.allowed_claims_json),
      bannedPhrases: strings(row.banned_phrases_json), rulesVersion: String(row.rules_version),
      visual: json<BrandProfile['visual']>(row.visual_json, { background: '#f2f4ef', foreground: '#171a18', accent: '#1769e0' }),
      updatedAt: String(row.updated_at),
    }
  }

  updateBrand(input: Omit<BrandProfile, 'id' | 'updatedAt'>): BrandProfile {
    const timestamp = now()
    this.database.prepare(`UPDATE brand_profiles SET name = ?, description = ?, allowed_claims_json = ?,
      banned_phrases_json = ?, rules_version = ?, visual_json = ?, updated_at = ? WHERE id = 1`)
      .run(input.name, input.description, JSON.stringify(input.allowedClaims), JSON.stringify(input.bannedPhrases), input.rulesVersion, JSON.stringify(input.visual), timestamp)
    this.audit({ action: 'brand_update', status: 'succeeded', detail: { rulesVersion: input.rulesVersion } })
    return this.getBrand()
  }

  listKnowledge(): KnowledgeItem[] {
    return (this.database.prepare('SELECT * FROM knowledge_items ORDER BY updated_at DESC').all() as Row[]).map((row) => ({
      id: String(row.id), kind: String(row.kind) as KnowledgeItem['kind'], title: String(row.title), body: String(row.body),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }))
  }

  getKnowledge(ids: string[]): KnowledgeItem[] {
    if (!ids.length) return []
    return ids.flatMap((id) => {
      const row = this.database.prepare('SELECT * FROM knowledge_items WHERE id = ?').get(id) as Row | undefined
      return row ? [{ id: String(row.id), kind: String(row.kind) as KnowledgeItem['kind'], title: String(row.title), body: String(row.body), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }] : []
    })
  }

  createKnowledge(input: Pick<KnowledgeItem, 'kind' | 'title' | 'body'>): KnowledgeItem {
    const id = randomUUID()
    const timestamp = now()
    this.database.prepare('INSERT INTO knowledge_items (id, kind, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, input.kind, input.title, input.body, timestamp, timestamp)
    return this.getKnowledge([id])[0] as KnowledgeItem
  }

  deleteKnowledge(id: string): boolean {
    return this.database.prepare('DELETE FROM knowledge_items WHERE id = ?').run(id).changes === 1
  }

  listAssets(): MediaAsset[] {
    return (this.database.prepare('SELECT * FROM assets ORDER BY created_at DESC').all() as Row[]).map((row) => ({
      id: String(row.id), kind: String(row.kind) as MediaAsset['kind'], filename: String(row.filename), mimeType: String(row.mime_type),
      relativePath: String(row.relative_path), sha256: String(row.sha256), width: row.width === null ? null : Number(row.width),
      height: row.height === null ? null : Number(row.height), createdAt: String(row.created_at),
    }))
  }

  getAssets(ids: string[]): MediaAsset[] {
    const byId = new Map(this.listAssets().map((item) => [item.id, item]))
    return ids.flatMap((id) => byId.has(id) ? [byId.get(id) as MediaAsset] : [])
  }

  createAsset(input: Omit<MediaAsset, 'id' | 'createdAt'>): MediaAsset {
    const id = randomUUID()
    this.database.prepare(`INSERT INTO assets (id, kind, filename, mime_type, relative_path, sha256, width, height, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.kind, input.filename, input.mimeType, input.relativePath, input.sha256, input.width, input.height, now())
    return this.getAssets([id])[0] as MediaAsset
  }

  listAccounts(): AccountBinding[] {
    return (this.database.prepare('SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY enabled DESC, updated_at DESC').all() as Row[]).map(accountFromRow)
  }

  getAccount(id: number): AccountBinding | null {
    const row = this.database.prepare('SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
    return row ? accountFromRow(row) : null
  }

  createAccount(input: {
    handle: string; displayName: string; expectedProfileId: string; profileUrl: string; avatarUrl?: string | null;
    workerThreadId?: string | null; browserProfileId?: string | null; position: string; audience: string; noteTone: string; commentTone: string;
    contentColumns: string[]; bannedTopics: string[]; dailyLimit: number;
  }): AccountBinding {
    const timestamp = now()
    const result = this.database.prepare(`INSERT INTO accounts
      (handle, display_name, expected_profile_id, profile_url, avatar_url, worker_thread_id, browser_profile_id, position, audience,
       note_tone, comment_tone, content_columns_json, banned_topics_json, daily_limit, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(expected_profile_id) DO UPDATE SET
        handle = excluded.handle, display_name = excluded.display_name, profile_url = excluded.profile_url, avatar_url = excluded.avatar_url,
        worker_thread_id = excluded.worker_thread_id, browser_profile_id = excluded.browser_profile_id,
        position = excluded.position, audience = excluded.audience, note_tone = excluded.note_tone, comment_tone = excluded.comment_tone,
        content_columns_json = excluded.content_columns_json, banned_topics_json = excluded.banned_topics_json, daily_limit = excluded.daily_limit,
        enabled = 1, session_status = 'setup', last_verified_at = NULL, last_error = NULL, deleted_at = NULL, updated_at = excluded.updated_at
      WHERE accounts.deleted_at IS NOT NULL RETURNING id`)
      .get(input.handle, input.displayName, input.expectedProfileId, input.profileUrl, input.avatarUrl ?? null,
        input.workerThreadId ?? null, input.browserProfileId ?? null, input.position, input.audience, input.noteTone, input.commentTone,
        JSON.stringify(input.contentColumns), JSON.stringify(input.bannedTopics), input.dailyLimit, timestamp, timestamp)
    if (!result) throw new Error('此小红书账号已经接入')
    const account = this.getAccount(Number(result.id)) as AccountBinding
    this.audit({ accountId: account.id, action: 'account_create', status: 'succeeded', detail: { handle: account.handle } })
    return account
  }

  updateAccount(id: number, input: {
    displayName: string; profileUrl: string; avatarUrl: string | null; workerThreadId: string | null; position: string;
    audience: string; noteTone: string; commentTone: string; contentColumns: string[]; bannedTopics: string[];
    dailyLimit: number; enabled: boolean;
  }): AccountBinding {
    this.database.prepare(`UPDATE accounts SET display_name = ?, profile_url = ?, avatar_url = ?, worker_thread_id = ?,
      position = ?, audience = ?, note_tone = ?, comment_tone = ?, content_columns_json = ?, banned_topics_json = ?,
      daily_limit = ?, enabled = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
      .run(input.displayName, input.profileUrl, input.avatarUrl, input.workerThreadId, input.position, input.audience,
        input.noteTone, input.commentTone, JSON.stringify(input.contentColumns), JSON.stringify(input.bannedTopics),
        input.dailyLimit, input.enabled ? 1 : 0, now(), id)
    const account = this.getAccount(id)
    if (!account) throw new Error('账号不存在')
    this.audit({ accountId: id, action: 'account_update', status: 'succeeded', detail: { enabled: account.enabled } })
    return account
  }

  setAccountAvatar(id: number, avatarUrl: string): void {
    this.database.prepare('UPDATE accounts SET avatar_url = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL AND avatar_url IS NOT ?')
      .run(avatarUrl, now(), id, avatarUrl)
  }

  deleteAccount(id: number): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const account = this.getAccount(id)
      if (!account) { this.database.exec('COMMIT'); return }
      const timestamp = now()
      const running = this.database.prepare("SELECT id FROM browser_jobs WHERE account_id = ? AND status = 'running' AND (lease_until IS NULL OR lease_until > ?) LIMIT 1").get(id, timestamp)
      if (running) throw new Error('此账号有正在执行的任务，请等待执行结束后再删除绑定')
      this.database.prepare("UPDATE accounts SET deleted_at = ?, enabled = 0, worker_thread_id = NULL, browser_profile_id = NULL, session_status = 'offline', updated_at = ? WHERE id = ?").run(timestamp, timestamp, id)
      this.database.prepare("UPDATE browser_jobs SET status = 'cancelled', worker_thread_id = NULL, lease_token_hash = NULL, lease_until = NULL, error_code = 'account_unbound', error = '账号已解除绑定', updated_at = ? WHERE account_id = ? AND status NOT IN ('succeeded', 'skipped', 'cancelled')").run(timestamp, id)
      this.database.prepare("UPDATE content_items SET status = 'cancelled', error = '账号已解除绑定', updated_at = ? WHERE account_id = ? AND status IN ('planned', 'generating', 'ready', 'scheduled', 'publishing')").run(timestamp, id)
      this.database.prepare("UPDATE interactions SET status = 'skipped', updated_at = ? WHERE (account_id = ? AND status IN ('planned', 'queued', 'review')) OR id IN (SELECT interaction_id FROM review_items WHERE account_id = ? AND status = 'pending')").run(timestamp, id, id)
      this.database.prepare("UPDATE review_items SET status = 'rejected', updated_at = ? WHERE account_id = ? AND status = 'pending'").run(timestamp, id)
      for (const campaign of this.listCampaigns()) {
        if (!campaign.accountIds.includes(id) && !campaign.commentAccountIds.includes(id)) continue
        const accountIds = campaign.accountIds.filter(value => value !== id)
        const commentAccountIds = campaign.commentAccountIds.filter(value => value !== id)
        this.database.prepare('UPDATE campaigns SET account_ids_json = ?, comment_account_ids_json = ?, status = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(accountIds), JSON.stringify(commentAccountIds), campaign.status === 'active' && !accountIds.length ? 'paused' : campaign.status, timestamp, campaign.id)
      }
      this.audit({ accountId: id, action: 'account_unbind', status: 'succeeded' })
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }

  setAccountEnabled(id: number, enabled: boolean): AccountBinding {
    this.database.prepare('UPDATE accounts SET enabled = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(enabled ? 1 : 0, now(), id)
    const account = this.getAccount(id)
    if (!account) throw new Error('账号不存在')
    this.audit({ accountId: id, action: enabled ? 'account_enable' : 'account_pause', status: 'succeeded' })
    return account
  }

  setAccountSession(id: number, status: AccountSessionStatus, values: { verified?: boolean; error?: string | null } = {}): AccountBinding {
    this.database.prepare(`UPDATE accounts SET session_status = ?, last_verified_at = CASE WHEN ? = 1 THEN ? ELSE last_verified_at END,
      last_error = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
      .run(status, values.verified ? 1 : 0, now(), values.error ?? null, now(), id)
    const account = this.getAccount(id)
    if (!account) throw new Error('账号不存在')
    return account
  }

  bindAccountWorker(id: number, workerId: string): AccountBinding {
    const account = this.getAccount(id)
    if (!account?.enabled) throw new Error('请先启用账号')
    if (account.workerThreadId && account.workerThreadId !== workerId) throw new Error('该账号已绑定其他会话，请在原绑定会话中验证')
    const other = this.database.prepare('SELECT id FROM accounts WHERE worker_thread_id = ? AND id != ? LIMIT 1').get(workerId, id)
    if (other) throw new Error('当前会话已绑定其他账号，请为此账号使用一个独立会话')
    if (account.workerThreadId === workerId) return account
    this.database.prepare('UPDATE accounts SET worker_thread_id = ?, updated_at = ? WHERE id = ?').run(workerId, now(), id)
    return this.getAccount(id) as AccountBinding
  }

  pendingVerification(accountId: number): BrowserJob | null {
    this.database.prepare("UPDATE browser_jobs SET status = 'failed', error_code = 'verification_timeout', error = '验证超时，请重新发起', lease_token_hash = NULL, lease_until = NULL, updated_at = ? WHERE account_id = ? AND type = 'verify_session' AND status = 'running' AND lease_until < ?")
      .run(now(), accountId, now())
    const row = this.database.prepare("SELECT * FROM browser_jobs WHERE account_id = ? AND type = 'verify_session' AND status IN ('queued', 'dispatched', 'running') ORDER BY created_at DESC LIMIT 1").get(accountId) as Row | undefined
    return row ? jobFromRow(row) : null
  }

  rebindWorkerSession(previous: string, current: string): void {
    if (previous === current) return
    const account = this.database.prepare('SELECT id FROM accounts WHERE worker_thread_id = ? LIMIT 1').get(previous) as Row | undefined
    if (!account) return
    if (this.database.prepare('SELECT id FROM accounts WHERE worker_thread_id = ? LIMIT 1').get(current)) throw new Error('目标会话已绑定账号')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('UPDATE accounts SET worker_thread_id = ?, updated_at = ? WHERE id = ?').run(current, now(), Number(account.id))
      this.database.prepare("UPDATE browser_jobs SET worker_thread_id = ?, updated_at = ? WHERE account_id = ? AND worker_thread_id = ? AND status IN ('queued', 'dispatched', 'running')").run(current, now(), Number(account.id), previous)
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }

  dispatchVerification(id: string): BrowserJob {
    const job = this.getJob(id)
    const account = job && this.getAccount(job.accountId)
    if (!job || job.type !== 'verify_session' || !account?.enabled || !account.workerThreadId) throw new Error('验证任务或绑定账号不可用')
    if (job.status !== 'running') {
      this.database.prepare('UPDATE browser_jobs SET payload_json = ? WHERE id = ?').run(JSON.stringify({ ...job.payload, evidence: { ...job.payload.evidence, requireProfileId: true } }), id)
    }
    this.database.prepare("UPDATE browser_jobs SET status = 'dispatched', worker_thread_id = ?, updated_at = ? WHERE id = ? AND status = 'queued'").run(account.workerThreadId, now(), id)
    return this.getJob(id) as BrowserJob
  }

  listCampaigns(): Campaign[] {
    return (this.database.prepare('SELECT * FROM campaigns ORDER BY updated_at DESC').all() as Row[]).map(campaignFromRow)
  }

  getCampaign(id: string): Campaign | null {
    const row = this.database.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Row | undefined
    return row ? campaignFromRow(row) : null
  }

  createCampaign(input: Omit<Campaign, 'id' | 'status' | 'authorizationLockedAt' | 'createdAt' | 'updatedAt'>): Campaign {
    const id = randomUUID()
    const timestamp = now()
    this.database.prepare(`INSERT INTO campaigns
      (id, name, theme, status, account_ids_json, comment_account_ids_json, knowledge_ids_json, asset_ids_json,
       note_tones_json, comment_tones_json, schedule_json, min_comments, max_comments, comment_window_start_minutes,
       comment_window_end_minutes, generate_lead_minutes, created_at, updated_at)
      VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.name, input.theme, JSON.stringify(input.accountIds), JSON.stringify(input.commentAccountIds),
        JSON.stringify(input.knowledgeIds), JSON.stringify(input.assetIds), JSON.stringify(input.noteTones),
        JSON.stringify(input.commentTones), JSON.stringify(input.schedule), input.minComments, input.maxComments,
        input.commentWindowStartMinutes, input.commentWindowEndMinutes, input.generateLeadMinutes, timestamp, timestamp)
    return this.getCampaign(id) as Campaign
  }

  setCampaignStatus(id: string, status: CampaignStatus): Campaign {
    const campaign = this.getCampaign(id)
    if (!campaign) throw new Error('活动不存在')
    if (status === 'active') {
      if (!campaign.accountIds.length) throw new Error('活动必须选择发布账号')
      const accounts = campaign.accountIds.map((accountId) => this.getAccount(accountId))
      if (accounts.some((account) => !account?.enabled || !account.workerThreadId || account.sessionStatus !== 'healthy')) {
        throw new Error('发布账号必须启用、绑定 Codex 任务并完成登录验证')
      }
    }
    const lockedAt = status === 'active' ? now() : campaign.authorizationLockedAt
    this.database.prepare('UPDATE campaigns SET status = ?, authorization_locked_at = ?, updated_at = ? WHERE id = ?')
      .run(status, lockedAt, now(), id)
    this.audit({ campaignId: id, action: 'campaign_status', status: 'succeeded', detail: { status } })
    return this.getCampaign(id) as Campaign
  }

  listContent(limit = 100): ContentItem[] {
    return (this.database.prepare('SELECT * FROM content_items ORDER BY scheduled_at DESC LIMIT ?').all(limit) as Row[]).map(contentFromRow)
  }

  getPlatformSnapshot(accountId: number): PlatformSnapshot | null {
    const row = this.database.prepare('SELECT snapshot_json FROM platform_snapshots WHERE account_id = ?').get(accountId) as Row | undefined
    return row ? JSON.parse(String(row.snapshot_json)) as PlatformSnapshot : null
  }

  savePlatformSnapshot(accountId: number, snapshot: PlatformSnapshot): void {
    this.database.prepare('INSERT INTO platform_snapshots (account_id, snapshot_json) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET snapshot_json = excluded.snapshot_json')
      .run(accountId, JSON.stringify(snapshot))
    this.database.prepare('UPDATE accounts SET updated_at = ? WHERE id = ?').run(now(), accountId)
  }

  accountContent(accountId: number, requestedPage = 1) {
    const counts = this.database.prepare('SELECT status, COUNT(*) AS count FROM content_items WHERE account_id = ? GROUP BY status').all(accountId) as Row[]
    const total = counts.reduce((sum, row) => sum + Number(row.count), 0)
    const pages = Math.max(1, Math.ceil(total / 20))
    const page = Math.min(pages, Math.max(1, requestedPage))
    const items = (this.database.prepare('SELECT * FROM content_items WHERE account_id = ? ORDER BY scheduled_at DESC, id DESC LIMIT 20 OFFSET ?')
      .all(accountId, (page - 1) * 20) as Row[]).map(contentFromRow)
    return { items, total, pages, page, counts: Object.fromEntries(counts.map(row => [String(row.status), Number(row.count)])) as Record<string, number> }
  }

  getContent(id: string): ContentItem | null {
    const row = this.database.prepare('SELECT * FROM content_items WHERE id = ?').get(id) as Row | undefined
    return row ? contentFromRow(row) : null
  }

  createPlannedContent(campaignId: string | null, accountId: number, scheduledAt: string): ContentItem {
    const existing = this.database.prepare('SELECT * FROM content_items WHERE campaign_id = ? AND account_id = ? AND scheduled_at = ?')
      .get(campaignId, accountId, scheduledAt) as Row | undefined
    if (existing) return contentFromRow(existing)
    const id = randomUUID()
    const timestamp = now()
    this.database.prepare(`INSERT INTO content_items
      (id, campaign_id, account_id, status, scheduled_at, title, body, topics_json, card_data_json,
       media_asset_ids_json, source_knowledge_ids_json, created_at, updated_at)
      VALUES (?, ?, ?, 'planned', ?, '', '', '[]', '[]', '[]', '[]', ?, ?)`)
      .run(id, campaignId, accountId, scheduledAt, timestamp, timestamp)
    return this.getContent(id) as ContentItem
  }

  markContentGenerating(id: string): boolean {
    return this.database.prepare("UPDATE content_items SET status = 'generating', error = NULL, updated_at = ? WHERE id = ? AND status IN ('planned', 'failed')")
      .run(now(), id).changes === 1
  }

  setContentGenerated(id: string, input: {
    title: string; body: string; topics: string[]; cardData: ContentItem['cardData']; mediaAssetIds: string[];
    sourceKnowledgeIds: string[]; contentHash: string;
  }): ContentItem {
    this.database.prepare(`UPDATE content_items SET status = 'scheduled', title = ?, body = ?, topics_json = ?,
      card_data_json = ?, media_asset_ids_json = ?, source_knowledge_ids_json = ?, content_hash = ?, error = NULL,
      updated_at = ? WHERE id = ? AND status = 'generating'`)
      .run(input.title, input.body, JSON.stringify(input.topics), JSON.stringify(input.cardData), JSON.stringify(input.mediaAssetIds),
        JSON.stringify(input.sourceKnowledgeIds), input.contentHash, now(), id)
    return this.getContent(id) as ContentItem
  }

  failContent(id: string, error: string): void {
    this.database.prepare("UPDATE content_items SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status IN ('planned', 'generating')")
      .run(error.slice(0, 2000), now(), id)
  }

  createJob(input: {
    type: JobType; accountId: number; contentItemId?: string | null; parentJobId?: string | null;
    scheduledAt: string; payload: BrowserJobPayload; idempotencyKey: string;
  }): BrowserJob {
    if (!this.getAccount(input.accountId)) throw new Error('账号已解除绑定')
    if (input.contentItemId && this.getContent(input.contentItemId)?.status === 'cancelled') throw new Error('内容已取消')
    const existing = this.database.prepare('SELECT * FROM browser_jobs WHERE idempotency_key = ?').get(input.idempotencyKey) as Row | undefined
    if (existing) return jobFromRow(existing)
    const id = randomUUID()
    const timestamp = now()
    this.database.prepare(`INSERT INTO browser_jobs
      (id, type, status, account_id, content_item_id, parent_job_id, scheduled_at, payload_json, idempotency_key, created_at, updated_at)
      VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.type, input.accountId, input.contentItemId ?? null, input.parentJobId ?? null,
        input.scheduledAt, JSON.stringify(input.payload), input.idempotencyKey, timestamp, timestamp)
    return this.getJob(id) as BrowserJob
  }

  listJobs(limit = 100): BrowserJob[] {
    return (this.database.prepare('SELECT * FROM browser_jobs ORDER BY scheduled_at DESC LIMIT ?').all(limit) as Row[]).map(jobFromRow)
  }

  createSessionJob(input: SessionOperation, payload: BrowserJobPayload): BrowserJob {
    const key = 'session:' + createHash('sha256').update(JSON.stringify([input.runKey, input.operationKey])).digest('hex')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.database.prepare('SELECT * FROM browser_jobs WHERE idempotency_key = ?').get(key) as Row | undefined
      if (existing) {
        const job = jobFromRow(existing)
        if (job.accountId !== input.accountId || job.type !== input.type || job.payload.evidence?.inputHash !== payload.evidence?.inputHash) throw new Error('同一次操作已锁定账号和内容，不能更换操作标识绕过已有记录')
        if (job.attempts === 0 && ['queued', 'dispatched'].includes(job.status)) this.database.prepare('UPDATE browser_jobs SET worker_thread_id = ? WHERE id = ?').run(input.sessionId, job.id)
        this.database.exec('COMMIT')
        return this.getJob(job.id) as BrowserJob
      }
      const account = this.getAccount(input.accountId)
      if (!account?.enabled) throw new Error('账号不存在、已解除绑定或已停用')
      const scheduledAt = now()
      const content = input.type === 'publish_note' ? this.createPlannedContent(null, account.id, scheduledAt) : null
      if (content) this.database.prepare('UPDATE content_items SET title = ?, body = ?, topics_json = ?, card_data_json = ? WHERE id = ?')
        .run(input.title, input.body, JSON.stringify(input.topics), JSON.stringify(input.cards), content.id)
      const job = this.createJob({ type: input.type, accountId: account.id, contentItemId: content?.id ?? null, scheduledAt, payload, idempotencyKey: key })
      this.database.prepare('UPDATE browser_jobs SET worker_thread_id = ? WHERE id = ?').run(input.sessionId, job.id)
      if (!content) this.createInteraction({
        contentItemId: null, kind: input.type === 'reply_comment' ? 'reply' : 'managed_comment', accountId: account.id,
        remoteAuthor: input.targetAuthor || null, remoteCommentId: `job:${job.id}`, body: input.body,
        status: 'queued', riskLabels: [], scheduledAt, resultUrl: input.targetUrl,
      })
      this.audit({ accountId: account.id, contentItemId: content?.id ?? null, jobId: job.id, action: 'session_operation_prepared', status: 'queued' })
      this.database.exec('COMMIT')
      return this.getJob(job.id) as BrowserJob
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }

  setSessionJobMedia(id: string, mediaPaths: string[]): void {
    const job = this.getJob(id)
    if (!job || job.status !== 'queued') throw new Error('任务已变更')
    this.database.prepare('UPDATE browser_jobs SET payload_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify({ ...job.payload, mediaPaths }), now(), id)
  }

  getJob(id: string): BrowserJob | null {
    const row = this.database.prepare('SELECT * FROM browser_jobs WHERE id = ?').get(id) as Row | undefined
    return row ? jobFromRow(row) : null
  }

  dispatchDue(at = new Date(), jobId?: string): BrowserJob[] {
    const timestamp = at.toISOString()
    const rows = this.database.prepare("SELECT * FROM browser_jobs WHERE status = 'queued' AND scheduled_at <= ? AND (? IS NULL OR id = ?) ORDER BY scheduled_at, id")
      .all(timestamp, jobId ?? null, jobId ?? null) as Row[]
    const dispatched: BrowserJob[] = []
    for (const row of rows) {
      const job = jobFromRow(row)
      const account = this.getAccount(job.accountId)
      const sessionExecution = job.payload.evidence?.sessionExecution === true
      if (sessionExecution && job.type === 'publish_note' && !job.payload.mediaPaths?.length) continue
      const canVerify = job.type === 'verify_session' && account?.enabled && Boolean(account.workerThreadId)
      const canExecute = account?.enabled && (sessionExecution ? Boolean(job.workerThreadId) : Boolean(account.workerThreadId) && account.sessionStatus === 'healthy')
      if (!canVerify && !canExecute) {
        this.database.prepare("UPDATE browser_jobs SET status = 'blocked', error_code = 'account_not_ready', error = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
          .run(job.type === 'verify_session' ? '账号未启用或未绑定独立任务' : '账号未启用、未绑定任务或登录状态不健康', now(), job.id)
        continue
      }
      const deadlineAt = typeof job.payload.evidence?.deadlineAt === 'string' ? job.payload.evidence.deadlineAt : null
      const defaultExpired = job.type === 'publish_note' && at.getTime() - new Date(job.scheduledAt).getTime() > 15 * 60_000
      const explicitExpired = deadlineAt ? at.getTime() > new Date(deadlineAt).getTime() : false
      if (defaultExpired || explicitExpired) {
        this.database.prepare("UPDATE browser_jobs SET status = 'skipped', error_code = 'window_missed', error = '执行窗口已错过', updated_at = ? WHERE id = ? AND status = 'queued'")
          .run(now(), job.id)
        if (job.type === 'publish_note' && job.contentItemId) {
          this.database.prepare("UPDATE content_items SET status = 'missed', error = '发布时间已错过', updated_at = ? WHERE id = ?")
            .run(now(), job.contentItemId)
        }
        continue
      }
      if (job.type === 'publish_note') {
        const range = localDayUtcRange(job.scheduledAt)
        const used = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM browser_jobs
          WHERE type = 'publish_note' AND account_id = ? AND id != ? AND scheduled_at >= ? AND scheduled_at < ?
          AND status IN ('dispatched', 'running', 'succeeded', 'needs_reconcile')`)
          .get(job.accountId, job.id, range.start, range.end) as Row).count)
        if (used >= account.dailyLimit) {
          this.database.prepare("UPDATE browser_jobs SET status = 'skipped', error_code = 'daily_quota', error = '账号当日发布上限已用完', updated_at = ? WHERE id = ? AND status = 'queued'")
            .run(now(), job.id)
          if (job.contentItemId) {
            this.database.prepare("UPDATE content_items SET status = 'missed', error = '账号当日发布上限已用完', updated_at = ? WHERE id = ?")
              .run(now(), job.contentItemId)
          }
          continue
        }
      }
      const result = this.database.prepare("UPDATE browser_jobs SET status = 'dispatched', worker_thread_id = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
        .run(sessionExecution ? job.workerThreadId : account.workerThreadId, now(), job.id)
      if (result.changes === 1) dispatched.push(this.getJob(job.id) as BrowserJob)
    }
    return dispatched
  }

  claimJob(id: string, accountId: number, observation?: { sessionId: string; actualAccount: string; actualProfileId: string }): { job: BrowserJob; leaseToken: string } {
    const job = this.getJob(id)
    if (!job) throw new Error('任务不存在')
    if (job.accountId !== accountId) throw new Error('任务账号与执行账号不一致')
    if (job.status !== 'dispatched') throw new Error('任务当前不可领取')
    const account = this.getAccount(accountId)
    if (!account?.enabled) throw new Error('账号已停用或解除绑定')
    if (job.payload.evidence?.sessionExecution === true) {
      if (!observation || observation.sessionId !== job.workerThreadId) throw new Error('当前会话与执行任务不一致')
      if (observation.actualProfileId !== account.expectedProfileId || observation.actualAccount.trim().toLocaleLowerCase() !== account.handle.toLocaleLowerCase()) throw new Error('浏览器身份与指定账号不一致，不能发布或回复')
    }
    if (job.type !== 'verify_session' && this.database.prepare("SELECT id FROM browser_jobs WHERE account_id = ? AND id != ? AND type != 'verify_session' AND status IN ('running', 'needs_reconcile') LIMIT 1").get(accountId, id)) throw new Error('该账号还有正在执行或结果待核对的操作，请先处理，避免重复发送')
    const token = randomBytes(24).toString('base64url')
    const leaseUntil = new Date(Date.now() + 10 * 60_000).toISOString()
    const result = this.database.prepare(`UPDATE browser_jobs SET status = 'running', lease_token_hash = ?, lease_until = ?,
      attempts = attempts + 1, error_code = NULL, error = NULL, updated_at = ? WHERE id = ? AND status = 'dispatched'`)
      .run(leaseHash(token), leaseUntil, now(), id)
    if (result.changes !== 1) throw new Error('任务已被其他执行器领取')
    this.audit({ accountId, ...(job.contentItemId ? { contentItemId: job.contentItemId } : {}), jobId: id, action: 'job_claim', status: 'succeeded' })
    return { job: this.getJob(id) as BrowserJob, leaseToken: token }
  }

  private assertLease(job: BrowserJob, token: string): void {
    const row = this.database.prepare('SELECT lease_token_hash, lease_until FROM browser_jobs WHERE id = ?').get(job.id) as Row | undefined
    if (!row || typeof row.lease_token_hash !== 'string' || typeof row.lease_until !== 'string') throw new Error('任务没有有效租约')
    const supplied = Buffer.from(leaseHash(token))
    const expected = Buffer.from(row.lease_token_hash)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('任务租约无效')
    if (new Date(row.lease_until).getTime() < Date.now()) throw new Error('任务租约已过期')
  }

  completeJob(id: string, token: string, input: { actualAccount: string; actualProfileId?: string; resultUrl?: string | null; screenshotPath?: string | null }): BrowserJob {
    const job = this.getJob(id)
    if (!job || job.status !== 'running') throw new Error('任务不在执行中')
    this.assertLease(job, token)
    const account = this.getAccount(job.accountId)
    if (job.payload.evidence?.sessionExecution === true && (!account || input.actualProfileId !== account.expectedProfileId || !input.resultUrl)) throw new Error('完成操作需要匹配的小红书号和已确认的结果地址')
    if (job.type === 'verify_session' && job.payload.evidence?.requireProfileId === true
      && (!account || input.actualProfileId !== account.expectedProfileId || account.workerThreadId !== job.workerThreadId)) {
      this.stopJob(id, token, 'blocked', { code: 'identity_mismatch', message: '未观察到匹配的小红书号，或账号绑定已变更' })
      throw new Error('小红书号验证失败，不能将账号标记为已连接')
    }
    if (!account || input.actualAccount.trim().toLocaleLowerCase() !== account.handle.toLocaleLowerCase()) {
      this.database.prepare(`UPDATE browser_jobs SET status = 'blocked', actual_account = ?, error_code = 'identity_mismatch',
        error = '浏览器中的账号与任务绑定账号不一致', lease_token_hash = NULL, lease_until = NULL, updated_at = ? WHERE id = ?`)
        .run(input.actualAccount, now(), id)
      this.setAccountSession(job.accountId, 'blocked', { error: '浏览器账号身份不一致' })
      throw new Error('浏览器中的账号与任务绑定账号不一致')
    }
    this.database.prepare(`UPDATE browser_jobs SET status = 'succeeded', actual_account = ?, result_url = ?, screenshot_path = ?,
      error_code = NULL, error = NULL, lease_token_hash = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'running'`)
      .run(input.actualAccount, input.resultUrl ?? null, input.screenshotPath ?? null, now(), id)
    this.setAccountSession(job.accountId, 'healthy', { verified: true })
    this.audit({ accountId: job.accountId, ...(job.contentItemId ? { contentItemId: job.contentItemId } : {}), jobId: id, action: job.type, status: 'succeeded', detail: { resultUrl: input.resultUrl ?? null } })
    return this.getJob(id) as BrowserJob
  }

  stopJob(id: string, token: string, status: 'blocked' | 'failed' | 'needs_reconcile', input: { code: string; message: string; screenshotPath?: string | null }): BrowserJob {
    const job = this.getJob(id)
    if (!job || job.status !== 'running') throw new Error('任务不在执行中')
    this.assertLease(job, token)
    this.database.prepare(`UPDATE browser_jobs SET status = ?, error_code = ?, error = ?, screenshot_path = ?,
      lease_token_hash = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'running'`)
      .run(status, input.code, input.message.slice(0, 2000), input.screenshotPath ?? null, now(), id)
    if (status === 'blocked') {
      const sessionStatus: AccountSessionStatus = ['login_required', 'captcha', 'reauthorize'].includes(input.code) ? 'reauthorize' : 'blocked'
      this.setAccountSession(job.accountId, sessionStatus, { error: input.message })
    }
    this.audit({ accountId: job.accountId, ...(job.contentItemId ? { contentItemId: job.contentItemId } : {}), jobId: id, action: job.type, status, detail: { code: input.code } })
    if (job.payload.evidence?.sessionExecution === true) {
      if (job.contentItemId) this.database.prepare("UPDATE content_items SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(input.message, now(), job.contentItemId)
      this.updateInteractionByJob(this.getJob(id) as BrowserJob)
    }
    return this.getJob(id) as BrowserJob
  }

  reconcileJob(id: string, resolution: 'found' | 'not_found' | 'uncertain', input: { resultUrl?: string; actualAccount?: string } = {}): BrowserJob {
    const job = this.getJob(id)
    if (!job || job.status !== 'needs_reconcile') throw new Error('任务不需要核对')
    if (resolution === 'found') {
      const account = this.getAccount(job.accountId)
      if (!account || !input.actualAccount || input.actualAccount.toLocaleLowerCase() !== account.handle.toLocaleLowerCase()) throw new Error('核对结果缺少正确账号')
      this.database.prepare("UPDATE browser_jobs SET status = 'succeeded', actual_account = ?, result_url = ?, error_code = NULL, error = NULL, updated_at = ? WHERE id = ?")
        .run(input.actualAccount, input.resultUrl ?? null, now(), id)
    } else if (resolution === 'not_found') {
      this.database.prepare("UPDATE browser_jobs SET status = 'queued', error_code = NULL, error = NULL, scheduled_at = ?, updated_at = ? WHERE id = ?")
        .run(now(), now(), id)
    }
    return this.getJob(id) as BrowserJob
  }

  retryJob(id: string): BrowserJob {
    const job = this.getJob(id)
    if (!job || !['blocked', 'failed'].includes(job.status)) throw new Error('只有已阻断或失败的任务可以重试')
    const account = this.getAccount(job.accountId)
    if (!account?.enabled || !account.workerThreadId || account.sessionStatus !== 'healthy') {
      throw new Error('账号必须先恢复为可执行状态')
    }
    const result = this.database.prepare(`UPDATE browser_jobs SET status = 'queued', worker_thread_id = NULL,
      scheduled_at = ?, error_code = NULL, error = NULL, lease_token_hash = NULL, lease_until = NULL,
      updated_at = ? WHERE id = ? AND status IN ('blocked', 'failed')`)
      .run(now(), now(), id)
    if (result.changes !== 1) throw new Error('任务状态已经变化')
    this.audit({ accountId: job.accountId, ...(job.contentItemId ? { contentItemId: job.contentItemId } : {}), jobId: id, action: 'job_retry', status: 'queued' })
    return this.getJob(id) as BrowserJob
  }

  markContentPublished(id: string, resultUrl: string): ContentItem {
    this.database.prepare("UPDATE content_items SET status = 'published', result_url = ?, published_at = ?, error = NULL, updated_at = ? WHERE id = ?")
      .run(resultUrl, now(), now(), id)
    return this.getContent(id) as ContentItem
  }

  createInteraction(input: Omit<Interaction, 'id' | 'createdAt' | 'updatedAt'>): Interaction {
    const id = randomUUID()
    const timestamp = now()
    this.database.prepare(`INSERT OR IGNORE INTO interactions
      (id, content_item_id, kind, account_id, remote_author, remote_comment_id, body, status, risk_labels_json,
       scheduled_at, result_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.contentItemId, input.kind, input.accountId, input.remoteAuthor, input.remoteCommentId, input.body,
        input.status, JSON.stringify(input.riskLabels), input.scheduledAt, input.resultUrl, timestamp, timestamp)
    const row = this.database.prepare('SELECT * FROM interactions WHERE id = ? OR (content_item_id = ? AND kind = ? AND remote_comment_id = ?) LIMIT 1')
      .get(id, input.contentItemId, input.kind, input.remoteCommentId) as Row
    return interactionFromRow(row)
  }

  listInteractions(limit = 100, accountId?: number): Interaction[] {
    // Incoming reader comments belong to the content owner; managed actions belong to the acting account.
    const rows = accountId === undefined
      ? this.database.prepare('SELECT * FROM interactions ORDER BY created_at DESC LIMIT ?').all(limit)
      : this.database.prepare(`SELECT i.* FROM interactions i LEFT JOIN content_items c ON c.id = i.content_item_id
          WHERE i.account_id = ? OR (i.account_id IS NULL AND c.account_id = ?)
          ORDER BY i.created_at DESC LIMIT ?`).all(accountId, accountId, limit)
    return (rows as Row[]).map(interactionFromRow)
  }

  updateInteractionByJob(job: BrowserJob): void {
    if (job.payload.evidence?.sessionExecution === true && !job.contentItemId) {
      this.database.prepare("UPDATE interactions SET status = ?, result_url = COALESCE(?, result_url), updated_at = ? WHERE remote_comment_id = ? AND content_item_id IS NULL AND account_id = ?")
        .run(job.status === 'succeeded' ? 'published' : 'failed', job.resultUrl, now(), `job:${job.id}`, job.accountId)
      return
    }
    if (!job.contentItemId) return
    const status = job.status === 'succeeded' ? 'published' : job.status === 'failed' || job.status === 'blocked' ? 'failed' : null
    if (!status) return
    const comment = job.payload.commentBody
    if (!comment) return
    this.database.prepare(`UPDATE interactions SET status = ?, result_url = ?, updated_at = ?
      WHERE content_item_id = ? AND account_id = ? AND body = ? AND status IN ('planned', 'queued')`)
      .run(status, job.resultUrl, now(), job.contentItemId, job.accountId, comment)
    if (job.type === 'reply_comment' && job.status === 'succeeded' && job.payload.targetUrl) {
      this.database.prepare(`UPDATE interactions SET status = 'published', updated_at = ?
        WHERE content_item_id = ? AND kind = 'organic_comment' AND result_url = ? AND status = 'queued'`)
        .run(now(), job.contentItemId, job.payload.targetUrl)
    }
  }

  ingestDiscoveredComments(job: BrowserJob, comments: DiscoveredComment[], suggestedReplies: Map<string, string>): void {
    if (!job.contentItemId) throw new Error('扫描任务没有关联内容')
    const managedHandles = new Set(this.listAccounts().map((account) => account.handle.toLocaleLowerCase('zh-CN')))
    for (const comment of comments) {
      if (managedHandles.has(comment.remoteAuthor.trim().replace(/^@/, '').toLocaleLowerCase('zh-CN'))) continue
      const risks = classifyCommentRisk(comment.body)
      const interaction = this.createInteraction({
        contentItemId: job.contentItemId, kind: 'organic_comment', accountId: null, remoteAuthor: comment.remoteAuthor,
        remoteCommentId: comment.remoteCommentId, body: comment.body, status: risks.length ? 'review' : 'queued',
        riskLabels: risks, scheduledAt: null, resultUrl: comment.targetUrl,
      })
      const suggestion = suggestedReplies.get(comment.remoteCommentId) ?? ''
      if (risks.length) {
        const id = randomUUID()
        const timestamp = now()
        this.database.prepare(`INSERT OR IGNORE INTO review_items
          (id, interaction_id, account_id, source_text, suggested_text, risk_labels_json, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
          .run(id, interaction.id, job.accountId, comment.body, suggestion, JSON.stringify(risks), timestamp, timestamp)
      } else if (suggestion.trim()) {
        this.createInteraction({
          contentItemId: job.contentItemId, kind: 'reply', accountId: job.accountId, remoteAuthor: comment.remoteAuthor,
          remoteCommentId: `reply:${comment.remoteCommentId}`, body: suggestion, status: 'planned', riskLabels: [],
          scheduledAt: now(), resultUrl: null,
        })
        this.createJob({
          type: 'reply_comment', accountId: job.accountId, contentItemId: job.contentItemId, parentJobId: job.id,
          scheduledAt: now(), idempotencyKey: `reply:${job.contentItemId}:${comment.remoteCommentId}`,
          payload: {
            destinationUrl: job.payload.destinationUrl,
            expectedHandle: job.payload.expectedHandle,
            expectedProfileId: job.payload.expectedProfileId,
            expectedProfileUrl: job.payload.expectedProfileUrl,
            targetUrl: comment.targetUrl,
            commentBody: suggestion,
          },
        })
      }
    }
  }

  listReviews(limit = 100, accountId?: number): ReviewItem[] {
    const rows = accountId === undefined
      ? this.database.prepare('SELECT * FROM review_items ORDER BY created_at DESC LIMIT ?').all(limit)
      : this.database.prepare('SELECT * FROM review_items WHERE account_id = ? ORDER BY created_at DESC LIMIT ?').all(accountId, limit)
    return (rows as Row[]).map(reviewFromRow)
  }

  resolveReview(id: string, status: 'approved' | 'rejected', suggestedText: string): ReviewItem {
    const row = this.database.prepare('SELECT * FROM review_items WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error('审核项不存在')
    const review = reviewFromRow(row)
    if (review.status !== 'pending') throw new Error('审核项已经处理')
    const interactionRow = this.database.prepare('SELECT * FROM interactions WHERE id = ?').get(review.interactionId) as Row | undefined
    if (!interactionRow) throw new Error('原评论不存在')
    const interaction = interactionFromRow(interactionRow)
    const finalText = suggestedText.trim()
    if (status === 'approved' && !finalText) throw new Error('批准回复时内容不能为空')
    const account = status === 'approved' ? this.getAccount(review.accountId) : null
    if (status === 'approved' && (!account || !interaction.resultUrl)) throw new Error('回复账号或目标地址不可用')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('UPDATE review_items SET status = ?, suggested_text = ?, updated_at = ? WHERE id = ? AND status = ?')
        .run(status, finalText, now(), id, 'pending')
      if (status === 'rejected') {
        this.database.prepare("UPDATE interactions SET status = 'skipped', updated_at = ? WHERE id = ?").run(now(), interaction.id)
      } else if (account && interaction.resultUrl) {
        this.database.prepare("UPDATE interactions SET status = 'queued', updated_at = ? WHERE id = ?").run(now(), interaction.id)
        this.createInteraction({
          contentItemId: interaction.contentItemId, kind: 'reply', accountId: account.id,
          remoteAuthor: interaction.remoteAuthor, remoteCommentId: `reply:${interaction.remoteCommentId ?? interaction.id}`,
          body: finalText, status: 'planned', riskLabels: review.riskLabels, scheduledAt: now(), resultUrl: null,
        })
        this.createJob({
          type: 'reply_comment', accountId: account.id, contentItemId: interaction.contentItemId,
          scheduledAt: now(), idempotencyKey: `approved-reply:${interaction.id}`,
          payload: {
            destinationUrl: config.xhs.webUrl, expectedHandle: account.handle,
            expectedProfileId: account.expectedProfileId, expectedProfileUrl: account.profileUrl,
            targetUrl: interaction.resultUrl, commentBody: finalText,
          },
        })
      }
      this.audit({ accountId: review.accountId, contentItemId: interaction.contentItemId, action: 'review_resolve', status, detail: { reviewId: id } })
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    const updated = this.database.prepare('SELECT * FROM review_items WHERE id = ?').get(id) as Row
    return reviewFromRow(updated)
  }

  listAudit(limit = 100): Row[] {
    return this.database.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?').all(limit) as Row[]
  }

  counts(): Record<string, number> {
    const count = (sql: string): number => Number((this.database.prepare(sql).get() as Row).count)
    return {
      accounts: count('SELECT COUNT(*) AS count FROM accounts WHERE enabled = 1'),
      healthyAccounts: count("SELECT COUNT(*) AS count FROM accounts WHERE enabled = 1 AND session_status = 'healthy'"),
      activeCampaigns: count("SELECT COUNT(*) AS count FROM campaigns WHERE status = 'active'"),
      dueJobs: count("SELECT COUNT(*) AS count FROM browser_jobs WHERE status IN ('queued', 'dispatched', 'running')"),
      blockedJobs: count("SELECT COUNT(*) AS count FROM browser_jobs WHERE status IN ('blocked', 'needs_reconcile')"),
      pendingReviews: count("SELECT COUNT(*) AS count FROM review_items WHERE status = 'pending'"),
      publishedContent: count("SELECT COUNT(*) AS count FROM content_items WHERE status = 'published'"),
    }
  }
}

export function sqlValues(values: unknown[]): SQLInputValue[] {
  return values.map((value) => value === undefined ? null : value as SQLInputValue)
}
