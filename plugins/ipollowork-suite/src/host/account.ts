/** iPollo Better Auth adapter. Durable session tokens remain in DSH's credential provider. */
import type {
  AccountState,
  AccountUser,
  CredentialStore,
} from "../shared/types.ts";
import type { ResolvedConfig } from "./config.ts";
import { SuiteError } from "./errors.ts";

const KEY = "ipollowork-suite/account";
type Grant = { version: 1; origin: string; token: string };
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Bounded JSON reader shared by the upstream account calls. */
export async function readJson(
  response: Response,
  maximum: number,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new SuiteError("IPW_INVALID_RESPONSE", 502);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new SuiteError("IPW_RESPONSE_TOO_LARGE", 502);
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (cause) {
      throw new SuiteError("IPW_INVALID_RESPONSE", 502, { cause });
    }
  } finally {
    reader.releaseLock();
  }
}
function userOf(value: unknown): AccountUser {
  if (
    !object(value) ||
    typeof value.id !== "string" ||
    typeof value.email !== "string"
  )
    throw new SuiteError("IPW_INVALID_RESPONSE", 502);
  return {
    id: value.id,
    email: value.email,
    name: typeof value.name === "string" ? value.name : "",
  };
}
export class AccountService {
  private revision = 0;
  get generation() {
    return this.revision;
  }
  constructor(
    private credentials: CredentialStore,
    private config: ResolvedConfig,
    private signal: AbortSignal,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async send(
    path: string,
    token?: string,
    body?: unknown,
    method?: string,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(this.config.accountOrigin + path, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        redirect: "error",
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        signal: AbortSignal.any([
          this.signal,
          AbortSignal.timeout(this.config.requestTimeoutMs),
        ]),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      throw new SuiteError("IPW_ACCOUNT_UNAVAILABLE", 502, { cause });
    }
    if (!response.ok) {
      if (path.startsWith("/api/v1/")) {
        const data = await readJson(response, this.config.maxResponseBytes);
        const code =
          object(data) &&
          typeof data.code === "string" &&
          /^[A-Z_]+$/.test(data.code)
            ? data.code
            : "IPW_ACCOUNT_UNAVAILABLE";
        throw new SuiteError(code, response.status);
      }
      await response.body?.cancel();
      if (
        path === "/api/auth/sign-up/email" &&
        [400, 409, 422].includes(response.status)
      )
        throw new SuiteError("IPW_REGISTRATION_REJECTED", 400);
      throw new SuiteError(
        response.status === 401 || response.status === 403
          ? "IPW_SIGN_IN_REQUIRED"
          : "IPW_ACCOUNT_UNAVAILABLE",
        response.status === 401 || response.status === 403 ? 401 : 502,
      );
    }
    return readJson(response, this.config.maxResponseBytes);
  }
  /** Call an account-owned business endpoint with the saved, origin-bound grant. */
  async request(
    path: string,
    body?: unknown,
    method?: string,
  ): Promise<unknown> {
    const grant = await this.grant();
    if (!grant) throw new SuiteError("IPW_SIGN_IN_REQUIRED", 401);
    return this.send(path, grant.token, body, method);
  }
  /** Stream a project file without buffering it or exposing the account token. */
  async uploadProject(
    projectId: string,
    metadata: string,
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const revision = this.revision,
      grant = await this.grant();
    if (!grant) throw new SuiteError("IPW_SIGN_IN_REQUIRED", 401);
    if (revision !== this.revision)
      throw new SuiteError("IPW_ACCOUNT_CHANGED", 409);
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      duplex: "half",
      redirect: "error",
      body,
      headers: {
        Authorization: `Bearer ${grant.token}`,
        "Content-Type": "application/octet-stream",
        "x-ipw-artifact": metadata,
      },
      signal: AbortSignal.any([
        this.signal,
        signal,
        AbortSignal.timeout(this.config.uploadTimeoutMs),
      ]),
    };
    const response = await this.fetcher(
      this.config.accountOrigin +
        "/api/v1/projects/" +
        encodeURIComponent(projectId) +
        "/artifacts/upload",
      init,
    );
    const value = await readJson(response, this.config.maxResponseBytes);
    if (!response.ok)
      throw new SuiteError(
        object(value) && typeof value.code === "string"
          ? value.code
          : "IPW_FILE_TRANSFER_FAILED",
        response.status,
      );
    return value;
  }
  /** Transfer selected files through the Host; credentials never reach the browser. */
  async transfer(path: string, form?: FormData): Promise<Response> {
    const revision = this.revision;
    const grant = await this.grant();
    if (revision !== this.revision)
      throw new SuiteError("IPW_ACCOUNT_CHANGED", 409);
    if (!grant) throw new SuiteError("IPW_SIGN_IN_REQUIRED", 401);
    const response = await this.fetcher(this.config.accountOrigin + path, {
      method: form ? "POST" : "GET",
      redirect: "error",
      headers: { Authorization: `Bearer ${grant.token}` },
      signal: AbortSignal.any([
        this.signal,
        AbortSignal.timeout(this.config.uploadTimeoutMs),
      ]),
      ...(form ? { body: form } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new SuiteError("IPW_FILE_TRANSFER_FAILED", response.status);
    }
    return response;
  }
  /** Execute an authenticated service request without exposing the account grant. */
  async execute(
    id: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<Response> {
    const revision = this.revision;
    const grant = await this.grant();
    if (revision !== this.revision)
      throw new SuiteError("IPW_ACCOUNT_CHANGED", 409);
    if (!grant) throw new SuiteError("IPW_SIGN_IN_REQUIRED", 401);
    const response = await this.fetcher(
      this.config.accountOrigin +
        "/api/v1/services/" +
        encodeURIComponent(id) +
        "/invoke",
      {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: "Bearer " + grant.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
        signal: AbortSignal.any([this.signal, signal]),
      },
    );
    if (!response.ok) {
      const data = await readJson(response, this.config.maxResponseBytes);
      const code =
        object(data) && typeof data.code === "string"
          ? data.code
          : "IPW_SERVICE_UNAVAILABLE";
      throw new SuiteError(code, response.status);
    }
    return response;
  }
  private async grant(): Promise<Grant | undefined> {
    const record = await this.credentials.readRecord(KEY);
    if (!record) return undefined;
    const value = record.payload;
    if (
      record.kind !== "grant" ||
      !object(value) ||
      value.version !== 1 ||
      typeof value.origin !== "string" ||
      typeof value.token !== "string"
    )
      throw new SuiteError("IPW_INVALID_SAVED_ACCOUNT", 500);
    if (value.origin !== this.config.accountOrigin) return undefined;
    return { version: 1, origin: value.origin, token: value.token };
  }
  /** Return only account identity and points; never the token or upstream session. */
  async state(): Promise<AccountState> {
    const grant = await this.grant();
    if (!grant)
      return { status: "anonymous", origin: this.config.accountOrigin };
    let session: unknown;
    try {
      session = await this.send("/api/auth/get-session", grant.token);
    } catch (error) {
      if (error instanceof SuiteError && error.status === 401)
        return { status: "anonymous", origin: this.config.accountOrigin };
      throw error;
    }
    if (session === null)
      return { status: "anonymous", origin: this.config.accountOrigin };
    if (!object(session)) throw new SuiteError("IPW_INVALID_RESPONSE", 502);
    const user = userOf(session.user);
    let points: number | null = null;
    try {
      const summary = await this.send("/api/v1/me/summary", grant.token);
      if (
        object(summary) &&
        object(summary.points) &&
        typeof summary.points.balance === "number" &&
        Number.isFinite(summary.points.balance)
      )
        points = summary.points.balance;
    } catch (error) {
      // The identity service can be available while the optional points service is unavailable.
      if (!(error instanceof SuiteError)) throw error;
    }
    return {
      status: "signed-in",
      origin: this.config.accountOrigin,
      user,
      points,
      balanceStatus: points === null ? "unavailable" : "available",
    };
  }
  /** Authenticate with the configured service; a concurrent sign-out supersedes the result. */
  async signIn(input: unknown): Promise<AccountState> {
    if (
      !object(input) ||
      typeof input.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
      input.email.length > 254 ||
      typeof input.password !== "string" ||
      !input.password ||
      input.password.length > 1024
    )
      throw new SuiteError("IPW_INVALID_LOGIN");
    return this.authenticate("/api/auth/sign-in/email", {
      email: input.email.trim(),
      password: input.password,
    });
  }
  /** Register through the configured service and persist only its verified session grant. */
  async signUp(input: unknown): Promise<AccountState> {
    if (
      !object(input) ||
      typeof input.name !== "string" ||
      !input.name.trim() ||
      input.name.trim().length > 120 ||
      typeof input.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
      input.email.length > 254 ||
      typeof input.password !== "string" ||
      input.password.length < 10 ||
      input.password.length > 1024
    )
      throw new SuiteError("IPW_REGISTRATION_REJECTED");
    return this.authenticate("/api/auth/sign-up/email", {
      name: input.name.trim(),
      email: input.email.trim(),
      password: input.password,
    });
  }
  private async authenticate(
    path: string,
    input: { email: string; password: string; name?: string },
  ): Promise<AccountState> {
    const revision = ++this.revision;
    const result = await this.send(path, undefined, input);
    if (!object(result) || typeof result.token !== "string" || !result.token)
      throw new SuiteError("IPW_INVALID_RESPONSE", 502);
    const session = await this.send("/api/auth/get-session", result.token);
    if (!object(session)) throw new SuiteError("IPW_INVALID_RESPONSE", 502);
    userOf(session.user);
    if (revision !== this.revision || this.signal.aborted)
      throw new SuiteError("IPW_LOGIN_CANCELLED", 409);
    const grant: Grant = {
      version: 1,
      origin: this.config.accountOrigin,
      token: result.token,
    };
    await this.credentials.modifyRecord(KEY, async () => {
      if (revision !== this.revision || this.signal.aborted)
        throw new SuiteError("IPW_LOGIN_CANCELLED", 409);
      return { kind: "grant", payload: grant };
    });
    return this.state();
  }
  /** Disconnect only this suite's local account. DSH provider credentials are untouched. */
  async signOut(): Promise<AccountState> {
    ++this.revision;
    await this.credentials.deleteRecord(KEY);
    return { status: "anonymous", origin: this.config.accountOrigin };
  }
}
