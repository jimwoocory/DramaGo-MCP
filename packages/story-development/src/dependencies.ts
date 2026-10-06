import { canonicalHash, equal } from '@xiaoshuren/dramago-application/domain.js'
import type { ArtifactRef, ArtifactVersion, ProjectFact, RunContext, StoryRepository } from './ports.js'
import { check, exact, ref, uniqueRefs } from './validation.js'
import { assertShape, policy } from './contracts.js'
import { artifactRole, contentObject, researchSnapshot, roleKind, validateContent } from './policy.js'

export const contextOf = (v: ArtifactVersion): RunContext => v.content as unknown as RunContext
export const executionId = (context: ArtifactRef): string => `run_story_${canonicalHash(context).slice(7)}`
export const resolveIn = (artifacts: ArtifactVersion[], r: ArtifactRef): ArtifactVersion => {
  const found = artifacts.find(v => equal(ref(v), r))
  check(found, 'unresolved exact frozen reference')
  return found
}
export function contentRefs(value: unknown): ArtifactRef[] {
  if (!value || typeof value !== 'object') return []
  if (!Array.isArray(value) && 'artifact_id' in value && 'version_id' in value && 'content_digest' in value && !('schema_version' in value)) return [value as ArtifactRef]
  return Object.values(value).flatMap(contentRefs)
}
export function manifestRefs(contextRef: ArtifactRef, c: RunContext, artifacts: ArtifactVersion[]): ArtifactRef[] {
  const episodes = c.operation === 'planning_review'
    ? (contentObject(resolveIn(artifacts, c.bindings.episode_outline_set)).ordered_episodes as unknown as { outline_ref: ArtifactRef }[]).map(e => e.outline_ref) : []
  return uniqueRefs([contextRef, c.planning_scope.definition_ref, c.executor.configuration_ref,
    ...policy.steps[c.operation].required_bindings.map(name => c.bindings[name]), ...c.source_refs,
    ...(c.research.status === 'supplied' ? [c.research.snapshot_ref] : []), ...episodes])
}

/** Exact transitive closure, including contexts, source/configuration records and parents. */
export async function resolveDependencies(tx: StoryRepository, project: ProjectFact, roots: ArtifactRef[]): Promise<ArtifactVersion[]> {
  const resolved = new Map<string, ArtifactVersion>(), active = new Set<string>(), done = new Set<string>()
  const pending = roots.slice().reverse().map(r => ({ r, exit: false }))
  while (pending.length) {
    const { r, exit } = pending.pop()!
    const key = canonicalHash(r)
    if (exit) { active.delete(key); done.add(key); continue }
    check(!active.has(key), 'cyclic Story dependencies')
    if (done.has(key)) continue
    check(resolved.size < 4096, 'story dependency graph exceeds bound')
    const v = await exact(tx, project, r)
    resolved.set(key, v); active.add(key)
    pending.push({ r, exit: true })
    for (const child of uniqueRefs([...contentRefs(v.content), ...(v.parent_ref ? [v.parent_ref] : [])]).reverse()) pending.push({ r: child, exit: false })
  }
  return [...resolved.values()]
}

export function validateContext(v: ArtifactVersion, artifacts: ArtifactVersion[]) {
  check(artifactRole(v) === 'run_context' && v.kind === 'other_drama', 'typed run context required')
  assertShape('run_context', v.content)
  const c = contextOf(v)
  for (const name of policy.steps[c.operation].required_bindings) {
    const selected = resolveIn(artifacts, c.bindings[name])
    check(artifactRole(selected) === name && selected.kind === roleKind(name), `invalid ${name} binding`)
    assertShape(name, selected.content)
  }
  const range = resolveIn(artifacts, c.planning_scope.definition_ref)
  check(range.kind === 'planning_range' && equal(range.content, {
    workspace_id: v.workspace_id, project_id: v.project_id, range_id: c.planning_scope.range_id, ordered_episode_ids: c.planning_scope.ordered_episode_ids,
  }), 'declared scope definition mismatch')
}

export async function validateGraph(tx: StoryRepository, artifacts: ArtifactVersion[], allowSynthetic: boolean) {
  for (const v of artifacts) {
    const role = artifactRole(v), content = contentObject(v)
    if (role === 'run_context') validateContext(v, artifacts)
    else if (role === 'research_snapshot') researchSnapshot(v, allowSynthetic)
    else if (role === 'idea') { check(v.kind === roleKind(role), 'idea kind mismatch'); assertShape(role, v.content) }
    else if (role) {
      const context = resolveIn(artifacts, content.run_context_ref as unknown as ArtifactRef)
      validateContext(context, artifacts)
      const c = contextOf(context)
      validateContent(v, c, artifacts)
      const outputs = policy.steps[c.operation].outputs
      check(outputs.includes(role), 'content does not match generating operation')
      const refs = manifestRefs(ref(context), c, artifacts)
      const siblings = role === 'episode_outline_set' ? (content.ordered_episodes as unknown as { outline_ref: ArtifactRef }[]).map(e => e.outline_ref) : []
      check(equal(content.dependency_refs, uniqueRefs([...refs, ...siblings])), 'invalid exact output dependencies')
      if (role === 'episode_outline_set') validateSet(v, c, artifacts)
      // Identity is trusted only when an actual durable execution bound this
      // exact context, manifest and output. Caller-provided author labels do not count.
      const run = await tx.getRun(executionId(ref(context)))
      check(run && run.status === 'succeeded' && run.project_id === v.project_id && run.workspace_id === v.workspace_id
        && run.input_manifest_digest === canonicalHash(run.input_manifest)
        && equal(run.input_manifest.input_refs, refs)
        && run.steps.length === 1 && run.steps[0].stage === `story.${c.operation}`
        && run.steps[0].attempts.some(a => a.status === 'succeeded' && a.input_manifest_digest === run.input_manifest_digest && a.output_refs.some(r => equal(r, ref(v)))), 'Story output lacks trusted execution provenance')
    } else check(!content.run_context_ref && !content.schema_version?.toString().startsWith('dramago.story-'), 'unknown Story content')
  }
}

export function validateSet(v: ArtifactVersion, c: RunContext, artifacts: ArtifactVersion[]) {
  const entries = contentObject(v).ordered_episodes as unknown as { episode_id: string; outline_ref: ArtifactRef }[]
  check(equal(entries.map(e => e.episode_id), c.planning_scope.ordered_episode_ids), 'episode set coverage/order mismatch')
  for (const entry of entries) {
    const outline = resolveIn(artifacts, entry.outline_ref)
    check(artifactRole(outline) === 'episode_outline' && outline.episode_id === entry.episode_id && contentObject(outline).episode_id === entry.episode_id, 'outline episode identity mismatch')
    check(equal(contentObject(outline).run_context_ref, contentObject(v).run_context_ref), 'episode set must bind same-run outlines')
  }
}

/** Only semantic bindings select the current cohort. Parents remain verified history. */
export function coherentBindings(c: RunContext, artifacts: ArtifactVersion[]) {
  const pending = Object.values(c.bindings), seen = new Set<string>()
  while (pending.length) {
    const r = pending.pop()!, key = canonicalHash(r)
    if (seen.has(key)) continue
    seen.add(key)
    const v = resolveIn(artifacts, r), role = artifactRole(v)!
    if (c.bindings[role]) check(equal(r, c.bindings[role]), 'planning scope conflicts with exact dependency')
    const contextRef = contentObject(v).run_context_ref as unknown as ArtifactRef | undefined
    if (contextRef) {
      const prior = contextOf(resolveIn(artifacts, contextRef))
      check(equal(prior.planning_scope, c.planning_scope), 'selected Story scope differs from frozen scope')
      pending.push(...Object.values(prior.bindings))
    }
  }
}
