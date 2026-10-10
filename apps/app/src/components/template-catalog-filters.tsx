/** @jsxImportSource react */
import { useEffect } from "react";
import { ChevronDown } from "lucide-react";
import {
  getTemplateTopic,
  TEMPLATE_TOPIC_OPTIONS,
  templateStyleSchema,
  type TemplateCatalogItem,
  type TemplateCategory,
  type TemplateStyle,
  type TemplateTopicFilter,
} from "@ipollowork/types/templates";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { t, translationKey } from "@/i18n";
import { cn } from "@/lib/utils";

type TemplateCatalogFiltersProps = {
  templates: readonly TemplateCatalogItem[];
  category: TemplateCategory | "all";
  style: TemplateStyle | "all";
  topic: TemplateTopicFilter;
  onStyleChange: (value: TemplateStyle | "all") => void;
  onTopicChange: (value: TemplateTopicFilter) => void;
};

const triggerClassName = "w-[124px] justify-between text-foreground";

/** Shared facets keep the marketplace and Design/Video pickers on one classification contract. */
export function TemplateCatalogFilters(props: TemplateCatalogFiltersProps) {
  const scoped = props.templates.filter(({ manifest }) => props.category === "all" || manifest.category === props.category);
  const styles = templateStyleSchema.options.filter((style) => props.templates.some(({ manifest }) => manifest.style === style));
  useEffect(() => {
    if (props.style !== "all" && !props.templates.some(({ manifest }) => manifest.style === props.style)) {
      props.onStyleChange("all");
    }
  }, [props.style, props.templates, props.onStyleChange]);
  const unclassified = scoped.some(({ manifest }) => !getTemplateTopic(manifest));

  return (
    <div className="inline-flex shrink-0 items-center rounded-lg bg-muted/50 p-0.5" data-testid="template-catalog-filters">
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={t("template_market.style_label")} render={<Button type="button" variant="ghost" className={triggerClassName} />}>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn("shrink-0", props.style !== "all" && "text-muted-foreground")}>{t("template_market.style_label")}</span>
            {props.style !== "all" ? <span className="truncate">{t(translationKey("template_market.style.", props.style))}</span> : null}
          </span>
          <ChevronDown className="size-3.5 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={7} positionerClassName="z-[90]" className="w-[196px] min-w-[196px]">
          <DropdownMenuItem className={cn(props.style === "all" && "bg-muted")} onClick={() => props.onStyleChange("all")}>{t("template_market.all_styles")}</DropdownMenuItem>
          {styles.map((style) => <DropdownMenuItem key={style} className={cn(props.style === style && "bg-muted")} onClick={() => props.onStyleChange(style)}>{t(translationKey("template_market.style.", style))}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border/70" />
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={t("template_market.topic_label")} render={<Button type="button" variant="ghost" className={triggerClassName} />}>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn("shrink-0", props.topic !== "all" && "text-muted-foreground")}>{t("template_market.topic_label")}</span>
            {props.topic !== "all" ? <span className="truncate">{t(translationKey("template_market.topic.", props.topic))}</span> : null}
          </span>
          <ChevronDown className="size-3.5 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={7} positionerClassName="z-[90]" className="w-[196px] min-w-[196px]">
          <DropdownMenuItem className={cn(props.topic === "all" && "bg-muted")} onClick={() => props.onTopicChange("all")}>{t("template_market.all_topics")}</DropdownMenuItem>
          {TEMPLATE_TOPIC_OPTIONS.map((topic) => (
            <DropdownMenuItem key={topic} className={cn("whitespace-nowrap", props.topic === topic && "bg-muted")} onClick={() => props.onTopicChange(topic)}>
              {t(translationKey("template_market.topic.", topic))}
            </DropdownMenuItem>
          ))}
          {unclassified ? <DropdownMenuItem className={cn(props.topic === "unclassified" && "bg-muted")} onClick={() => props.onTopicChange("unclassified")}>{t("template_market.topic.unclassified")}</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
