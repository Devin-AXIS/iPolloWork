// Translate known provider failures without exposing the raw response or credentials.
export function apiResponseIssue(url: string, data: unknown) {
  if (new URL(url).origin !== 'https://www.alphavantage.co' || !data || typeof data !== 'object')
    return undefined
  const response = data as Record<string, unknown>
  const detail = [response.Information, response.Note, response['Error Message']]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
  if (/demo.*(?:api\s*)?key|(?:api\s*)?key.*demo/i.test(detail))
    return {
      code: 'credentials_required',
      message:
        '当前行情接口使用体验凭据，这只证券未开放。请为该字段配置自己的行情凭据；每条记录无需单独添加 API。',
    }
  if (/rate limit|call frequency|requests per|calls per/i.test(detail))
    return { code: 'rate_limited', message: '行情接口调用频率已达上限，请稍后更新或调整刷新间隔。' }
  if (typeof response['Error Message'] === 'string')
    return {
      code: 'upstream_rejected',
      message: '行情接口未接受本次查询，请检查证券代码和接口配置。',
    }
  return undefined
}
