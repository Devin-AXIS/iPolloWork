/** @jsxImportSource react */
import { useReducer } from "react";
import { Download, Loader2, Search } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { TextInput } from "../../../design-system/text-input";
import type { iPolloWorkClaudePluginPreview } from "../../../../app/lib/ipollowork-server";

export type ClaudePluginImportModalProps = {
  open: boolean;
  onClose: () => void;
  onPreview: (url: string) => Promise<iPolloWorkClaudePluginPreview>;
  onInstall: (url: string) => Promise<{ ok: boolean; message: string }>;
  /** Called after a successful install so the host view can refresh. */
  onInstalled?: () => void;
};

type ModalState = {
  url: string;
  preview: iPolloWorkClaudePluginPreview | null;
  /** URL the current preview was generated from; install always targets this. */
  previewedUrl: string | null;
  previewing: boolean;
  installing: boolean;
  error: string | null;
};

const initialState: ModalState = {
  url: "",
  preview: null,
  previewedUrl: null,
  previewing: false,
  installing: false,
  error: null,
};

type ModalAction =
  | Partial<ModalState>
  | "reset"
  | { kind: "preview-success"; url: string; preview: iPolloWorkClaudePluginPreview };

function reducer(state: ModalState, action: ModalAction): ModalState {
  if (action === "reset") return initialState;
  if ("kind" in action) {
    // Ignore preview responses for a URL the user has since edited away from.
    if (state.url.trim() !== action.url) return { ...state, previewing: false };
    return { ...state, previewing: false, preview: action.preview, previewedUrl: action.url };
  }
  return { ...state, ...action };
}

const COMPONENT_LABEL_KEYS: Record<string, string> = {
  mcp: "claude_plugin.component_mcp",
  skill: "claude_plugin.component_skill",
  command: "claude_plugin.component_command",
  agent: "claude_plugin.component_agent",
};

export function ClaudePluginImportModal(props: ClaudePluginImportModalProps) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const handleClose = () => {
    if (state.previewing || state.installing) return;
    dispatch("reset");
    props.onClose();
  };

  const handlePreview = async () => {
    const url = state.url.trim();
    if (!url) {
      dispatch({ error: t("claude_plugin.invalid_url") });
      return;
    }
    dispatch({ previewing: true, error: null, preview: null, previewedUrl: null });
    try {
      const preview = await props.onPreview(url);
      dispatch({ kind: "preview-success", url, preview });
    } catch (error) {
      dispatch({
        previewing: false,
        error: error instanceof Error ? error.message : t("claude_plugin.load_preview_failed"),
      });
    }
  };

  const handleInstall = async () => {
    // Install exactly what was previewed — never a URL edited after preview.
    const url = state.previewedUrl;
    if (!url || state.installing) return;
    dispatch({ installing: true, error: null });
    try {
      const result = await props.onInstall(url);
      if (!result.ok) {
        dispatch({ installing: false, error: result.message });
        return;
      }
    } catch (error) {
      dispatch({
        installing: false,
        error: error instanceof Error ? error.message : t("claude_plugin.install_failed"),
      });
      return;
    }
    dispatch("reset");
    props.onInstalled?.();
    props.onClose();
  };

  const preview = state.preview;
  const groups = preview
    ? (["mcp", "skill", "command", "agent"] as const)
        .map((type) => ({
          type,
          items: preview.components.filter((component) => component.type === type),
        }))
        .filter((group) => group.items.length > 0)
    : [];

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="flex max-h-[min(650px,calc(100dvh-160px))] min-h-0 w-full max-w-lg flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("claude_plugin.title")}</DialogTitle>
          <DialogDescription>
            {t("claude_plugin.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextInput
                label={t("claude_plugin.repository")}
                placeholder="https://github.com/slackapi/slack-mcp-plugin"
                value={state.url}
                onChange={(event) =>
                  dispatch({ url: event.currentTarget.value, preview: null, previewedUrl: null })
                }
              />
            </div>
            <Button
              variant="outline"
              onClick={() => void handlePreview()}
              disabled={state.previewing || state.installing}
            >
              {state.previewing ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Search data-icon="inline-start" />
              )}
              {t("claude_plugin.preview")}
            </Button>
          </div>

          {state.preview ? (
            <div className="space-y-3 rounded-xl border border-dls-border bg-dls-hover/40 p-4">
              <div>
                <div className="text-sm font-semibold text-dls-text">
                  {state.preview.name}
                  {state.preview.version ? (
                    <span className="ml-2 text-xs font-normal text-dls-secondary">v{state.preview.version}</span>
                  ) : null}
                </div>
                {state.preview.description ? (
                  <div className="mt-0.5 text-xs text-dls-secondary">{state.preview.description}</div>
                ) : null}
                <div className="mt-1 text-[11px] text-dls-secondary">
                  {state.preview.source.owner}/{state.preview.source.repo} @ {state.preview.source.ref}
                  {state.preview.source.dir ? ` · ${state.preview.source.dir}` : ""}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-medium text-dls-text">{t("claude_plugin.will_install")}</div>
                <div className="space-y-2">
                  {groups.map((group) => (
                    <div key={group.type}>
                      <div className="text-[11px] font-medium uppercase tracking-wide text-dls-secondary">
                        {t(COMPONENT_LABEL_KEYS[group.type] ?? "claude_plugin.component_skill", { count: group.items.length })}
                      </div>
                      <ul className="mt-0.5 space-y-0.5">
                        {group.items.map((item) => (
                          <li key={`${group.type}:${item.name}`} className="text-xs text-dls-text">
                            <span className="font-medium">{item.name}</span>
                            {item.description ? (
                              <span className="text-dls-secondary"> — {item.description}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              {state.preview.warnings.length > 0 ? (
                <div className="rounded-lg border border-amber-6 bg-amber-2 px-3 py-2 text-xs text-amber-11">
                  {state.preview.warnings.map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {state.error ? (
            <div className="rounded-lg border border-red-6 bg-red-2 px-3 py-2 text-xs text-red-11">
              {state.error}
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0">
          <DialogClose
            render={<Button variant="outline" disabled={state.previewing || state.installing} />}
            disabled={state.previewing || state.installing}
          >
            {t("claude_plugin.cancel")}
          </DialogClose>
          <Button
            onClick={() => void handleInstall()}
            disabled={!state.preview || state.previewing || state.installing}
          >
            {state.installing ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Download data-icon="inline-start" />
            )}
            {t("claude_plugin.install")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
