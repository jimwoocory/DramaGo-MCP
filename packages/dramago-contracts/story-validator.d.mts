export interface StoryPolicy {
  policy_version: string;
  content_kinds: Record<string, string>;
  steps: Record<string, { required_bindings: string[]; outputs: string[]; research: 'required' | 'optional'; port: string }>;
}
export const policy: StoryPolicy;
export function assertShape(name: string, value: unknown, code?: string): void;
export function contentType(content: unknown): string | undefined;
export function roleKind(role: string): string;
export function artifactRole(value: { content: unknown }): string | undefined;
export function contentObject(value: { content: unknown }): any;
export function validateContent(value: any, context: any, artifacts: any[], code?: string): void;
export function researchSnapshot(value: any, allowSynthetic?: boolean): void;
