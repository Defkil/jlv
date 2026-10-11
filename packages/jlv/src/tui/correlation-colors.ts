// The colors of correlation identifiers in the viewer (plan section 6.3, upstream issue #15). The identifier's text
// alone picks its color: a hash of it chooses one of a fixed palette, so the same identifier has the same color in
// every view and every run, and nothing remembers identifiers, however many there are. Different identifiers may share
// a color, so the text stays the identifier; filters and the selection never look at colors.

// xterm 256-color numbers of middle brightness and different hues, which read on dark and light backgrounds; blessed
// reduces them to the nearest colors of terminals with fewer.
const correlationPalette: readonly string[] = ['167', '173', '179', '107', '72', '73', '68', '98', '134', '168', '137', '109']

// FNV-1a, 32 bits, over the UTF-16 code units of the text.
const hashOf = (text: string): number => {
  let hash = 0x81_1C_9D_C5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.codePointAt(index) ?? 0
    hash = Math.imul(hash, 0x01_00_01_93)
  }
  return hash >>> 0
}

// The blessed color of an identifier, such as 167 for {167-fg}.
const correlationColor = (identifier: string): string =>
  correlationPalette[hashOf(identifier) % correlationPalette.length] ?? 'default'

export { correlationColor, correlationPalette }
