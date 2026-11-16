import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FsTargetKey, FsVersion } from "@deepseek-ai/dsh-fs";
import {
  ProjectArchive,
  type ArchiveContext,
  type ArchiveSession,
} from "../src/host/project-archive.ts";
import { linkProject } from "../src/host/project-context.ts";
import { AccountService } from "../src/host/account.ts";
import { resolveConfig } from "../src/host/config.ts";

test("native deliveries stream in bounded ranges, retry safely and release with the suite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-native-archive-"));
  const content = new Uint8Array(2_200_000).fill(65),
    reads: number[] = [],
    uploads: string[] = [];
  let observe: (
    session: ArchiveSession,
    event: { type: string; data: unknown },
  ) => void = () => {};
  let dispose: () => Promise<void> = async () => {};
  const ctx: ArchiveContext = {
    on: (event, listener) => {
      if (event === "session/event") observe = listener as typeof observe;
    },
    effect: (setup) => {
      dispose = setup();
    },
    logger: { warn: () => {} },
    fs: {
      resolve: async (path, options) => ({
        targetKey: FsTargetKey(resolve(options?.cwd ?? dir, path)),
        displayPath: path,
      }),
      contains: (parent, child) =>
        child.targetKey.startsWith(parent.targetKey + "/"),
      processPath: (target) => target.targetKey,
      stat: async () => ({
        type: "file",
        size: content.length,
        version: FsVersion("v1"),
      }),
      readByteRange: async (_target, range) => {
        reads.push(range.length);
        return content.slice(range.offset, range.offset + range.length);
      },
    },
  };
  let reject = true;
  const account = new AccountService(
    {
      readRecord: async () => ({
        kind: "grant",
        payload: {
          version: 1,
          origin: "https://account.test",
          token: "private-fixture",
        },
      }),
      modifyRecord: async () => {},
      deleteRecord: async () => {},
    },
    resolveConfig({ accountOrigin: "https://account.test" }),
    new AbortController().signal,
    async (url, options) => {
      if (String(url).endsWith("/artifacts"))
        return Response.json({ policy: { outputs: true } });
      if (reject)
        return Response.json({ code: "OSS_NOT_CONFIGURED" }, { status: 503 });
      const metadata = JSON.parse(
        Buffer.from(
          new Headers(options?.headers).get("x-ipw-artifact")!,
          "base64url",
        ).toString(),
      );
      uploads.push(metadata.path);
      const body = await new Response(options?.body).arrayBuffer();
      assert.equal(body.byteLength, content.length);
      assert(!JSON.stringify(metadata).includes("private-fixture"));
      return Response.json({ id: "archive", version: 1 });
    },
  );
  const archive = new ProjectArchive(
    ctx,
    account,
    "https://account.test",
    5_000_000,
    100,
  );
  const session: ArchiveSession = {
    id: "session",
    header: { cwd: dir },
    snapshotEvents: () => [],
  };
  const event = {
    type: "deliverables/presented",
    data: {
      turn: 1,
      callId: "call",
      files: [{ path: join(dir, "result.mp4") }],
    },
  };
  try {
    await linkProject(dir, "https://account.test", "project");
    observe(session, event);
    await archive.settled();
    assert.equal(archive.status("project")[0]?.state, "failed");
    reject = false;
    archive.retry("project");
    await archive.settled();
    assert.deepEqual(uploads, ["result.mp4"]);
    assert.equal(archive.status("project")[0]?.state, "saved");
    assert(reads.every((bytes) => bytes <= 1024 * 1024));
    observe(session, event);
    await archive.settled();
    assert.equal(uploads.length, 1);
  } finally {
    await dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
