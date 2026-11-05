import { translate as tr, useLocale } from './i18n'
import { TextArea, TextField } from '@radix-ui/themes'
import { IconPicker } from './components/icons'
import type { EntityIconId } from '../core/icons'
import { FormLabel } from './components/primitives'

export function ProjectFields({
  name,
  description,
  color,
  onName,
  onDescription,
  onColor,
  icon,
  onIcon,
  kind = 'project',
  compact = false,
}: {
  icon: EntityIconId
  onIcon: (value: EntityIconId) => void
  name: string
  description: string
  color: string
  onName: (value: string) => void
  onDescription: (value: string) => void
  onColor: (value: string) => void
  kind?: 'project' | 'table'
  compact?: boolean
}) {
  useLocale()
  return (
    <>
      <div className="entity-name-field">
        <IconPicker
          value={icon}
          onChange={onIcon}
          label={kind === 'project' ? tr('更换项目图标') : tr('更换数据表图标')}
        />
        <FormLabel label={kind === 'project' ? tr('项目名称') : tr('数据表名称')}>
          <TextField.Root
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder={kind === 'project' ? tr('例如：客户与销售') : tr('例如：客户、商机、产品')}
          />
        </FormLabel>
      </div>
      {compact ? (
        <details className="table-preset-notes">
          <summary>{tr('描述（可选）')}</summary>
          <TextArea
            aria-label={tr('描述（可选）')}
            value={description}
            maxLength={500}
            onChange={(e) => onDescription(e.target.value)}
            placeholder={tr('简单介绍这里管理的内容')}
          />
        </details>
      ) : (
        <FormLabel label={tr('描述（可选）')}>
          <TextArea
            value={description}
            maxLength={500}
            onChange={(e) => onDescription(e.target.value)}
            placeholder={tr('简单介绍这里管理的内容')}
          />
        </FormLabel>
      )}
      {kind === 'project' && (
        <fieldset className="color-picker">
          <legend>{tr('项目颜色')}</legend>
          {['neutral', 'green', 'blue', 'orange', 'violet'].map((c, i) => (
            <button
              key={c}
              type="button"
              className={`color-choice ${c} ${c === color ? 'selected' : ''}`}
              aria-label={[tr('墨色'), tr('绿色'), tr('蓝色'), tr('橙色'), tr('紫色')][i]}
              aria-pressed={c === color}
              onClick={() => onColor(c)}
            />
          ))}
        </fieldset>
      )}
    </>
  )
}
