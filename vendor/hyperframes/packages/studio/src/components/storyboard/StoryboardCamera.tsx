import { useStudioI18n } from "../../i18n";
import { CAMERA_PRESETS, parseCameraPlan, serializeCameraPlan, spatialCameraValue } from "./cameraPlan";

const CAMERA_PRESET_NAMES: Record<string, string> = {
  "camera.push-in": "Focus push",
  "camera.pull-back": "Pull-back reveal",
  "camera.focus-travel": "Focus travel",
  "camera.oblique-glide": "Spatial glide",
};

export function StoryboardCamera({
  frameIndex,
  value,
  disabled,
  spatialRecipes,
  onChange,
}: {
  frameIndex: number;
  value: string;
  disabled: boolean;
  spatialRecipes: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const { tx } = useStudioI18n();
  const plan = parseCameraPlan(value);

  function update(presetIds: string[], note = plan.note) {
    onChange(serializeCameraPlan({ presetIds, note }));
  }

  function toggle(id: string) {
    const next = plan.presetIds.includes(id) ? [] : [id];
    update(next);
  }

  return (
    <div className="space-y-1.5">
      <div
        role="group"
        aria-label={`${tx("Choose camera and animation")} ${frameIndex}`}
        className="flex flex-wrap gap-1"
      >
        {CAMERA_PRESETS.map((preset) => {
          const selected = plan.presetIds.includes(preset.id);
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => toggle(preset.id)}
              className={`rounded-full border px-2 py-1 text-[10px] transition-colors ${
                selected
                  ? "border-studio-accent bg-studio-accent/10 text-[var(--hf-panel-text-0)]"
                  : "border-[var(--hf-workspace-border)] text-[var(--hf-panel-text-3)] hover:bg-[var(--hf-panel-hover)]"
              }`}
            >
              {tx(CAMERA_PRESET_NAMES[preset.id] ?? preset.label)}
            </button>
          );
        })}
      </div>

      <select
        aria-label={`${tx("Spatial camera choreography")} ${frameIndex}`}
        value={spatialRecipes.find((recipe) => plan.presetIds.includes(spatialCameraValue(recipe.value)))?.value ?? ""}
        disabled={disabled || spatialRecipes.length === 0}
        onChange={(event) => update(event.target.value ? [spatialCameraValue(event.target.value)] : [])}
        className="w-full rounded-md border border-[var(--hf-workspace-border)] bg-[var(--hf-workspace-bg)] px-2 py-1.5 text-[11px] text-[var(--hf-panel-text-2)] disabled:opacity-50"
      >
        <option value="">{tx(plan.note ? "Custom camera direction" : "AI / basic camera movement")}</option>
        {spatialRecipes.map((recipe) => <option key={recipe.value} value={recipe.value}>{recipe.label}</option>)}
      </select>

      {plan.note && <p className="text-xs leading-5 text-[var(--hf-panel-text-2)]">{plan.note}</p>}
    </div>
  );
}
