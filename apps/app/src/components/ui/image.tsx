import { Image as SharedImage, type ImageProps } from "@ipollowork/ui/image";
import { t } from "@/i18n";
export type { ImageProps, GeneratedImageLike } from "@ipollowork/ui/image";
export function Image(props: ImageProps) { return <SharedImage showFullLabel={t("image.preview.show_full")} showLessLabel={t("image.preview.show_less")} {...props} />; }
