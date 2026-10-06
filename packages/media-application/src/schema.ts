import { isDeepStrictEqual } from "node:util";
import { DomainError } from "@xiaoshuren/contracts";

type Check = (value: unknown) => boolean;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const types: Record<string, Check> = {
  object, array: Array.isArray, string: value => typeof value === "string",
  boolean: value => typeof value === "boolean", null: value => value === null,
  number: value => typeof value === "number" && Number.isFinite(value),
  integer: value => typeof value === "number" && Number.isInteger(value),
};
const bounds = ["minLength", "maxLength", "minItems", "maxItems"] as const;
const keywords = new Set([
  "type", "properties", "required", "additionalProperties", "items", "enum",
  "minimum", "maximum", ...bounds, "title", "description", "default", "examples",
]);
const invalidSchema = (): never => { throw new DomainError("VALIDATION_ERROR", "Unsupported or malformed model input schema"); };

/** Deliberately bounded JSON Schema subset. Unknown keywords fail CLOSED, even in
 * absent optional properties. No coercion, defaults, references or remote loading.
 * Compile the entire schema before evaluating any request value.
 */
function compile(schema: unknown, depth = 0): Check {
  if (depth > 64) return invalidSchema();
  if (typeof schema === "boolean") return () => schema;
  if (!object(schema) || Object.keys(schema).some(key => !keywords.has(key))) return invalidSchema();
  let type: Check | undefined;
  if (Object.hasOwn(schema, "type")) {
    if (typeof schema.type !== "string" || !Object.hasOwn(types, schema.type)) return invalidSchema();
    type = types[schema.type];
  }
  for (const key of bounds) {
    if (Object.hasOwn(schema, key) && (!Number.isSafeInteger(schema[key]) || (schema[key] as number) < 0)) return invalidSchema();
  }
  for (const key of ["minimum", "maximum"]) {
    if (Object.hasOwn(schema, key) && (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))) return invalidSchema();
  }
  for (const key of ["title", "description"]) {
    if (Object.hasOwn(schema, key) && typeof schema[key] !== "string") return invalidSchema();
  }
  if (Object.hasOwn(schema, "examples") && !Array.isArray(schema.examples)) return invalidSchema();
  let required: string[] = [];
  if (Object.hasOwn(schema, "required")) {
    if (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== "string")) return invalidSchema();
    required = schema.required as string[];
    if (new Set(required).size !== required.length) return invalidSchema();
  }
  const properties = new Map<string, Check>();
  if (Object.hasOwn(schema, "properties")) {
    if (!object(schema.properties)) return invalidSchema();
    for (const [key, child] of Object.entries(schema.properties)) properties.set(key, compile(child, depth + 1));
  }
  const additional = Object.hasOwn(schema, "additionalProperties") ? compile(schema.additionalProperties, depth + 1) : () => true;
  const items = Object.hasOwn(schema, "items") ? compile(schema.items, depth + 1) : () => true;
  let choices: unknown[] | undefined;
  if (Object.hasOwn(schema, "enum")) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) return invalidSchema();
    choices = schema.enum;
  }
  return value => {
    if (type && !type(value)) return false;
    if (choices && !choices.some(choice => isDeepStrictEqual(choice, value))) return false;
    if (typeof value === "number") {
      if (typeof schema.minimum === "number" && value < schema.minimum) return false;
      if (typeof schema.maximum === "number" && value > schema.maximum) return false;
    }
    if (typeof value === "string") {
      const length = [...value].length;
      if (typeof schema.minLength === "number" && length < schema.minLength) return false;
      if (typeof schema.maxLength === "number" && length > schema.maxLength) return false;
    }
    if (Array.isArray(value)) {
      if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
      if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return false;
      if (!value.every(items)) return false;
    } else if (object(value)) {
      if (required.some(key => !Object.hasOwn(value, key))) return false;
      for (const [key, child] of Object.entries(value)) {
        if (!(properties.get(key) ?? additional)(child)) return false;
      }
    }
    return true;
  };
}

export function validateModelInput(schema: Record<string, unknown>, request: Record<string, unknown>): void {
  if (!compile(schema)(request)) throw new DomainError("VALIDATION_ERROR", "Request does not match model input schema");
}
