import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apiResponseIssue } from '../src/plugins/api-response'
import { stockRequest, decodeStockQuote } from '../src/plugins/tencent-stock'
import { roundApiDecimal } from '../src/plugins/api-decimal'

test('explicit API decimal rounding handles rates and large values without binary precision loss', () => {
  assert.equal(roundApiDecimal(0.85441, 4), '0.8544')
  assert.equal(roundApiDecimal('0.85445', 4), '0.8545')
  assert.equal(roundApiDecimal('-0.85445', 4), '-0.8545')
  assert.equal(roundApiDecimal('99999999999999.12345', 4), '99999999999999.1235')
  assert.equal(roundApiDecimal('1.999', 2), '2.00')
  assert.equal(roundApiDecimal('-0.00001', 4), '0.0000')
  assert.equal(roundApiDecimal('1.5', 0), '2')
  assert.throws(() => roundApiDecimal('not a number', 4), /小数位数/)
})

test('public stock adapter parses distinct quotes without executing the response wrapper', () => {
  const quote = (symbol: string, price: string) => {
    const f = Array<string>(40).fill('0')
    f[2] = symbol + '.OQ'
    f[3] = price
    f[4] = '368.16'
    f[6] = '123456'
    f[30] = '2026-09-09 16:00:01'
    f[35] = 'USD'
    return Buffer.from(`v_us${symbol}="${f.join('~')}";`)
  }
  assert.equal(stockRequest(' tsla '), 'https://qt.gtimg.cn/q=usTSLA')
  assert.equal(decodeStockQuote(quote('TSLA', '367.81'), stockRequest('TSLA')).price, '367.81')
  assert.equal(decodeStockQuote(quote('IBM', '239.94'), stockRequest('IBM')).price, '239.94')
  assert.equal(decodeStockQuote(quote('TSLA', '367.81'), stockRequest('TSLA')).date, '2026-09-09')
  assert.equal(
    decodeStockQuote(quote('TSLA', '367.81'), stockRequest('TSLA')).previousClose,
    '368.16',
  )
  assert.throws(() => decodeStockQuote(quote('IBM', '239.94'), stockRequest('TSLA')), /未找到/)
  assert.throws(
    () => decodeStockQuote(Buffer.from('globalThis.run()'), stockRequest('TSLA')),
    /未找到/,
  )
  assert.throws(() => stockRequest('TSLA&secret=yes'), /证券代码/)
})

test('stock provider restrictions are explained without returning raw upstream content', () => {
  const endpoint = 'https://www.alphavantage.co/query?symbol=TSLA'
  const denied = apiResponseIssue(endpoint, {
    Information: 'The **demo** API key is for demo purposes only. private-value',
  })
  assert.equal(denied?.code, 'credentials_required')
  assert.match(denied!.message, /每条记录无需单独添加 API/)
  assert.ok(!denied!.message.includes('private-value'))
  assert.equal(
    apiResponseIssue(endpoint, { Note: 'API call frequency exceeded' })?.code,
    'rate_limited',
  )
  assert.equal(
    apiResponseIssue(endpoint, { 'Error Message': 'Invalid API call' })?.code,
    'upstream_rejected',
  )
  assert.equal(apiResponseIssue(endpoint, { 'Global Quote': { '05. price': '239.94' } }), undefined)
  assert.equal(
    apiResponseIssue('https://api.example.com/data', { Information: 'demo API key' }),
    undefined,
  )
})
