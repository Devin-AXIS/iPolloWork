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
