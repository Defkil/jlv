// A third-party plugin as its author writes it, against jlv's published types: a format for JSON lines whose level
// is a number in "sev", whose message is in "text" and whose time is in seconds in "at", built on jlv's JSON-lines
// reader, and a predicate. jlv's tests compile it with strict settings against the declarations of 'jlv' and
// 'jlv/formats', and then run it.
import type { FormatContext, FormatPlugin, JsonObject, LogFormat, LogLevel, NormalizationResult, ParseDiagnostic } from 'jlv'
import { readJsonLines } from 'jlv/formats'

const severities: Readonly<Record<string, LogLevel>> = { 1: 'debug', 2: 'info', 3: 'warn', 4: 'error' }

const normalize = (value: JsonObject, context: FormatContext): NormalizationResult => {
  const severity = value['sev']
  const text = value['text']
  const at = value['at']
  const diagnostics: ParseDiagnostic[] = []
  if (typeof text !== 'string') {
    diagnostics.push({ kind: 'diagnostic', severity: 'warning', code: 'acme-no-text', message: `a record of ${context.source.label} has no text` })
  }
  return {
    record: {
      level: typeof severity === 'number' ? severities[String(severity)] ?? 'unknown' : 'unknown',
      message: typeof text === 'string' ? text : '',
      ...(typeof at === 'number' && { timestamp: at * 1000 }),
      fields: value
    },
    diagnostics
  }
}

const acme: LogFormat = {
  identifier: 'acme',
  probe: sample => sample.text.includes('"sev":') ? 70 : 0,
  read: readJsonLines,
  normalize
}

const plugin: FormatPlugin = {
  apiVersion: 1,
  formats: [acme],
  predicates: {
    isSlow: record => typeof record.fields['ms'] === 'number' && record.fields['ms'] > 1000
  }
}

export default plugin
