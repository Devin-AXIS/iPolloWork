import { ApiError } from "../errors.js";
import type { AuthMode } from "../routes/registry.js";
import type { TokenScope } from "../types.js";
import {
  defaultScopeForEffect,
  type ApiEffect,
  type ApiOperation,
  type ApiResponseSpec,
  type JsonSchema,
  type RegisteredApiModule,
} from "./module.js";

/**
 * OpenAPI generation from the module declarations.
 *
 * The declaration in `module.ts` is the single source of truth for the route table, so it
 * is also the single source of truth for the published document: everything here is
 * derived, nothing is hand-maintained, and the two therefore cannot drift.
 *
 * The output is a pure function of its input — no timestamps, no environment lookups, no
 * iteration over unordered maps. `buildOpenApiDocument(x)` twice produces byte-identical
 * JSON, so the spec can be committed and a diff in CI means the API actually changed.
 */

export const OPENAPI_VERSION = "3.1.0";
export const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

/** Name of the single security scheme. Bearer tokens are the only client credential. */
export const SECURITY_SCHEME_NAME = "bearerAuth";

export const API_ERROR_SCHEMA_NAME = "ApiError";
export const API_ERROR_SCHEMA_REF = `#/components/schemas/${API_ERROR_SCHEMA_NAME}`;

export interface BuildOpenApiDocumentInput {
  operations: ApiOperation[];
  modules: RegisteredApiModule[];
  serverVersion: string;
  /** Defaults to `iPolloWork Server API`. */
  title?: string;
  /** Replaces the generated top-level description. */
  description?: string;
}

export type OpenApiDocument = Record<string, unknown>;

/** OpenAPI renders the methods of a path in this order; fixing it keeps diffs small. */
const METHOD_ORDER = ["get", "put", "post", "delete", "patch"] as const;

const SCOPE_RANK: Record<TokenScope, number> = { viewer: 0, collaborator: 1, owner: 2 };

const SCOPE_DESCRIPTIONS: ReadonlyArray<readonly [TokenScope, string]> = [
  ["viewer", "read-only access to the workspaces the token is scoped to"],
  ["collaborator", "everything `viewer` allows, plus write and destructive operations"],
  ["owner", "everything `collaborator` allows, plus host-level administration"],
];

/** Standard error responses, keyed by status. Emitted into `components.responses`. */
const ERROR_RESPONSES: ReadonlyArray<{ status: number; name: string; description: string }> = [
  {
    status: 400,
    name: "BadRequest",
    description: "The request was malformed: an unparsable body, a missing required field, or an unusable parameter.",
  },
  {
    status: 401,
    name: "Unauthorized",
    description: "The bearer token is missing, unknown, or revoked.",
  },
  {
    status: 403,
    name: "Forbidden",
    description:
      "The token scope is insufficient for this operation, or the server runs read-only (`read_only`) and the operation writes.",
  },
  {
    status: 404,
    name: "NotFound",
    description: "The addressed resource does not exist, or the token cannot see it.",
  },
  {
    status: 500,
    name: "InternalServerError",
    description: "Unexpected server error (`internal_error`).",
  },
];

const ERROR_RESPONSE_BY_STATUS = new Map(ERROR_RESPONSES.map((entry) => [entry.status, entry]));

/** Converts `addRoute` path syntax (`/a/:id`) to OpenAPI path syntax (`/a/{id}`). */
export function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

/** Path parameter names in the order they appear, deduplicated. */
export function extractPathParameterNames(path: string): string[] {
  const names: string[] = [];
  const pattern = /:([A-Za-z0-9_]+)/g;
  let match: RegExpExecArray | null = pattern.exec(path);
  while (match) {
    const name = match[1] as string;
    if (!names.includes(name)) names.push(name);
    match = pattern.exec(path);
  }
  return names;
}

export function buildOpenApiDocument(input: BuildOpenApiDocumentInput): OpenApiDocument {
  const moduleByOperationId = new Map<string, RegisteredApiModule>();
  for (const registered of input.modules) {
    for (const operation of registered.operations) {
      moduleByOperationId.set(operation.operationId, registered);
    }
  }

  const documented = input.operations.filter((operation) => operation.internal !== true);

  // Group by OpenAPI path, then order paths lexicographically and methods by METHOD_ORDER.
  // Both inputs are arrays, so nothing here depends on object iteration order.
  const byPath = new Map<string, Map<string, unknown>>();
  const usedTags = new Set<string>();

  for (const operation of documented) {
    const openApiPath = toOpenApiPath(operation.path);
    const registered = moduleByOperationId.get(operation.operationId);
    if (registered) usedTags.add(registered.module.id);
    let methods = byPath.get(openApiPath);
    if (!methods) {
      methods = new Map<string, unknown>();
      byPath.set(openApiPath, methods);
    }
    methods.set(operation.method.toLowerCase(), buildOperationObject(operation, registered));
  }

  const paths: Record<string, unknown> = {};
  for (const openApiPath of [...byPath.keys()].sort()) {
    const methods = byPath.get(openApiPath) as Map<string, unknown>;
    const item: Record<string, unknown> = {};
    for (const method of METHOD_ORDER) {
      const operation = methods.get(method);
      if (operation !== undefined) item[method] = operation;
    }
    // Anything outside the canonical list (there is nothing today) still gets emitted,
    // sorted, rather than silently dropped.
    for (const method of [...methods.keys()].sort()) {
      if (!(method in item)) item[method] = methods.get(method);
    }
    paths[openApiPath] = item;
  }

  const tags = input.modules
    .filter((registered) => usedTags.has(registered.module.id))
    .map((registered) => ({
      name: registered.module.id,
      description: registered.module.description,
      "x-ipollowork-title": registered.module.title,
      "x-ipollowork-version": registered.module.version,
      "x-ipollowork-stability": registered.module.stability,
      "x-ipollowork-depends-on": [...(registered.module.dependsOn ?? [])],
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    openapi: OPENAPI_VERSION,
    jsonSchemaDialect: JSON_SCHEMA_DIALECT,
    info: {
      title: input.title ?? "iPolloWork Server API",
      version: input.serverVersion,
      description: input.description ?? defaultDescription(),
    },
    servers: [{ url: "/", description: "The iPolloWork server this document was served from." }],
    security: [{ [SECURITY_SCHEME_NAME]: [] }],
    tags,
    paths,
    components: buildComponents(),
  };
}

function defaultDescription(): string {
  const scopes = SCOPE_DESCRIPTIONS.map(([scope, text]) => `- \`${scope}\`: ${text}`).join("\n");
  return [
    "Generated from the API module declarations. Every operation below is registered from the",
    "same declaration that produces the live route table, so this document cannot drift from",
    "the running server.",
    "",
    "Authentication is a bearer token. Three token scopes exist, each a superset of the one above it:",
    "",
    scopes,
    "",
    "Each operation documents the minimum scope it requires. Write and destructive operations are",
    "additionally rejected with `403 read_only` when the server runs read-only.",
  ].join("\n");
}

function buildOperationObject(operation: ApiOperation, registered: RegisteredApiModule | undefined): Record<string, unknown> {
  const auth: AuthMode = operation.auth ?? "client";
  const scope = operation.scope ?? defaultScopeForEffect(operation.effect);
  const pathParameterNames = extractPathParameterNames(operation.path);
  const parameters = [
    ...buildPathParameters(pathParameterNames, operation.pathParams),
    ...buildQueryParameters(operation.query),
  ];

  const result: Record<string, unknown> = {
    operationId: operation.operationId,
    summary: operation.summary,
    description: buildOperationDescription(operation, auth, scope),
  };

  if (registered) result.tags = [registered.module.id];
  if (operation.deprecated === true) result.deprecated = true;
  if (parameters.length > 0) result.parameters = parameters;

  if (operation.requestBody) {
    result.requestBody = {
      // A body whose every field is optional is itself optional — `createSession` and
      // `cancelTask` both work with no body at all. Marking those `required` would make a
      // generated client demand an argument the server does not need.
      required: hasRequiredFields(operation.requestBody),
      content: { "application/json": { schema: cloneJsonSchema(operation.requestBody, operation.operationId) } },
    };
  }

  result.responses = buildResponses(operation, auth, parameters.length > 0);
  result.security = auth === "none" ? [] : [{ [SECURITY_SCHEME_NAME]: [] }];

  result["x-ipollowork-module"] = registered ? registered.module.id : null;
  result["x-ipollowork-effect"] = operation.effect;
  result["x-ipollowork-auth"] = auth;
  result["x-ipollowork-scope"] = auth === "client" ? scope : null;
  if (operation.streaming) result["x-ipollowork-streaming"] = operation.streaming;

  return result;
}

function buildOperationDescription(operation: ApiOperation, auth: AuthMode, scope: TokenScope): string {
  const lines: string[] = [];
  const declared = operation.description?.trim();
  if (declared) lines.push(declared);

  if (auth === "none") {
    lines.push("Authentication: none. This operation is reachable without a token.");
  } else if (auth === "client") {
    const suffix = SCOPE_RANK[scope] < SCOPE_RANK.owner ? " or higher" : "";
    lines.push(`Authentication: bearer token. Minimum scope: \`${scope}\`${suffix}.`);
  } else {
    lines.push(
      `Authentication: host credentials (\`${auth}\`) — the \`x-ipollowork-host-token\` header or an \`owner\` bearer token. Client token scopes do not apply.`,
    );
  }

  lines.push(effectSentence(operation.effect));

  if (operation.streaming === "sse") {
    lines.push(
      "Streams `text/event-stream`. Each frame carries an `event`, a JSON `data` payload, and an `id` that is the cursor to resume from.",
    );
  }

  return lines.join("\n\n");
}

function effectSentence(effect: ApiEffect): string {
  if (effect === "read") return "Effect: `read`. The operation does not modify server state.";
  if (effect === "write") {
    return "Effect: `write`. Rejected with `403 read_only` when the server runs read-only.";
  }
  return "Effect: `destructive`. Removes or overwrites state, and is rejected with `403 read_only` when the server runs read-only.";
}

function buildPathParameters(names: string[], pathParams: JsonSchema | undefined): Record<string, unknown>[] {
  const properties = schemaProperties(pathParams);
  return names.map((name) => {
    const declared = properties?.[name];
    const parameter: Record<string, unknown> = {
      name,
      in: "path",
      // A path parameter is part of the route pattern, so it is always required.
      required: true,
    };
    const description = declared && typeof declared.description === "string" ? declared.description : undefined;
    if (description) parameter.description = description;
    parameter.schema = declared ? cloneJsonSchema(declared, name) : { type: "string" };
    return parameter;
  });
}

function buildQueryParameters(query: JsonSchema | undefined): Record<string, unknown>[] {
  const properties = schemaProperties(query);
  if (!properties) return [];
  const required = new Set(
    Array.isArray(query?.required) ? (query.required as unknown[]).filter((entry): entry is string => typeof entry === "string") : [],
  );
  // Declared property order, not `Object.keys` of a mutated object: the schema literal in
  // the module declaration is static, so this is stable across builds.
  return Object.keys(properties).map((name) => {
    const declared = properties[name] as Record<string, unknown>;
    const parameter: Record<string, unknown> = {
      name,
      in: "query",
      required: required.has(name),
    };
    if (typeof declared.description === "string") parameter.description = declared.description;
    parameter.schema = cloneJsonSchema(declared, name);
    return parameter;
  });
}

function schemaProperties(schema: JsonSchema | undefined): Record<string, Record<string, unknown>> | null {
  if (!schema || typeof schema !== "object") return null;
  const properties = (schema as Record<string, unknown>).properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return null;
  return properties as Record<string, Record<string, unknown>>;
}

function buildResponses(operation: ApiOperation, auth: AuthMode, hasParameters: boolean): Record<string, unknown> {
  const entries = new Map<number, unknown>();

  for (const [status, spec] of Object.entries(operation.responses ?? {})) {
    entries.set(Number(status), buildResponseObject(spec, operation, Number(status)));
  }

  if (![...entries.keys()].some((status) => status < 400)) {
    entries.set(200, defaultSuccessResponse(operation));
  }

  for (const status of applicableErrorStatuses(operation, auth, hasParameters)) {
    if (entries.has(status)) continue;
    const error = ERROR_RESPONSE_BY_STATUS.get(status);
    if (!error) continue;
    entries.set(status, { $ref: `#/components/responses/${error.name}` });
  }

  const responses: Record<string, unknown> = {};
  for (const status of [...entries.keys()].sort((a, b) => a - b)) {
    responses[String(status)] = entries.get(status);
  }
  return responses;
}

function applicableErrorStatuses(operation: ApiOperation, auth: AuthMode, hasParameters: boolean): number[] {
  const statuses: number[] = [];
  if (operation.requestBody || hasParameters) statuses.push(400);
  if (auth !== "none") {
    statuses.push(401);
    statuses.push(403);
  } else if (operation.effect !== "read") {
    // Unauthenticated writes still hit the read-only gate.
    statuses.push(403);
  }
  if (extractPathParameterNames(operation.path).length > 0) statuses.push(404);
  statuses.push(500);
  return statuses;
}

function defaultSuccessResponse(operation: ApiOperation): Record<string, unknown> {
  if (operation.streaming === "sse") {
    return {
      description: "An open `text/event-stream` connection.",
      content: {
        "text/event-stream": {
          schema: {
            type: "string",
            description: "A sequence of SSE frames: `id: <cursor>`, `event: <type>`, `data: <json>`.",
          },
        },
      },
    };
  }
  return {
    description: "Success.",
    content: { "application/json": { schema: {} } },
  };
}

function buildResponseObject(spec: ApiResponseSpec, operation: ApiOperation, status: number): Record<string, unknown> {
  const contentType = spec.contentType
    ?? (status < 400 && operation.streaming === "sse" ? "text/event-stream" : "application/json");
  const schema = spec.schema
    ? cloneJsonSchema(spec.schema, `${operation.operationId}:${status}`)
    : status >= 400
      ? { $ref: API_ERROR_SCHEMA_REF }
      : {};
  return {
    description: spec.description,
    content: { [contentType]: { schema } },
  };
}

function buildComponents(): Record<string, unknown> {
  const responses: Record<string, unknown> = {};
  for (const entry of [...ERROR_RESPONSES].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    responses[entry.name] = {
      description: entry.description,
      content: { "application/json": { schema: { $ref: API_ERROR_SCHEMA_REF } } },
    };
  }

  return {
    schemas: {
      [API_ERROR_SCHEMA_NAME]: {
        type: "object",
        title: "ApiError",
        description:
          "The body of every failing response, produced by `formatError` in `src/errors.ts`. `details` is omitted when the error carries no structured context.",
        required: ["code", "message"],
        properties: {
          code: {
            type: "string",
            description: "Stable machine-readable error code, e.g. `read_only` or `not_found`.",
            examples: ["not_found"],
          },
          message: {
            type: "string",
            description: "Human-readable explanation. Not stable — never match on it.",
          },
          details: {
            description: "Optional structured context. The shape depends on `code`.",
          },
        },
        additionalProperties: false,
      },
    },
    responses,
    securitySchemes: {
      [SECURITY_SCHEME_NAME]: {
        type: "http",
        scheme: "bearer",
        description: [
          "A client token, sent as `Authorization: Bearer <token>`.",
          "",
          ...SCOPE_DESCRIPTIONS.map(([scope, text]) => `- \`${scope}\`: ${text}`),
          "",
          "Each operation states the minimum scope it requires; a token with a higher scope also passes.",
        ].join("\n"),
      },
    },
  };
}

/**
 * Deep clone of an author-supplied JSON Schema.
 *
 * Copying rather than referencing means the emitted document is a value, not a view onto
 * mutable module state, and dropping non-JSON values here (instead of letting
 * `JSON.stringify` do it later) keeps the in-memory document and its serialization
 * identical. Key order is preserved as declared, which is what makes two builds byte-equal.
 */
/** True when the body schema names at least one field the caller must supply. */
function hasRequiredFields(schema: JsonSchema): boolean {
  const required = schema.required;
  return Array.isArray(required) && required.length > 0;
}

function cloneJsonSchema(schema: JsonSchema, label: string): unknown {
  return cloneJsonValue(schema, label, new Set<unknown>());
}

function cloneJsonValue(value: unknown, label: string, seen: Set<unknown>): unknown {
  if (value === null) return null;
  const type = typeof value;
  if (type === "string" || type === "boolean") return value;
  if (type === "number") return Number.isFinite(value as number) ? value : null;
  if (type !== "object") return undefined;

  if (seen.has(value)) {
    throw new ApiError(500, "openapi_schema_cyclic", `Cyclic JSON schema in ${label}`, { schema: label });
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => {
        const cloned = cloneJsonValue(entry, label, seen);
        return cloned === undefined ? null : cloned;
      });
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const cloned = cloneJsonValue((value as Record<string, unknown>)[key], label, seen);
      if (cloned !== undefined) result[key] = cloned;
    }
    return result;
  } finally {
    seen.delete(value);
  }
}
