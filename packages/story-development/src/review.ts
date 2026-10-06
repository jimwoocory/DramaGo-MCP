import { canonicalHash, equal } from '@xiaoshuren/dramago-application/domain.js'
import type { ArtifactRef, ArtifactVersion, RunContext } from './ports.js'
import { check } from './validation.js'
import { contentObject } from './policy.js'
import { contextOf, resolveIn } from './dependencies.js'
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
export function independentReviewer(identity: string, c: RunContext, artifacts: ArtifactVersion[]) {
  check(!reviewScope(c, artifacts).writers.includes(identity), 'reviewer authored a subject', 'ROLE_SEPARATION')
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
