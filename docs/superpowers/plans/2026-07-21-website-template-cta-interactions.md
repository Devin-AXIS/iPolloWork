# Website Template CTA Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every visually actionable control in all nine bundled `site` templates produce an observable, accessible result.

**Architecture:** Keep behavior inside each self-contained template: native links and forms remain native, explicit `data-ipw-action-message` attributes identify demonstration-only calls to action, and one isolated inline runtime updates a shared `role="status"` element. Extend the server template-market test as the catalog admission gate, then prove representative interactions through the production Design preview with fraimz.

**Tech Stack:** Static HTML/CSS/JavaScript templates, TypeScript, Bun test, Electron/Chromium CDP, iPolloWork fraimz.

## Global Constraints

- Every control that visually presents itself as actionable must produce an observable result.
- Prefer real navigation, toggle, or form semantics; use fallback acknowledgement only when no real destination exists.
- Fallback acknowledgement must be visible and exposed through `role="status"` or `aria-live="polite"`; do not use browser `alert`.
- Fallback messages must not claim that an account, purchase, or external request completed.
- Repeated activations update one status region instead of creating duplicate UI.
- Every button has an explicit `type`; no button may accidentally submit a surrounding form.
- All template scripts execute inside an isolated function scope and must parse together in document order.
- Do not add backend signup, authentication, billing, or sales integrations.
- Do not change slide, poster, app, or video templates.
- Preserve unrelated dirty-worktree changes and use `pnpm`, never npm or yarn.

---

### Task 1: Add the website-template interaction admission gate

**Files:**
- Modify: `apps/server/src/templates.test.ts:269`

**Interfaces:**
- Consumes: bundled `TemplateManifestV1` manifests and their `entry.html` files.
- Produces: one catalog test that rejects inert buttons, empty or broken fragment links, unisolated inline scripts, and missing fallback status regions.

- [ ] **Step 1: Replace the current website structural test with a failing interaction contract**

Add these helpers above the test suite:

```ts
function attribute(tag: string, name: string) {
  return tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1]?.trim() ?? "";
}

function websiteInteractionProblems(entry: string) {
  const ids = new Set(Array.from(entry.matchAll(/\\bid=["']([^"']+)["']/gi), (match) => match[1]));
  const buttons = Array.from(entry.matchAll(/<button\\b[^>]*>/gi), (match) => match[0]);
  const links = Array.from(entry.matchAll(/<a\\b[^>]*>/gi), (match) => match[0]);
  const scripts = Array.from(
    entry.matchAll(/<script(?![^>]*\\bsrc=)[^>]*>([\\s\\S]*?)<\\/script>/gi),
    (match) => match[1],
  );
  const inertButtons = buttons.filter((tag) => {
    const type = attribute(tag, "type");
    return !(
      tag.includes("mobile-nav-toggle")
      || type === "submit"
      || attribute(tag, "data-ipw-action-message")
      || attribute(tag, "data-ipw-toggle")
    );
  });
  const badLinks = links.filter((tag) => {
    const href = attribute(tag, "href");
    return !href || href === "#" || (href.startsWith("#") && !ids.has(href.slice(1)));
  });
  const fallbackButtons = buttons.filter((tag) => attribute(tag, "data-ipw-action-message"));
  return {
    inertButtons,
    badLinks,
    hasFallbackStatus: fallbackButtons.length === 0 || /<(?:p|div)\\b[^>]*(?:role=["']status["']|aria-live=["']polite["'])/i.test(entry),
    scriptsParseTogether: (() => {
      try { new Function(scripts.join("\\n")); return true; } catch { return false; }
    })(),
    scriptsAreIsolated: scripts.every((script) => script.trimStart().startsWith("(() => {")),
  };
}
```

Replace the existing website test body with:

```ts
test("ships every website template with accessible navigation and observable actions", async () => {
  const directories = (await readdir(bundledTemplatesRoot)).filter((name) => !name.startsWith("."));
  const websites: Array<{ manifest: TemplateManifestV1; entry: string }> = [];
  for (const directory of directories) {
    const root = join(bundledTemplatesRoot, directory);
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as TemplateManifestV1;
    if (manifest.category !== "site") continue;
    websites.push({ manifest, entry: await readFile(join(root, manifest.entry), "utf8") });
  }
  expect(websites).toHaveLength(9);
  for (const { manifest, entry } of websites) {
    expect(entry).toContain('name="viewport"');
    expect(entry).toContain('data-ipw-mobile-ready="true"');
    expect(entry).toMatch(/@media\\s*\\(max-width:/);
    if (/<nav\\b|<header\\s+class="nav"/.test(entry)) {
      expect(entry).toContain("mobile-nav-toggle");
      expect(entry).toContain('aria-expanded="false"');
    }
    expect(manifest.minimumAppVersion).toBeTruthy();
    const problems = websiteInteractionProblems(entry);
    expect(problems.inertButtons).toEqual([]);
    expect(problems.badLinks).toEqual([]);
    expect(problems.hasFallbackStatus).toBe(true);
    expect(problems.scriptsParseTogether).toBe(true);
    expect(problems.scriptsAreIsolated).toBe(true);
  }
});
```

- [ ] **Step 2: Run the focused test and confirm the admission gate fails for existing inert controls**

Run:

```powershell
& 'C:\Users\Lenovo\AppData\Roaming\npm\bun.cmd' test src/templates.test.ts --test-name-pattern "observable actions"
```

Expected: FAIL at `problems.inertButtons` and `problems.badLinks`; the output names the existing unannotated buttons and `href="#"` or missing fragment destinations.

- [ ] **Step 3: Commit the red test only**

```powershell
git add apps/server/src/templates.test.ts
git commit -m "test: require interactive website template actions"
```

---

### Task 2: Make pricing and SaaS template actions observable

**Files:**
- Modify: `apps/server/bundled-templates/ipollowork.html-anything.pricing-page/entry.html:75`
- Modify: `apps/server/bundled-templates/ipollowork.html-anything.saas-landing/entry.html:85`
- Modify: `apps/server/bundled-templates/ipollowork.saas-landing/entry.html:85`
- Test: `apps/server/src/templates.test.ts`

**Interfaces:**
- Consumes: `data-ipw-toggle="monthly|yearly"` for pricing switches and `data-ipw-action-message="..."` for demonstration-only CTAs.
- Produces: `.price[data-monthly][data-yearly]` values, one `[data-ipw-action-status]` live region per template, and isolated event listeners that update selection, prices, or status text.

- [ ] **Step 1: Add a failing focused assertion for real toggle and fallback hooks**

Inside the website catalog test, after loading each entry, add:

```ts
if (manifest.id === "ipollowork.html-anything.pricing-page") {
  expect(entry).toContain('data-ipw-toggle="monthly"');
  expect(entry).toContain('data-ipw-toggle="yearly"');
  expect(entry).toContain("data-monthly");
  expect(entry).toContain("data-yearly");
}
if (manifest.id === "ipollowork.saas-landing" || manifest.id === "ipollowork.html-anything.saas-landing") {
  expect(entry).toContain('data-ipw-action-message="Sign-in demo opened. Connect this button to your authentication page."');
  expect(entry).toContain('data-ipw-action-status');
}
```

- [ ] **Step 2: Run the focused test and verify the new assertion fails**

Run:

```powershell
& 'C:\Users\Lenovo\AppData\Roaming\npm\bun.cmd' test src/templates.test.ts --test-name-pattern "observable actions"
```

Expected: FAIL because the pricing toggle attributes and SaaS status hooks do not exist.

- [ ] **Step 3: Implement the pricing template's monthly/yearly switch and CTA feedback**

In `ipollowork.html-anything.pricing-page/entry.html`:

- give each button `type="button"`;
- mark the two billing controls with `data-ipw-toggle="monthly"` and `data-ipw-toggle="yearly"` plus `aria-pressed`;
- change the two numeric prices to elements with exact pairs `data-monthly="$8" data-yearly="$80"` and `data-monthly="$14" data-yearly="$140"`;
- mark plan buttons with the exact messages below;
- add `<p class="action-status" data-ipw-action-status role="status" aria-live="polite"></p>` after the tier section;
- add status styling and this isolated runtime before `</body>`:

```html
<script>
  (() => {
    const status = document.querySelector('[data-ipw-action-status]');
    const toggles = document.querySelectorAll('[data-ipw-toggle]');
    const prices = document.querySelectorAll('.price[data-monthly][data-yearly]');
    const selectBilling = (period) => {
      toggles.forEach((button) => {
        const selected = button.dataset.ipwToggle === period;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      prices.forEach((price) => {
        price.firstChild.textContent = `${period === 'yearly' ? price.dataset.yearly : price.dataset.monthly} `;
        const suffix = price.querySelector('small');
        if (suffix) suffix.textContent = period === 'yearly' ? '/ year' : price.dataset.monthly === '$14' ? '/ seat / month' : '/ month';
      });
    };
    toggles.forEach((button) => button.addEventListener('click', () => selectBilling(button.dataset.ipwToggle)));
    document.querySelectorAll('[data-ipw-action-message]').forEach((button) => {
      button.addEventListener('click', () => { if (status) status.textContent = button.dataset.ipwActionMessage || ''; });
    });
  })();
</script>
```

Use these fallback messages:

```html
data-ipw-action-message="Solo plan selected. Connect this button to your checkout flow."
data-ipw-action-message="Team plan selected. Connect this button to your checkout flow."
data-ipw-action-message="Sales request started. Connect this button to your contact form."
```

- [ ] **Step 4: Implement equivalent explicit feedback in both SaaS templates**

In both SaaS entry files:

- add `type="button"` and `data-ipw-action-message` to Sign in, both primary start buttons, the whitepaper button, every plan button, and the sales button;
- add `id="docs"` to the closing section in the `html-anything` copy so the existing Docs fragment resolves;
- add `<p class="action-status" data-ipw-action-status role="status" aria-live="polite"></p>` before the footer;
- append this logic inside the existing IIFE after mobile-navigation listeners:

```js
const status = document.querySelector('[data-ipw-action-status]');
document.querySelectorAll('[data-ipw-action-message]').forEach((button) => {
  button.addEventListener('click', () => {
    if (status) status.textContent = button.dataset.ipwActionMessage || '';
  });
});
```

Use exact intent-matched messages, including:

```html
data-ipw-action-message="Sign-in demo opened. Connect this button to your authentication page."
data-ipw-action-message="Trial selected. Connect this button to your signup flow."
data-ipw-action-message="Whitepaper requested. Connect this button to your document download."
data-ipw-action-message="Solo plan selected. Connect this button to your checkout flow."
data-ipw-action-message="Team plan selected. Connect this button to your checkout flow."
data-ipw-action-message="Sales request started. Connect this button to your contact form."
```

- [ ] **Step 5: Run the focused test and confirm this template group passes its assertions**

Run:

```powershell
& 'C:\Users\Lenovo\AppData\Roaming\npm\bun.cmd' test src/templates.test.ts --test-name-pattern "observable actions"
```

Expected: the pricing/SaaS-specific assertions PASS; the suite may remain red only for controls in Tasks 3 and 4.

- [ ] **Step 6: Commit the pricing and SaaS behavior**

```powershell
git add apps/server/src/templates.test.ts apps/server/bundled-templates/ipollowork.html-anything.pricing-page/entry.html apps/server/bundled-templates/ipollowork.html-anything.saas-landing/entry.html apps/server/bundled-templates/ipollowork.saas-landing/entry.html
git commit -m "fix: make SaaS template actions interactive"
```

---

### Task 3: Repair prototype navigation and CTA behavior

**Files:**
- Modify: `apps/server/bundled-templates/ipollowork.html-anything.prototype-web/entry.html:52`
- Modify: `apps/server/bundled-templates/ipollowork.html-anything.web-proto-editorial/entry.html:268`
- Modify: `apps/server/bundled-templates/ipollowork.html-anything.web-proto-soft/entry.html:421`
- Test: `apps/server/src/templates.test.ts`

**Interfaces:**
- Consumes: existing section ids and `data-ipw-action-message` fallback declarations.
- Produces: no `href="#"`, no missing fragment destination, explicit button types, and shared accessible status feedback in each prototype.

- [ ] **Step 1: Add a failing assertion that these prototypes contain no placeholder links**

Inside the website catalog loop add:

```ts
if ([
  "ipollowork.html-anything.prototype-web",
  "ipollowork.html-anything.web-proto-editorial",
  "ipollowork.html-anything.web-proto-soft",
].includes(manifest.id)) {
  expect(entry).not.toContain('href="#"');
  expect(entry).toContain('data-ipw-action-status');
}
```

- [ ] **Step 2: Run the focused test and confirm it fails on placeholder links**

Run:

```powershell
& 'C:\Users\Lenovo\AppData\Roaming\npm\bun.cmd' test src/templates.test.ts --test-name-pattern "observable actions"
```

Expected: FAIL because all three prototypes currently contain placeholder or missing fragment links.

- [ ] **Step 3: Convert `prototype-web` controls to real anchors where destinations exist**

Apply these exact mappings:

```text
logo -> #top
desktop About -> #features
pricing Get started -> #cta
pricing About -> #features
pricing Solutions -> #voices
closing CTA -> #cta
footer About -> #features
footer Contact -> #voices
footer Get started -> #cta
```

Add `id="top"` to the first hero section. Replace the three pricing `<button>` elements with `<a href="...">` while preserving their class lists. This template then uses native section navigation and needs no fallback status region.

- [ ] **Step 4: Repair editorial prototype navigation and annotate fallback CTAs**

In `web-proto-editorial/entry.html`:

- change Changelog navigation to `href="#bento-history"`;
- change footer Manual, Changelog, Status, Privacy to existing sections `#bento`, `#bento-history`, `#contrast`, `#pricing`;
- map Read the manual to a native `<a class="btn-link" href="#bento">`;
- add `type="button"` and exact `data-ipw-action-message` values to Open workspace, Request access, Start solo, Start studio, and Open a thread;
- add one `[data-ipw-action-status]` live region before the footer;
- keep the existing nav and observer code inside its IIFE and append the shared status listener before `})();`.

Use exact messages such as `Workspace preview opened. Connect this button to your app entry point.` and `Access request prepared. Connect this button to your request form.` without claiming external completion.

- [ ] **Step 5: Repair soft prototype navigation and annotate fallback CTAs**

In `web-proto-soft/entry.html`:

- add `id="metrics"` to the marquee section, `id="docs"` to the closing section, and `id="changelog"` to the footer;
- replace footer `href="#"` values with `#docs`, `#changelog`, `#metrics`, `#topnav`, and `#closing` in displayed order;
- map Read the runtime spec to `<a class="ghost" href="#bento">`;
- add `type="button"` and explicit fallback messages to Get started, Open the console, and Talk to an engineer;
- add one shared live status region before the footer;
- append the status listener inside the existing IIFE before `})();`.

- [ ] **Step 6: Run the focused test and confirm every website now passes the admission gate**

Run:

```powershell
& 'C:\Users\Lenovo\AppData\Roaming\npm\bun.cmd' test src/templates.test.ts --test-name-pattern "observable actions"
```

Expected: the three prototype-specific assertions PASS; the suite remains red only because the waitlist script is not isolated until Task 4.

- [ ] **Step 7: Commit the prototype fixes**

```powershell
git add apps/server/src/templates.test.ts apps/server/bundled-templates/ipollowork.html-anything.prototype-web/entry.html apps/server/bundled-templates/ipollowork.html-anything.web-proto-editorial/entry.html apps/server/bundled-templates/ipollowork.html-anything.web-proto-soft/entry.html
git commit -m "fix: wire website prototype entry actions"
```

---

### Task 4: Isolate the waitlist form and add runtime behavior tests

**Files:**
- Modify: `apps/server/src/templates.test.ts:269`
- Modify: `apps/server/bundled-templates/ipollowork.html-anything.waitlist-page/entry.html:406`
- Verify unchanged: `apps/server/bundled-templates/ipollowork.html-anything.web-proto-brutalist/entry.html`
- Verify unchanged: `apps/server/bundled-templates/ipollowork.html-anything.wireframe-sketch/entry.html`

**Interfaces:**
- Consumes: the final nine website entries and Bun's ability to execute isolated runtime snippets with a minimal DOM fixture.
- Produces: an isolated waitlist form runtime plus focused behavior coverage for navigation declarations, pricing toggle state, valid form submission, and fallback CTA status updates.

- [ ] **Step 1: Add focused behavior assertions for the native controls**

Add a separate test:

```ts
test("keeps native website interactions explicit", async () => {
  const waitlist = await readFile(join(bundledTemplatesRoot, "ipollowork.html-anything.waitlist-page", "entry.html"), "utf8");
  const brutalist = await readFile(join(bundledTemplatesRoot, "ipollowork.html-anything.web-proto-brutalist", "entry.html"), "utf8");
  const wireframe = await readFile(join(bundledTemplatesRoot, "ipollowork.html-anything.wireframe-sketch", "entry.html"), "utf8");
  expect(waitlist).toContain('id="waitlist-form"');
  expect(waitlist).toContain("checkValidity()");
  expect(waitlist).toContain("success-msg");
  expect(brutalist).toContain('href="#abstract"');
  expect(brutalist).toContain('href="#specimen"');
  expect(brutalist).toContain("mobile-nav-toggle");
  expect(wireframe).not.toMatch(/<button\\b|<a\\b/i);
});
```

- [ ] **Step 2: Run the website tests and confirm the isolation gate fails on the waitlist script**

Run:

```powershell
& 'C:\Users\Lenovo\AppData\Roaming\npm\bun.cmd' test src/templates.test.ts --test-name-pattern "observable actions|native website interactions"
```

Expected: the native-interaction assertions PASS, while the admission gate fails at `scriptsAreIsolated` for the waitlist template.

- [ ] **Step 3: Wrap the waitlist submit handler in an isolated scope**

Replace its inline script with:

```html
<script>
  (() => {
    const form = document.getElementById('waitlist-form');
    if (!form) return;
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      if (!this.checkValidity()) {
        this.reportValidity();
        return;
      }
      this.style.display = 'none';
      document.getElementById('success-msg')?.classList.add('visible');
    });
  })();
</script>
```

- [ ] **Step 4: Add a runtime test for the pricing switch and fallback status listener**

Add this test fixture and test inside `templates.test.ts`; it extracts the final inline script from `pricing-page`, executes it against local test doubles, and invokes the captured yearly and CTA click handlers:

```ts
function interactiveButton(dataset: Record<string, string>) {
  const attributes = new Map<string, string>();
  const listeners = new Map<string, () => void>();
  return {
    dataset,
    attributes,
    listeners,
    classList: { toggle: (_name: string, _active: boolean) => undefined },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
  };
}

test("runs website toggle and fallback interactions without leaking globals", async () => {
  const entry = await readFile(
    join(bundledTemplatesRoot, "ipollowork.html-anything.pricing-page", "entry.html"),
    "utf8",
  );
  const scripts = Array.from(
    entry.matchAll(/<script(?![^>]*\\bsrc=)[^>]*>([\\s\\S]*?)<\\/script>/gi),
    (match) => match[1],
  );
  const script = scripts.at(-1);
  if (!script) throw new Error("Pricing interaction script is missing");

  const monthly = interactiveButton({ ipwToggle: "monthly" });
  const yearly = interactiveButton({ ipwToggle: "yearly" });
  const team = interactiveButton({ ipwActionMessage: "Team plan selected. Connect this button to your checkout flow." });
  const status = { textContent: "" };
  const soloSuffix = { textContent: "/ month" };
  const teamSuffix = { textContent: "/ seat / month" };
  const soloPrice = {
    dataset: { monthly: "$8", yearly: "$80" },
    firstChild: { textContent: "$8 " },
    querySelector: (selector: string) => selector === "small" ? soloSuffix : null,
  };
  const teamPrice = {
    dataset: { monthly: "$14", yearly: "$140" },
    firstChild: { textContent: "$14 " },
    querySelector: (selector: string) => selector === "small" ? teamSuffix : null,
  };
  const documentFixture = {
    querySelector: (selector: string) => selector === "[data-ipw-action-status]" ? status : null,
    querySelectorAll: (selector: string) => {
      if (selector === "[data-ipw-toggle]") return [monthly, yearly];
      if (selector === ".price[data-monthly][data-yearly]") return [soloPrice, teamPrice];
      if (selector === "[data-ipw-action-message]") return [team];
      return [];
    },
  };

  new Function("document", script)(documentFixture);
  yearly.listeners.get("click")?.();
  team.listeners.get("click")?.();

expect(yearly.attributes.get("aria-pressed")).toBe("true");
expect(monthly.attributes.get("aria-pressed")).toBe("false");
expect(soloPrice.firstChild.textContent).toBe("$80 ");
expect(status.textContent).toBe("Team plan selected. Connect this button to your checkout flow.");
});
```

Do not add a browser DOM dependency.

- [ ] **Step 5: Run both focused interaction tests**

Run:

```powershell
& 'C:\Users\Lenovo\AppData\Roaming\npm\bun.cmd' test src/templates.test.ts --test-name-pattern "website toggle|native website"
```

Expected: 2 PASS, 0 FAIL.

- [ ] **Step 6: Run the complete server template suite**

Run:

```powershell
& 'C:\Users\Lenovo\AppData\Roaming\npm\bun.cmd' test src/templates.test.ts
```

Expected: all template tests PASS with no syntax error or unhandled rejection.

- [ ] **Step 7: Commit the isolated form and behavior coverage**

```powershell
git add apps/server/src/templates.test.ts apps/server/bundled-templates/ipollowork.html-anything.waitlist-page/entry.html
git commit -m "test: cover website template interactions"
```

---

### Task 5: Prove the real Design-preview interaction path with fraimz

**Files:**
- Modify: `apps/app/src/react-app/domains/session/chat/session-page.tsx:1040`
- Modify: `apps/app/tests/design-html-runtime.test.ts:1`
- Create: `evals/voiceovers/website-template-actions.md`
- Create: `evals/flows/website-template-actions.flow.mjs`

**Interfaces:**
- Consumes: the existing development-only `window.__ipolloworkControl` API and the production `ipollowork.saas-landing` materialization path.
- Produces: development action `eval.design.seed_website_actions` returning `{ path: string }` and fraimz frames proving a native section link and fallback CTA acknowledgement inside the real Design iframe.

- [ ] **Step 1: Add a failing source-level test for the new deterministic eval action**

In `apps/app/tests/design-html-runtime.test.ts`, add:

```ts
test("keeps the website action eval on the real bundled template path", async () => {
  const source = await Bun.file(new URL(
    "../src/react-app/domains/session/chat/session-page.tsx",
    import.meta.url,
  )).text();
  expect(source).toContain('id: "eval.design.seed_website_actions"');
  expect(source).toContain('"ipollowork.saas-landing"');
  const actionStart = source.indexOf('id: "eval.design.seed_website_actions"');
  const actionEnd = source.indexOf('id: "eval.design.seed_deck"', actionStart);
  expect(source.slice(actionStart, actionEnd)).not.toContain("const content = `<!doctype html>");
});
```

- [ ] **Step 2: Run the focused app test and confirm it fails because the action does not exist**

Run:

```powershell
& 'C:\Users\Lenovo\AppData\Roaming\npm\bun.cmd' test tests/design-html-runtime.test.ts --test-name-pattern "website action eval"
```

Expected: FAIL because `eval.design.seed_website_actions` is absent.

- [ ] **Step 3: Add the deterministic development-only control action**

Next to `seedDesignHtmlControlAction`, add `seedWebsiteActionsControlAction` with:

```ts
const seedWebsiteActionsControlAction = useMemo<iPolloWorkControlAction | null>(() => {
  if (!import.meta.env.DEV) return null;
  return {
    id: "eval.design.seed_website_actions",
    label: "Seed interactive website template",
    description: "Materialize the bundled interactive website template in Design.",
    sideEffect: "mutation",
    disabled: !props.ipolloworkServerClient || !props.runtimeWorkspaceId || !props.selectedSessionId || props.selectedWorkspaceDisplay.workspaceType === "remote",
    execute: async () => {
      if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId || !props.selectedSessionId) {
        return { ok: false, error: "Workspace client is not ready." };
      }
      await props.ipolloworkServerClient.installTemplate(props.runtimeWorkspaceId, "ipollowork.saas-landing");
      const materialized = await props.ipolloworkServerClient.materializeTemplate(
        props.runtimeWorkspaceId,
        "ipollowork.saas-landing",
        props.selectedSessionId,
      );
      setSessionType(props.selectedSessionId, sessionTypeForTemplate(materialized.manifest));
      setTemplateSessionData({ ...materialized, hasBrief: true });
      setSessionTypeRevision((value) => value + 1);
      setTemplateSessionRevision((value) => value + 1);
      setCurrentSidePanel("design");
      return { ok: true, path: materialized.state.entry };
    },
  };
}, [props.ipolloworkServerClient, props.runtimeWorkspaceId, props.selectedSessionId, props.selectedWorkspaceDisplay.workspaceType, setCurrentSidePanel]);
```

Register it beside the existing eval actions in the control action array. Do not write or replace template HTML.

- [ ] **Step 4: Run the focused app test and verify it passes**

Run:

```powershell
& 'C:\Users\Lenovo\AppData\Roaming\npm\bun.cmd' test tests/design-html-runtime.test.ts --test-name-pattern "website action eval"
```

Expected: PASS.

- [ ] **Step 5: Write the approved two-frame voiceover**

Create `evals/voiceovers/website-template-actions.md`:

```markdown
# website-template-actions — bundled website controls respond in Design

1. I open the bundled SaaS website in Design and use its Pricing navigation; the real page moves to the pricing section instead of ignoring the click.

2. I choose the Team plan and the template immediately acknowledges the selection in the page, without pretending that a purchase completed.
```

- [ ] **Step 6: Implement the fraimz flow against the real Design iframe**

Create `evals/flows/website-template-actions.flow.mjs` using `design-html-editor.flow.mjs`'s `withPreviewClient` pattern. The flow must:

1. create a task and wait for `eval.design.seed_website_actions`;
2. execute it and wait for `[data-testid="design-panel"] iframe` to load;
3. connect to the `about:srcdoc` iframe target;
4. click `a[href="#pricing"]`, assert `document.getElementById("pricing")` exists and the active scroll position changed toward it, and capture a screenshot;
5. click `[data-ipw-action-message^="Team plan selected"]`, assert `[data-ipw-action-status].textContent` equals the declared message, and capture a screenshot.

Use `loadVoiceoverParagraphs("website-template-actions")`, `ctx.prove`, and observable assertions in both frames.

- [ ] **Step 7: Run unit/type validation before the UI proof**

Run:

```powershell
& 'C:\Users\Lenovo\AppData\Roaming\npm\bun.cmd' test tests/design-html-runtime.test.ts
& 'C:\Users\Lenovo\AppData\Roaming\npm\pnpm.cmd' --filter @ipollowork/app typecheck
```

Expected: both commands PASS.

- [ ] **Step 8: Run fraimz against a development Electron app**

With the app running on its configured CDP port, run:

```powershell
& 'C:\Users\Lenovo\AppData\Roaming\npm\pnpm.cmd' fraimz --flow website-template-actions --cdp-url http://127.0.0.1:9823
```

Expected: verdict `PASSED`, two validated screenshot frames, and a reported `evals/results/<run-id>/fraimz.html` path. If the local Electron app cannot be started, report the proof as `Incomplete` with this exact reproduction command; do not claim end-to-end success.

- [ ] **Step 9: Commit the production-path proof harness**

```powershell
git add apps/app/src/react-app/domains/session/chat/session-page.tsx apps/app/tests/design-html-runtime.test.ts evals/voiceovers/website-template-actions.md evals/flows/website-template-actions.flow.mjs
git commit -m "test: prove website template actions in Design"
```

---

### Task 6: Final verification and scope audit

**Files:**
- Verify: all files changed in Tasks 1–5.

**Interfaces:**
- Consumes: the complete implementation and tests.
- Produces: a clean, evidence-backed handoff with no unrelated files staged or committed.

- [ ] **Step 1: Run the complete targeted verification set**

```powershell
& 'C:\Users\Lenovo\AppData\Roaming\npm\bun.cmd' test src/templates.test.ts
& 'C:\Users\Lenovo\AppData\Roaming\npm\bun.cmd' test tests/design-html-runtime.test.ts
& 'C:\Users\Lenovo\AppData\Roaming\npm\pnpm.cmd' --filter @ipollowork/server typecheck
& 'C:\Users\Lenovo\AppData\Roaming\npm\pnpm.cmd' --filter @ipollowork/app typecheck
```

Expected: every command exits 0.

- [ ] **Step 2: Check formatting and unintended scope**

```powershell
git diff --check HEAD~5
git status --short
git diff --name-only HEAD~5
```

Expected: no whitespace errors; changed implementation files are limited to the website templates, template tests, the development-only eval hook, and the new fraimz flow/voiceover. Existing unrelated dirty-worktree files remain untouched and unstaged.

- [ ] **Step 3: Re-run the website script/global-scope check explicitly**

```powershell
& 'C:\Users\Lenovo\AppData\Roaming\npm\bun.cmd' test src/templates.test.ts --test-name-pattern "observable actions"
```

Expected: PASS for all nine templates, proving combined inline scripts parse and no inline script exposes a top-level lexical declaration.

- [ ] **Step 4: Record the final evidence**

In the handoff, report:

```text
- server template test command and pass count
- app runtime test command and pass count
- both typecheck commands and exit status
- fraimz verdict and absolute fraimz.html path, or an explicit Incomplete reason
- exact list of website templates changed
```
