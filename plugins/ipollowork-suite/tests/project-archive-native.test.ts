/** Native profile smoke: actual present events archive only completed outputs. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const url = process.env.IPOLLO_ARCHIVE_QA_URL;
test(
  "native output reaches the linked project, keeps inputs local and stops when archiving is disabled",
  { skip: !url, timeout: 90000 },
  async () => {
    const login = await fetch(url!, { redirect: "manual" });
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    assert(cookie);
    const origin = new URL(url!).origin;
    const api = async <T>(
      path: string,
      body?: unknown,
      method = body === undefined ? "GET" : "POST",
    ): Promise<T> => {
      const response = await fetch(origin + path, {
        method,
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60000),
      });
      const value: unknown = await response.json();
      assert(response.ok, JSON.stringify(value));
      return value as T;
    };
    const folder = await mkdtemp(join(tmpdir(), "ipw-native-output-"));
    try {
      await api("/ipollowork-suite/account/sign-up", {
        name: "Archive fixture",
        email: randomUUID() + "@example.test",
        password: "Fixture-only-2026-password",
      });
      const native = await api<{ id: string }>("/ipollo-fixture/project", {
        path: folder,
        title: "Native output smoke",
      });
      await writeFile(
        join(folder, "input.txt"),
        "PRIVATE_INPUT_NOT_FOR_ARCHIVE",
      );
      const project = await api<{ id: string }>(
        "/ipollowork-suite/enterprise/assign",
        { projectId: native.id, enterpriseId: null },
      );
      const run = await api<{ presented: number; requests: unknown[] }>(
        "/ipollo-fixture/run",
        {
          projectId: native.id,
          agentPreset: "standard",
          prompt: "ARCHIVE_NATIVE_OUTPUT",
        },
      );
      assert.equal(run.presented, 1);
      const deadline = Date.now() + 10000;
      let outputs: {
        items: {
          id: string;
          path: string;
          version: number;
          resource_id: string;
        }[];
      };
      for (;;) {
        outputs = await api(
          "/ipollowork-suite/enterprise/projects/" + project.id + "/artifacts",
        );
        if (outputs.items.length) break;
        if (Date.now() > deadline)
          throw new Error("Native output was not archived");
        await setTimeout(20);
      }
      const download = await fetch(
        origin +
          "/ipollowork-suite/enterprise/download/" +
          outputs.items[0]!.resource_id,
        { headers: { Cookie: cookie } },
      );
      assert.equal(download.status, 200);
      assert.match(await download.text(), /Saved by DSH/);
      const summary = {
        presented: run.presented,
        outputPaths: outputs.items.map((file) => file.path),
        version: outputs.items[0]!.version,
        inputPresentLocally:
          (await readFile(join(folder, "input.txt"), "utf8")) ===
          "PRIVATE_INPUT_NOT_FOR_ARCHIVE",
        inputAbsentFromModel: !JSON.stringify(run.requests).includes(
          "PRIVATE_INPUT_NOT_FOR_ARCHIVE",
        ),
      };
      assert.deepEqual(
        summary,
        JSON.parse(
          await readFile(
            new URL("./expected/project-archive-native.json", import.meta.url),
            "utf8",
          ),
        ),
      );
      const large = new Uint8Array(25 * 1024 * 1024).fill(71);
      const uploaded = await fetch(
        origin +
          "/ipollowork-suite/enterprise/projects/" +
          project.id +
          "/artifacts/upload",
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "x-ipw-artifact": Buffer.from(
              JSON.stringify({
                requestId: randomUUID(),
                path: "large.bin",
                bytes: large.length,
              }),
            ).toString("base64url"),
          },
          body: large,
        },
      );
      assert.equal(uploaded.status, 201);
      const archive = (await uploaded.json()) as { resourceId: string };
      const streamed = await fetch(
        origin + "/ipollowork-suite/enterprise/download/" + archive.resourceId,
        { headers: { Cookie: cookie } },
      );
      assert.equal(streamed.status, 200);
      assert.equal((await streamed.arrayBuffer()).byteLength, large.length);
      await api(
        "/ipollowork-suite/enterprise/projects/" +
          project.id +
          "/archive-policy",
        { outputs: false },
        "PUT",
      );
      await api("/ipollo-fixture/run", {
        projectId: native.id,
        agentPreset: "standard",
        prompt: "ARCHIVE_NATIVE_OUTPUT",
      });
      const status = await api<{ items: { state: string }[] }>(
        "/ipollowork-suite/enterprise/projects/" +
          project.id +
          "/archive-status",
      );
      assert(!status.items.some((item) => item.state === "failed"));
      const after = await api<typeof outputs>(
        "/ipollowork-suite/enterprise/projects/" + project.id + "/artifacts",
      );
      assert.equal(after.items[0]!.version, 1);
      console.log(JSON.stringify(summary));
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);
