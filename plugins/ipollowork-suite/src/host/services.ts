/** Shared routing and local choices over the native credential store. */
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { AccountService } from "./account.ts";
import type { CredentialStore } from "../shared/types.ts";
import type {
  OfficialService,
  ServiceCatalog,
  ServiceChoice,
  ServiceCenter,
  ServiceBinding,
  PublicationInput,
} from "../shared/services.ts";
import { SuiteError } from "./errors.ts";
import { serviceCategories } from "../shared/service-categories.ts";
const KEY = "ipollowork-suite/services";
const choiceSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("own") }).strict(),
  z
    .object({
      source: z.literal("official"),
      serviceId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
    })
    .strict(),
]);
const serviceSchema = z.object({
  id: z.string(),
  title: z.string(),
  provider: z.string(),
  capabilities: z.array(z.string()),
  category: z.enum(serviceCategories).default("language"),
  vendor: z.string().optional(),
  origin: z.string().url(),
  basePath: z.string(),
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category: z.enum(serviceCategories).optional(),
      contextWindow: z.number().optional(),
      maxTokens: z.number().optional(),
    }),
  ),
  routes: z.array(
    z.object({ method: z.string(), path: z.string(), points: z.number() }),
  ),
  available: z.boolean(),
  enterprise: z
    .object({ id: z.string(), name: z.string() })
    .nullable()
    .default(null),
});
const catalogSchema = z.object({
  items: z.array(serviceSchema),
  points: z.number(),
});
export class Services implements ServiceCenter {
  get generation() {
    return this.account.generation;
  }
  modelStatus = "pending";
  modelError = "";
  constructor(
    private account: AccountService,
    private credentials: CredentialStore,
    private signal: AbortSignal,
    private enabled = true,
  ) {}
  async choices(): Promise<Record<string, ServiceChoice>> {
    const record = await this.credentials.readRecord(KEY);
    if (!record) return {};
    const value = record.payload;
    if (record.kind !== "grant" || !value || typeof value !== "object")
      throw new SuiteError("IPW_INVALID_SERVICE_CHOICES", 500);
    return z.record(z.string(), choiceSchema).parse(value);
  }
  async choose(provider: string, raw: unknown) {
    const choice = choiceSchema.parse(raw);
    if (
      !/^[a-z][a-z0-9-]{0,79}$/.test(provider) ||
      !choice ||
      !["own", "official"].includes(choice.source) ||
      (choice.source === "official" &&
        !/^[a-z][a-z0-9-]{0,79}$/.test(choice.serviceId))
    )
      throw new SuiteError("IPW_INVALID_INPUT");
    if (
      choice.source === "official" &&
      !(await this.catalog()).items.some(
        (s) =>
          s.provider === provider && s.id === choice.serviceId && s.available,
      )
    )
      throw new SuiteError("IPW_SERVICE_UNAVAILABLE", 409);
    await this.credentials.modifyRecord(KEY, async (current) => {
      const payload =
        current &&
        typeof current === "object" &&
        "payload" in current &&
        current.payload &&
        typeof current.payload === "object"
          ? current.payload
          : {};
      return { kind: "grant", payload: { ...payload, [provider]: choice } };
    });
  }
  async catalog(): Promise<ServiceCatalog> {
    if (!this.enabled) return { items: [], points: 0 };
    try {
      return catalogSchema.parse(
        await this.account.request("/api/v1/services"),
      );
    } catch (error) {
      if (
        error instanceof SuiteError &&
        (error.code === "IPW_SIGN_IN_REQUIRED" || error.status === 404)
      )
        return { items: [], points: 0 };
      throw error;
    }
  }
  async state() {
    return {
      catalog: await this.catalog(),
      choices: await this.choices(),
      models: { status: this.modelStatus, error: this.modelError },
    };
  }
  /** Freeze source selection for the complete caller operation. Never fall back after a routed failure. */
  async bind(signal?: AbortSignal): Promise<ServiceBinding> {
    const generation = this.account.generation;
    const choices = await this.choices();
    let loading: Promise<Map<string, OfficialService[]>> | undefined;
    const matches = (service: OfficialService, path: string, method: string) =>
      service.routes.some(
        (route) =>
          route.method === method &&
          new RegExp(
            "^" +
              route.path
                .split("/")
                .map((part) =>
                  part.startsWith(":")
                    ? "[A-Za-z0-9_-]+"
                    : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                )
                .join("/") +
              "$",
          ).test(path.split("?")[0]!),
      );
    const resolve = () =>
      (loading ??= (async () => {
        const catalog = await this.catalog(),
          entries = new Map<string, OfficialService[]>();
        for (const provider of new Set(
          catalog.items.map((service) => service.provider),
        )) {
          const group = catalog.items.filter(
            (service) => service.provider === provider,
          );
          const choice = choices[provider];
          if (choice?.source === "own") continue;
          const primary =
            choice?.source === "official"
              ? group.find((service) => service.id === choice.serviceId)
              : group.find((service) => service.available);
          if (primary)
            entries.set(provider, [
              primary,
              ...group.filter(
                (service) =>
                  service.id !== primary.id &&
                  !primary.enterprise &&
                  !service.enterprise &&
                  service.available,
              ),
            ]);
        }
        return entries;
      })());
    const invoke = async (
      service: OfficialService,
      path: string,
      request: Request,
    ) => {
      if (!service.available)
        throw new SuiteError("IPW_SERVICE_UNAVAILABLE", 403);
      const body =
        request.method === "GET"
          ? undefined
          : Buffer.from(await request.arrayBuffer()).toString("base64");
      if (generation !== this.account.generation)
        throw new SuiteError("IPW_ACCOUNT_CHANGED", 409);
      return this.account.execute(
        service.id,
        {
          requestId: randomUUID(),
          path,
          method: request.method,
          contentType: request.headers.get("content-type") ?? undefined,
          body,
        },
        AbortSignal.any([
          this.signal,
          ...(signal ? [signal] : []),
          request.signal,
        ]),
      );
    };
    return {
      ...(this.enabled && choices["aliyun-oss"]?.source !== "own"
        ? {
            publicationStatus: async () => {
              if (!this.enabled) return false;
              const status = z
                .object({ available: z.boolean() })
                .parse(
                  await this.account.request("/api/v1/publications/status"),
                );
              return status.available;
            },
            publish: async (input: PublicationInput) => {
              if (!this.enabled)
                throw new SuiteError("IPW_SIGN_IN_REQUIRED", 401);
              const active = AbortSignal.any([
                this.signal,
                ...(signal ? [signal] : []),
              ]);
              const check = () => {
                active.throwIfAborted();
                if (generation !== this.account.generation)
                  throw new SuiteError("IPW_ACCOUNT_CHANGED", 409);
              };
              check();
              const projects = z
                .object({
                  items: z.array(
                    z
                      .object({
                        id: z.string(),
                        native_id: z.string().nullable().optional(),
                      })
                      .passthrough(),
                  ),
                })
                .parse(await this.account.request("/api/v1/projects"));
              const project = projects.items.find(
                (item) => item.native_id === input.workspaceId,
              );
              const publication = z
                .object({ id: z.string() })
                .parse(
                  await this.account.request("/api/v1/publications", {
                    requestId: randomUUID(),
                    entry: input.entry,
                    projectId: project?.id,
                    files: input.files.map(({ path, bytes }) => ({
                      path,
                      bytes,
                    })),
                  }),
                );
              for (const file of input.files) {
                check();
                await this.account.uploadPublication(
                  publication.id,
                  file.path,
                  file.open(),
                  active,
                );
              }
              check();
              return z
                .object({ url: z.string().url() })
                .parse(
                  await this.account.request(
                    "/api/v1/publications/" + publication.id + "/publish",
                    {},
                  ),
                );
            },
          }
        : {}),
      official: async (provider, hasOwnKey = false) => {
        const choice = choices[provider];
        if (choice?.source === "own") return false;
        if (choice?.source !== "official" && hasOwnKey) return false;
        const service = (await resolve()).get(provider)?.[0];
        if (choice?.source === "official" && !service?.available)
          throw new SuiteError("IPW_SERVICE_UNAVAILABLE", 403);
        return Boolean(service?.available);
      },
      request: async (provider, path, init) => {
        if (!path.startsWith("/") || path.startsWith("//"))
          throw new SuiteError("IPW_INVALID_INPUT");
        const service = (await resolve())
          .get(provider)
          ?.find((service) => matches(service, path, init?.method ?? "GET"));
        if (!service) throw new SuiteError("IPW_SERVICE_UNAVAILABLE", 403);
        return invoke(
          service,
          path,
          new Request(service.origin + service.basePath + path, init),
        );
      },
      fetch: async (input, init) => {
        if (generation !== this.account.generation)
          throw new SuiteError("IPW_ACCOUNT_CHANGED", 409);
        const headers = new Headers(
          init?.headers ??
            (input instanceof Request ? input.headers : undefined),
        );
        if (
          ![...headers.values()].some((value) =>
            value.includes("ipollo-managed"),
          )
        )
          return fetch(input, init);
        const entries = await resolve(),
          url = new URL(input instanceof Request ? input.url : String(input));
        const service = [...entries.values()]
          .flat()
          .find(
            (s) =>
              s.origin === url.origin &&
              (url.pathname === s.basePath ||
                url.pathname.startsWith(s.basePath + "/")) &&
              matches(
                s,
                url.pathname.slice(s.basePath.length),
                init?.method ??
                  (input instanceof Request ? input.method : "GET"),
              ),
          );
        if (!service)
          throw new SuiteError("IPW_SERVICE_ENDPOINT_MISMATCH", 409);
        return invoke(
          service,
          url.pathname.slice(service.basePath.length) + url.search,
          new Request(input, init),
        );
      },
    };
  }
}
