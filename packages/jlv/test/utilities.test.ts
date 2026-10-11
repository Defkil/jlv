// Upstream test/utils.test.js (for src/utils.js), moved to node:test with unchanged assertions and in the same order:
// hasColors keeps state in a global regular expression, so the order is part of the behavior. The tests run against
// the TypeScript port in src/tui/formatting.ts, where upstream's len is named textLength.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatRows, maxLengths, stripColors, hasColors, spaces, padEnd, textLength, trunc } from '../src/tui/formatting.js'

describe('hasColors', () => {
  it('is false for string with no colors', () => {
    assert.equal(hasColors('res'), false)
  })

  it('is true for string with colors', () => {
    assert.equal(hasColors('{bold}res{/bold}'), true)
  })
})

describe('spaces', () => {
  it('return number of spaces', () => {
    assert.equal(spaces(2), '  ')
  })
})

describe('stripColors', () => {
  it('strip colors', () => {
    assert.equal(stripColors('{fg-abc}Name{/}'), 'Name')
  })

  it('works with undefined', () => {
    assert.equal(stripColors(undefined), '')
  })
})

describe('formatRows', () => {
  it('returns the formatted rows', () => {
    const data = [
      { ts: '2012-01-01 10:01:01.12', lvl: 'debug', msg: '{fg-yellow}something{/fg-yellow}' },
      { ts: '2012-01-01 10:01:01.123', lvl: 'info', msg: 'This other long thing happened while I was asleep' }
    ]
    const columns = [
      { key: 'ts' },
      { key: 'lvl', format: (level: unknown) => level === 'debug' ? `{fg-yellow}${level}{/fg-yellow}` : String(level) },
      { key: 'msg' }
    ]
    const expected = [
      '2012-01-01 10:01:01.12  {fg-yellow}debug{/fg-yellow} {fg-yellow}something{/fg-yellow}                  ',
      '2012-01-01 10:01:01.123 info  This other long thing happened while I was asleep '
    ]
    const rows = formatRows(data, columns, 1, 80)

    assert.equal(`|${rows[0] ?? ''}|`, `|${expected[0] ?? ''}|`)
    assert.equal(`|${rows[1] ?? ''}|`, `|${expected[1] ?? ''}|`)
  })
})

describe('maxLengths', () => {
  it('pads the last item of the array', () => {
    const columns = [
      { key: 'one' }, { key: 'two' }, { key: 'three' }
    ]
    const rows = [
      { one: 'a', two: '{fg-yellow}babc{/fg-yellow}' },
      { one: 'aa', three: 'kkk' },
      { two: 'a', three: 'ssss' }
    ]
    assert.deepEqual(maxLengths(columns, rows, 1, 20), { one: 2, two: 4, three: 12 })
  })
})

describe('padEnd', () => {
  it('works with colors', () => {
    const text = '{fg-green}{bold}felipe{/bold}{/fg-green} {bold}coury{/bold}'
    const expected = `${text}${' '.repeat(18)}`
    assert.equal(padEnd(text, 30), expected)
  })

  it('truncates if needed', () => {
    const text = '{fg-green}{bold}felipe{/bold}{/fg-green} {bold}coury{/bold}'
    const expected = trunc(text, 2)
    assert.equal(padEnd(text, 2), expected)
  })
})

describe('len', () => {
  it('ignores colors', () => {
    const text = '{fg-green}{bold}felipe{/bold}{/fg-green} {bold}coury{/bold}'
    assert.equal(textLength(text), 12)
  })

  it('considers colors when flag set', () => {
    const text = '{fg-green}{bold}felipe{/bold}{/fg-green} {bold}coury{/bold}'
    assert.equal(textLength(text, true), text.length)
  })
})

describe('trunc', () => {
  it('truncates text', () => {
    assert.equal(trunc('abcdef', 2), 'ab')
  })

  it('truncates null', () => {
    assert.equal(trunc(null, 2), '')
  })

  it('works with colors', () => {
    const text = '{fg-green}{bold}felipe{/bold}{/fg-green} {bold}coury{/bold}'
    assert.equal(trunc(text, 3), '{fg-green}{bold}fel{/}')
    assert.equal(trunc(text, 8), '{fg-green}{bold}felipe{/bold}{/fg-green} {bold}c{/}')
    assert.equal(trunc(text, 6), '{fg-green}{bold}felipe{/}')
    assert.equal(trunc(text, 1000), '{fg-green}{bold}felipe{/bold}{/fg-green} {bold}coury{/bold}')
    assert.equal(trunc('{fg-green}{/fg-green}', 3), '{fg-green}{/fg-green}')
  })

  it('ignores colors', () => {
    const text = '{fg-green}{bold}felipe{/bold}{/fg-green} {bold}coury{/bold}'
    assert.equal(trunc(text, 3, true), '{fg')
    assert.equal(trunc(text, 8, true), '{fg-gree')
    assert.equal(trunc(text, 6, true), '{fg-gr')
    assert.equal(trunc(text, 1000, true), '{fg-green}{bold}felipe{/bold}{/fg-green} {bold}coury{/bold}')
    assert.equal(trunc('{fg-green}{/fg-green}', 3, true), '{fg')
  })

  it('works with JSON', () => {
    // Upstream used a captured request log with a third-party host, addresses and an expired bearer
    // token. Only the first ten characters are asserted, so the same JSON shape carries neutral values.
    const text = '{"res":{"statusCode":401},"req":{"url":"/queues","headers":{"host":"qa.example.com","x-real-ip":"192.0.2.10","x-forwarded-for":"192.0.2.10","x-forwarded-proto"     :"https","connection":"keep-alive","user-agent":"Mozilla/5.0 (Windows NT 10.0; WOW64; rv:55.0) Gecko/20100101 Firefox/55.0","accept":"application/json, text/plain, */*","acc     ept-language":"en-US,en;q=0.5","accept-encoding":"gzip, deflate, br","authorization":"<redacted bearer token>","referer":"https://qa.example.com/queues","cookie":"<redacted cookie>","if-     none-match":"W/"1963-QHmYfE6rpcPujtkDZuFGu3gZmeI""},"method":"GET","httpVersion":"1.0","originalUrl":"/queues","query":{}},"responseTime":9,"level":"info","message":"GET /     queues 401 9ms","timestamp":"2017-09-26T13:10:18.127Z"}'
    assert.equal(trunc(text, 10), '{"res":{"s')
  })
})
