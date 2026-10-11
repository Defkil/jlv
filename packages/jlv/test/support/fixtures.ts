import { readFileSync } from 'node:fs'

// Upstream's own fixtures, retained unchanged in packages/jlv/test/fixtures.
export const upstreamFixture = (name: string): URL => new URL(`../fixtures/${name}`, import.meta.url)

export const readUpstreamFixture = (name: string): string => readFileSync(upstreamFixture(name), 'utf8')

// Follows own properties only, so a lookup can never reach prototype members.
export const valueAt = (value: unknown, path: readonly string[]): unknown => {
  let current = value
  for (const key of path) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key)) {
      return undefined
    }
    current = (current as Readonly<Record<string, unknown>>)[key]
  }
  return current
}
