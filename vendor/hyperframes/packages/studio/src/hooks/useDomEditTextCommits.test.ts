// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { DomEditTextField } from "../components/editor/domEditing";
import {
  findDomTextFieldElement,
  textFieldStyleTargetsSelectedElement,
} from "./useDomEditTextCommits";

function textField(key: string, value: string): DomEditTextField {
  return {
    key,
    label: value,
    value,
    tagName: "div",
    attributes: [],
    inlineStyles: {},
    computedStyles: {},
    source: "child",
    sourceChildIndex: 0,
  };
}

describe("findDomTextFieldElement", () => {
  it("resolves the exact same-tag child selected by a text-list remove button", () => {
    const parent = document.createElement("section");
    parent.innerHTML = "<div>First</div><h1>Heading</h1><div>Second</div>";
    const first = textField("first", "First");
    const second = { ...textField("second", "Second"), sourceChildIndex: 1 };

    expect(findDomTextFieldElement(parent, [first, second], second.key)?.textContent).toBe(
      "Second",
    );
  });
});

describe("textFieldStyleTargetsSelectedElement", () => {
  it("applies direct text-node typography to the selected element", () => {
    expect(textFieldStyleTargetsSelectedElement("self")).toBe(true);
    expect(textFieldStyleTargetsSelectedElement("text-node")).toBe(true);
    expect(textFieldStyleTargetsSelectedElement("child")).toBe(false);
  });
});
