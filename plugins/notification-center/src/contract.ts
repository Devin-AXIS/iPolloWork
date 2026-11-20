/** An authorized, plain-text notification supplied by its owning plugin. */
export interface NoticeItem {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly createdAt: number;
  readonly read: boolean;
  readonly tone?: 'info' | 'action' | 'success' | 'error';
}

/** The owner of the feed also owns persistence, read state, and navigation. */
export interface NotificationSource {
  label(): string;
  getSnapshot(): readonly NoticeItem[];
  subscribe(listener: () => void): () => void;
  markRead(id: string): Promise<void> | void;
  /** Open through the source's authorized navigation. It may leave the item unread if opening fails. */
  open?(id: string): Promise<void> | void;
}

/** Optional DSH client service injected as `ipolloNotificationCenter`. */
export interface NotificationCenter {
  registerSource(sourceId: string, source: NotificationSource): () => void;
}
