import { useEffect, useState } from "react";
import { Image as SharedImage, type ImageProps as SharedImageProps } from "@ipollowork/ui/image";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
export type { GeneratedImageLike } from "@ipollowork/ui/image";
export type ImageProps = SharedImageProps & { compactPreview?: boolean };

export function Image({ compactPreview = false, ...props }: ImageProps) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [props.src, props.base64, props.uint8Array]);
  const label = t(expanded ? "image.preview.show_less" : "image.preview.show_full");
  if (!compactPreview) return <SharedImage showFullLabel={t("image.preview.show_full")} showLessLabel={t("image.preview.show_less")} {...props} />;
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      className="max-w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => setExpanded(!expanded)}
    >
      <SharedImage {...props} previewMaxHeight={0} className={cn("block w-auto", !expanded && "max-h-[260px] max-w-[min(420px,100%)]", props.className)} />
      <span className="mt-1 block text-xs text-muted-foreground">{label}</span>
    </button>
  );
}
