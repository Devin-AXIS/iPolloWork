import { createHash } from 'node:crypto';

/** Per-account protection complements the shared-office IP allowance on one service instance. */
export class AuthAttempts {
  private readonly entries = new Map<string, { count: number; expires: number }>();
  constructor(private readonly maxEntries = 10000) {}
  consume(email: string, now = Date.now()): number {
    const key = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
    const previous = this.entries.get(key);
    if (previous && previous.expires > now) {
      if (previous.count >= 8) return Math.ceil((previous.expires - now) / 1000);
      previous.count++; return 0;
    }
    if (this.entries.size >= this.maxEntries) {
      for (const [id, entry] of this.entries) if (entry.expires <= now) this.entries.delete(id);
      if (!this.entries.has(key) && this.entries.size >= this.maxEntries) return 60;
    }
    this.entries.set(key, { count: 1, expires: now + 60000 });
    return 0;
  }
}
