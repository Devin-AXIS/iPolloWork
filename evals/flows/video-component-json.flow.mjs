import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
const vo = await loadVoiceoverParagraphs("video-component-json");
const api = "/api/projects/component-content-proof/components/mindmap-proof";
const editor = '[data-testid="component-json-editor"]';
let before, updated, previousLabel;
const same = (left, right) => JSON.stringify(left, (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value) === JSON.stringify(right, (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
const read = ctx => ctx.eval(`fetch(${JSON.stringify(api)}).then(r=>r.json())`, { awaitPromise: true });
async function open(ctx) {
  await ctx.waitFor('Boolean(document.querySelector(\'[aria-label="Select Mindmap Proof"]\'))', { timeoutMs: 30000 });
  await ctx.trustedClick('[aria-label="Select Mindmap Proof"]');
  await ctx.waitFor('Boolean(document.querySelector(\'[data-testid="component-json-tab"]\'))', { timeoutMs: 30000 });
  await ctx.trustedClick('[data-testid="component-json-tab"]');
}
export default {
  id: "video-component-json", title: "Video component JSON and visual form share one saved source",
  cdpTarget: { urlIncludes: ":4573" }, preserveTheme: true,
  steps: [
    { name: "Current component content is readable JSON", run: async ctx => {
      await ctx.prove("Read current hierarchical content", { voiceover: vo[0], action: async () => {
        await ctx.eval("location.reload(); true"); await open(ctx); before = await read(ctx); ctx.assert(!!before.revision, "Missing source revision");
        previousLabel = before.data.content.branches[0].label;
      }, assert: async () => {
        const draft = JSON.parse(await ctx.eval(`document.querySelector(${JSON.stringify(editor)}).value`));
        ctx.assert(draft.content.branches.length === 4, "Content count changed");
        ctx.assert(draft.content.branches[0].leaves.includes("A,B"), "Punctuation was split");
      }, screenshot: { name: "current-component-json", requireText: ["JSON", "Apply JSON", "思维导图"] } });
    } },
    { name: "Invalid drafts do not change saved content", run: async ctx => {
      await ctx.prove("Reject unknown fields before applying", { voiceover: vo[1], action: async () => {
        const invalid = structuredClone(before.data); invalid.content.branches[0].unknown = "must not disappear";
        await ctx.fill(editor, JSON.stringify(invalid, null, 2));
      }, assert: async () => {
        await ctx.waitFor('document.querySelector(\'[role="alert"]\')?.textContent.includes("unknown")');
        ctx.assert(await ctx.eval('document.querySelector(\'[data-testid="component-json-apply"]\').disabled'), "Invalid JSON is applicable");
        ctx.assert((await read(ctx)).revision === before.revision, "Invalid draft changed source");
      }, screenshot: { name: "invalid-draft-preserves-preview", requireText: ["unknown", "Apply JSON"] } });
    } },
    { name: "One JSON apply updates the preview and saved content", run: async ctx => {
      updated = structuredClone(before.data); updated.content.branches[0].label = previousLabel === "创" ? "研" : "创";
      updated.content.branches[0].leaves = ["A,B", "中，文"];
      updated.content.center = before.data.content.center === "AI 协作" ? "AI 教育" : "AI 协作";
      await ctx.prove("Apply one complete object", { voiceover: vo[2], action: async () => {
        await ctx.fill(editor, JSON.stringify(updated, null, 2)); await ctx.trustedClick('[data-testid="component-json-apply"]');
      }, assert: async () => {
        await ctx.waitFor('document.querySelector("[data-testid=component-json-apply]")?.disabled && document.querySelector("[data-testid=component-json-apply]")?.textContent === "Apply JSON"', { timeoutMs: 30000 });
        const actual = await read(ctx); if (!same(actual.data, updated)) ctx.output("Saved data comparison", JSON.stringify({ expected: updated, actual: actual.data }, null, 2));
        ctx.assert(same(actual.data, updated), "Saved JSON differs from applied object");
        await ctx.waitFor(`document.querySelector('hyperframes-player')?.shadowRoot?.querySelector('iframe')?.contentDocument?.body.innerText.includes(${JSON.stringify(updated.content.branches[0].label)})`, { timeoutMs: 30000 });
        const visible = await ctx.eval('document.querySelector(\'hyperframes-player\')?.shadowRoot?.querySelector(\'iframe\')?.contentDocument?.body.innerText');
        ctx.assert(visible.includes("A,B") && visible.includes("中，文") && visible.includes(updated.content.branches[0].label), "Preview did not update");
        ctx.assert(!(await ctx.eval('document.querySelector(\'button[aria-label="Undo"]\').disabled')), "No single undo entry");
      }, screenshot: { name: "json-applied-with-punctuation", requireText: ["JSON", "Apply JSON"] } });
    } },
    { name: "Form, undo, redo and reload keep the same content", run: async ctx => {
      await ctx.prove("Continue in the visual form and reopen", { voiceover: vo[3], action: async () => {
        await ctx.trustedClick('[data-testid="component-content-tab"]');
        await ctx.waitFor(`document.querySelector('input[aria-label="Branch 1"]')?.value===${JSON.stringify(updated.content.branches[0].label)}`);
        await ctx.trustedClick('button[aria-label="Undo"]');
        await ctx.waitFor(`document.querySelector('input[aria-label="Branch 1"]')?.value===${JSON.stringify(previousLabel)} && !document.querySelector('button[aria-label="Redo"]')?.disabled`);
        ctx.assert(same((await read(ctx)).data, before.data), "One undo did not restore the entire object");
        await ctx.trustedClick('button[aria-label="Redo"]');
        await ctx.waitFor(`document.querySelector('input[aria-label="Branch 1"]')?.value===${JSON.stringify(updated.content.branches[0].label)}`);
        await ctx.eval('location.reload(); true'); await open(ctx); await ctx.trustedClick('[data-testid="component-content-tab"]');
      }, assert: async () => {
        await ctx.waitFor(`document.querySelector('input[aria-label="Branch 1"]')?.value===${JSON.stringify(updated.content.branches[0].label)}`);
        ctx.assert(await ctx.eval('document.querySelector(\'textarea[aria-label="Details 1"]\').value') === "A,B\n中，文", "Form lost list punctuation");
        ctx.assert(same((await read(ctx)).data, updated), "Reopen lost data");
      }, screenshot: { name: "form-after-reopen", requireText: ["Content", "思维导图", "Autosaved"] } });
    } },
  ],
};
