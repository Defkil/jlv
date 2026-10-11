// A jlv plugin with one format, text: every line of the input is a record, and the line is its message. Its predicate
// finished keeps the records whose message says so.
//
//   jlv --plugin ./text-plugin.mjs --format text notes.txt
//   jlv --plugin ./text-plugin.mjs --predicate finished notes.txt
//
// A plugin is trusted code that runs inside jlv; load only plugins that you would also run yourself.

/**
@type {import('jlv').LogFormat}
*/
const text = {
  identifier: 'text',
  // Any text fits a little, so every other format that fits a sample wins over this one.
  probe: sample => sample.text === '' ? 0 : 1,
  // Splits the bytes into lines; a line keeps its number for diagnostics and the viewer.
  async * read (chunks, context) {
    const decoder = new TextDecoder()
    let lineNumber = 0
    let rest = ''
    const entry = line => {
      lineNumber += 1
      return { kind: 'entry', value: { line }, position: { firstLine: lineNumber, lastLine: lineNumber } }
    }
    for await (const chunk of chunks) {
      const lines = (rest + decoder.decode(chunk, { stream: true })).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) {
        yield entry(line.replace(/\r$/, ''))
      }
      // A line longer than jlv's limit for one record arrives in pieces, so that memory stays bounded.
      while (rest.length > context.maximumRecordSize) {
        yield entry(rest.slice(0, context.maximumRecordSize))
        rest = rest.slice(context.maximumRecordSize)
      }
    }
    rest += decoder.decode()
    if (rest !== '') {
      yield entry(rest)
    }
  },
  normalize: value => ({
    record: { level: 'unknown', message: String(value.line), fields: {} },
    diagnostics: []
  })
}

/**
@type {import('jlv').FormatPlugin}
*/
const plugin = {
  apiVersion: 1,
  formats: [text],
  predicates: {
    finished: record => record.message.includes('finished')
  }
}

export default plugin
