import { randomUUID } from 'node:crypto'
import { applyBlueprint } from './blueprint'
import { deleteProject, saveRecord, getProjects } from './store'

// Templates only describe real HTTP APIs. Values are always resolved by the shared provider.
function source(
  url: string,
  valuePath: string,
  inputFieldId: string,
  storage: 'live' | 'snapshot' = 'snapshot',
  unit = '',
  observedAtPath = '',
) {
  return {
    provider: 'json-api' as const,
    url,
    valuePath,
    inputFieldId,
    storage,
    unit,
    observedAtPath,
    ttlSeconds: 3600,
  }
}
function stockSource(
  metric: 'price' | 'volume' | 'date',
  storage: 'live' | 'snapshot' = 'snapshot',
) {
  return {
    provider: 'tencent-stock' as const,
    metric,
    inputFieldId: 'symbol',
    storage,
    ttlSeconds: 60,
    unit: metric === 'price' ? 'USD' : metric === 'volume' ? '股' : '',
  }
}
const fxUrl = 'https://api.frankfurter.dev/v2/rate/{{value}}/CNY'
const githubUrl = 'https://api.github.com/users/{{value}}'

export async function createResearchExample() {
  const built = await applyBlueprint({
    schemaVersion: 1,
    requestId: randomUUID(),
    project: {
      name: '企业研究 · 真实 API',
      description:
        '实际连接腾讯公开美股行情、Frankfurter 汇率和 GitHub 企业公开数据。统一配置接口，每条记录只填写变量，自动获取相关字段。',
    },
    tables: [
      {
        key: 'stocks',
        name: '公司股票',
        description:
          '统一连接腾讯公开美股行情。填写 TSLA、IBM、AAPL 等证券代码，保存后自动获取股价、成交量和报价日期；数据时间以来源为准。',
        fields: [
          { key: 'name', name: '公司', type: 'text' },
          { key: 'symbol', name: '证券代码', type: 'text' },
          {
            key: 'price',
            name: '股价',
            type: 'currency',
            source: stockSource('price'),
          },
          {
            key: 'volume',
            name: '成交量',
            type: 'number',
            source: stockSource('volume', 'live'),
          },
          {
            key: 'date',
            name: '报价日期',
            type: 'date',
            source: stockSource('date'),
          },
        ],
      },
      {
        key: 'fx',
        name: '人民币汇率',
        description:
          'Frankfurter 发布的最新参考汇率，每单位外币兑换人民币的金额。按来源发布频率更新，不是交易报价。',
        fields: [
          { key: 'name', name: '货币', type: 'text' },
          { key: 'code', name: '货币代码', type: 'text' },
          {
            key: 'rate',
            name: '折合人民币',
            type: 'number',
            source: {
              ...source(fxUrl, '/rate', 'code', 'snapshot', 'CNY', '/date'),
              decimalPlaces: 4,
            },
          },
          { key: 'date', name: '数据日期', type: 'date', source: source(fxUrl, '/date', 'code') },
        ],
      },
      {
        key: 'github',
        name: '企业开源动态',
        description:
          'GitHub 企业账号的公开仓库数、关注者和主页。按账号逐行读取，显示实际获取时间。',
        fields: [
          { key: 'name', name: '企业', type: 'text' },
          { key: 'account', name: 'GitHub 账号', type: 'text' },
          {
            key: 'repos',
            name: '公开仓库',
            type: 'number',
            source: source(githubUrl, '/public_repos', 'account'),
          },
          {
            key: 'followers',
            name: '关注者',
            type: 'number',
            source: source(githubUrl, '/followers', 'account', 'live'),
          },
          {
            key: 'url',
            name: '公开主页',
            type: 'url',
            source: source(githubUrl, '/html_url', 'account'),
          },
        ],
      },
    ],
    relations: [],
  })
  try {
    const examples = {
      stocks: [
        { name: 'IBM', symbol: 'IBM' },
        { name: '特斯拉', symbol: 'TSLA' },
        { name: '苹果', symbol: 'AAPL' },
      ],
      fx: [
        { name: '美元', code: 'USD' },
        { name: '欧元', code: 'EUR' },
        { name: '港币', code: 'HKD' },
      ],
      github: [
        { name: '微软', account: 'microsoft' },
        { name: '百度', account: 'baidu' },
        { name: '阿里巴巴', account: 'alibaba' },
      ],
    }
    for (const table of built.tables) {
      for (const values of examples[table.key as keyof typeof examples]) {
        await saveRecord(table.id, {
          values: Object.fromEntries(
            Object.entries(values).map(([key, value]) => [table.fieldIds[key], value]),
          ),
        })
      }
    }
    const project = (await getProjects()).find((p) => p.id === built.projectId)!
    return { project, tableId: built.tables[0].id }
  } catch (e) {
    await deleteProject(built.projectId)
    throw e
  }
}
