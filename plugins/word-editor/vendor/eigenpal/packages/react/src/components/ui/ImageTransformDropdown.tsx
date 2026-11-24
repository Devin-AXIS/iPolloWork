/**
 * Image Transform Dropdown — thin wrapper around IconGridDropdown.
 */

import { IconGridDropdown, type IconGridOption } from './IconGridDropdown';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';

type TransformAction = 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV';

const TRANSFORM_OPTIONS: (Omit<IconGridOption<TransformAction>, 'label'> & {
  labelKey: TranslationKey;
})[] = [
  { value: 'rotateCW', labelKey: 'imageTransform.rotateClockwise', iconName: 'rotate_right' },
  {
    value: 'rotateCCW',
    labelKey: 'imageTransform.rotateCounterClockwise',
    iconName: 'rotate_left',
  },
  { value: 'flipH', labelKey: 'imageTransform.flipHorizontal', iconName: 'swap_horiz' },
  { value: 'flipV', labelKey: 'imageTransform.flipVertical', iconName: 'swap_vert' },
];

export interface ImageTransformDropdownProps {
  onTransform: (action: TransformAction) => void;
  disabled?: boolean;
}

export function ImageTransformDropdown({
  onTransform,
  disabled = false,
}: ImageTransformDropdownProps) {
  const { t } = useTranslation();
  const translatedOptions: IconGridOption<TransformAction>[] = TRANSFORM_OPTIONS.map((opt) => ({
    ...opt,
    label: t(opt.labelKey),
  }));

  return (
    <IconGridDropdown<TransformAction>
      options={translatedOptions}
      triggerIcon="rotate_right"
      tooltipContent={t('imageTransform.tooltip')}
      onSelect={onTransform}
      disabled={disabled}
      testId="toolbar-image-transform"
    />
  );
}
