import { useState, type ComponentType, type SVGProps } from 'react'
import { Popover, IconButton, TextField } from '@radix-ui/themes'
import {
  ArchiveIcon,
  TableIcon,
  HomeIcon,
  PersonIcon,
  BackpackIcon,
  BarChartIcon,
  GlobeIcon,
  CubeIcon,
  RocketIcon,
  TargetIcon,
  CalendarIcon,
  FileTextIcon,
  LayersIcon,
  LightningBoltIcon,
  StarIcon,
  HeartIcon,
  GearIcon,
  BookmarkIcon,
  CameraIcon,
  CodeIcon,
  DashboardIcon,
  Link2Icon,
  ReaderIcon,
  StackIcon,
  TextIcon,
  TextAlignLeftIcon,
  EnvelopeClosedIcon,
  MobileIcon,
  TokensIcon,
  PieChartIcon,
  CheckCircledIcon,
  CheckIcon,
  ListBulletIcon,
  ClockIcon,
  ImageIcon,
  FileIcon,
  ReloadIcon,
  TimerIcon,
  ChevronDownIcon,
} from '@radix-ui/react-icons'
import { entityIconIds, type EntityIconId } from '../../core/icons'
import { fieldTypes } from '../../core/fields'
import { translate as tr, useLocale } from '../i18n'

type Glyph = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
function NumberIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" {...props}>
      <path d="M6 2 4 13M11 2 9 13M2 5.5h11M1 10h11" />
    </svg>
  )
}
const icons: Record<EntityIconId, { glyph: Glyph; label: string }> = {
  folder: { glyph: StackIcon, label: '项目' },
  table: { glyph: TableIcon, label: '数据表' },
  building: { glyph: HomeIcon, label: '公司' },
  people: { glyph: PersonIcon, label: '团队' },
  briefcase: { glyph: BackpackIcon, label: '业务' },
  chart: { glyph: BarChartIcon, label: '分析' },
  globe: { glyph: GlobeIcon, label: '全球' },
  cube: { glyph: CubeIcon, label: '产品' },
  rocket: { glyph: RocketIcon, label: '增长' },
  target: { glyph: TargetIcon, label: '目标' },
  calendar: { glyph: CalendarIcon, label: '日程' },
  document: { glyph: FileTextIcon, label: '文档' },
  layers: { glyph: LayersIcon, label: '分组' },
  lightning: { glyph: LightningBoltIcon, label: '自动化' },
  star: { glyph: StarIcon, label: '收藏' },
  heart: { glyph: HeartIcon, label: '关注' },
  gear: { glyph: GearIcon, label: '设置' },
  bookmark: { glyph: BookmarkIcon, label: '书签' },
  camera: { glyph: CameraIcon, label: '媒体' },
  code: { glyph: CodeIcon, label: '代码' },
  dashboard: { glyph: DashboardIcon, label: '看板' },
  link: { glyph: Link2Icon, label: '关联' },
  archive: { glyph: ArchiveIcon, label: '归档' },
  reader: { glyph: ReaderIcon, label: '知识' },
}
export function EntityIcon({
  name,
  fallback = 'table',
}: {
  name?: string
  fallback?: EntityIconId
}) {
  const Icon = Object.hasOwn(icons, name ?? '')
    ? icons[name as EntityIconId].glyph
    : icons[fallback].glyph
  return <Icon aria-hidden={true} className="entity-glyph" />
}
export function IconPicker({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: EntityIconId
  onChange: (value: EntityIconId) => void
  label: string
  disabled?: boolean
}) {
  useLocale()
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('')
  const choices = entityIconIds.filter((id) =>
    `${id} ${tr(icons[id].label)}`.toLowerCase().includes(query.trim().toLowerCase()),
  )
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        setQuery('')
      }}
    >
      <Popover.Trigger>
        <IconButton
          type="button"
          size="3"
          color="gray"
          variant="soft"
          className="icon-picker-trigger"
          aria-label={label}
          title={label}
          disabled={disabled}
        >
          <EntityIcon name={value} />
        </IconButton>
      </Popover.Trigger>
      <Popover.Content width="292px" maxWidth="calc(100vw - 32px)" aria-label={tr('选择图标')}>
        <TextField.Root
          aria-label={tr('搜索图标')}
          placeholder={tr('搜索图标')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="icon-picker-grid" role="group" aria-label={tr('图标')}>
          {choices.map((id) => (
            <button
              type="button"
              key={id}
              data-icon={id}
              aria-label={tr(icons[id].label)}
              title={tr(icons[id].label)}
              aria-pressed={value === id}
              onClick={() => {
                onChange(id)
                setOpen(false)
              }}
            >
              <EntityIcon name={id} />
            </button>
          ))}
        </div>
        {!choices.length && <p className="icon-picker-empty">{tr('没有匹配的图标')}</p>}
      </Popover.Content>
    </Popover.Root>
  )
}
const fieldIcons: Record<string, Glyph> = {
  text: TextIcon,
  longtext: TextAlignLeftIcon,
  url: Link2Icon,
  email: EnvelopeClosedIcon,
  phone: MobileIcon,
  number: NumberIcon,
  currency: TokensIcon,
  percentage: PieChartIcon,
  progress: TimerIcon,
  rating: StarIcon,
  select: ChevronDownIcon,
  multiselect: ListBulletIcon,
  tags: BookmarkIcon,
  boolean: CheckCircledIcon,
  date: CalendarIcon,
  datetime: CalendarIcon,
  time: ClockIcon,
  daterange: CalendarIcon,
  image: ImageIcon,
  file: FileIcon,
  json: CodeIcon,
  relation: Link2Icon,
  api: ReloadIcon,
  textarea: TextAlignLeftIcon,
  checkbox: CheckIcon,
}
export function FieldTypeIcon({ type, source }: { type: string; source?: unknown }) {
  const definition = fieldTypes.has(type) ? fieldTypes.get(type) : undefined
  if (!source && definition?.icon) return <EntityIcon name={definition.icon} />
  const Icon = source
    ? ReloadIcon
    : Object.hasOwn(fieldIcons, type)
      ? fieldIcons[type]
      : (definition && fieldIcons[definition.input]) || CubeIcon
  return <Icon aria-hidden={true} className="field-type-icon" />
}
