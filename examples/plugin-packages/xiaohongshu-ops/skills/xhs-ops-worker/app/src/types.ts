export type AccountSessionStatus = 'setup' | 'healthy' | 'blocked' | 'reauthorize' | 'offline'
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed'
export type ScheduleKind = 'single' | 'weekly'
export type ContentStatus = 'planned' | 'generating' | 'ready' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'missed' | 'cancelled'
export type JobType = 'publish_note' | 'create_comment' | 'scan_comments' | 'reply_comment' | 'verify_session'
export type JobStatus = 'queued' | 'dispatched' | 'running' | 'succeeded' | 'blocked' | 'needs_reconcile' | 'failed' | 'skipped' | 'cancelled'
export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export interface PlatformSnapshot {
  importedAt: string
  source?: 'csv' | 'browser'
  followers: number | null
  likes: number | null
  collections: number | null
  articles: Array<{
    title: string; url: string; views: number | null; likes: number | null
    collections: number | null; comments: number | null
  }>
}

export interface AccountBinding {
  id: number
  handle: string
  displayName: string
  expectedProfileId: string
  profileUrl: string
  avatarUrl: string | null
  workerThreadId: string | null
  browserProfileId: string | null
  position: string
  audience: string
  noteTone: string
  commentTone: string
  contentColumns: string[]
  bannedTopics: string[]
  dailyLimit: number
  enabled: boolean
  sessionStatus: AccountSessionStatus
  lastVerifiedAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface BrandProfile {
  id: number
  name: string
  description: string
  allowedClaims: string[]
  bannedPhrases: string[]
  rulesVersion: string
  visual: {
    background: string
    foreground: string
    accent: string
  }
  updatedAt: string
}

export interface KnowledgeItem {
  id: string
  kind: 'fact' | 'product' | 'campaign' | 'policy'
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

export interface MediaAsset {
  id: string
  kind: 'upload' | 'generated'
  filename: string
  mimeType: string
  relativePath: string
  sha256: string
  width: number | null
  height: number | null
  createdAt: string
}

export interface CampaignSchedule {
  kind: ScheduleKind
  timezone: string
  scheduledLocal: string | null
  weekdays: number[]
  publishTime: string | null
}

export interface Campaign {
  id: string
  name: string
  theme: string
  status: CampaignStatus
  accountIds: number[]
  commentAccountIds: number[]
  knowledgeIds: string[]
  assetIds: string[]
  noteTones: string[]
  commentTones: string[]
  schedule: CampaignSchedule
  minComments: number
  maxComments: number
  commentWindowStartMinutes: number
  commentWindowEndMinutes: number
  generateLeadMinutes: number
  authorizationLockedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface GeneratedCard {
  heading: string
  body: string
}

export interface ContentItem {
  id: string
  campaignId: string
  accountId: number
  status: ContentStatus
  scheduledAt: string
  title: string
  body: string
  topics: string[]
  cardData: GeneratedCard[]
  mediaAssetIds: string[]
  sourceKnowledgeIds: string[]
  contentHash: string | null
  resultUrl: string | null
  publishedAt: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface BrowserJobPayload {
  destinationUrl: string
  expectedHandle: string
  expectedProfileId: string
  expectedProfileUrl: string
  title?: string
  body?: string
  topics?: string[]
  mediaPaths?: string[]
  targetUrl?: string
  commentBody?: string
  scanLimit?: number
  evidence?: Record<string, unknown>
}

export interface BrowserJob {
  id: string
  type: JobType
  status: JobStatus
  accountId: number
  contentItemId: string | null
  parentJobId: string | null
  scheduledAt: string
  payload: BrowserJobPayload
  idempotencyKey: string
  workerThreadId: string | null
  leaseUntil: string | null
  attempts: number
  actualAccount: string | null
  resultUrl: string | null
  screenshotPath: string | null
  errorCode: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface Interaction {
  id: string
  contentItemId: string
  kind: 'managed_comment' | 'organic_comment' | 'reply'
  accountId: number | null
  remoteAuthor: string | null
  remoteCommentId: string | null
  body: string
  status: 'planned' | 'queued' | 'published' | 'review' | 'skipped' | 'failed'
  riskLabels: string[]
  scheduledAt: string | null
  resultUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface ReviewItem {
  id: string
  interactionId: string
  accountId: number
  sourceText: string
  suggestedText: string
  riskLabels: string[]
  status: ReviewStatus
  createdAt: string
  updatedAt: string
}

export interface ExecutionReceipt {
  jobId: string
  actualAccount: string
  resultUrl: string | null
  screenshotPath: string | null
  completedAt: string
  evidence: Record<string, unknown>
}

export interface DiscoveredComment {
  remoteCommentId: string
  remoteAuthor: string
  body: string
  targetUrl: string
}
