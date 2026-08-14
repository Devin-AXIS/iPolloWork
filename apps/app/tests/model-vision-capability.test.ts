import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { modelSupportsVision } from "../src/app/utils/model-capabilities";

const useModelPickerSource = readFileSync(
  join(import.meta.dir, "../src/react-app/domains/session/modals/use-model-picker.ts"),
  "utf8",
);
const modelSelectSource = readFileSync(
  join(import.meta.dir, "../src/components/model-select.tsx"),
  "utf8",
);
const modelPickerModalSource = readFileSync(
  join(import.meta.dir, "../src/react-app/domains/session/modals/model-picker-modal.tsx"),
  "utf8",
);

describe("model vision capability labels", () => {
  test("detects image input support from provider catalog metadata", () => {
    expect(
      modelSupportsVision({
        capabilities: {
          input: {
            image: true,
          },
        },
      }),
    ).toBe(true);
    expect(modelSupportsVision({ capabilities: { input: { image: false } } })).toBe(false);
    expect(modelSupportsVision({ capabilities: {} })).toBe(false);
  });

  test("passes vision support into both model option loaders", () => {
    expect(useModelPickerSource).toContain("supportsVision: modelSupportsVision(model)");
    expect(modelSelectSource).toContain("supportsVision: modelSupportsVision(model)");
  });

  test("renders the vision badge in compact and full model pickers", () => {
    expect(modelSelectSource).toContain('option.supportsVision ? t("model_picker.badge_vision")');
    expect(modelPickerModalSource).toContain('opt.supportsVision ? t("model_picker.badge_vision")');
  });
});
