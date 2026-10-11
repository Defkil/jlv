// The only module that loads the terminal backend (plan §4.2). Widgets extend Box and create their parts through
// these factories. The declarations of blessed 0.1.81 are corrected in src/types/blessed.d.ts; callback payloads
// that they describe wrongly are normalized here before they reach the widgets.
import blessed from 'blessed'
import type { ScreenOptions, Widgets } from 'blessed'

const { Box } = blessed

const createScreen = (options: ScreenOptions): Widgets.Screen => blessed.screen(options)

const createElement = (options: Widgets.BoxOptions): Widgets.BoxElement => blessed.element(options)

const createList = (options: Widgets.ListOptions<Widgets.ListElementStyle>): Widgets.ListElement => blessed.list(options)

const createPrompt = (options: Widgets.PromptOptions): Widgets.PromptElement => blessed.prompt(options)

const createQuestion = (options: Widgets.QuestionOptions): Widgets.QuestionElement => blessed.question(options)

// Shows the prompt and reports the entered text. blessed reports a cancelled prompt with null, which the declarations
// do not admit; it arrives here as undefined.
const readInput = (
  prompt: Widgets.PromptElement,
  text: string,
  value: string,
  callback: (error: unknown, input: string | undefined) => void
): void => {
  prompt.input(text, value, (error: unknown, input: unknown) => {
    callback(error, typeof input === 'string' ? input : undefined)
  })
}

// Shows the question and reports whether it was accepted. blessed answers with a boolean, not the declared text.
const ask = (question: Widgets.QuestionElement, text: string, callback: (error: unknown, isAccepted: boolean) => void): void => {
  question.ask(text, (error: unknown, answer: unknown) => {
    callback(error, answer === true)
  })
}

// blessed computes the size of an element or a screen as a number of cells; the declarations also admit the
// percentages of the options. Number() keeps upstream's implicit conversion.
const toCells: (size: number | string) => number = Number

export { Box, ask, createElement, createList, createPrompt, createQuestion, createScreen, readInput, toCells }
