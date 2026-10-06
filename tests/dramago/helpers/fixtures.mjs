import { existsSync, readFileSync } from 'node:fs'

// Prefer the separately owned contracts package once it is merged. If that
// package exists, missing/broken fixtures are errors, not a silent fallback.
const contracts = new URL('../../../packages/dramago-contracts/', import.meta.url)
export const fixtureDirectory = existsSync(contracts)
  ? new URL('contracts/examples/', contracts)
  : new URL('../fixtures/contracts-examples/', import.meta.url)

export const fixture = name => JSON.parse(readFileSync(new URL(`${name}.json`, fixtureDirectory), 'utf8'))
