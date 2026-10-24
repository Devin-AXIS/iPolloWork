import { MOTION_PRESETS } from "@hyperframes/core/motion-presets";

export const CAMERA_PRESETS = MOTION_PRESETS.filter((preset) => preset.id.startsWith("camera."));
export const SPATIAL_CAMERA_COMPONENT = "spatial-camera-suite";
export const spatialCameraValue = (recipe: string) => `component:${SPATIAL_CAMERA_COMPONENT}#${recipe}`;

function isSpatialCamera(value: string): boolean {
  return /^component:spatial-camera-suite#[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

const CAMERA_PRESET_IDS = new Set(CAMERA_PRESETS.map((preset) => preset.id));
const CAMERA_PRESET_ALIASES: Record<string, string> = {
  "Focus push": "camera.push-in",
  "Pull-back reveal": "camera.pull-back",
  "Focus travel": "camera.focus-travel",
  "Spatial glide": "camera.oblique-glide",
};

export type CameraPlan = {
  /** One shared preset or component-owned camera recipe. Preserve older stacks when reading. */
  presetIds: string[];
  /** Optional natural-language direction appended after the selected preset. */
  note: string;
};

function resolvePresetId(value: string): string | undefined {
  if (CAMERA_PRESET_IDS.has(value)) return value;
  if (isSpatialCamera(value)) return value;
  const alias = CAMERA_PRESET_ALIASES[value];
  if (alias) return alias;
  return CAMERA_PRESETS.find((preset) => preset.label === value)?.id;
}

/** Read current and legacy values without discarding older stacked movements. */
export function parseCameraPlan(value: string): CameraPlan {
  const source = value.trim();
  if (!source) return { presetIds: [], note: "" };

  const separator = source.indexOf(" | ");
  const actionSource = separator < 0 ? source : source.slice(0, separator).trim();
  const note = separator < 0 ? "" : source.slice(separator + 3).trim();
  const actions = actionSource.split(/\s*(?:→|->|>)\s*/).filter(Boolean);
  const presetIds = actions.map(resolvePresetId);

  if (presetIds.length && presetIds.every((id): id is string => Boolean(id))) {
    return { presetIds: [...new Set(presetIds)], note };
  }

  // A lone historical catalog label is still presented as a selected action.
  const legacyId = resolvePresetId(source);
  if (legacyId) return { presetIds: [legacyId], note: "" };
  return { presetIds: [], note: source };
}

/** Keep the canonical storyboard field human-readable and stable across locales. */
export function serializeCameraPlan(plan: CameraPlan): string {
  const ids = plan.presetIds.filter((id) => CAMERA_PRESET_IDS.has(id) || isSpatialCamera(id));
  const actions = [...new Set(ids)].join(" → ");
  const note = plan.note.trim();
  if (actions && note) return `${actions} | ${note}`;
  return actions || note;
}
