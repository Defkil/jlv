// Declarations for neo-blessed 0.2.0, which ships none. It keeps the API of blessed 0.1.81, so they reuse
// @types/blessed 0.1.27 and correct only what those describe wrongly (plan sections 4.2 and 0.9). Only
// src/tui/blessed-boundary.ts loads the library.
declare module 'neo-blessed' {
  import type { Readable, Writable } from 'node:stream'
  import type * as blessed from 'blessed'

  // @types/blessed swaps the stream directions of the screen options: the screen reads keys from input and writes
  // to output.
  export type ScreenOptions = Omit<blessed.Widgets.IScreenOptions, 'input' | 'output'> & {
    readonly input?: Readable
    readonly output?: Writable
  }

  interface TerminalLibrary extends Omit<typeof blessed, 'screen'> {
    // The constructor of the box widget, which @types/blessed only describes as an instance type.
    readonly Box: typeof blessed.Widgets.BoxElement
    // Creates a plain element; @types/blessed omits this factory.
    element (options?: blessed.Widgets.BoxOptions): blessed.Widgets.BoxElement
    screen (options: ScreenOptions): blessed.Widgets.Screen
    // The patterns of lib/unicode.js with which blessed lays out text, all global; @types/blessed omits the module.
    readonly unicode: {
      readonly chars: {
        // Characters that take two cells.
        readonly all: RegExp
        // Combining and other zero-width characters.
        readonly combining: RegExp
        // Surrogate pairs.
        readonly surrogate: RegExp
      }
    }
  }

  const terminalLibrary: TerminalLibrary
  export default terminalLibrary
}
