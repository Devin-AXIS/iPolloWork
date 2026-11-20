import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CredentialStore } from '../shared/types.ts';
import type { AccountService } from './account.ts';
import { SuiteError } from './errors.ts';

const KEY = 'ipollowork-suite/mcp-preferences';
const schema = z.object({ version: z.literal(1), accounts: z.record(z.string().regex(/^[a-f0-9]{64}$/), z.array(z.uuid()).max(1000)) });
const empty = () => ({ version: 1 as const, accounts: {} as Record<string, string[]> });
function payload(record: unknown) {
  if (record === undefined) return empty();
  const value = z.object({ kind: z.literal('grant'), payload: schema }).safeParse(record);
  if (!value.success) throw new SuiteError('IPW_MCP_PREFERENCES_INVALID', 500);
  return value.data.payload;
}

/** Device-local choices, separated by verified account identity and service origin. No MCP secrets are copied. */
export class McpPreferences {
  private identity: { generation: number; fingerprint: string; key: Promise<string> } | undefined;
  constructor(private credentials: CredentialStore, private account: Pick<AccountService, 'generation' | 'user'>, private origin: string) {}
  private async fingerprint(): Promise<string> {
    // Authentication may be in flight while its generation already changed. Bind the cache to the actual saved grant too.
    return createHash('sha256').update(JSON.stringify(await this.credentials.readRecord('ipollowork-suite/account')) ?? '').digest('hex');
  }
  private async key(): Promise<string> {
    const generation = this.account.generation;
    const fingerprint = await this.fingerprint();
    if (this.identity?.generation === generation && this.identity.fingerprint === fingerprint) return this.identity.key;
    const key = this.account.user().then(async user => {
      if (!user) throw new SuiteError('IPW_SIGN_IN_REQUIRED', 401);
      if (generation !== this.account.generation || fingerprint !== await this.fingerprint()) throw new SuiteError('IPW_ACCOUNT_CHANGED', 409);
      return createHash('sha256').update(JSON.stringify([this.origin, user.id])).digest('hex');
    });
    this.identity = { generation, fingerprint, key };
    void key.catch(() => { if (this.identity?.key === key) this.identity = undefined; });
    return key;
  }
  async disabled(): Promise<Set<string>> {
    const value = payload(await this.credentials.readRecord(KEY));
    // Existing installations with no choices retain the original discovery budget.
    if (!Object.keys(value.accounts).length) return new Set();
    return new Set(value.accounts[await this.key()] ?? []);
  }
  async setDisabled(id: string, disabled: boolean): Promise<void> {
    const generation = this.account.generation, key = await this.key();
    await this.credentials.modifyRecord(KEY, async current => {
      if (generation !== this.account.generation) throw new SuiteError('IPW_ACCOUNT_CHANGED', 409);
      const value = payload(current), ids = new Set(value.accounts[key] ?? []);
      if (disabled) ids.add(id); else ids.delete(id);
      value.accounts[key] = [...ids];
      return { kind: 'grant', payload: schema.parse(value) };
    });
    if (generation !== this.account.generation) throw new SuiteError('IPW_ACCOUNT_CHANGED', 409);
  }
}
