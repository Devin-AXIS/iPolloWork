import type { TemplateSessionSnapshot } from "@ipollowork/types/templates";
import type { DesignStudioClient, DesignStudioFeatures } from "@ipollowork/design-studio";

import { TemplateCatalogDialog } from "@/components/template-catalog-dialog";
import { t } from "@/i18n";

type DesignTemplateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: DesignStudioClient;
  workspaceId: string;
  sessionId: string;
  copy: Exclude<DesignStudioFeatures["templates"], false>;
  onApplied: (snapshot: TemplateSessionSnapshot) => void;
};

export function DesignTemplateDialog(props: DesignTemplateDialogProps) {
  const listTemplates = props.client.listDesignStudioTemplates;
  const getCover = props.client.getDesignStudioTemplateCover;
  const applyTemplate = props.client.applyDesignStudioTemplate;
  return (
    <TemplateCatalogDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      queryKey={["design-studio-templates", props.workspaceId]}
      copy={props.copy}
      listTemplates={() => {
        if (!listTemplates) throw new Error(t("design_templates.unavailable"));
        return listTemplates(props.workspaceId);
      }}
      getCover={(templateId) => {
        if (!getCover) throw new Error(t("design_templates.unavailable"));
        return getCover(props.workspaceId, templateId);
      }}
      applyTemplate={(templateId) => {
        if (!applyTemplate) throw new Error(t("design_templates.unavailable"));
        return applyTemplate(props.workspaceId, props.sessionId, templateId);
      }}
      onApplied={props.onApplied}
    />
  );
}
