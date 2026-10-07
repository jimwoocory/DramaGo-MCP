import { canonicalHash, equal, snapshot } from '@xiaoshuren/dramago-application/domain.js'
import type { ArtifactRef, ArtifactVersion, RunContext, ProjectFact, StoryRepository, StoryAuthorshipPort } from './ports.js'
import { check, exact, freeze, ref } from './validation.js'
import { artifactRole, contentObject, researchSnapshot } from './policy.js'
import { contextOf, executionId, resolveIn, resolveDependencies, validateContext } from './dependencies.js'
import { trustedWriter } from './authorship.js'
import { policy } from './contracts.js'

export function reviewScope(c: RunContext, artifacts: ArtifactVersion[]) {
  const set = resolveIn(artifacts, c.bindings.episode_outline_set)
  const episodes = (contentObject(set).ordered_episodes as unknown as { outline_ref: ArtifactRef }[]).map(e => e.outline_ref)
  check(c.research.status === 'supplied', 'review requires research')
  const subjects = [c.planning_scope.definition_ref, ...['story_foundation', 'story_bible', 'master_outline', 'season_architecture'].map(n => c.bindings[n]), ...episodes]
  const inspected = [c.planning_scope.definition_ref, ...policy.steps.planning_review.required_bindings.map(n => c.bindings[n]), ...episodes, c.research.snapshot_ref]
  const writers = [...new Set(inspected.map(r => contentObject(resolveIn(artifacts, r)).run_context_ref)
    .filter(Boolean).map(r => contextOf(resolveIn(artifacts, r as unknown as ArtifactRef)).executor.executor_id))].sort()
  return { subjects, inspected, writers }
}
/** Validate every creative ancestor; labels never establish trusted authorship. */
export async function independentReviewer(tx: StoryRepository, project: ProjectFact, identity: string, inputs: ArtifactVersion[], attestation?: StoryAuthorshipPort, allowSynthetic = false, trustedConfigurations: ArtifactRef[] = []) {
  const structural = new Set(trustedConfigurations.map(canonicalHash))
  for (const v of inputs.filter(v => artifactRole(v) === 'run_context')) {
    validateContext(v, await resolveDependencies(tx, project, [ref(v)]))
    const c = contextOf(v)
    structural.add(canonicalHash(c.planning_scope.definition_ref))
    structural.add(canonicalHash(ref(v)))
    // A schema-valid context is not evidence that its configuration was trusted.
    // Historical configs need an exact output with service-owned execution proof;
    // current port configs are supplied explicitly by the service, not the caller.
    const run = await tx.getRun(executionId(ref(v)))
    if (run?.status === 'succeeded' && Array.isArray(run.steps)) {
      const outputRef = run.steps.flatMap(step => Array.isArray(step.attempts) ? step.attempts : [])
        .filter(attempt => attempt.status === 'succeeded' && Array.isArray(attempt.output_refs))
        .flatMap(attempt => attempt.output_refs)[0]
      if (outputRef) {
        const output = await exact(tx, project, outputRef)
        check(equal(contentObject(output).run_context_ref, ref(v)), 'configuration lacks bound execution provenance', 'ROLE_SEPARATION')
        await trustedWriter(tx, project, output)
        structural.add(canonicalHash(c.executor.configuration_ref))
      }
    }
  }
  for (const input of inputs) {
    const v = await exact(tx, project, ref(input)), body = contentObject(v)
    check(body.generated_by !== identity, 'reviewer authored a subject', 'ROLE_SEPARATION')
    const role = artifactRole(v)
    if (role === 'research_snapshot') { researchSnapshot(v, allowSynthetic); continue }
    // A creative artifact cannot acquire an exemption just by being referenced as config.
    if ((!role || role === 'run_context') && structural.has(canonicalHash(ref(v)))) continue
    if (body.run_context_ref) {
      check(await trustedWriter(tx, project, v) !== identity, 'reviewer authored a subject', 'ROLE_SEPARATION')
      continue
    }
    const result = attestation ? snapshot(await attestation.attest(freeze(snapshot({ artifact: v, project, reviewer_identity: identity })), new AbortController().signal)) : null
    check(result && equal(result.artifact_ref, ref(v)) && Array.isArray(result.author_identities) && result.author_identities.length > 0 && result.author_identities.every(author => typeof author === 'string' && author.trim().length > 0 && author !== identity), 'creative authorship is not trusted or independent', 'ROLE_SEPARATION')
  }
}
export function reviewValid(v: ArtifactVersion, c: RunContext, artifacts: ArtifactVersion[]) {
  const code = 'INVALID_REVIEW_OUTPUT', result = contentObject(v) as any
  const { subjects, inspected, writers } = reviewScope(c, artifacts)
  check(equal(result.subject_refs, subjects) && equal(result.inspected_refs, inspected), 'incomplete exact review subjects', code)
  check(result.reviewer_id === c.executor.executor_id && equal(result.reviewed_writer_ids, writers), 'review identity mismatch', code)
  check(!writers.includes(result.reviewer_id), 'reviewer authored a subject', code)
  const ids = new Set<string>(), allowed = new Set(inspected.map(canonicalHash))
  for (const finding of result.findings) {
    check(!ids.has(finding.finding_id), 'duplicate finding_id', code)
    ids.add(finding.finding_id)
    check(finding.subject_refs.every((r: ArtifactRef) => allowed.has(canonicalHash(r))), 'finding subject outside inspected scope', code)
  }
  const blockers = result.findings.filter((f: any) => f.severity === 'blocker').map((f: any) => f.finding_id)
  check(equal(result.blockers, blockers), 'blocker IDs must match finding order', code)
  check(result.outcome === 'PASS' ? blockers.length === 0 : blockers.length > 0, 'invalid review outcome/blockers', code)
}
