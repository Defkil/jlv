// Winston's JSON output (plan section 6.2): timestamp, level and message at the top level, like generic JSON lines,
// with Winston's own level names: npm's silly, verbose and http, and syslog's emerg, alert, crit and notice. Winston's
// transports and formats can produce any schema, so no probe claims a source for Winston; --format winston chooses it,
// and a mapping covers renamed fields. Text and colorized transports are no JSON and outside this format.
import type { LogFormat, LogLevel } from '../api.js'
import { genericProfile, type FieldProfile } from '../record.js'
import { jsonProfileFormat } from './json-lines.js'

const winstonLevels: Readonly<Record<string, LogLevel>> = {
  silly: 'trace',
  verbose: 'debug',
  http: 'info',
  notice: 'info',
  crit: 'fatal',
  alert: 'fatal',
  emerg: 'fatal'
}

const winstonProfile: FieldProfile = { ...genericProfile, levelNames: winstonLevels }

const winstonFormat: LogFormat = jsonProfileFormat({ identifier: 'winston', profile: winstonProfile, probe: () => 0 })

export { winstonFormat, winstonLevels, winstonProfile }
