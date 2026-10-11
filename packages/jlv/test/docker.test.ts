// Docker envelopes through src/formats/docker.ts (plan section 6.2): the fields of a record with the envelope below a
// key that does not collide with the inner record, plain text in the envelope's log, and the rows of the viewer.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readRecords, rowsOf } from './support/records.js'

const envelope = (log: string, extra: object = {}): string =>
  `${JSON.stringify({ log, stream: 'stdout', time: '2026-10-11T10:00:00.250Z', ...extra })}\n`

describe('Docker envelopes', () => {
  it('give the inner record\'s fields with the envelope below docker, and its own time first', async () => {
    const inner = { level: 30, time: 1_791_712_800_000, pid: 1, hostname: 'c1', msg: 'inner', req: { id: 7 } }
    const { records, format } = await readRecords(envelope(`${JSON.stringify(inner)}\n`, { attrs: { tag: 'web' } }))
    assert.equal(format, 'docker')
    const [row] = rowsOf(records)
    assert.ok(row)
    assert.deepEqual(row.record.fields, { ...inner, docker: { stream: 'stdout', time: '2026-10-11T10:00:00.250Z', attrs: { tag: 'web' } } })
    assert.equal(row.timestamp, '2026-10-11T10:00:00.000Z')
    assert.equal(row.record.correlationIdentifier, '7')
    assert.deepEqual(row.data, { pid: 1, hostname: 'c1', req: { id: 7 }, docker: { stream: 'stdout', time: '2026-10-11T10:00:00.250Z', attrs: { tag: 'web' } } })
  })

  it('move the envelope to _docker and further when the inner record has such fields', async () => {
    const { records } = await readRecords(envelope('{"message":"m","docker":1,"_docker":2}\n'))
    assert.deepEqual(Object.keys(records[0]?.record.fields ?? {}), ['message', 'docker', '_docker', '__docker'])
  })

  it('keep plain text in the envelope\'s log without Docker\'s line ending and take Docker\'s time', async () => {
    const { records } = await readRecords(envelope('plain text\r\n'))
    const [row] = rowsOf(records)
    assert.ok(row)
    assert.deepEqual(row.record.fields, { docker: { log: 'plain text', stream: 'stdout', time: '2026-10-11T10:00:00.250Z' } })
    assert.deepEqual([row.timestamp, row.record.level, row.message], ['2026-10-11T10:00:00.250Z', 'unknown', 'plain text'])
  })

  // Copying the envelope key by key set the prototype of the copy for a key __proto__ and lost the key.
  it('keep an envelope key such as __proto__ as a field', async () => {
    const { records } = await readRecords(envelope('plain\n', JSON.parse('{"__proto__":{"level":"error"}}') as object))
    const docker: unknown = records[0]?.record.fields['docker']
    assert.ok(typeof docker === 'object' && docker !== null)
    assert.deepEqual(Object.keys(docker), ['log', 'stream', 'time', '__proto__'])
    assert.equal(Object.getPrototypeOf(docker), Object.prototype)
    assert.equal(records[0]?.record.level, 'unknown')
  })

  it('read records without an envelope in a Docker source as generic JSON', async () => {
    const { records } = await readRecords(`${envelope('first\n')}{"level":"info","message":"no envelope"}\n`)
    assert.deepEqual(records.map(({ record }) => [record.level, record.message]), [['unknown', 'first'], ['info', 'no envelope']])
  })
})
