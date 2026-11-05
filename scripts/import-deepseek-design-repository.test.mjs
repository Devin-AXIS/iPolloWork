import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { deepSeekDesignSourceMappings } from "./export-deepseek-design-repository.mjs";
import { importDeepSeekDesignRepository } from "./import-deepseek-design-repository.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "deepseek-design-import-test-"));
  const source = join(root, "deepseek-design");
  const destination = join(root, "ipollowork");
  await mkdir(source, { recursive: true });
  await mkdir(destination, { recursive: true });
  await writeFile(join(source, "repository.json"), `${JSON.stringify({
    schemaVersion: 1,
    repository: "https://github.com/Devin-AXIS/deepseek-design",
    source: {
      repository: "https://github.com/Devin-AXIS/iPolloWork",
      commit: "0123456789abcdef0123456789abcdef01234567",
    },
  })}\n`);
  for (const mapping of deepSeekDesignSourceMappings) {
    const target = join(source, mapping.mirrorPath);
    if (mapping.type === "directory") {
      await mkdir(target, { recursive: true });
      await writeFile(join(target, "fixture.txt"), mapping.mirrorPath);
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, mapping.mirrorPath);
    }
  }
  return { root, source, destination };
}

test("imports only the approved DeepSeek Design source mappings", async () => {
  const current = await fixture();
  try {
    const imported = await importDeepSeekDesignRepository(current);
    assert.deepEqual(imported, deepSeekDesignSourceMappings.map(({ ipolloWorkPath }) => ipolloWorkPath));
    for (const mapping of deepSeekDesignSourceMappings) {
      const target = join(current.destination, mapping.ipolloWorkPath);
      const content = mapping.type === "directory"
        ? await readFile(join(target, "fixture.txt"), "utf8")
        : await readFile(target, "utf8");
      assert.equal(content, mapping.mirrorPath);
    }
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("rejects symbolic links from the public repository", async () => {
  const current = await fixture();
  try {
    const directoryMapping = deepSeekDesignSourceMappings.find(({ type }) => type === "directory");
    assert.ok(directoryMapping);
    await symlink("fixture.txt", join(current.source, directoryMapping.mirrorPath, "linked.txt"));
    await assert.rejects(
      importDeepSeekDesignRepository(current),
      /may not contain symbolic links/,
    );
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("rejects a mapped path with the wrong file type", async () => {
  const current = await fixture();
  try {
    const fileMapping = deepSeekDesignSourceMappings.find(({ type }) => type === "file");
    assert.ok(fileMapping);
    await rm(join(current.source, fileMapping.mirrorPath));
    await mkdir(join(current.source, fileMapping.mirrorPath));
    await writeFile(join(current.source, fileMapping.mirrorPath, "unexpected.txt"), "unexpected");
    await assert.rejects(
      importDeepSeekDesignRepository(current),
      /must be a regular file/,
    );
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});
