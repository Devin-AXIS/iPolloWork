import type { VideoStudioClient, VideoStudioFeatures, VideoStudioTemplateApplyResult } from "@ipollowork/video-studio";

import { TemplateCatalogDialog } from "@/components/template-catalog-dialog";
import { t } from "@/i18n";

type VideoTemplateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: VideoStudioClient;
  workspaceId: string;
  sessionId: string;
  copy: Exclude<VideoStudioFeatures["templates"], false>;
  onApplied: (runtime: VideoStudioTemplateApplyResult) => void;
};

export function VideoTemplateDialog(props: VideoTemplateDialogProps) {
  const listTemplates = props.client.listVideoStudioTemplates;
  const getCover = props.client.getVideoStudioTemplateCover;
  const applyTemplate = props.client.applyVideoStudioTemplate;
  const unavailable = () => new Error(t("design_templates.unavailable"));
  return (
    <TemplateCatalogDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      queryKey={["video-studio-templates", props.workspaceId]}
      copy={{
        ...props.copy,
        confirmTitle: "替换当前视频？",
        confirmDescription: (title) => `使用“${title}”会安全替换当前对话的视频；失败时会自动恢复。`,
      }}
      listTemplates={() => listTemplates?.(props.workspaceId) ?? Promise.reject(unavailable())}
      getCover={(templateId) => getCover?.(props.workspaceId, templateId) ?? Promise.reject(unavailable())}
      applyTemplate={(templateId) => applyTemplate?.(props.workspaceId, props.sessionId, templateId) ?? Promise.reject(unavailable())}
      onApplied={props.onApplied}
    />
  );
}
