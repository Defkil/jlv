// Corrections to @types/blessed 0.1.27 for the blessed 0.1.81 runtime (plan §0.9). Only src/tui/blessed-boundary.ts
// loads blessed; phase 4 replaces this file with the neo-blessed declaration.
import type { Readable, Writable } from 'node:stream'
import type { Widgets } from 'blessed'

declare module 'blessed' {
  // The declarations swap the stream directions of the screen options: the screen reads keys from input and
  // writes to output.
  export type ScreenOptions = Omit<Widgets.IScreenOptions, 'input' | 'output'> & {
    readonly input?: Readable
    readonly output?: Writable
  }

  // The constructor of the box widget, which the declarations only describe as an instance type.
  export const Box: typeof Widgets.BoxElement

  // Creates a plain element; the declarations omit this factory.
  export function element (options?: Widgets.BoxOptions): Widgets.BoxElement

  export function screen (options: ScreenOptions): Widgets.Screen
}
