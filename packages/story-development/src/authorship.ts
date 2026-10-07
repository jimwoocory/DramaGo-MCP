import { canonicalHash, equal, DomainError } from '@xiaoshuren/dramago-application/domain.js'
import type { ArtifactRef, ArtifactVersion, ProjectFact, StoryRepository } from './ports.js'
import { artifactRole, contentObject, STORY_POLICY_VERSION, validateContent } from './policy.js'
import { check, exact, ref, uniqueRefs } from './validation.js'
import { contextOf, executionId, manifestRefs, resolveDependencies, validateContext, validateSet } from './dependencies.js'
import { policy } from './contracts.js'

/** Labels and context refs are claims, not proof. The service-owned durable run
 * must bind the exact output, canonical manifest and generating context. No
 * legacy envelope fields or caller-provided authorship labels grant authority.
 */
export async function trustedWriter(tx: StoryRepository, project: ProjectFact, artifact: ArtifactVersion, artifacts?: ArtifactVersion[], code = 'ROLE_SEPARATION'): Promise<string> {
  const valid = (condition: unknown): void => check(condition, 'Story output lacks trusted execution provenance', code)
  try {
    const persisted = await exact(tx, project, ref(artifact))
    valid(equal(persisted, artifact))
    const body = contentObject(persisted)
    const contextRef = body.run_context_ref as unknown as ArtifactRef
    const contextVersion = await exact(tx, project, contextRef)
    const graph = artifacts ?? await resolveDependencies(tx, project, [ref(persisted)])
    validateContext(contextVersion, graph)
    const c = contextOf(contextVersion), role = artifactRole(persisted)
    validateContent(persisted, c, graph)
    valid(role && policy.steps[c.operation].outputs.includes(role))
    const runId = executionId(contextRef), run = await tx.getRun(runId)
    valid(run && run.schema_version === 'dramago.creative-run/v1' && run.run_id === runId
      && run.status === 'succeeded' && run.domain === 'story'
      && run.project_id === project.project_id && run.workspace_id === project.workspace_id)
    const manifest = run!.input_manifest
    const refs = manifestRefs(contextRef, c, graph)
    valid(manifest && manifest.schema_version === 'dramago.run-input-manifest/v1'
      && manifest.policy_version === STORY_POLICY_VERSION && equal(manifest.input_refs, refs)
      && canonicalHash(manifest) === run!.input_manifest_digest)
    valid(Array.isArray(run!.steps) && run!.steps.length === 1)
    const step = run!.steps[0]
    valid(step.stage === `story.${c.operation}` && Array.isArray(step.attempts))
    const proofs = step.attempts.filter(a => Number.isSafeInteger(a.attempt) && a.attempt > 0
      && a.status === 'succeeded' && a.input_manifest_digest === run!.input_manifest_digest
      && Array.isArray(a.output_refs) && a.output_refs.some(r => equal(r, ref(persisted))))
    valid(proofs.length === 1)
    let dependencies = refs
    if (role === 'episode_outline_set') {
      validateSet(persisted, c, graph)
      const members = (body.ordered_episodes as unknown as { outline_ref: ArtifactRef }[]).map(e => e.outline_ref)
      valid(members.every(member => proofs[0].output_refs.some(output => equal(output, member))))
      dependencies = uniqueRefs([...refs, ...members])
    }
    valid(equal(body.dependency_refs, dependencies))
    return c.executor.executor_id
  } catch (error) {
    if (error instanceof DomainError) check(false, 'Story output lacks trusted execution provenance', code)
    throw error
  }
}
