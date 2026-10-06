export interface InstanceValidator {
  errors: string[];
  validate(value: unknown, file: string, label?: string): string[];
}
export function createInstanceValidator(schemas: Map<string, unknown>): InstanceValidator;
export function validateExamples(schemas: Map<string, unknown>, examples: Map<string, unknown>): { errors: string[]; instances: number };
