import { describe, expect, it } from "vitest";
import { applyVariableBindings } from "./applyVariableBindings";

function structuredDocument(defaultValue: string) {
  (window as Window & { __hfVariables?: Record<string, unknown> }).__hfVariables = {
    title: defaultValue,
  };
  const testDocument = document.implementation.createHTMLDocument("structured text");
  testDocument.body.innerHTML = `
    <main data-composition-id="main">
      <h1 data-var-text="title" data-ipw-motion-structure="v1" data-ipw-motion-source='"Make motion clear."'>
        <span data-ipw-motion-role="unit"><span data-ipw-motion-role="text">Make</span></span>
        <span data-ipw-motion-role="unit"><span data-ipw-motion-role="text">motion</span></span>
        <span data-ipw-motion-role="unit"><span data-ipw-motion-role="text">clear.</span></span>
      </h1>
    </main>
  `;
  return testDocument;
}

function splitDocument(defaultValue: string, characters = false) {
  (window as Window & { __hfVariables?: Record<string, unknown> }).__hfVariables = {
    title: defaultValue,
  };
  const characterMarkup = characters
    ? '<span data-ipw-motion-char="">M</span><span data-ipw-motion-char="">a</span><span data-ipw-motion-char="">k</span><span data-ipw-motion-char="">e</span>'
    : "Make";
  const testDocument = document.implementation.createHTMLDocument("split text");
  testDocument.body.innerHTML = `
    <main data-composition-id="main">
      <h1 data-var-text="title" data-ipw-motion-split="v1">
        <span data-ipw-motion-word="">${characterMarkup}</span>
        <span data-ipw-motion-word="">motion</span>
        <span data-ipw-motion-word="">clear.</span>
      </h1>
    </main>
  `;
  return testDocument;
}

describe("applyVariableBindings structured text", () => {
  it("does not duplicate an unchanged variable value beside structured units", () => {
    const document = structuredDocument("Make motion clear.");

    applyVariableBindings(document);

    const target = document.querySelector("h1")!;
    expect(
      Array.from(target.childNodes).filter(
        (node) => node.nodeType === Node.TEXT_NODE && node.nodeValue?.trim(),
      ),
    ).toHaveLength(0);
    expect(target.querySelectorAll('[data-ipw-motion-role="unit"]')).toHaveLength(3);
    expect(target.textContent?.replace(/\s+/g, " ").trim()).toBe("Make motion clear.");
  });

  it("prefers an overridden variable value over a stale structured animation", () => {
    const document = structuredDocument("A different title");

    applyVariableBindings(document);

    const target = document.querySelector("h1")!;
    expect(target.textContent).toBe("A different title");
    expect(target.querySelector('[data-ipw-motion-role="unit"]')).toBeNull();
  });

  it("re-segments variable-bound word motion instead of degrading it to whole text", () => {
    const document = splitDocument("Exact motion fidelity");

    applyVariableBindings(document);

    const target = document.querySelector("h1")!;
    expect(target.querySelectorAll(':scope > [data-ipw-motion-word]')).toHaveLength(3);
    expect(target.querySelector("[data-ipw-motion-char]")).toBeNull();
    expect(target.textContent).toBe("Exact motion fidelity");
  });

  it("keeps character markers when a variable-bound character animation changes text", () => {
    const document = splitDocument("New title", true);

    applyVariableBindings(document);

    const target = document.querySelector("h1")!;
    expect(target.querySelectorAll(':scope > [data-ipw-motion-word]')).toHaveLength(2);
    expect(target.querySelectorAll("[data-ipw-motion-char]")).toHaveLength(8);
    expect(target.textContent).toBe("New title");
  });
});

import { onVariablesChange, updateVariables } from "./applyVariableBindings";
import { updateTextVariableBinding } from "@hyperframes/parsers/composition";

describe("shared native variable transactions", () => {
  it("updates one instance and JSON data cells without replacing animation targets", () => {
    document.body.innerHTML = `<main data-composition-id="one"><span data-var-text="/items/rows/0/value"><i id="animated"></i></span></main><main data-composition-id="two"><span data-var-text="heading">Other animating</span></main>`;
    const win = window as Window & { __hfVariablesByComp?: Record<string, Record<string, unknown>> };
    win.__hfVariablesByComp = { one: { items: JSON.stringify({ rows: [{ value: 2 }] }) }, two: { heading: "Other" } };
    const target = document.getElementById("animated");
    const root = document.querySelector("main")!;
    expect(updateVariables(root, { items: JSON.stringify({ rows: [{ value: 8 }] }) })).toBe(true);
    expect(root.querySelector("span")?.textContent).toBe("8");
    expect(document.getElementById("animated")).toBe(target);
    expect(document.querySelectorAll("main")[1]!.textContent).toBe("Other animating");
  });

  it("refuses invalid data and restores the previous scoped value and geometry", () => {
    document.body.innerHTML = `<main data-composition-id="test"><span data-var-text="value">1</span></main>`;
    const root = document.querySelector("main")!;
    const win = window as Window & { __hfVariablesByComp?: Record<string, Record<string, unknown>> };
    win.__hfVariablesByComp = { test: { value: 1 } };
    onVariablesChange(root, (values) => {
      if (Number(values.value) < 0) throw new Error("Invalid value");
      root.setAttribute("data-geometry", String(values.value));
    });
    expect(() => updateVariables(root, { value: -1 })).toThrow("Invalid value");
    expect(win.__hfVariablesByComp.test!.value).toBe(1);
    expect(root.getAttribute("data-geometry")).toBe("1");
    expect(root.textContent).toBe("1");
  });

  it("isolates uniquely named mounts that retain the same authored inner composition id", () => {
    document.body.innerHTML = `<section data-composition-id="metric" data-composition-file="metric.html"><div data-composition-id="metric"><span data-var-text="value">2</span></div></section><section data-composition-id="metric_2" data-composition-file="metric.html"><div data-composition-id="metric"><span data-var-text="value">3</span></div></section>`;
    const win = window as Window & { __hfVariablesByComp?: Record<string, Record<string, unknown>> };
    win.__hfVariablesByComp = { metric: { value: 2 }, metric_2: { value: 3 } };
    const roots = document.querySelectorAll("section > div");
    expect(updateVariables(roots[0]!, { value: 8 })).toBe(true);
    applyVariableBindings(document);
    expect(Array.from(roots, root => root.textContent)).toEqual(["8", "3"]);
    expect(updateVariables(roots[1]!, { value: 9 })).toBe(true);
    applyVariableBindings(document);
    expect(Array.from(roots, root => root.textContent)).toEqual(["8", "9"]);
  });

  it("canvas cell edits preserve numerical types, siblings and the common data document", () => {
    const items = JSON.stringify({ version: 1, kind: "category-value", rows: [{ id: "a", value: 2, label: "中文" }] });
    const update = updateTextVariableBinding("/items/rows/0/value", { items }, "4.5")!;
    expect(JSON.parse(String(update.value)).rows).toEqual([{ id: "a", value: 4.5, label: "中文" }]);
    expect(() => updateTextVariableBinding("/items/rows/0/value", { items }, "NaN")).toThrow();
    expect(() => updateTextVariableBinding("/items/__proto__/bad", { items }, "bad")).toThrow();
  });
});
