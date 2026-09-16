import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import createDataAnnotationService from "./data-annotation";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

// Minimal DOCX containing two Chinese paragraphs, created independently of the parser.
const TEXT_DOCX = Buffer.from("UEsDBBQAAAAIAPZVMF3UV5DVpAAAANMAAAARAAAAd29yZC9kb2N1bWVudC54bWyyKbdKyU8uzU3NK1GoyM3JK7Yqt1XKKCkpsNLXL07OSM1NLNbLL0jNq8jNScsvyk0sKdbLL0rXL88vSikoyk9OLS7OzEvPzdE3MjAw089NzMxTsrMpt0rKT6kE0QUgoghElNiF5xelKDxdv+dp69JnW7tfrJ9qow8SBpFFYBKsGFnH8zVrnuzqebZu67O1i59Na8eiXh9mlT7CG3YAAAAA//8DAFBLAwQUAAAACAD2VTBdrG4SWqQAAADcAAAAEwAAAFtDb250ZW50X1R5cGVzXS54bWxcjzEOwjAMRa9SZUXUiIEBtV3YgYELWKnbRsR2lBgot0cFqQPz13tPv7m9E5Vq5iildZNZOgIUPxFjqTWRzBwHzYxWas0jJPR3HAn2u90BvIqR2NYWh+uay5NyDj1VV8x2RqbWwUtzD736B5NYPXN01emHLeXWYUoxeLSgAk/p/5pbHYbgaeUXW8rqqZQgI8d6XRiDbBY9dA18T3UfAAAA//8DAFBLAQIUABQAAAAIAPZVMF3UV5DVpAAAANMAAAARAAAAAAAAAAAAAAAAAAAAAAB3b3JkL2RvY3VtZW50LnhtbFBLAQIUABQAAAAIAPZVMF2sbhJapAAAANwAAAATAAAAAAAAAAAAAAAAANMAAABbQ29udGVudF9UeXBlc10ueG1sUEsFBgAAAAACAAIAgAAAAKgBAAAAAA==", "base64");

test("imports Word and Chinese TXT, preserves paragraphs, and rejects invalid input without saving projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-labelu-documents-"));
  const service = await createDataAnnotationService({ plugin: { id: "labelu-data-annotation", version: "0.3.0" } });
  try {
    const launch = new URL((await service.actions["open-workbench"]({}, { directory: root })).url);
    const extract = (name: string, bytes: Buffer, authenticated = true) => fetch(
      `${launch.origin}/api/extract-document?${authenticated ? launch.searchParams.toString() : ""}&name=${encodeURIComponent(name)}`,
      { method: "POST", body: Uint8Array.from(bytes) },
    );
    for (const [name, bytes, expected] of [
      ["例子.TXT", Buffer.from("\uFEFF中文正文\r\n第二段"), "中文正文\n第二段"],
      ["utf16.txt", Buffer.from("\uFEFF中文正文", "utf16le"), "中文正文"],
      ["gbk.txt", Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), "中文"],
      ["例子.docx", TEXT_DOCX, "Word 导入测试\n第二段正文\n"],
    ] as const) {
      const response = await extract(name, bytes);
      assert.equal(response.status, 200, name);
      assert.deepEqual(await response.json(), { textContent: expected, characterCount: expected.length });
    }
    for (const [name, bytes, status] of [
      ["bad.doc", Buffer.from("not Word"), 400],
      ["bad.docx", Buffer.from("not a ZIP"), 400],
      ["empty.txt", Buffer.alloc(0), 400],
      ["blank.txt", Buffer.from(" \n "), 422],
      ["binary.txt", Buffer.from([0, 0, 1]), 400],
      ["large.txt", Buffer.alloc(5 * 1024 * 1024 + 1, 65), 413],
      ["file.exe", Buffer.from("text"), 400],
    ] as const) {
      const response = await extract(name, bytes);
      assert.equal(response.status, status, name);
      await response.arrayBuffer();
    }
    const unauthorized = await extract("valid.txt", Buffer.from("secret"), false);
    assert.equal(unauthorized.status, 401);
    await unauthorized.arrayBuffer();
    assert.deepEqual(await service.actions["list-projects"]({}, { directory: root }), []);
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

function simplePdf(text?: string): Uint8Array<ArrayBuffer> {
  const escapedText = text?.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const content = escapedText ? `BT /F1 18 Tf 72 720 Td (${escapedText}) Tj ET` : "q Q";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(document));
}

type OpenedWorkbench = { url: string };
type CreatedProject = {
  project: {
    id: string;
    title: string;
    modality: "image" | "video" | "audio" | "text";
    revision: number;
    sourcePath: string | null;
    mediaUrl: string | null;
    textContent: string | null;
    labels: string[];
    labelColors: Record<string, string>;
    annotations: Record<string, unknown>;
  };
};

test("extracts text-layer PDFs without creating a project and rejects unusable PDFs", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-labelu-pdf-"));
  const service = await createDataAnnotationService({ plugin: { id: "labelu-data-annotation", version: "0.3.0" } });

  try {
    const opened = await service.actions["open-workbench"]({}, { directory: root }) as OpenedWorkbench;
    const launchUrl = new URL(opened.url);
    const endpoint = `${launchUrl.origin}/api/extract-pdf?${launchUrl.searchParams.toString()}`;
    const extractedResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: simplePdf("PDF import works"),
    });
    assert.equal(extractedResponse.status, 200);
    assert.deepEqual(await extractedResponse.json(), {
      textContent: "PDF import works",
      pageCount: 1,
      characterCount: 16,
    });

    const projectsResponse = await fetch(`${launchUrl.origin}/api/projects?${launchUrl.searchParams.toString()}`);
    assert.deepEqual(await projectsResponse.json(), { projects: [] });

    const scannedResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: simplePdf(),
    });
    assert.equal(scannedResponse.status, 422);
    assert.match(JSON.stringify(await scannedResponse.json()), /没有可提取的文字/);

    const invalidResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: Uint8Array.from(Buffer.from("not a pdf")),
    });
    assert.equal(invalidResponse.status, 400);
    assert.match(JSON.stringify(await invalidResponse.json()), /有效的 PDF/);
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("ships a runnable PDF worker and text assets with the built service", async () => {
  await access(new URL("./dist/pdf.worker.mjs", import.meta.url));
  await access(new URL("./dist/pdfjs/cmaps/Adobe-GB1-UCS2.bcmap", import.meta.url));
  await access(new URL("./dist/pdfjs/standard_fonts/LiberationSans-Regular.ttf", import.meta.url));
  const builtModule = await import(new URL("./dist/data-annotation.mjs", import.meta.url).href) as {
    default: typeof createDataAnnotationService;
  };
  const root = await mkdtemp(join(tmpdir(), "ipollowork-labelu-built-pdf-"));
  const service = await builtModule.default({ plugin: { id: "labelu-data-annotation", version: "0.3.0" } });

  try {
    const opened = await service.actions["open-workbench"]({}, { directory: root }) as OpenedWorkbench;
    const launchUrl = new URL(opened.url);
    const response = await fetch(`${launchUrl.origin}/api/extract-pdf?${launchUrl.searchParams.toString()}`, {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: simplePdf("Bundled PDF worker"),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { textContent: string }).textContent, "Bundled PDF worker");
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("opens a multimodal workbench and keeps conversational actions read-only", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-labelu-plugin-"));
  const service = await createDataAnnotationService({ plugin: { id: "labelu-data-annotation", version: "0.2.0" } });

  try {
    assert.deepEqual(Object.keys(service.actions), ["open-workbench", "list-projects", "get-project"]);
    const opened = await service.actions["open-workbench"]({}, { directory: root }) as OpenedWorkbench;
    assert.match(opened.url, /^http:\/\/127\.0\.0\.1:\d+\//);

    const page = await fetch(opened.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /数据标注实训云/);

    const launchUrl = new URL(opened.url);
    const apiQuery = launchUrl.searchParams.toString();
    const emptyProjects = await fetch(`${launchUrl.origin}/api/projects?${apiQuery}`);
    assert.deepEqual(await emptyProjects.json(), { projects: [] });

    const imageQuery = new URLSearchParams(launchUrl.searchParams);
    imageQuery.set("name", "sample.png");
    imageQuery.set("modality", "image");
    const uploadResponse = await fetch(`${launchUrl.origin}/api/project-file?${imageQuery.toString()}`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: ONE_PIXEL_PNG,
    });
    assert.equal(uploadResponse.status, 201);
    const uploaded = await uploadResponse.json() as CreatedProject;
    assert.equal(uploaded.project.title, "sample.png");
    assert.equal(uploaded.project.modality, "image");
    assert.equal(uploaded.project.revision, 0);
    assert.match(uploaded.project.sourcePath ?? "", /^\.ipollowork\/plugins\/labelu-data-annotation\/uploads\/[a-f0-9-]+\.png$/);

    const mediaResponse = await fetch(`${launchUrl.origin}${uploaded.project.mediaUrl}`);
    assert.equal(mediaResponse.status, 200);
    assert.equal(mediaResponse.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await mediaResponse.arrayBuffer()), ONE_PIXEL_PNG);

    const rangeResponse = await fetch(`${launchUrl.origin}${uploaded.project.mediaUrl}`, {
      headers: { range: "bytes=0-7" },
    });
    assert.equal(rangeResponse.status, 206);
    assert.equal(rangeResponse.headers.get("content-range"), `bytes 0-7/${ONE_PIXEL_PNG.length}`);
    assert.deepEqual(Buffer.from(await rangeResponse.arrayBuffer()), ONE_PIXEL_PNG.subarray(0, 8));

    const annotations = { rect: [{ id: "rect-1", label: "目标", x: 0, y: 0, width: 1, height: 1 }] };
    const savedResponse = await fetch(`${launchUrl.origin}/api/project?${new URLSearchParams({
      ...Object.fromEntries(launchUrl.searchParams),
      projectId: uploaded.project.id,
    }).toString()}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ annotations, expectedRevision: 0 }),
    });
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json() as CreatedProject;
    assert.equal(saved.project.revision, 1);

    const labelEndpoint = `${launchUrl.origin}/api/project-labels?${new URLSearchParams({
      ...Object.fromEntries(launchUrl.searchParams),
      projectId: uploaded.project.id,
    }).toString()}`;
    const renamedLabelsResponse = await fetch(labelEndpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 1,
        labels: [
          { name: "人物", color: "#DC2626" },
          { name: "背景", color: "#2563EB" },
        ],
        replacements: { "目标": "人物" },
      }),
    });
    assert.equal(renamedLabelsResponse.status, 200);
    const renamedLabels = await renamedLabelsResponse.json() as CreatedProject;
    assert.equal(renamedLabels.project.revision, 2);
    assert.deepEqual(renamedLabels.project.labels, ["人物", "背景"]);
    assert.deepEqual(renamedLabels.project.labelColors, { "人物": "#dc2626", "背景": "#2563eb" });
    assert.deepEqual(renamedLabels.project.annotations, {
      rect: [{ id: "rect-1", label: "人物", x: 0, y: 0, width: 1, height: 1 }],
    });

    const unsafeDeleteResponse = await fetch(labelEndpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 2,
        labels: [{ name: "背景", color: "#2563eb" }],
        replacements: {},
      }),
    });
    assert.equal(unsafeDeleteResponse.status, 409);
    assert.match(JSON.stringify(await unsafeDeleteResponse.json()), /请先选择替换标签/);

    const safeDeleteResponse = await fetch(labelEndpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 2,
        labels: [{ name: "背景", color: "#2563eb" }],
        replacements: { "人物": "背景" },
      }),
    });
    assert.equal(safeDeleteResponse.status, 200);
    const safelyDeleted = await safeDeleteResponse.json() as CreatedProject;
    assert.equal(safelyDeleted.project.revision, 3);
    assert.deepEqual(safelyDeleted.project.labels, ["背景"]);
    assert.deepEqual(safelyDeleted.project.annotations, {
      rect: [{ id: "rect-1", label: "背景", x: 0, y: 0, width: 1, height: 1 }],
    });

    const staleLabelsResponse = await fetch(labelEndpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 2,
        labels: [{ name: "背景", color: "#2563eb" }],
        replacements: {},
      }),
    });
    assert.equal(staleLabelsResponse.status, 409);

    const textResponse = await fetch(`${launchUrl.origin}/api/project-text?${apiQuery}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "校园通知", textContent: "明天下午召开会议。" }),
    });
    assert.equal(textResponse.status, 201);
    const textProject = await textResponse.json() as CreatedProject;
    assert.equal(textProject.project.modality, "text");
    assert.equal(textProject.project.textContent, "明天下午召开会议。");

    const textAnnotations = {
      spans: [{ id: "span-1", start: 0, end: 2, label: "实体", text: "明天" }],
      classification: "通知",
    };
    const savedTextResponse = await fetch(`${launchUrl.origin}/api/project?${new URLSearchParams({
      ...Object.fromEntries(launchUrl.searchParams),
      projectId: textProject.project.id,
    }).toString()}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ annotations: textAnnotations, textContent: "明天下午召开会议。", expectedRevision: 0 }),
    });
    assert.equal(savedTextResponse.status, 200);

    const listed = await service.actions["list-projects"]({ limit: 10 }, { directory: root }) as Array<{
      id: string;
      modality: string;
      annotationCount: number;
    }>;
    assert.equal(listed.length, 2);
    assert.deepEqual(new Set(listed.map((project) => project.modality)), new Set(["image", "text"]));

    const readInConversation = await service.actions["get-project"](
      { projectId: textProject.project.id },
      { directory: root },
    ) as { annotations: unknown; revision: number; modality: string };
    assert.equal(readInConversation.modality, "text");
    assert.equal(readInConversation.revision, 1);
    assert.deepEqual(readInConversation.annotations, textAnnotations);

    const projectFile = join(root, ".ipollowork", "plugins", "labelu-data-annotation", "projects", `${textProject.project.id}.json`);
    const persisted = JSON.parse(await readFile(projectFile, "utf8")) as { annotations: unknown; schemaVersion: number };
    assert.equal(persisted.schemaVersion, 2);
    assert.deepEqual(persisted.annotations, textAnnotations);
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("deletes only selected records across modalities and legacy copies, with authenticated and idempotent requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-labelu-delete-"));
  const service = await createDataAnnotationService({ plugin: { id: "labelu-data-annotation", version: "0.3.0" } });
  try {
    const launch = new URL((await service.actions["open-workbench"]({}, { directory: root })).url);
    const base = join(root, ".ipollowork", "plugins", "labelu-data-annotation");
    await mkdir(join(base, "projects"), { recursive: true });
    await mkdir(join(base, "tasks"), { recursive: true });
    const source = join(root, "source.txt");
    await writeFile(source, "original media stays");
    const record = (id: string, modality: string) => ({
      schemaVersion: 2, id, title: id, modality, sourcePath: "source.txt", annotations: {}, labels: [], revision: 0,
    });
    for (const modality of ["image", "audio", "video", "text"]) {
      await writeFile(join(base, "projects", `${modality}.json`), JSON.stringify(record(modality, modality)));
    }
    const legacy = { schemaVersion: 1, id: "legacy", title: "legacy", sourcePath: "source.txt", annotations: {} };
    await writeFile(join(base, "tasks", "legacy.json"), JSON.stringify(legacy));
    await writeFile(join(base, "tasks", "image.json"), JSON.stringify({ ...legacy, id: "image" }));
    const endpoint = (id: string) => `${launch.origin}/api/project?${launch.searchParams}&projectId=${encodeURIComponent(id)}`;
    const unauthorized = await fetch(`${launch.origin}/api/project?projectId=image`, { method: "DELETE" });
    assert.equal(unauthorized.status, 401);
    await unauthorized.arrayBuffer();
    assert.equal((await service.actions["list-projects"]({}, { directory: root })).length, 5);
    const invalid = await fetch(endpoint("../source"), { method: "DELETE" });
    assert.equal(invalid.status, 400);
    await invalid.arrayBuffer();
    for (const [index, id] of ["image", "audio", "video", "text", "legacy"].entries()) {
      const removed = await fetch(endpoint(id), { method: "DELETE" });
      assert.equal(removed.status, 200);
      assert.deepEqual(await removed.json(), { ok: true });
      const listed = await service.actions["list-projects"]({}, { directory: root });
      assert.equal(listed.length, 4 - index);
      assert.ok(listed.every((item) => item.id !== id));
      const missing = await fetch(endpoint(id));
      assert.equal(missing.status, 404);
      await missing.arrayBuffer();
      const retry = await fetch(endpoint(id), { method: "DELETE" });
      assert.equal(retry.status, 200);
      await retry.arrayBuffer();
      assert.equal(await readFile(source, "utf8"), "original media stays");
    }
    await assert.rejects(access(join(base, "tasks", "image.json")));
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("lists legacy image tasks as resumable projects without modifying them", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-labelu-legacy-"));
  const taskId = "legacy-image";
  const taskDirectory = join(root, ".ipollowork", "plugins", "labelu-data-annotation", "tasks");
  await mkdir(taskDirectory, { recursive: true });
  await writeFile(join(taskDirectory, `${taskId}.json`), `${JSON.stringify({
    schemaVersion: 1,
    id: taskId,
    title: "旧图片.png",
    sourcePath: ".ipollowork/plugins/labelu-data-annotation/uploads/legacy-image.png",
    labels: ["目标"],
    annotations: { point: [] },
    revision: 3,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    updateSource: "user",
  }, null, 2)}\n`, "utf8");

  const service = await createDataAnnotationService({ plugin: { id: "labelu-data-annotation", version: "0.2.0" } });
  try {
    const listed = await service.actions["list-projects"]({ limit: 10 }, { directory: root }) as Array<{
      id: string;
      modality: string;
      revision: number;
    }>;
    assert.deepEqual(listed, [{
      id: taskId,
      title: "旧图片.png",
      modality: "image",
      revision: 3,
      updatedAt: "2026-08-02T00:00:00.000Z",
      updateSource: "user",
      annotationCount: 0,
      annotationCounts: { point: 0 },
      status: "not_started",
    }]);
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("lists categorized training templates and creates ready-to-use projects without uploads", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-labelu-training-"));
  const service = await createDataAnnotationService({ plugin: { id: "labelu-data-annotation", version: "0.3.0" } });

  try {
    const opened = await service.actions["open-workbench"]({}, { directory: root }) as OpenedWorkbench;
    const launchUrl = new URL(opened.url);
    const apiQuery = launchUrl.searchParams.toString();
    const templatesResponse = await fetch(`${launchUrl.origin}/api/training-templates?${apiQuery}`);
    assert.equal(templatesResponse.status, 200);
    const templatesPayload = await templatesResponse.json() as {
      templates: Array<Record<string, unknown> & { id: string; modality: string; labels: string[] }>;
    };
    assert.equal(templatesPayload.templates.length, 12);
    assert.deepEqual(
      Object.fromEntries(["image", "video", "audio", "text"].map((modality) => [
        modality,
        templatesPayload.templates.filter((template) => template.modality === modality).length,
      ])),
      { image: 3, video: 3, audio: 3, text: 3 },
    );
    assert.equal(templatesPayload.templates.some((template) => "assetFile" in template || "textContent" in template), false);

    const invalidResponse = await fetch(`${launchUrl.origin}/api/training-project?${apiQuery}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId: "missing-template" }),
    });
    assert.equal(invalidResponse.status, 404);

    const imageResponse = await fetch(`${launchUrl.origin}/api/training-project?${apiQuery}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId: "image-campus-safety" }),
    });
    assert.equal(imageResponse.status, 201);
    const imageProject = await imageResponse.json() as CreatedProject;
    assert.equal(imageProject.project.title, "校园安全帽检测");
    assert.equal(imageProject.project.modality, "image");
    assert.equal(imageProject.project.revision, 0);
    assert.deepEqual(imageProject.project.labels, ["人物", "安全帽"]);
    assert.deepEqual(imageProject.project.labelColors, { "人物": "#2563eb", "安全帽": "#f59e0b" });
    assert.match(imageProject.project.sourcePath ?? "", /^\.ipollowork\/plugins\/labelu-data-annotation\/uploads\/[a-f0-9-]+\.svg$/);
    const mediaResponse = await fetch(`${launchUrl.origin}${imageProject.project.mediaUrl}`);
    assert.equal(mediaResponse.status, 200);
    assert.equal(mediaResponse.headers.get("content-type"), "image/svg+xml");
    assert.match(await mediaResponse.text(), /<svg/);

    const textResponse = await fetch(`${launchUrl.origin}/api/training-project?${apiQuery}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId: "text-news-entities" }),
    });
    assert.equal(textResponse.status, 201);
    const textProject = await textResponse.json() as CreatedProject;
    assert.equal(textProject.project.title, "新闻实体抽取");
    assert.equal(textProject.project.modality, "text");
    assert.match(textProject.project.textContent ?? "", /智慧未来学校/);
    assert.deepEqual(textProject.project.labels, ["人物", "组织", "地点", "时间"]);

    for (const [templateId, modality, contentType] of [
      ["video-sports-motion", "video", "video/mp4"],
      ["audio-speaker-turns", "audio", "audio/mp4"],
    ] as const) {
      const projectResponse = await fetch(`${launchUrl.origin}/api/training-project?${apiQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      assert.equal(projectResponse.status, 201);
      const created = await projectResponse.json() as CreatedProject;
      assert.equal(created.project.modality, modality);
      const assetResponse = await fetch(`${launchUrl.origin}${created.project.mediaUrl}`);
      assert.equal(assetResponse.status, 200);
      assert.equal(assetResponse.headers.get("content-type"), contentType);
      assert.ok((await assetResponse.arrayBuffer()).byteLength > 1_000);
    }

    const listed = await service.actions["list-projects"]({ limit: 10 }, { directory: root }) as Array<{ modality: string }>;
    assert.equal(listed.length, 4);
    assert.deepEqual(new Set(listed.map((project) => project.modality)), new Set(["image", "video", "audio", "text"]));
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
