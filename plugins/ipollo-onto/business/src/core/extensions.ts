import type { EntityIconId } from './icons'

export const extensionCategories = [
  { id: 'fields', name: '字段' },
  { id: 'views', name: '视图' },
  { id: 'connectors', name: '数据连接器' },
  { id: 'automation', name: '自动化' },
] as const
export type ExtensionCategory = (typeof extensionCategories)[number]['id']

export interface ExtensionManifest {
  id: string
  name: string
  icon?: EntityIconId
  description: string
  categories: ExtensionCategory[]
  version: string
  protocol: 1
  required?: boolean
  defaultInstalled: boolean
  dependencies: string[]
  contributes: { fields?: string[]; views?: string[]; actions?: string[]; providers?: string[] }
  entrypoints?: { shared?: string; client?: string }
  digest?: string
  loadError?: string
}
export interface ExtensionState extends ExtensionManifest {
  installedVersion: string | null
  enabled: boolean
  usedBy: number
}
export const extensionCatalog: ExtensionManifest[] = [
  {
    id: 'api-fields',
    categories: ['fields', 'connectors'],
    name: 'API 动态字段',
    description: '按记录参数读取 API，可选择实时读取或获取并保存，支持真实 HTTP API 接口',
    version: '1.0.0',
    protocol: 1,
    defaultInstalled: true,
    dependencies: ['core'],
    contributes: { providers: ['json-api', 'tencent-stock'] },
  },
  {
    id: 'core',
    categories: ['fields', 'views'],
    name: '表格基础',
    description: '基础字段、表格视图和一致的数据操作',
    version: '1.0.0',
    protocol: 1,
    required: true,
    defaultInstalled: true,
    dependencies: [],
    contributes: {
      fields: [
        'text',
        'longtext',
        'number',
        'currency',
        'date',
        'boolean',
        'select',
        'url',
        'json',
      ],
      views: ['grid'],
    },
  },
  {
    id: 'business-fields',
    categories: ['fields'],
    name: '业务字段',
    description: '多选、标签、联系方式、时间、评分、进度与文件引用',
    version: '1.0.0',
    protocol: 1,
    defaultInstalled: true,
    dependencies: ['core', 'percentage'],
    contributes: {
      fields: [
        'email',
        'phone',
        'multiselect',
        'tags',
        'datetime',
        'time',
        'daterange',
        'rating',
        'progress',
        'image',
        'file',
      ],
    },
  },
  {
    id: 'automation',
    categories: ['automation'],
    name: '轻量自动化',
    description: '新记录创建后，自动填入指定字段的缺省值；后台持续运行',
    version: '1.0.0',
    protocol: 1,
    defaultInstalled: false,
    dependencies: ['core'],
    contributes: { actions: ['fill-empty'] },
  },
]
export function fieldExtension(type: string) {
  return extensionCatalog.find((e) => e.contributes.fields?.includes(type))
}
export function availableContribution(
  states: ExtensionState[],
  kind: 'fields' | 'views' | 'actions' | 'providers',
  id: string,
) {
  return states.some(
    (e) =>
      !e.loadError &&
      e.enabled &&
      e.installedVersion === e.version &&
      e.contributes[kind]?.includes(id),
  )
}
