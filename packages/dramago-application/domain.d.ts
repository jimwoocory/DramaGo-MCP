export class DomainError extends Error {
  constructor(code: string, message: string, details?: object)
  code: string
  details: object
}
export function canonicalize(value: unknown): string
export function canonicalHash(value: unknown): string
export function snapshot<T>(value: T): T
export function equal(a: unknown, b: unknown): boolean
export function ensure(condition: unknown, code: string, message: string, details?: object): asserts condition
