// The only module that loads the terminal backend, neo-blessed 0.2.0 (plan §4.2). Widgets extend Box and create
// their parts through these factories. src/types/neo-blessed.d.ts declares the library with the corrected types of
// blessed 0.1.81, whose API it keeps; callback payloads that the declarations describe wrongly are normalized here
// before they reach the widgets.
import terminalLibrary from 'neo-blessed'
import type { ScreenOptions } from 'neo-blessed'
import type { Widgets } from 'blessed'

const { Box } = terminalLibrary

const createScreen = (options: ScreenOptions): Widgets.Screen => terminalLibrary.screen(options)

const createElement = (options: Widgets.BoxOptions): Widgets.BoxElement => terminalLibrary.element(options)

const createList = (options: Widgets.ListOptions<Widgets.ListElementStyle>): Widgets.ListElement => terminalLibrary.list(options)

const createPrompt = (options: Widgets.PromptOptions): Widgets.PromptElement => terminalLibrary.prompt(options)

const createQuestion = (options: Widgets.QuestionOptions): Widgets.QuestionElement => terminalLibrary.question(options)

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
