import { canonicalHash, equal, DomainError, snapshot } from '@xiaoshuren/dramago-application/domain.js'
import type { ArtifactRef, ArtifactVersion, AuthContext, Command, ProjectFact, StoryRepository } from './ports.js'
import { assertShape } from './contracts.js'

export function check(condition: unknown, message: string, code = 'VALIDATION_ERROR'): asserts condition {
  if (!condition) throw new DomainError(code, message)
}
export function text(value: unknown): asserts value is string {
  check(typeof value === 'string' && value.trim().length > 0, 'nonempty string required')
}
export function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
export function reference(value: ArtifactRef): ArtifactRef { assertShape('artifact_ref', value); return value }
export const ref = (v: ArtifactRef): ArtifactRef => ({ artifact_id: v.artifact_id, version_id: v.version_id, content_digest: v.content_digest })
export const uniqueRefs = (refs: ArtifactRef[]): ArtifactRef[] => [...new Map(refs.map(r => [canonicalHash(reference(r)), r])).values()]
export function commandValid(auth: AuthContext, command: Command, action: string) {
  text(auth.tenantId); text(auth.subjectId); text(auth.clientId)
  check(Array.isArray(auth.scopes) && auth.scopes.includes(action), 'required scope missing', 'FORBIDDEN')
  assertShape(action === 'story.review' ? 'review_request' : 'step_request', command)
}
export async function projectAt(tx: StoryRepository, command: Command): Promise<ProjectFact> {
  const project = await tx.getProject(command.project_id)
  check(project, 'project not found', 'NOT_FOUND')
  check(project.project_id === command.project_id, 'project identity mismatch')
  assertShape('drama-project.schema.json', project)
  check(project.revision === command.expected_revision, 'stale project revision', 'REVISION_CONFLICT')
  return snapshot(project)
}
export async function exact(tx: StoryRepository, project: ProjectFact, requested: ArtifactRef): Promise<ArtifactVersion> {
  reference(requested)
  const v = await tx.getArtifactVersion(requested.version_id)
  check(v && equal(ref(v), requested) && v.project_id === project.project_id && v.workspace_id === project.workspace_id, 'unresolved or foreign artifact reference')
  assertShape('artifact-version.schema.json', v)
  check(!await tx.getBaselineByVersion(requested.version_id, project.project_id), 'ambiguous artifact/baseline version')
  check(v.content_digest === canonicalHash(v.content), 'stored content digest mismatch')
  return snapshot(v)
}
