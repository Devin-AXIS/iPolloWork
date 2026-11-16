import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { Store } from "./database.js";

/** Secrets are encrypted at rest and never included in public settings responses. */
export class Settings {
  private readonly key: Buffer;
  constructor(
    private store: Store,
    secret: string,
  ) {
    this.key = createHash("sha256").update(secret).digest();
  }
  async get(name: string): Promise<Record<string, string>> {
    const row = await this.store.one(
      "SELECT value FROM settings WHERE key=?",
      name,
    );
    if (!row) return {};
    const [iv, tag, body] = String(row.value).split(".");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(body, "base64url")),
        decipher.final(),
      ]).toString(),
    );
  }
  async set(name: string, value: Record<string, string>) {
    const merged = {
      ...(await this.get(name)),
      ...Object.fromEntries(Object.entries(value).filter(([, v]) => v !== "")),
    };
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([
      cipher.update(JSON.stringify(merged)),
      cipher.final(),
    ]);
    const payload = [iv, cipher.getAuthTag(), body]
      .map((v) => v.toString("base64url"))
      .join(".");
    await this.store.run(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      name,
      payload,
    );
  }
}
