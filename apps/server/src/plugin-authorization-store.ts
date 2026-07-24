import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

const credentialSchema = z.object({
  handle: z.string(),
  installationId: z.string(),
  accountId: z.string(),
  methodId: z.string(),
  values: z.record(z.string(), z.string()),
  secretFields: z.array(z.string()),
  updatedAt: z.number(),
});

const pendingFlowSchema = z.object({
  installationId: z.string(),
  accountId: z.string(),
  methodId: z.string(),
  flowId: z.string(),
  state: z.string(),
  privateData: z.record(z.string(), z.unknown()),
  expiresAt: z.number(),
  createdAt: z.number(),
});

const activeAccountSchema = z.object({
  installationId: z.string(),
  methodId: z.string(),
  accountId: z.string(),
});

const storeSchema = z.object({
  schemaVersion: z.literal(1),
  credentials: z.array(credentialSchema),
  pendingFlows: z.array(pendingFlowSchema),
  activeAccounts: z.array(activeAccountSchema).default([]),
});

const envelopeSchema = z.object({
  schemaVersion: z.literal(1),
  algorithm: z.literal("aes-256-gcm"),
  iv: z.string(),
  tag: z.string(),
  data: z.string(),
});

type StoreState = z.infer<typeof storeSchema>;

export type PluginConnectionStatus = {
  accountId: string;
  methodId: string;
  status: "connected";
  fields: Record<string, boolean>;
  updatedAt: number;
};

export type SavedPluginCredential = {
  handle: string;
  status: PluginConnectionStatus;
};

export type ConsumedPluginFlow = {
  installationId: string;
  accountId: string;
  methodId: string;
  flowId: string;
  state: string;
  privateData: Record<string, unknown>;
  expiresAt: number;
};

export type PluginPendingFlowStatus = {
  accountId: string;
  methodId: string;
  flowId: string;
  status: "pending" | "expired";
  expiresAt: number;
};

function emptyState(): StoreState {
  return { schemaVersion: 1, credentials: [], pendingFlows: [], activeAccounts: [] };
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

function statusForCredential(credential: z.infer<typeof credentialSchema>): PluginConnectionStatus {
  return {
    accountId: credential.accountId,
    methodId: credential.methodId,
    status: "connected",
    fields: Object.fromEntries(Object.keys(credential.values).map((field) => [field, true])),
    updatedAt: credential.updatedAt,
  };
}

export class PluginAuthorizationStore {
  private readonly filePath: string;
  private readonly encryptionKey: Buffer;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(input: { filePath: string; encryptionKey: Buffer }) {
    if (input.encryptionKey.byteLength !== 32) throw new Error("Plugin authorization encryption key must contain 32 bytes");
    this.filePath = input.filePath;
    this.encryptionKey = Buffer.from(input.encryptionKey);
  }

  private async readState(): Promise<StoreState> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") return emptyState();
      throw error;
    }
    const envelope = envelopeSchema.parse(JSON.parse(raw));
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return storeSchema.parse(JSON.parse(decrypted));
  }

  private async writeState(state: StoreState): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
    const envelope = {
      schemaVersion: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: encrypted.toString("base64"),
    };
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = join(directory, `.plugin-authorization.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(temporaryPath, `${JSON.stringify(envelope)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(temporaryPath, 0o600).catch(() => undefined);
    try {
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
    await chmod(this.filePath, 0o600).catch(() => undefined);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.catch(() => undefined).then(operation);
    this.mutationQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async saveCredential(input: {
    installationId: string;
    accountId: string;
    methodId: string;
    values: Record<string, string>;
    secretFields: string[];
    now?: number;
  }): Promise<SavedPluginCredential> {
    return this.enqueue(async () => {
      const state = await this.readState();
      const current = state.credentials.find((entry) =>
        entry.installationId === input.installationId && entry.accountId === input.accountId && entry.methodId === input.methodId
      );
      const credential = credentialSchema.parse({
        handle: current?.handle ?? `plugin_credential_${randomUUID()}`,
        installationId: input.installationId,
        accountId: input.accountId,
        methodId: input.methodId,
        values: input.values,
        secretFields: input.secretFields,
        updatedAt: input.now ?? Date.now(),
      });
      state.credentials = state.credentials.filter((entry) =>
        !(entry.installationId === input.installationId && entry.accountId === input.accountId && entry.methodId === input.methodId)
      );
      state.credentials.push(credential);
      if (!state.activeAccounts.some((entry) => entry.installationId === input.installationId && entry.methodId === input.methodId)) {
        state.activeAccounts.push({ installationId: input.installationId, methodId: input.methodId, accountId: input.accountId });
      }
      await this.writeState(state);
      return { handle: credential.handle, status: statusForCredential(credential) };
    });
  }

  async listConnections(installationId: string): Promise<PluginConnectionStatus[]> {
    await this.mutationQueue.catch(() => undefined);
    const state = await this.readState();
    return state.credentials
      .filter((entry) => entry.installationId === installationId)
      .sort((left, right) => left.accountId.localeCompare(right.accountId) || left.methodId.localeCompare(right.methodId))
      .map(statusForCredential);
  }

  async setActiveAccount(input: { installationId: string; methodId: string; accountId: string }): Promise<boolean> {
    return this.enqueue(async () => {
      const state = await this.readState();
      const exists = state.credentials.some((entry) =>
        entry.installationId === input.installationId && entry.methodId === input.methodId && entry.accountId === input.accountId
      );
      if (!exists) return false;
      const current = state.activeAccounts.find((entry) => entry.installationId === input.installationId && entry.methodId === input.methodId);
      if (current?.accountId === input.accountId) return true;
      state.activeAccounts = state.activeAccounts.filter((entry) => !(entry.installationId === input.installationId && entry.methodId === input.methodId));
      state.activeAccounts.push(input);
      await this.writeState(state);
      return true;
    });
  }

  async readActiveCredential(input: { installationId: string; methodId: string }): Promise<{ accountId: string; values: Record<string, string> } | null> {
    await this.mutationQueue.catch(() => undefined);
    const state = await this.readState();
    const selected = state.activeAccounts.find((entry) => entry.installationId === input.installationId && entry.methodId === input.methodId)?.accountId;
    const candidates = state.credentials
      .filter((entry) => entry.installationId === input.installationId && entry.methodId === input.methodId)
      .sort((left, right) => left.accountId.localeCompare(right.accountId));
    const credential = candidates.find((entry) => entry.accountId === selected) ?? candidates[0];
    return credential ? { accountId: credential.accountId, values: { ...credential.values } } : null;
  }

  async retainMethods(installationId: string, methodIds: ReadonlySet<string>): Promise<number> {
    return this.enqueue(async () => {
      const state = await this.readState();
      const beforeCredentials = state.credentials.length;
      const beforeFlows = state.pendingFlows.length;
      state.credentials = state.credentials.filter((entry) => entry.installationId !== installationId || methodIds.has(entry.methodId));
      state.pendingFlows = state.pendingFlows.filter((entry) => entry.installationId !== installationId || methodIds.has(entry.methodId));
      state.activeAccounts = state.activeAccounts.filter((entry) => entry.installationId !== installationId || methodIds.has(entry.methodId));
      const removed = beforeCredentials - state.credentials.length + beforeFlows - state.pendingFlows.length;
      if (removed) await this.writeState(state);
      return removed;
    });
  }

  async readCredential(input: { installationId: string; handle: string }): Promise<Record<string, string> | null> {
    await this.mutationQueue.catch(() => undefined);
    const state = await this.readState();
    const credential = state.credentials.find((entry) => entry.installationId === input.installationId && entry.handle === input.handle);
    return credential ? { ...credential.values } : null;
  }

  async readCredentialForAccount(input: { installationId: string; accountId: string; methodId: string }): Promise<Record<string, string> | null> {
    await this.mutationQueue.catch(() => undefined);
    const state = await this.readState();
    const credential = state.credentials.find((entry) =>
      entry.installationId === input.installationId && entry.accountId === input.accountId && entry.methodId === input.methodId
    );
    return credential ? { ...credential.values } : null;
  }

  async savePendingFlow(input: {
    installationId: string;
    accountId: string;
    methodId: string;
    flowId: string;
    state: string;
    privateData: Record<string, unknown>;
    expiresAt: number;
    now?: number;
  }): Promise<void> {
    return this.enqueue(async () => {
      const current = await this.readState();
      const flow = pendingFlowSchema.parse({
        ...input,
        createdAt: input.now ?? Date.now(),
      });
      current.pendingFlows = current.pendingFlows.filter((entry) =>
        !(entry.installationId === input.installationId && (entry.flowId === input.flowId || entry.state === input.state))
      );
      current.pendingFlows.push(flow);
      await this.writeState(current);
    });
  }

  async consumePendingFlow(input: { installationId: string; state: string; now?: number }): Promise<ConsumedPluginFlow | null> {
    return this.enqueue(async () => {
      const now = input.now ?? Date.now();
      const current = await this.readState();
      const flow = current.pendingFlows.find((entry) =>
        entry.installationId === input.installationId && entry.state === input.state && entry.expiresAt > now
      );
      const nextFlows = current.pendingFlows.filter((entry) => entry.expiresAt > now && entry !== flow);
      if (nextFlows.length !== current.pendingFlows.length) {
        current.pendingFlows = nextFlows;
        await this.writeState(current);
      }
      if (!flow) return null;
      return {
        installationId: flow.installationId,
        accountId: flow.accountId,
        methodId: flow.methodId,
        flowId: flow.flowId,
        state: flow.state,
        privateData: { ...flow.privateData },
        expiresAt: flow.expiresAt,
      };
    });
  }

  async readPendingFlow(input: { installationId: string; flowId: string; now?: number }): Promise<ConsumedPluginFlow | null> {
    await this.mutationQueue.catch(() => undefined);
    const now = input.now ?? Date.now();
    const current = await this.readState();
    const flow = current.pendingFlows.find((entry) =>
      entry.installationId === input.installationId && entry.flowId === input.flowId && entry.expiresAt > now
    );
    if (!flow) return null;
    return {
      installationId: flow.installationId,
      accountId: flow.accountId,
      methodId: flow.methodId,
      flowId: flow.flowId,
      state: flow.state,
      privateData: { ...flow.privateData },
      expiresAt: flow.expiresAt,
    };
  }

  async listPendingFlows(installationId: string, now = Date.now()): Promise<PluginPendingFlowStatus[]> {
    await this.mutationQueue.catch(() => undefined);
    const current = await this.readState();
    return current.pendingFlows
      .filter((entry) => entry.installationId === installationId)
      .map((entry) => ({
        accountId: entry.accountId,
        methodId: entry.methodId,
        flowId: entry.flowId,
        status: entry.expiresAt > now ? "pending" : "expired",
        expiresAt: entry.expiresAt,
      }));
  }

  async cancelPendingFlow(input: { installationId: string; flowId: string }): Promise<boolean> {
    return this.enqueue(async () => {
      const state = await this.readState();
      const count = state.pendingFlows.length;
      state.pendingFlows = state.pendingFlows.filter((entry) =>
        !(entry.installationId === input.installationId && entry.flowId === input.flowId)
      );
      const changed = count !== state.pendingFlows.length;
      if (changed) await this.writeState(state);
      return changed;
    });
  }

  async revokeAccount(input: { installationId: string; accountId: string }): Promise<boolean> {
    return this.enqueue(async () => {
      const state = await this.readState();
      const credentialCount = state.credentials.length;
      const flowCount = state.pendingFlows.length;
      state.credentials = state.credentials.filter((entry) => !(entry.installationId === input.installationId && entry.accountId === input.accountId));
      state.pendingFlows = state.pendingFlows.filter((entry) => !(entry.installationId === input.installationId && entry.accountId === input.accountId));
      state.activeAccounts = state.activeAccounts.filter((entry) => !(entry.installationId === input.installationId && entry.accountId === input.accountId));
      const changed = credentialCount !== state.credentials.length || flowCount !== state.pendingFlows.length;
      if (changed) await this.writeState(state);
      return changed;
    });
  }

  async deleteInstallation(installationId: string): Promise<boolean> {
    return this.enqueue(async () => {
      const state = await this.readState();
      const credentialCount = state.credentials.length;
      const flowCount = state.pendingFlows.length;
      state.credentials = state.credentials.filter((entry) => entry.installationId !== installationId);
      state.pendingFlows = state.pendingFlows.filter((entry) => entry.installationId !== installationId);
      state.activeAccounts = state.activeAccounts.filter((entry) => entry.installationId !== installationId);
      const changed = credentialCount !== state.credentials.length || flowCount !== state.pendingFlows.length;
      if (changed) await this.writeState(state);
      return changed;
    });
  }
}
