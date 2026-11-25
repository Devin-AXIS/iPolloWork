/** Shared, credential-free records sent from the Host to the browser. */
export interface AccountUser { id: string; name: string; email: string }
export type AccountState =
  | { status: 'anonymous' }
  | { status: 'signed-in'; user: AccountUser; points: number | null; balanceStatus: 'available' | 'unavailable' }

export interface MarketItem {
  name: string; title: string; description: string; author: string; icon: string | null;
  homepage: string | null; category: string; categoryTitle: string; version: string; spec: string; registry?: string;
  compatible: boolean; requirement: string | null; installed: boolean; enabled: boolean;
  providedByDsh: boolean;
  installedVersion: string | null; resources: readonly string[];
  archiveSha256?: string;
  enableOnInstall?: boolean;
  update?: 'archive' | 'git';
}
export interface MarketState { title: string; items: MarketItem[]; categories: { id: string; title: string }[]; runtimeVersion: string; canManage?: boolean }
export interface SuiteInfo { name: 'iPolloWork'; version: string }

/** Narrow native services used by this package; no runtime service is reimplemented. */
export interface CredentialStore {
  readRecord(key: string): Promise<{ kind: string; payload?: unknown } | undefined>;
  modifyRecord(key: string, operation: (current: unknown) => Promise<{ kind: 'grant'; payload: unknown }>): Promise<unknown>;
  deleteRecord(key: string): Promise<void>;
}

/** A curated native bundle reference, never executable plugin contents. */
export interface MarketEntry {
  name: string; title: string; description?: string; author?: string; homepage?: string; icon?: string;
  metadata: { category: 'productivity' | 'communication' | 'creative' };
  versions: [{ version: string; publishTimestamp: number;
    source: { type: 'npm'; registry?: string } | { type: 'git'; url: string; commit: string; path?: string };
    engines?: { dsh: string } }];
}
