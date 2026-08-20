/** @jsxImportSource react */
import * as React from "react";
import type { ProjectAgent } from "@ipollowork/types/project-workspace";
import {
  DEFAULT_ENGINE_ID,
  DEEPSEEK_HARNESS_ENGINE_ID,
} from "@ipollowork/types/workspace";
import { KeyRound, Package, Pencil, RefreshCw, Sparkles, Trash2, X } from "lucide-react";

import { formatGenericBehaviorLabel, getModelBehaviorSummary } from "@/app/lib/model-behavior";
import type {
  iPolloWorkPluginAuthorizationState,
  iPolloWorkPluginPackageItem,
} from "@/app/lib/ipollowork-server";
import type { ModelRef, ProviderListItem } from "@/app/types";
import { resolveModelDisplayName } from "@/app/utils";
import { ModelBehaviorMenu } from "@/components/model-behavior-menu";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { resolveExtensionIconUrl } from "@/react-app/design-system/extension-icon-src";

import { AgentAvatar, pluginNeedsConfiguration } from "./project-overview-shared";
import { ProjectResourcePicker, type ProjectResourceOption } from "./project-resource-picker";

type ProjectAgentInspectorProps = {
  open: boolean;
  agent: ProjectAgent | null;
  isNew: boolean;
  isPrimary: boolean;
  canDelete: boolean;
  plugins: iPolloWorkPluginPackageItem[];
  authorizations: Record<string, iPolloWorkPluginAuthorizationState>;
  providers: ProviderListItem[];
  projectModel: ModelRef;
  projectEngineId: string | null | undefined;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (agent: ProjectAgent, primary: boolean) => void;
  onDelete: () => void;
  onAuthorizePlugin: (pluginId: string) => void;
  onConfigureModels?: (providerId?: string) => void;
  onConfigureTokenStar?: () => void;
};

type SkillOption = ProjectResourceOption & { pluginId: string };

const INHERIT_ENGINE_VALUE = "inherit-project";

function DetailRow(props: { label: string; value: string; detail?: string }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-4 px-3.5 py-3 text-[12px]">
      <dt className="text-dls-tertiary">{props.label}</dt>
      <dd className="min-w-0 text-right font-medium text-dls-text">
        <span className="block truncate">{props.value}</span>
        {props.detail ? <span className="mt-0.5 block text-[9px] font-normal text-dls-tertiary">{props.detail}</span> : null}
      </dd>
    </div>
  );
}

function PluginIcon({ item }: { item: iPolloWorkPluginPackageItem }) {
  const iconUrl = resolveExtensionIconUrl({
    pluginId: item.pluginId,
    iconSrc: item.manifest.icon?.src,
    iconSlug: item.manifest.icon?.simpleIconSlug,
  });
  return (
    <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-dls-hover">
      {iconUrl ? <img src={iconUrl} alt="" className="size-5 object-contain" /> : <Package className="size-4 text-dls-secondary" />}
    </span>
  );
}

export function ProjectAgentInspector(props: ProjectAgentInspectorProps) {
  const [draft, setDraft] = React.useState<ProjectAgent | null>(props.agent);
  const [primary, setPrimary] = React.useState(props.isPrimary);
  const [editing, setEditing] = React.useState(props.isNew);

  React.useEffect(() => {
    if (!props.open) return;
    setDraft(props.agent);
    setPrimary(props.isPrimary);
    setEditing(props.isNew);
  }, [props.agent, props.isNew, props.isPrimary, props.open]);

  if (!draft) return null;
  const effectiveModel: ModelRef = draft.runtime.model
    ? { providerID: draft.runtime.model.providerId, modelID: draft.runtime.model.modelId }
    : props.projectModel;
  const selectedProvider = props.providers.find((provider) => provider.id === effectiveModel.providerID);
  const selectedModelDefinition = selectedProvider?.models[effectiveModel.modelID];
  const behavior = selectedModelDefinition
    ? getModelBehaviorSummary(effectiveModel.providerID, selectedModelDefinition, draft.runtime.modelVariant, selectedProvider?.name)
    : {
      label: formatGenericBehaviorLabel(draft.runtime.modelVariant),
      value: draft.runtime.modelVariant,
      options: [],
    };
  const modelLabel = resolveModelDisplayName(effectiveModel.modelID) || effectiveModel.modelID;
  const modelSummary = behavior.options.length ? `${modelLabel} · ${behavior.label}` : modelLabel;
  const projectEngineId = props.projectEngineId?.trim() || DEFAULT_ENGINE_ID;
  const engineLabel = draft.runtime.engineId === DEFAULT_ENGINE_ID
    ? t("projects.engine_opencode")
    : draft.runtime.engineId === DEEPSEEK_HARNESS_ENGINE_ID
      ? t("projects.engine_dsh")
      : draft.runtime.engineId || t("project_overview.inherit_project");
  const modeLabel = draft.runtime.mode === "plan"
    ? t("project_overview.mode_plan")
    : draft.runtime.mode === "execute"
      ? t("project_overview.mode_execute")
      : t("project_overview.mode_auto");
  const skillOptions: SkillOption[] = props.plugins.flatMap((item) => item.manifest.resources
    .filter((resource) => resource.type === "skill" && !item.disabledResourceIds.includes(resource.id))
    .map((resource) => ({
      id: `${item.pluginId}:${resource.id}`,
      label: resource.label?.trim() || resource.id,
      description: resource.description?.trim() || item.name,
      pluginId: item.pluginId,
      icon: <Sparkles className="size-4 shrink-0 text-dls-secondary" />,
    })));
  const selectedPlugins = draft.pluginIds.map((id) => ({
    id,
    item: props.plugins.find((plugin) => plugin.pluginId === id),
  }));
  const selectedSkills = draft.skillIds.map((id) => skillOptions.find((skill) => skill.id === id) ?? {
    id,
    label: id.split(":").at(-1) || id,
    description: t("project_overview.unavailable_resource"),
    pluginId: id.split(":")[0] || "",
    icon: <Sparkles className="size-4 shrink-0 text-dls-secondary" />,
  });
  const pluginPickerItems: ProjectResourceOption[] = props.plugins
    .filter((item) => !draft.pluginIds.includes(item.pluginId))
    .map((item) => ({
      id: item.pluginId,
      label: item.name,
      description: item.manifest.description?.trim() || item.name,
      icon: <PluginIcon item={item} />,
    }));
  const skillPickerItems = skillOptions.filter((item) => !draft.skillIds.includes(item.id));

  const update = (next: Partial<ProjectAgent>) => setDraft((current) => current ? { ...current, ...next } : current);
  const updateRuntime = (next: Partial<ProjectAgent["runtime"]>) => setDraft((current) => current ? {
    ...current,
    runtime: { ...current.runtime, ...next },
  } : current);
  const addPlugins = (pluginIds: string[]) => setDraft((current) => current ? {
    ...current,
    pluginIds: Array.from(new Set([...current.pluginIds, ...pluginIds])),
  } : current);
  const removePlugin = (pluginId: string) => setDraft((current) => current ? {
    ...current,
    pluginIds: current.pluginIds.filter((id) => id !== pluginId),
    skillIds: current.skillIds.filter((id) => !id.startsWith(`${pluginId}:`)),
  } : current);
  const addSkills = (skillIds: string[]) => setDraft((current) => {
    if (!current) return current;
    const pluginIds = skillOptions
      .filter((item) => skillIds.includes(item.id))
      .map((item) => item.pluginId);
    return {
      ...current,
      skillIds: Array.from(new Set([...current.skillIds, ...skillIds])),
      pluginIds: Array.from(new Set([...current.pluginIds, ...pluginIds])),
    };
  });
  const beginEditing = () => {
    setDraft(props.agent);
    setPrimary(props.isPrimary);
    setEditing(true);
  };
  const cancelEditing = () => {
    if (props.isNew) {
      props.onOpenChange(false);
      return;
    }
    setDraft(props.agent);
    setPrimary(props.isPrimary);
    setEditing(false);
  };

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side="right" className="w-[min(500px,96vw)] border-l border-white/20 bg-dls-surface/92 shadow-[-24px_0_70px_rgba(20,32,58,0.16)] backdrop-blur-2xl sm:max-w-[500px]" data-testid="project-agent-inspector">
        <SheetHeader className="border-b border-dls-border/70 px-6 pb-4 pt-5">
          <div className="flex items-center gap-3 pe-10">
            <button
              type="button"
              disabled={!editing}
              className={cn(
                "relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                editing && "group cursor-pointer",
              )}
              aria-label={t("project_overview.change_avatar")}
              title={editing ? t("project_overview.change_avatar") : undefined}
              data-testid="project-agent-avatar"
              data-avatar-seed={draft.avatarSeed}
              onClick={() => update({ avatarSeed: `${draft.id}-${window.crypto.randomUUID()}` })}
            >
              <AgentAvatar agent={draft} className="size-11" />
              {editing ? (
                <span className="absolute inset-0 grid place-items-center rounded-full bg-black/42 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  <RefreshCw className="size-4" />
                </span>
              ) : null}
            </button>
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate">{draft.name}</SheetTitle>
              <SheetDescription className="mt-0.5 line-clamp-1">{draft.role || t("project_overview.agent_no_role")}</SheetDescription>
            </div>
            {!editing ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 rounded-lg border-dls-border/80 bg-dls-surface/70 px-2.5 text-[11px] shadow-none"
                data-testid="project-agent-edit"
                onClick={beginEditing}
              >
                <Pencil className="size-3.5" />
                {t("common.edit")}
              </Button>
            ) : null}
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6" data-testid="project-agent-inspector-content">
          <div className="divide-y divide-dls-border/60">
            <section className="space-y-3 py-5">
              <h3 className="text-[11px] font-medium text-dls-secondary">{t("project_overview.identity")}</h3>
              {editing ? (
                <FieldGroup className="gap-3.5">
                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
                    <Field className="gap-2">
                      <FieldLabel htmlFor="project-agent-name">{t("project_overview.agent_name")}</FieldLabel>
                      <Input id="project-agent-name" className="rounded-xl bg-dls-surface/75" value={draft.name} onChange={(event) => update({ name: event.currentTarget.value })} />
                    </Field>
                    <Field className="gap-2">
                      <FieldLabel htmlFor="project-agent-role">{t("project_overview.agent_role")}</FieldLabel>
                      <Input id="project-agent-role" className="rounded-xl bg-dls-surface/75" value={draft.role} onChange={(event) => update({ role: event.currentTarget.value })} />
                    </Field>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-dls-border/75 bg-dls-surface/62 px-3.5 py-3 text-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]">
                    <span>
                      <span className="block font-medium text-dls-text">{t("project_overview.primary_agent")}</span>
                      <span className="mt-0.5 block text-[9px] text-dls-tertiary">{t("project_overview.primary_agent_description")}</span>
                    </span>
                    <Switch
                      className="data-disabled:opacity-100"
                      checked={primary}
                      disabled={primary}
                      aria-label={t("project_overview.primary_agent")}
                      onCheckedChange={setPrimary}
                    />
                  </div>
                </FieldGroup>
              ) : (
                <dl className="divide-y divide-dls-border/60 overflow-hidden rounded-xl border border-dls-border/70 bg-dls-surface/52">
                  <DetailRow label={t("project_overview.agent_name")} value={draft.name} />
                  <DetailRow label={t("project_overview.agent_role")} value={draft.role || t("project_overview.agent_no_role")} />
                  <DetailRow
                    label={t("project_overview.agent_status")}
                    value={primary ? t("project_overview.primary") : t("project_overview.standby")}
                    detail={primary ? t("project_overview.primary_agent_description") : undefined}
                  />
                </dl>
              )}
            </section>

            <section className="space-y-3 py-5">
              <h3 className="text-[11px] font-medium text-dls-secondary">{t("project_overview.runtime")}</h3>
              {editing ? (
                <FieldGroup className="gap-3.5">
                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                    <Field className="gap-2">
                      <FieldLabel htmlFor="project-agent-engine">{t("project_overview.engine")}</FieldLabel>
                      <Select
                        value={draft.runtime.engineId ?? INHERIT_ENGINE_VALUE}
                        onValueChange={(value) => {
                          if (!value) return;
                          updateRuntime({ engineId: value === INHERIT_ENGINE_VALUE ? null : value });
                        }}
                      >
                        <SelectTrigger id="project-agent-engine" className="w-full rounded-xl bg-dls-surface/75" data-testid="project-agent-engine-select">
                          <SelectValue>{engineLabel}</SelectValue>
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectItem value={INHERIT_ENGINE_VALUE}>{t("project_overview.inherit_project")}</SelectItem>
                          <SelectItem value={projectEngineId}>
                            {projectEngineId === DEEPSEEK_HARNESS_ENGINE_ID ? t("projects.engine_dsh") : t("projects.engine_opencode")}
                          </SelectItem>
                          {draft.runtime.engineId && draft.runtime.engineId !== projectEngineId ? (
                            <SelectItem value={draft.runtime.engineId}>{draft.runtime.engineId}</SelectItem>
                          ) : null}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field className="gap-2">
                      <FieldLabel htmlFor="project-agent-mode">{t("project_overview.mode")}</FieldLabel>
                      <Select value={draft.runtime.mode} onValueChange={(value) => {
                        if (value === "auto" || value === "plan" || value === "execute") updateRuntime({ mode: value });
                      }}>
                        <SelectTrigger id="project-agent-mode" className="w-full rounded-xl bg-dls-surface/75" data-testid="project-agent-mode-select">
                          <SelectValue>{modeLabel}</SelectValue>
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectItem value="auto">{t("project_overview.mode_auto")}</SelectItem>
                          <SelectItem value="plan">{t("project_overview.mode_plan")}</SelectItem>
                          <SelectItem value="execute">{t("project_overview.mode_execute")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <p className="text-[9px] leading-4 text-dls-tertiary">{t("project_overview.runtime_new_tasks_only")}</p>
                  <Field className="gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <FieldLabel>{t("project_overview.model_and_reasoning")}</FieldLabel>
                      {draft.runtime.model ? (
                        <button type="button" className="text-[10px] text-dls-tertiary hover:text-dls-text" onClick={() => updateRuntime({ model: null, modelVariant: null })}>
                          {t("project_overview.follow_project")}
                        </button>
                      ) : null}
                    </div>
                    <ModelBehaviorMenu
                      appearance="field"
                      selectedModel={effectiveModel}
                      modelVariant={behavior.value}
                      modelVariantLabel={behavior.label}
                      options={behavior.options}
                      onModelChange={(model) => {
                        const provider = props.providers.find((item) => item.id === model.providerID);
                        const definition = provider?.models[model.modelID];
                        const nextVariant = definition ? getModelBehaviorSummary(model.providerID, definition, null, provider?.name).value : null;
                        updateRuntime({ model: { providerId: model.providerID, modelId: model.modelID }, modelVariant: nextVariant });
                      }}
                      onModelVariantChange={(modelVariant) => setDraft((current) => current ? {
                        ...current,
                        runtime: {
                          ...current.runtime,
                          model: current.runtime.model ?? {
                            providerId: effectiveModel.providerID,
                            modelId: effectiveModel.modelID,
                          },
                          modelVariant,
                        },
                      } : current)}
                      onConfigureModels={props.onConfigureModels}
                      onConfigureTokenStar={props.onConfigureTokenStar}
                    />
                  </Field>
                </FieldGroup>
              ) : (
                <dl className="divide-y divide-dls-border/60 overflow-hidden rounded-xl border border-dls-border/70 bg-dls-surface/52">
                  <DetailRow label={t("project_overview.engine")} value={engineLabel} detail={!draft.runtime.engineId ? t("project_overview.follow_project") : undefined} />
                  <DetailRow label={t("project_overview.mode")} value={modeLabel} />
                  <DetailRow label={t("project_overview.model_and_reasoning")} value={modelSummary} detail={!draft.runtime.model ? t("project_overview.follow_project") : undefined} />
                </dl>
              )}
            </section>

            <section className="space-y-3 py-5">
              <h3 className="text-[11px] font-medium text-dls-secondary">{t("project_overview.instructions")}</h3>
              {editing ? (
                <Field className="gap-2">
                  <FieldLabel htmlFor="project-agent-prompt">{t("project_overview.primary_prompt")}</FieldLabel>
                  <Textarea id="project-agent-prompt" className="min-h-32 resize-y rounded-xl bg-dls-surface/75" value={draft.prompt} placeholder={t("project_overview.primary_prompt_placeholder")} onChange={(event) => update({ prompt: event.currentTarget.value })} />
                </Field>
              ) : (
                <div className="min-h-20 rounded-xl border border-dls-border/70 bg-dls-surface/52 px-3.5 py-3 text-[12px] leading-5 text-dls-secondary">
                  {draft.prompt ? <p className="whitespace-pre-wrap text-dls-text">{draft.prompt}</p> : <p>{t("project_overview.no_prompt")}</p>}
                </div>
              )}
            </section>

            <section className="space-y-3 py-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[11px] font-medium text-dls-secondary">{t("project_overview.plugins_and_connections")}</h3>
                  <p className="mt-1 text-[9px] leading-4 text-dls-tertiary">{t("project_overview.plugins_description")}</p>
                </div>
                {editing ? <ProjectResourcePicker label={t("project_overview.add_plugin")} searchLabel={t("project_overview.search_plugins")} emptyLabel={t("project_overview.all_plugins_added")} testId="project-agent-add-plugin" items={pluginPickerItems} onAdd={addPlugins} /> : null}
              </div>
              {selectedPlugins.length ? <div className="space-y-2">
                {selectedPlugins.map(({ id, item }) => {
                  const needsConfiguration = !item || pluginNeedsConfiguration(item, props.authorizations[id]);
                  return (
                    <div key={id} data-testid="project-agent-plugin-row" className="flex items-center gap-3 rounded-xl border border-dls-border/70 bg-dls-surface/52 px-3 py-2.5">
                      {item ? <PluginIcon item={item} /> : <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-dls-hover"><Package className="size-4 text-dls-secondary" /></span>}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-dls-text">{item?.name || id}</p>
                        <p className={cn("mt-0.5 text-[9px]", needsConfiguration ? "text-amber-11" : "text-dls-tertiary")}>
                          {needsConfiguration ? t("project_overview.needs_configuration") : t("project_overview.ready")}
                        </p>
                      </div>
                      {editing && item && needsConfiguration ? <Button type="button" variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[11px]" onClick={() => props.onAuthorizePlugin(id)}><KeyRound className="size-3.5" />{t("project_overview.configure")}</Button> : null}
                      {editing ? <Button type="button" variant="ghost" size="icon-sm" className="size-7 rounded-lg text-dls-tertiary" aria-label={t("project_overview.remove_plugin", { name: item?.name || id })} onClick={() => removePlugin(id)}><X className="size-3.5" /></Button> : null}
                    </div>
                  );
                })}
              </div> : <p className="rounded-xl bg-dls-hover/35 px-3 py-3 text-[11px] text-dls-tertiary">{t("project_overview.no_plugins_assigned")}</p>}
            </section>

            <section className="space-y-3 py-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[11px] font-medium text-dls-secondary">{t("project_overview.skills")}</h3>
                {editing ? <ProjectResourcePicker label={t("project_overview.add_skill")} searchLabel={t("project_overview.search_skills")} emptyLabel={t("project_overview.all_skills_added")} testId="project-agent-add-skill" items={skillPickerItems} onAdd={addSkills} /> : null}
              </div>
              {selectedSkills.length ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {selectedSkills.map((skill) => (
                  <div key={skill.id} data-testid="project-agent-skill-row" className="flex min-w-0 items-center gap-2 rounded-xl border border-dls-border/70 bg-dls-surface/52 px-3 py-2.5">
                    {skill.icon}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium">{skill.label}</span>
                      <span className="block truncate text-[9px] text-dls-tertiary">{skill.description}</span>
                    </span>
                    {editing ? <button type="button" className="grid size-6 shrink-0 place-items-center rounded-md text-dls-tertiary hover:bg-dls-hover hover:text-dls-text" aria-label={t("project_overview.remove_skill", { name: skill.label })} onClick={() => setDraft((current) => current ? { ...current, skillIds: current.skillIds.filter((id) => id !== skill.id) } : current)}><X className="size-3.5" /></button> : null}
                  </div>
                ))}
              </div> : <p className="rounded-xl bg-dls-hover/35 px-3 py-3 text-[11px] text-dls-tertiary">{t("project_overview.no_skills_assigned")}</p>}
            </section>
          </div>
        </div>

        {editing ? (
          <SheetFooter className="flex-row items-center justify-between border-t border-dls-border/70 bg-dls-surface/72 px-6 py-4 backdrop-blur-xl">
            {props.canDelete ? <Button type="button" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={props.saving} onClick={props.onDelete}><Trash2 className="size-4" />{t("common.delete")}</Button> : <span />}
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={cancelEditing}>{t("common.cancel")}</Button>
              <Button type="button" size="sm" disabled={props.saving || !draft.name.trim()} onClick={() => props.onSave(draft, primary)}>{props.saving ? t("common.saving") : t("common.save")}</Button>
            </div>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
