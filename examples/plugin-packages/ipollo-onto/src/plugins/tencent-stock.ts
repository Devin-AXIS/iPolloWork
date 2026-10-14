import { DataError } from '../server/errors'

export function stockRequest(input: string) {
  const symbol = input.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol))
    throw new DataError('请填写美股证券代码，例如 TSLA、IBM 或 AAPL')
  return `https://qt.gtimg.cn/q=us${encodeURIComponent(symbol)}`
}

// Parse the provider's quoted wire format as data, never execute its JavaScript wrapper.
export function decodeStockQuote(bytes: Uint8Array, url: string) {
  const text = new TextDecoder('gb18030').decode(bytes).trim()
  const match = /^v_(us[A-Za-z0-9.-]+)="([^"\r\n]*)";?$/.exec(text)
  const requested = new URL(url).searchParams.get('q')
  // This provider uses /q=usTSLA rather than a query string.
  const key = requested ?? new URL(url).pathname.slice(3)
  if (!match || match[1] !== key) throw new DataError('该行情来源未找到这只证券，请检查证券代码')
  const fields = match[2].split('~')
  const date = fields[30]?.slice(0, 10)
  if (
    !/^\d+(\.\d+)?$/.test(fields[3] ?? '') ||
    !/^\d+(\.\d+)?$/.test(fields[4] ?? '') ||
    !/^\d+$/.test(fields[6] ?? '') ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ||
    !Number.isFinite(Date.parse(date))
  )
    throw new DataError('行情返回不完整，请稍后更新')
  return {
    price: fields[3],
    previousClose: fields[4],
    volume: fields[6],
    date,
    currency: fields[35],
    symbol: fields[2],
  }
}
