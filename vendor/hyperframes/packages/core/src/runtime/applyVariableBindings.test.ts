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
});
