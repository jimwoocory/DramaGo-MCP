import { canonicalHash, equal, DomainError, snapshot } from '@xiaoshuren/dramago-application/domain.js'
import type { ArtifactRef, ArtifactVersion, AuthContext, Command, ProjectFact, StoryRepository } from './ports.js'

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
export function reference(value: ArtifactRef): ArtifactRef {
  check(value && typeof value === 'object' && Object.keys(value).sort().join(',') === 'artifact_id,content_digest,version_id', 'exact reference triple required')
  text(value.artifact_id); text(value.version_id)
  check(/^sha256:[0-9a-f]{64}$/.test(value.content_digest), 'invalid reference digest')
  return value
}
export const ref = (v: ArtifactRef): ArtifactRef => ({ artifact_id: v.artifact_id, version_id: v.version_id, content_digest: v.content_digest })
export const uniqueRefs = (refs: ArtifactRef[]): ArtifactRef[] => [...new Map(refs.map(r => [canonicalHash(reference(r)), r])).values()]
export function commandValid(auth: AuthContext, command: Command & { research_ref?: ArtifactRef }, action: string) {
  text(auth.tenantId); text(auth.subjectId); text(auth.clientId)
  check(Array.isArray(auth.scopes) && auth.scopes.includes(action), 'required scope missing', 'FORBIDDEN')
  text(command.project_id); text(command.workspace_id); text(command.idempotency_key)
  check(Number.isSafeInteger(command.expected_revision) && command.expected_revision >= 0, 'invalid expected_revision')
  if (Object.hasOwn(command, 'research_ref')) reference(command.research_ref!)
}
export async function projectAt(tx: StoryRepository, command: Command): Promise<ProjectFact> {
  const project = await tx.getProject(command.project_id)
  check(project, 'project not found', 'NOT_FOUND')
  check(project.workspace_id === command.workspace_id, 'workspace mismatch')
  check(project.revision === command.expected_revision, 'stale project revision', 'REVISION_CONFLICT')
  const ids = project.planning_range?.ordered_episode_ids
  check(Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length, 'invalid declared episode scope')
  ids.forEach(text)
  return snapshot(project)
}
export async function exact(tx: StoryRepository, project: ProjectFact, requested: ArtifactRef): Promise<ArtifactVersion> {
  reference(requested)
  const v = await tx.getArtifactVersion(requested.version_id)
  check(v && equal(ref(v), requested) && v.project_id === project.project_id && v.workspace_id === project.workspace_id, 'unresolved or foreign artifact reference')
  check(v.schema_version === 'dramago.artifact-version/v1' && !Object.hasOwn(v, 'manifest'), 'invalid artifact envelope')
  check(!await tx.getBaselineByVersion(requested.version_id, project.project_id), 'ambiguous artifact/baseline version')
  check(v.content_digest === canonicalHash(v.content), 'stored content digest mismatch')
  return snapshot(v)
}
