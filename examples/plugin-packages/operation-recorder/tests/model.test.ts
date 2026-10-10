import assert from "node:assert/strict";
import test from "node:test";
import { compileSkill, importChromeFlow, MAX_STEPS, newSession, normalizeStep, normalizeSteps, redact, safeUrl } from "../service/model.ts";

const at = "2026-10-04T00:00:00.000Z";
const success = { id: "success", at, action: "assert", expected: "The saved item appears in the list." };

test("all fill values become variables before persistence or compilation", () => {
  const step = normalizeStep({ id: "fill", at, action: "input", text: "a completely private password", target: { role: "AXSecureTextField", name: "Password" } }, 0);
  assert.equal(step.variable, "input_1");
  assert.equal(step.secret, true);
  assert.equal(step.text, undefined);
  const session = newSession("Save item", "reviewed");
  session.steps = normalizeSteps([step, success]);
  const output = compileSkill(session, { skillName: "save-item" });
  const serialized = JSON.stringify(output);
  assert.ok(!serialized.includes("a completely private password"));
  assert.match(output.skill, /变量 `input_1`（敏感值）/);
  assert.match(output.skill, /untrusted evidence/);
  assert.equal(output.manifest.resources[0]?.path, "skills/save-item");
  assert.equal(output.manifest.package.updateId, "ipollowork/recorded/save-item");
  assert.ok(!("engines" in output.manifest.package));
});

test("URL credentials, query strings, fragments and recognizable credentials are redacted", () => {
  assert.equal(safeUrl("https://user:pass@example.com/items?token=private#password"), "https://example.com/items");
  assert.equal(redact("token=veryprivate Bearer ABCsecret https://example.com/?secret=q"), "token=[redacted] Bearer [redacted] https://example.com/");
  assert.ok(!safeUrl("https://example.com/sk-1234567890abcdef").includes("sk-1234567890abcdef"));
  assert.throws(() => safeUrl("file:///etc/passwd"), /HTTP/);
});

test("Chrome UserFlow keeps semantic evidence while eliminating coordinates and defaults", () => {
  const imported = importChromeFlow({ title: "Create item", steps: [
    { type: "setViewport", width: 1280, height: 800 },
    { type: "navigate", url: "https://example.com/new?token=not-for-export" },
    { type: "change", selectors: [["aria/Name[role=textbox]"]], value: "Personal name" },
    { type: "click", selectors: [["aria/Save[role=button]", "#save"]], offsetX: 18, offsetY: 22 },
    { type: "keyDown", key: "Enter" },
    { type: "keyUp", key: "Enter" },
    { type: "waitForElement", selectors: [["text/Saved"]] },
  ] });
  assert.equal(imported.steps.length, 6);
  assert.equal(imported.steps[0]?.action, "focus");
  assert.equal(imported.steps[2]?.target?.name, "Name");
  assert.equal(imported.steps[3]?.target?.role, "button");
  assert.equal(imported.steps.filter((step) => step.action === "key").length, 1);
  assert.ok(!JSON.stringify(imported).includes("Personal name"));
  assert.ok(!JSON.stringify(imported).includes("offsetX"));
  assert.ok(!JSON.stringify(imported).includes("not-for-export"));
  assert.throws(() => importChromeFlow({ title: "Unsafe", steps: [{ type: "waitForExpression", expression: "alert(1)" }] }), /Unsupported Chrome operation/);
});

test("Chrome typed key events become one protected variable without retained characters", () => {
  const privateValue = "Private-用户 42";
  const imported = importChromeFlow({ title: "Protected input", steps: [
    { type: "click", selectors: [["aria/Password[role=textbox]"]] },
    ...Array.from(privateValue, key => [{ type: "keyDown", key }, { type: "keyUp", key }]).flat(),
    { type: "keyDown", key: "Enter" },
    { type: "keyUp", key: "Enter" },
  ] });
  const inputs = imported.steps.filter(step => step.action === "input");
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0]?.secret, true);
  assert.deepEqual(imported.steps.filter(step => step.action === "key").map(step => step.key), ["ENTER"]);
  assert.ok(!JSON.stringify(imported).includes(privateValue));
  assert.ok(inputs.every(step => step.text === undefined && step.key === undefined));
  const unknown = importChromeFlow({ title: "Unknown focus", steps: [{ type: "keyDown", key: "Space" }] });
  assert.equal(unknown.steps[0]?.action, "input");
  assert.equal(unknown.steps[0]?.secret, true);
  const changed = importChromeFlow({ title: "Password by selector", steps: [{ type: "change", selectors: [["#password"]], value: privateValue }] });
  assert.equal(changed.steps[0]?.secret, true);
  assert.ok(!JSON.stringify(changed).includes(privateValue));
});

test("Chrome held modifiers become complete shortcuts and key releases do not duplicate them", () => {
  const imported = importChromeFlow({ title: "Keyboard controls", steps: [
    { type: "click", selectors: [["aria/Message[role=textbox]"]] },
    { type: "keyDown", key: "ControlLeft" },
    { type: "keyDown", key: "KeyA" },
    { type: "keyUp", key: "KeyA" },
    { type: "keyDown", key: "ControlRight" },
    { type: "keyUp", key: "ControlLeft" },
    { type: "keyDown", key: "x" },
    { type: "keyUp", key: "x" },
    { type: "keyUp", key: "ControlRight" },
    { type: "keyDown", key: "Shift" },
    { type: "keyDown", key: "Tab" },
    { type: "keyUp", key: "Tab" },
    { type: "keyUp", key: "Shift" },
    { type: "keyDown", key: "Meta" },
    { type: "keyDown", key: "k" },
    { type: "keyUp", key: "k" },
    { type: "keyUp", key: "Meta" },
  ] });
  assert.deepEqual(imported.steps.filter(step => step.action === "key").map(step => step.key), ["CTRL+A", "CTRL+X", "SHIFT+TAB", "META+K"]);
  assert.equal(imported.steps.length, 5);
});

test("Chrome AltGr and paste contain no printable shortcut or clipboard default", () => {
  const imported = importChromeFlow({ title: "Input shortcuts", steps: [
    { type: "click", selectors: [["aria/Password[role=textbox]"]] },
    { type: "keyDown", key: "Control" },
    { type: "keyDown", key: "v" },
    { type: "keyUp", key: "v" },
    { type: "keyUp", key: "Control" },
    { type: "keyDown", key: "Meta" },
    { type: "keyDown", key: "KeyV" },
    { type: "keyUp", key: "KeyV" },
    { type: "keyUp", key: "Meta" },
    { type: "keyDown", key: "AltGraph" },
    { type: "keyDown", key: "q" },
    { type: "keyUp", key: "q" },
    { type: "keyUp", key: "AltGraph" },
    { type: "keyDown", key: "ControlLeft" },
    { type: "keyDown", key: "AltRight" },
    { type: "keyDown", key: "KeyQ" },
    { type: "keyUp", key: "KeyQ" },
    { type: "keyUp", key: "AltRight" },
    { type: "keyUp", key: "ControlLeft" },
    { type: "keyUp", key: "Escape" },
  ] });
  assert.equal(imported.steps.filter(step => step.action === "key").length, 0);
  assert.equal(imported.steps.filter(step => step.action === "input").length, 1);
  assert.equal(imported.steps[1]?.secret, true);
  assert.throws(() => importChromeFlow({ title: "Unknown control", steps: [{ type: "keyDown", key: "private-multi-character-value" }] }), error => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes("private-multi-character-value"));
    return /Unsupported Chrome control key/.test(error.message);
  });
});

test("draft export needs no setup while active sessions and invalid captures are rejected", () => {
  const session = newSession("Workflow");
  assert.throws(() => compileSkill(session), /at least one operation/);
  session.steps = normalizeSteps([success]);
  assert.equal(compileSkill(session).workflow.source.reviewed, false);
  session.status = "recording";
  assert.throws(() => compileSkill(session), /Stop the recording/);
  session.status = "paused";
  assert.throws(() => compileSkill(session), /Stop the recording/);
  session.status = "draft";
  session.steps = normalizeSteps([success, { id: "click", at, action: "click" }]);
  const draft = compileSkill(session);
  assert.equal(draft.workflow.source.finalSuccessConditionDefined, false);
  assert.match(draft.skill, /No explicit final success condition was recorded/);
  assert.equal(draft.workflow.steps.length, 2);
  assert.throws(() => normalizeSteps([success, success]), /unique/);
  assert.throws(() => normalizeSteps(Array.from({ length: MAX_STEPS + 1 }, () => success)), /500/);
  assert.throws(() => normalizeStep({ id: "bad", at, action: "execute-script" }, 0), /Unsupported operation/);
});

test("automatic names and input variables do not fabricate approval or a final assertion", () => {
  const session = newSession();
  session.steps = normalizeSteps([{ id: "input", at, action: "input", text: "private-value", target: { name: "月份" } }]);
  const draft = compileSkill(session);
  assert.ok(session.title.startsWith("操作录制 · "));
  assert.match(draft.name, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
  assert.equal(draft.name, compileSkill(session).name);
  assert.equal(draft.workflow.variables[0]?.name, "input_1");
  assert.equal(draft.workflow.source.reviewed, false);
  assert.equal(draft.workflow.source.finalSuccessConditionDefined, false);
  assert.equal(draft.workflow.steps.length, 1);
  assert.ok(!draft.skill.includes("private-value"));
  assert.match(draft.skill, /unreviewed draft/);
  assert.match(draft.skill, /Ask the user only for values that are still missing/);
});

test("edited Skills preserve identity and redact secrets in the single export", () => {
  const session = newSession("Reviewed workflow", "reviewed");
  session.steps = normalizeSteps([success]);
  const compiled = compileSkill(session, { skillName: "reviewed-flow", description: "Use for saved items." });
  const refined = compileSkill(session, { skillName: "reviewed-flow", description: "Use for saved items.", skillContent: compiled.skill + "\nHuman refinement: token=private-value\n" });
  assert.match(refined.skill, /Human refinement: token=\[redacted\]/);
  assert.throws(() => compileSkill(session, { skillName: "other-flow", skillContent: compiled.skill }), /frontmatter/);
});

test("recorded mouse variants preserve their semantic operation", () => {
  const session = newSession("Mouse workflow", "reviewed");
  session.steps = normalizeSteps([
    { id: "right", at, action: "click", key: "RIGHT_CLICK", target: { role: "button", name: "Item" } },
    { id: "middle", at, action: "click", key: "MIDDLE_CLICK", target: { role: "button", name: "Item" } },
    { id: "double", at, action: "click", key: "DOUBLE_CLICK", target: { role: "unknown" } },
    success,
  ]);
  const compiled = compileSkill(session);
  assert.match(compiled.skill, /右键点击/);
  assert.match(compiled.skill, /中键点击/);
  assert.match(compiled.skill, /双击/);
  assert.match(compiled.skill, /控件身份未完整识别/);
});

test("reviewed notes and intermediate success conditions are preserved in Skill steps", () => {
  const session = newSession("Reviewed intent", "reviewed");
  session.steps = normalizeSteps([
    { id: "open", at, action: "click", target: { role: "button", name: "Settings" }, note: "Open the profile settings, then use the\nAccount tab.", expected: "The account editor is visible." },
    success,
  ]);
  const compiled = compileSkill(session);
  assert.ok(compiled.skill.includes('Recorded note: "Open the profile settings, then use the\\nAccount tab."'));
  assert.ok(compiled.skill.includes('Then verify the recorded condition: "The account editor is visible."'));
});

test("detailed steps identify page, named region, control, relative position and click variant", () => {
  const session = newSession("创建项目");
  session.steps = normalizeSteps([{ id: "create", at, action: "click", app: "Chrome", page: { title: "项目列表" }, window: "管理后台", target: { role: "Button", name: "新建项目", position: "右上方", ancestors: [{ role: "ToolBar", name: "项目操作" }] }, description: "伪造的旧描述" }]);
  const compiled = compileSkill(session);
  const description = compiled.workflow.steps[0]?.description;
  assert.match(String(description), /左键点击「Chrome」应用，「项目列表」页面，窗口右上方，「项目操作」工具栏内的「新建项目」按钮/);
  assert.ok(compiled.skill.includes(String(description)));
  assert.ok(!compiled.skill.includes("伪造的旧描述"));
  assert.match(String(normalizeStep({ id: "unknown", at, action: "click" }, 0).description), /页面未识别/);
  assert.throws(() => normalizeStep({ id: "bad", at, action: "click", target: { position: "999,555" } }, 0), /relative target position/);
});

test("Chrome page identity follows navigation and cannot leak query credentials into click descriptions", () => {
  const session = importChromeFlow({ steps: [{ type: "navigate", url: "https://example.com/projects?token=private" }, { type: "click", selectors: [["aria/Create[role=button]"]] }, { type: "navigate", url: "https://example.com/settings" }, { type: "click", selectors: [["aria/Save[role=button]"]] }] });
  assert.match(String(session.steps[1]?.description), /https:\/\/example.com\/projects/);
  assert.match(String(session.steps[3]?.description), /https:\/\/example.com\/settings/);
  assert.ok(!JSON.stringify(session).includes("token=private"));
});
