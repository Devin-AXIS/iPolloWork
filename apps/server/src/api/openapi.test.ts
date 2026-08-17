import { describe, expect, test } from "bun:test";

import type { ApiModule, ApiOperation, RegisteredApiModule } from "./module.js";
import { renderApiDocsHtml } from "./modules/openapi/module.js";
import {
  buildOpenApiDocument,
  extractPathParameterNames,
  toOpenApiPath,
  type BuildOpenApiDocumentInput,
} from "./openapi.js";

function moduleOf(id: string, extra: Partial<ApiModule> = {}): ApiModule {
  return {
    id,
    title: `${id} title`,
    description: `${id} description`,
    version: "1.2.3",
    stability: "stable",
    register: () => [],
    ...extra,
  };
}

const noop: ApiOperation["handler"] = async () => Response.json({});

/**
 * A fresh fixture on every call.
 *
 * Determinism is only meaningful if it survives fresh objects: reusing one frozen fixture
 * would hide an accidental dependency on object identity or on a mutated map.
 */
function fixture(): BuildOpenApiDocumentInput {
  const sessions: ApiOperation[] = [
    {
      operationId: "listSessions",
      method: "GET",
      path: "/api/v1/sessions",
      summary: "List sessions",
      description: "Lists sessions the token can see.",
      effect: "read",
      query: {
        type: "object",
        properties: {
          cursor: { type: "string", description: "Opaque page cursor." },
          limit: { type: "integer", minimum: 1, maximum: 200 },
        },
        required: ["cursor"],
      },
      handler: noop,
    },
    {
      operationId: "getSession",
      method: "GET",
      path: "/api/v1/workspaces/:workspaceId/sessions/:id",
      summary: "Get a session",
      effect: "read",
      pathParams: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: "Workspace identifier." },
        },
      },
      handler: noop,
    },
    {
      operationId: "createSession",
      method: "POST",
      path: "/api/v1/workspaces/:workspaceId/sessions",
      summary: "Create a session",
      effect: "write",
      requestBody: {
        type: "object",
        required: ["agent"],
        properties: { agent: { type: "string" }, model: { type: "string" } },
      },
      handler: noop,
    },
    {
      operationId: "streamSessionEvents",
      method: "GET",
      path: "/api/v1/workspaces/:workspaceId/sessions/:id/events",
      summary: "Stream session events",
      effect: "read",
      streaming: "sse",
      handler: noop,
    },
    {
      operationId: "promptSessionLegacy",
      method: "POST",
      path: "/api/v1/sessions/:id/prompt",
      summary: "Prompt a session (legacy alias)",
      effect: "write",
      deprecated: true,
      handler: noop,
    },
    {
      operationId: "debugSessionInternals",
      method: "GET",
      path: "/api/v1/internal/sessions/debug",
      summary: "Internal debug dump",
      effect: "read",
      internal: true,
      handler: noop,
    },
  ];

  const tasks: ApiOperation[] = [
    {
      operationId: "deleteTask",
      method: "DELETE",
      path: "/api/v1/tasks/:taskId",
      summary: "Delete a task",
      effect: "destructive",
      scope: "owner",
      handler: noop,
    },
    {
      operationId: "reloadTasks",
      method: "POST",
      path: "/api/v1/tasks/reload",
      summary: "Reload the task table",
      effect: "write",
      auth: "host",
      handler: noop,
    },
    {
      operationId: "getTaskHealth",
      method: "GET",
      path: "/api/v1/tasks/health",
      summary: "Task subsystem health",
      effect: "read",
      auth: "none",
      handler: noop,
    },
  ];

  // Registration order is deliberately not alphabetical, so a sorted output proves sorting.
  const modules: RegisteredApiModule[] = [
    { module: moduleOf("tasks", { stability: "preview", dependsOn: ["sessions"] }), operations: tasks },
    { module: moduleOf("sessions"), operations: sessions },
  ];

  return {
    operations: [...sessions, ...tasks],
    modules,
    serverVersion: "0.21.1",
  };
}

const document = buildOpenApiDocument(fixture()) as Record<string, any>;
const paths = document.paths as Record<string, any>;

describe("path syntax conversion", () => {
  test("converts :param to {param}", () => {
    expect(toOpenApiPath("/api/v1/workspaces/:workspaceId/sessions/:id")).toBe(
      "/api/v1/workspaces/{workspaceId}/sessions/{id}",
    );
    expect(toOpenApiPath("/api/v1/sessions")).toBe("/api/v1/sessions");
  });

  test("extracts parameter names in order, deduplicated", () => {
    expect(extractPathParameterNames("/a/:one/b/:two/c/:one")).toEqual(["one", "two"]);
    expect(extractPathParameterNames("/a/b")).toEqual([]);
  });

  test("the document keys use OpenAPI syntax", () => {
    expect(Object.keys(paths)).toContain("/api/v1/workspaces/{workspaceId}/sessions/{id}");
    expect(Object.keys(paths).some((path) => path.includes(":"))).toBe(false);
  });
});

describe("document skeleton", () => {
  test("is an OpenAPI 3.1.0 document carrying the server version", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(document.jsonSchemaDialect).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(document.info.version).toBe("0.21.1");
    expect(typeof document.info.title).toBe("string");
    expect(Array.isArray(document.servers)).toBe(true);
  });

  test("tags come from the owning modules, sorted, with module metadata", () => {
    expect((document.tags as any[]).map((tag) => tag.name)).toEqual(["sessions", "tasks"]);
    const tasksTag = (document.tags as any[]).find((tag) => tag.name === "tasks");
    expect(tasksTag.description).toBe("tasks description");
    expect(tasksTag["x-ipollowork-stability"]).toBe("preview");
    expect(tasksTag["x-ipollowork-depends-on"]).toEqual(["sessions"]);
  });

  test("each operation is tagged with its owning module", () => {
    expect(paths["/api/v1/sessions"].get.tags).toEqual(["sessions"]);
    expect(paths["/api/v1/tasks/{taskId}"].delete.tags).toEqual(["tasks"]);
  });
});

describe("parameters", () => {
  test("path parameters are extracted and marked required", () => {
    const parameters = paths["/api/v1/workspaces/{workspaceId}/sessions/{id}"].get.parameters as any[];
    expect(parameters.map((parameter) => parameter.name)).toEqual(["workspaceId", "id"]);
    expect(parameters.every((parameter) => parameter.in === "path")).toBe(true);
    expect(parameters.every((parameter) => parameter.required === true)).toBe(true);
    // A declared pathParams schema enriches the parameter; the rest fall back to string.
    expect(parameters[0].description).toBe("Workspace identifier.");
    expect(parameters[1].schema).toEqual({ type: "string" });
  });

  test("query parameters come from the query schema with its required list", () => {
    const parameters = paths["/api/v1/sessions"].get.parameters as any[];
    expect(parameters).toEqual([
      {
        name: "cursor",
        in: "query",
        required: true,
        description: "Opaque page cursor.",
        schema: { type: "string", description: "Opaque page cursor." },
      },
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 200 },
      },
    ]);
  });

  test("an operation with neither kind of parameter declares none", () => {
    expect(paths["/api/v1/tasks/health"].get.parameters).toBeUndefined();
  });
});

describe("request bodies", () => {
  test("are emitted as required application/json with the declared schema", () => {
    const body = paths["/api/v1/workspaces/{workspaceId}/sessions"].post.requestBody;
    expect(body.required).toBe(true);
    expect(body.content["application/json"].schema).toEqual({
      type: "object",
      required: ["agent"],
      properties: { agent: { type: "string" }, model: { type: "string" } },
    });
  });

  test("the emitted schema is a copy, not a reference to module state", () => {
    const input = fixture();
    const built = buildOpenApiDocument(input) as Record<string, any>;
    const source = input.operations.find((operation) => operation.operationId === "createSession");
    (source!.requestBody!.properties as Record<string, unknown>).injected = { type: "string" };
    const emitted = built.paths["/api/v1/workspaces/{workspaceId}/sessions"].post.requestBody
      .content["application/json"].schema.properties;
    expect(Object.keys(emitted)).toEqual(["agent", "model"]);
  });
});

describe("errors", () => {
  test("the ApiError component matches the real error body shape", () => {
    const schema = document.components.schemas.ApiError;
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["code", "message"]);
    expect(Object.keys(schema.properties)).toEqual(["code", "message", "details"]);
    expect(schema.properties.code.type).toBe("string");
    expect(schema.properties.message.type).toBe("string");
  });

  test("the shared error responses all reference the ApiError schema", () => {
    const responses = document.components.responses;
    expect(Object.keys(responses)).toEqual([
      "BadRequest",
      "Forbidden",
      "InternalServerError",
      "NotFound",
      "Unauthorized",
    ]);
    for (const name of Object.keys(responses)) {
      expect(responses[name].content["application/json"].schema).toEqual({
        $ref: "#/components/schemas/ApiError",
      });
    }
  });

  test("operations reference the shared error responses", () => {
    const responses = paths["/api/v1/workspaces/{workspaceId}/sessions/{id}"].get.responses;
    expect(Object.keys(responses)).toEqual(["200", "400", "401", "403", "404", "500"]);
    expect(responses["404"]).toEqual({ $ref: "#/components/responses/NotFound" });
    expect(responses["500"]).toEqual({ $ref: "#/components/responses/InternalServerError" });
  });

  test("404 is only documented where a resource is addressed by path", () => {
    expect(Object.keys(paths["/api/v1/sessions"].get.responses)).toEqual(["200", "400", "401", "403", "500"]);
  });

  test("an unauthenticated read documents no 401 or 403", () => {
    expect(Object.keys(paths["/api/v1/tasks/health"].get.responses)).toEqual(["200", "500"]);
  });
});

describe("security and scopes", () => {
  test("a single http bearer scheme documents the three token scopes", () => {
    const scheme = document.components.securitySchemes.bearerAuth;
    expect(scheme.type).toBe("http");
    expect(scheme.scheme).toBe("bearer");
    for (const scope of ["viewer", "collaborator", "owner"]) {
      expect(scheme.description).toContain(`\`${scope}\``);
    }
    expect(document.security).toEqual([{ bearerAuth: [] }]);
  });

  test("the minimum scope for each operation lands in its description", () => {
    expect(paths["/api/v1/sessions"].get.description).toContain("Minimum scope: `viewer` or higher.");
    expect(paths["/api/v1/workspaces/{workspaceId}/sessions"].post.description)
      .toContain("Minimum scope: `collaborator` or higher.");
    // An explicit scope overrides the effect default, and `owner` has nothing above it.
    expect(paths["/api/v1/tasks/{taskId}"].delete.description).toContain("Minimum scope: `owner`.");
    expect(paths["/api/v1/tasks/{taskId}"].delete.description).not.toContain("or higher");
  });

  test("the declared description is kept and the effect is spelled out", () => {
    const description = paths["/api/v1/sessions"].get.description as string;
    expect(description.startsWith("Lists sessions the token can see.")).toBe(true);
    expect(paths["/api/v1/workspaces/{workspaceId}/sessions"].post.description).toContain("403 read_only");
    expect(paths["/api/v1/tasks/{taskId}"].delete.description).toContain("Effect: `destructive`");
  });

  test("host operations are documented as host-authenticated", () => {
    const operation = paths["/api/v1/tasks/reload"].post;
    expect(operation.description).toContain("host credentials");
    expect(operation["x-ipollowork-auth"]).toBe("host");
    expect(operation["x-ipollowork-scope"]).toBeNull();
    expect(operation.security).toEqual([{ bearerAuth: [] }]);
  });

  test("an operation with auth none opts out of security", () => {
    expect(paths["/api/v1/tasks/health"].get.security).toEqual([]);
    expect(paths["/api/v1/tasks/health"].get.description).toContain("Authentication: none.");
  });
});

describe("streaming", () => {
  test("sse operations are documented as text/event-stream", () => {
    const operation = paths["/api/v1/workspaces/{workspaceId}/sessions/{id}/events"].get;
    expect(operation["x-ipollowork-streaming"]).toBe("sse");
    expect(operation.responses["200"].content["text/event-stream"].schema.type).toBe("string");
    expect(operation.responses["200"].content["application/json"]).toBeUndefined();
    expect(operation.description).toContain("text/event-stream");
  });

  test("non-streaming operations answer with application/json", () => {
    expect(paths["/api/v1/sessions"].get.responses["200"].content["application/json"]).toBeDefined();
  });
});

describe("declared responses", () => {
  test("override the generated defaults and default to the error schema for 4xx", () => {
    const built = buildOpenApiDocument({
      ...fixture(),
      operations: [
        {
          operationId: "getThing",
          method: "GET",
          path: "/api/v1/thing",
          summary: "Get a thing",
          effect: "read",
          responses: {
            200: { description: "The thing.", schema: { type: "object", properties: { id: { type: "string" } } } },
            409: { description: "The thing is busy." },
          },
          handler: noop,
        },
      ],
      modules: [],
    }) as Record<string, any>;

    const responses = built.paths["/api/v1/thing"].get.responses;
    expect(Object.keys(responses)).toEqual(["200", "401", "403", "409", "500"]);
    expect(responses["200"].description).toBe("The thing.");
    expect(responses["200"].content["application/json"].schema.properties.id).toEqual({ type: "string" });
    expect(responses["409"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/ApiError",
    });
    // No owning module, so no tag is invented.
    expect(built.paths["/api/v1/thing"].get.tags).toBeUndefined();
    expect(built.paths["/api/v1/thing"].get["x-ipollowork-module"]).toBeNull();
  });
});

describe("internal and deprecated operations", () => {
  test("internal operations are excluded from the document", () => {
    expect(Object.keys(paths)).not.toContain("/api/v1/internal/sessions/debug");
    expect(JSON.stringify(document)).not.toContain("debugSessionInternals");
  });

  test("deprecated operations are flagged", () => {
    expect(paths["/api/v1/sessions/{id}/prompt"].post.deprecated).toBe(true);
    expect(paths["/api/v1/sessions"].get.deprecated).toBeUndefined();
  });
});

describe("determinism", () => {
  test("two builds of an equivalent input are deep-equal and byte-equal", () => {
    const first = buildOpenApiDocument(fixture());
    const second = buildOpenApiDocument(fixture());
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test("paths are sorted and unaffected by module registration order", () => {
    const forward = fixture();
    const reversed = { ...fixture(), modules: [...fixture().modules].reverse() };
    const a = buildOpenApiDocument(forward) as Record<string, any>;
    const b = buildOpenApiDocument(reversed) as Record<string, any>;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));

    const keys = Object.keys(a.paths);
    expect(keys).toEqual([...keys].sort());
  });

  test("methods within a path follow a fixed order", () => {
    const built = buildOpenApiDocument({
      operations: [
        { operationId: "d", method: "DELETE", path: "/api/v1/x", summary: "d", effect: "destructive", handler: noop },
        { operationId: "g", method: "GET", path: "/api/v1/x", summary: "g", effect: "read", handler: noop },
        { operationId: "p", method: "POST", path: "/api/v1/x", summary: "p", effect: "write", handler: noop },
      ],
      modules: [],
      serverVersion: "1.0.0",
    }) as Record<string, any>;
    expect(Object.keys(built.paths["/api/v1/x"])).toEqual(["get", "post", "delete"]);
  });

  test("top-level keys keep a stable order", () => {
    expect(Object.keys(document)).toEqual([
      "openapi",
      "jsonSchemaDialect",
      "info",
      "servers",
      "security",
      "tags",
      "paths",
      "components",
    ]);
  });

  test("nothing time-varying leaks into the document", () => {
    const serialized = JSON.stringify(document);
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });
});

describe("api docs page", () => {
  const hostile = "</script><script>alert('xss')</script>";

  function render(): string {
    const input = fixture();
    input.modules[1]!.module = moduleOf("sessions", { description: hostile });
    return renderApiDocsHtml({
      document: buildOpenApiDocument(input),
      specUrl: "/api/v1/openapi.json",
    });
  }

  test("is self-contained: no external asset is referenced", () => {
    const html = render();
    expect(html).not.toContain("src=");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://unpkg");
    expect(html).not.toContain("cdn.");
    expect(html).toContain("<style>");
  });

  test("escapes a hostile string so it cannot break out of the embedded document", () => {
    const html = render();
    // The literal closing tag never appears, so the script block cannot be terminated early.
    expect(html).not.toContain(hostile);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("\\u003c/script\\u003e");
    // Exactly the three script elements the page itself declares.
    expect(html.split("<script").length - 1).toBe(3);
    expect(html.split("</script>").length - 1).toBe(3);
  });

  test("the embedded document is still valid JSON carrying the hostile string verbatim", () => {
    const html = render();
    const match = html.match(/<script type="application\/json" id="openapi-document">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1] as string) as Record<string, any>;
    expect(parsed.openapi).toBe("3.1.0");
    const sessionsTag = (parsed.tags as any[]).find((tag) => tag.name === "sessions");
    expect(sessionsTag.description).toBe(hostile);
  });

  test("renders through textContent only, never innerHTML", () => {
    expect(render()).not.toContain("innerHTML");
  });

  test("points its refresh control at the spec endpoint", () => {
    const html = renderApiDocsHtml({ document: { openapi: "3.1.0" }, specUrl: "/api/v1/openapi.json" });
    expect(html).toContain('id="spec-url"');
    expect(html).toContain("fetch(specUrl");
  });
});
