import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

const credentialSchema = z.object({
  handle: z.string(),
  connectionId: z.string(),
  accountId: z.string(),
  methodId: z.string(),
  methodFingerprint: z.string(),
  values: z.record(z.string(), z.string()),
  secretFields: z.array(z.string()),
  updatedAt: z.number(),
});

const pendingFlowSchema = z.object({
  consumerId: z.string(),
  connectionId: z.string(),
  accountId: z.string(),
  methodId: z.string(),
  flowId: z.string(),
  state: z.string(),
  privateData: z.record(z.string(), z.unknown()),
  expiresAt: z.number(),
  createdAt: z.number(),
});

const selectionSchema = z.object({
  consumerId: z.string(),
  connectionId: z.string(),
  methodId: z.string(),
  accountId: z.string(),
});

const storeSchema = z.object({
  schemaVersion: z.literal(1),
  credentials: z.array(credentialSchema),
  pendingFlows: z.array(pendingFlowSchema),
  selections: z.array(selectionSchema),
});

const envelopeSchema = z.object({
  schemaVersion: z.literal(1),
  algorithm: z.literal("aes-256-gcm"),
  iv: z.string(),
  tag: z.string(),
  data: z.string(),
});

type StoreState = z.infer<typeof storeSchema>;

export type ConnectionStatus = {
  accountId: string;
  methodId: string;
  status: "connected";
  fields: Record<string, boolean>;
  updatedAt: number;
};

export type SavedCredential = {
  handle: string;
  status: ConnectionStatus;
};

export type ConsumedAuthorizationFlow = {
  consumerId: string;
  connectionId: string;
  accountId: string;
  methodId: string;
  flowId: string;
  state: string;
  privateData: Record<string, unknown>;
  expiresAt: number;
};

export type PendingAuthorizationFlowStatus = {
  accountId: string;
  methodId: string;
  flowId: string;
  status: "pending" | "expired";
  expiresAt: number;
};

export type AuthorizationCredentialScope = {
  connectionId: string;
  methodId: string;
  methodFingerprint: string;
};

function emptyState(): StoreState {
  return { schemaVersion: 1, credentials: [], pendingFlows: [], selections: [] };
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

function statusForCredential(credential: z.infer<typeof credentialSchema>): ConnectionStatus {
  return {
    accountId: credential.accountId,
    methodId: credential.methodId,
    status: "connected",
    fields: Object.fromEntries(Object.keys(credential.values).map((field) => [field, true])),
    updatedAt: credential.updatedAt,
  };
}

export class AuthorizationVault {
  private readonly filePath: string;
  private readonly encryptionKey: Buffer;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(input: { filePath: string; encryptionKey: Buffer }) {
    if (input.encryptionKey.byteLength !== 32) throw new Error("Authorization encryption key must contain 32 bytes");
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
    const temporaryPath = join(directory, `.authorization.${process.pid}.${randomUUID()}.tmp`);
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
    connectionId: string;
    accountId: string;
    methodId: string;
    methodFingerprint: string;
    values: Record<string, string>;
    secretFields: string[];
    now?: number;
  }): Promise<SavedCredential> {
    return this.enqueue(async () => {
      const state = await this.readState();
      const current = state.credentials.find((entry) =>
        entry.connectionId === input.connectionId && entry.accountId === input.accountId && entry.methodId === input.methodId
      );
      const credential = credentialSchema.parse({
        handle: current?.handle ?? `authorization_credential_${randomUUID()}`,
        connectionId: input.connectionId,
        accountId: input.accountId,
        methodId: input.methodId,
        methodFingerprint: input.methodFingerprint,
        values: input.values,
        secretFields: input.secretFields,
        updatedAt: input.now ?? Date.now(),
      });
      state.credentials = state.credentials.filter((entry) =>
        !(entry.connectionId === input.connectionId && entry.accountId === input.accountId && entry.methodId === input.methodId)
      );
      state.credentials.push(credential);
      await this.writeState(state);
      return { handle: credential.handle, status: statusForCredential(credential) };
    });
  }

  async listConnections(input: { connectionId: string; methodId: string; methodFingerprint: string }): Promise<ConnectionStatus[]> {
    await this.mutationQueue.catch(() => undefined);
    const state = await this.readState();
    return state.credentials
      .filter((entry) => entry.connectionId === input.connectionId && entry.methodId === input.methodId && entry.methodFingerprint === input.methodFingerprint)
      .sort((left, right) => left.accountId.localeCompare(right.accountId))
      .map(statusForCredential);
  }

  async setActiveAccount(input: { consumerId: string; connectionId: string; methodId: string; methodFingerprint: string; accountId: string }): Promise<boolean> {
    return this.enqueue(async () => {
      const state = await this.readState();
      const exists = state.credentials.some((entry) =>
        entry.connectionId === input.connectionId && entry.methodId === input.methodId && entry.methodFingerprint === input.methodFingerprint && entry.accountId === input.accountId
      );
      if (!exists) return false;
      const current = state.selections.find((entry) => entry.consumerId === input.consumerId && entry.methodId === input.methodId);
      if (current?.accountId === input.accountId) return true;
      state.selections = state.selections.filter((entry) => !(entry.consumerId === input.consumerId && entry.methodId === input.methodId));
      state.selections.push({ consumerId: input.consumerId, connectionId: input.connectionId, methodId: input.methodId, accountId: input.accountId });
      await this.writeState(state);
      return true;
    });
  }

  async readActiveCredential(input: { consumerId: string; connectionId: string; methodId: string; methodFingerprint: string }): Promise<{ accountId: string; values: Record<string, string> } | null> {
    await this.mutationQueue.catch(() => undefined);
    const state = await this.readState();
    const selected = state.selections.find((entry) => entry.consumerId === input.consumerId && entry.methodId === input.methodId && entry.connectionId === input.connectionId)?.accountId;
    const candidates = state.credentials
      .filter((entry) => entry.connectionId === input.connectionId && entry.methodId === input.methodId && entry.methodFingerprint === input.methodFingerprint)
      .sort((left, right) => left.accountId.localeCompare(right.accountId));
    const credential = candidates.find((entry) => entry.accountId === selected) ?? candidates[0];
    return credential ? { accountId: credential.accountId, values: { ...credential.values } } : null;
  }

  async readActiveCredentialForConsumer(input: { consumerId: string; methodId: string; methodFingerprint: string }): Promise<{ connectionId: string; accountId: string; values: Record<string, string> } | null> {
    await this.mutationQueue.catch(() => undefined);
    const state = await this.readState();
    const selected = state.selections.find((entry) => entry.consumerId === input.consumerId && entry.methodId === input.methodId);
    if (!selected) return null;
    const credential = state.credentials.find((entry) =>
      entry.connectionId === selected.connectionId && entry.accountId === selected.accountId && entry.methodId === input.methodId && entry.methodFingerprint === input.methodFingerprint
    );
    return credential ? { connectionId: credential.connectionId, accountId: credential.accountId, values: { ...credential.values } } : null;
  }

  async retainMethods(consumerId: string, methods: ReadonlyMap<string, string>): Promise<number> {
    return this.enqueue(async () => {
      const state = await this.readState();
      const beforeFlows = state.pendingFlows.length;
      const beforeSelections = state.selections.length;
      state.pendingFlows = state.pendingFlows.filter((entry) => entry.consumerId !== consumerId || methods.get(entry.methodId) === entry.connectionId);
      state.selections = state.selections.filter((entry) => entry.consumerId !== consumerId || methods.get(entry.methodId) === entry.connectionId);
      const removed = beforeFlows - state.pendingFlows.length + beforeSelections - state.selections.length;
      if (removed) await this.writeState(state);
      return removed;
    });
  }

  async readCredential(input: { consumerId: string; handle: string }): Promise<Record<string, string> | null> {
    await this.mutationQueue.catch(() => undefined);
    const state = await this.readState();
    const allowedConnections = new Set(state.selections.filter((entry) => entry.consumerId === input.consumerId).map((entry) => entry.connectionId));
    const credential = state.credentials.find((entry) => allowedConnections.has(entry.connectionId) && entry.handle === input.handle);
    return credential ? { ...credential.values } : null;
  }

  async readCredentialForAccount(input: { connectionId: string; accountId: string; methodId: string; methodFingerprint: string }): Promise<Record<string, string> | null> {
    await this.mutationQueue.catch(() => undefined);
    const state = await this.readState();
    const credential = state.credentials.find((entry) =>
      entry.connectionId === input.connectionId && entry.accountId === input.accountId && entry.methodId === input.methodId && entry.methodFingerprint === input.methodFingerprint
    );
    return credential ? { ...credential.values } : null;
  }

  async savePendingFlow(input: {
    consumerId: string;
    connectionId: string;
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
        !(entry.consumerId === input.consumerId && (entry.flowId === input.flowId || entry.state === input.state))
      );
      current.pendingFlows.push(flow);
      await this.writeState(current);
    });
  }

  async consumePendingFlow(input: { consumerId: string; state: string; now?: number }): Promise<ConsumedAuthorizationFlow | null> {
    return this.enqueue(async () => {
      const now = input.now ?? Date.now();
      const current = await this.readState();
      const flow = current.pendingFlows.find((entry) =>
        entry.consumerId === input.consumerId && entry.state === input.state && entry.expiresAt > now
      );
      const nextFlows = current.pendingFlows.filter((entry) => entry.expiresAt > now && entry !== flow);
      if (nextFlows.length !== current.pendingFlows.length) {
        current.pendingFlows = nextFlows;
        await this.writeState(current);
      }
      if (!flow) return null;
      return {
        consumerId: flow.consumerId,
        connectionId: flow.connectionId,
        accountId: flow.accountId,
        methodId: flow.methodId,
        flowId: flow.flowId,
        state: flow.state,
        privateData: { ...flow.privateData },
        expiresAt: flow.expiresAt,
      };
    });
  }

  async consumePendingFlowByState(state: string, now = Date.now()): Promise<ConsumedAuthorizationFlow | null> {
    return this.enqueue(async () => {
      const current = await this.readState();
      const flow = current.pendingFlows.find((entry) => entry.state === state && entry.expiresAt > now);
      const nextFlows = current.pendingFlows.filter((entry) => entry.expiresAt > now && entry !== flow);
      if (nextFlows.length !== current.pendingFlows.length) {
        current.pendingFlows = nextFlows;
        await this.writeState(current);
      }
      if (!flow) return null;
      return {
        consumerId: flow.consumerId,
        connectionId: flow.connectionId,
        accountId: flow.accountId,
        methodId: flow.methodId,
        flowId: flow.flowId,
        state: flow.state,
        privateData: { ...flow.privateData },
        expiresAt: flow.expiresAt,
      };
    });
  }

  async readPendingFlow(input: { consumerId: string; flowId: string; now?: number }): Promise<ConsumedAuthorizationFlow | null> {
    await this.mutationQueue.catch(() => undefined);
    const now = input.now ?? Date.now();
    const current = await this.readState();
    const flow = current.pendingFlows.find((entry) =>
      entry.consumerId === input.consumerId && entry.flowId === input.flowId && entry.expiresAt > now
    );
    if (!flow) return null;
    return {
      consumerId: flow.consumerId,
      connectionId: flow.connectionId,
      accountId: flow.accountId,
      methodId: flow.methodId,
      flowId: flow.flowId,
      state: flow.state,
      privateData: { ...flow.privateData },
      expiresAt: flow.expiresAt,
    };
  }

  async listPendingFlows(consumerId: string, now = Date.now()): Promise<PendingAuthorizationFlowStatus[]> {
    await this.mutationQueue.catch(() => undefined);
    const current = await this.readState();
    return current.pendingFlows
      .filter((entry) => entry.consumerId === consumerId)
      .map((entry) => ({
        accountId: entry.accountId,
        methodId: entry.methodId,
        flowId: entry.flowId,
        status: entry.expiresAt > now ? "pending" : "expired",
        expiresAt: entry.expiresAt,
      }));
  }

  async cancelPendingFlow(input: { consumerId: string; flowId: string }): Promise<boolean> {
    return this.enqueue(async () => {
      const state = await this.readState();
      const count = state.pendingFlows.length;
      state.pendingFlows = state.pendingFlows.filter((entry) =>
        !(entry.consumerId === input.consumerId && entry.flowId === input.flowId)
      );
      const changed = count !== state.pendingFlows.length;
      if (changed) await this.writeState(state);
      return changed;
    });
  }

  async revokeAccount(input: { connectionId: string; accountId: string }): Promise<boolean> {
    return this.enqueue(async () => {
      const state = await this.readState();
      const credentialCount = state.credentials.length;
      const selectionCount = state.selections.length;
      state.credentials = state.credentials.filter((entry) => !(entry.connectionId === input.connectionId && entry.accountId === input.accountId));
      state.selections = state.selections.filter((entry) => !(entry.connectionId === input.connectionId && entry.accountId === input.accountId));
      const changed = credentialCount !== state.credentials.length || selectionCount !== state.selections.length;
      if (changed) await this.writeState(state);
      return changed;
    });
  }

  async revokeCredential(input: { connectionId: string; accountId: string; methodId: string }): Promise<boolean> {
    return this.enqueue(async () => {
      const state = await this.readState();
      const credentialCount = state.credentials.length;
      state.credentials = state.credentials.filter((entry) =>
        !(entry.connectionId === input.connectionId && entry.accountId === input.accountId && entry.methodId === input.methodId)
      );
      state.selections = state.selections.filter((entry) =>
        !(entry.connectionId === input.connectionId && entry.accountId === input.accountId && entry.methodId === input.methodId)
      );
      const changed = credentialCount !== state.credentials.length;
      if (changed) await this.writeState(state);
      return changed;
    });
  }

  async deleteConsumer(
    consumerId: string,
    pruneCredentialScopes: readonly AuthorizationCredentialScope[] = [],
  ): Promise<boolean> {
    return this.enqueue(async () => {
      const state = await this.readState();
      const flowCount = state.pendingFlows.length;
      const selectionCount = state.selections.length;
      state.pendingFlows = state.pendingFlows.filter((entry) => entry.consumerId !== consumerId);
      state.selections = state.selections.filter((entry) => entry.consumerId !== consumerId);
      const credentialCount = state.credentials.length;
      state.credentials = state.credentials.filter((credential) => {
        const shouldPrune = pruneCredentialScopes.some((scope) =>
          scope.connectionId === credential.connectionId
          && scope.methodId === credential.methodId
          && scope.methodFingerprint === credential.methodFingerprint
        );
        if (!shouldPrune) return true;
        return state.selections.some((selection) =>
          selection.connectionId === credential.connectionId && selection.methodId === credential.methodId
        ) || state.pendingFlows.some((flow) =>
          flow.connectionId === credential.connectionId && flow.methodId === credential.methodId
        );
      });
      const changed = flowCount !== state.pendingFlows.length
        || selectionCount !== state.selections.length
        || credentialCount !== state.credentials.length;
      if (changed) await this.writeState(state);
      return changed;
    });
  }

  async mergeConsumers(targetConsumerId: string, sourceConsumerIds: readonly string[]): Promise<number> {
    return this.enqueue(async () => {
      const sources = new Set(sourceConsumerIds.filter((consumerId) => consumerId !== targetConsumerId));
      if (sources.size === 0) return 0;
      const state = await this.readState();
      let changed = 0;
      const selections = state.selections.filter((entry) => entry.consumerId === targetConsumerId);
      for (const selection of state.selections) {
        if (!sources.has(selection.consumerId)) continue;
        changed += 1;
        if (!selections.some((entry) => entry.connectionId === selection.connectionId && entry.methodId === selection.methodId)) {
          selections.push({ ...selection, consumerId: targetConsumerId });
        }
      }
      state.selections = [
        ...state.selections.filter((entry) => entry.consumerId !== targetConsumerId && !sources.has(entry.consumerId)),
        ...selections,
      ];

      const pendingFlows = state.pendingFlows.filter((entry) => entry.consumerId === targetConsumerId);
      for (const flow of state.pendingFlows) {
        if (!sources.has(flow.consumerId)) continue;
        changed += 1;
        if (!pendingFlows.some((entry) => entry.flowId === flow.flowId || entry.state === flow.state)) {
          pendingFlows.push({ ...flow, consumerId: targetConsumerId });
        }
      }
      state.pendingFlows = [
        ...state.pendingFlows.filter((entry) => entry.consumerId !== targetConsumerId && !sources.has(entry.consumerId)),
        ...pendingFlows,
      ];
      if (changed > 0) await this.writeState(state);
      return changed;
    });
  }
}
