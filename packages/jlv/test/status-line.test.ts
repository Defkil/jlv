// The status line of src/tui/status-line.ts (plan section 6.3): it fits the width of the screen, giving way in a fixed
// order so that the counts stay, and shows the names of files, formats and filters literally.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { fitParts, type StatusPart } from '../src/tui/status-line.js'
import { cellStyle, openFileViewer, press, screenText, keys } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)

const parts: readonly StatusPart[] = [
  { value: '20', giveWay: 'drop' },
  { label: 'sort: ', value: '-timestamp' },
  { label: 'filters: ', value: 'message~alpha, level=error', giveWay: 'cut' },
  { label: 'config: ', value: 'projects/service/jlv.config.json', giveWay: 'cut-start' },
  { value: '4 skipped' },
  { value: '? help', giveWay: 'drop' }
]

// The parts as the line shows them.
const shown = (fitted: readonly StatusPart[]): string => fitted.map(part => ` | ${part.label ?? ''}${part.value}`).join('')

describe('fitting the status line', () => {
  it('keeps every part when there is room', () => {
    assert.equal(shown(fitParts(parts, 200)), ' | 20 | sort: -timestamp | filters: message~alpha, level=error | config: projects/service/jlv.config.json | 4 skipped | ? help')
  })

  it('drops the hint first, then the page height, then cuts the widest names, keeping the end of a file name', () => {
    const full = shown(parts).length
    assert.equal(shown(fitParts(parts, full - 1)), shown(parts.slice(0, -1)))
    assert.equal(shown(fitParts(parts, full - 10)), shown(parts.slice(1, -1)))
    assert.equal(shown(fitParts(parts, full - 20)),
      ' | sort: -timestamp | filters: message~alpha, level=error | config: …s/service/jlv.config.json | 4 skipped')
    assert.equal(shown(fitParts(parts, full - 40)), ' | sort: -timestamp | filters: message~alpha, level=er… | config: …ig.json | 4 skipped')
  })

  it('cuts names to eight cells, then to their ellipsis, then drops them, and never a count', () => {
    assert.equal(shown(fitParts(parts, 75)), ' | sort: -timestamp | filters: message~alph… | config: …ig.json | 4 skipped')
    assert.equal(shown(fitParts(parts, 56)), ' | sort: -timestamp | filters: … | config: … | 4 skipped')
    assert.equal(shown(fitParts(parts, 10)), ' | sort: -timestamp | 4 skipped')
  })
})

describe('the status line of the viewer', () => {
  for (const columns of [30, 40, 80, 120]) {
    it(`fits ${String(columns)} columns and keeps the count of skipped lines`, async t => {
      const viewer = openFileViewer(t, characterization, { columns, configuration: 'a/very/long/path/of/a/{red-fg}project/jlv.config.json' })
      await press(viewer, 'f', 'a', 'm', 'a long filter text', keys.enter)
      const line = screenText(viewer.screen).at(-1) ?? ''
      assert.ok(line.length <= columns, line)
      if (columns < 80) {
        return
      }
      assert.ok(line.endsWith('| 4 skipped'), line)
      assert.ok(line.includes('…'), line)
    })
  }

  it('shows the hint for the key help when there is room, and the configuration file literally', t => {
    const viewer = openFileViewer(t, characterization, { columns: 120, configuration: '{red-fg}jlv.config.json' })
    const line = screenText(viewer.screen).at(-1) ?? ''
    assert.equal(line, '  NORMAL  1/31 | 20 | sort: -timestamp | config: {red-fg}jlv.config.json | 4 skipped | ? help')
    // The status line is white on blue; the file name too.
    assert.deepEqual(cellStyle(viewer.screen, line.indexOf('{red-fg}'), screenText(viewer.screen).length - 1), { foreground: 7, background: 4, isBold: false })
  })
})
