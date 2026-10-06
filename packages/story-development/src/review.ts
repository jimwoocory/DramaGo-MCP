import { equal, canonicalHash } from '@xiaoshuren/dramago-application/domain.js'
import type { ArtifactRef, ArtifactRole, ArtifactVersion, PlanningScope, ProjectFact, ReviewResult, StoryRepository } from './ports.js'
import { check, exact, ref, uniqueRefs } from './validation.js'
import { artifactRole, contentObject, roleKind } from './policy.js'

export async function planningInputs(tx: StoryRepository, project: ProjectFact, scope: PlanningScope) {
  check(scope && typeof scope === 'object', 'planning scope required')
  check(Array.isArray(scope.ordered_episodes) && equal(scope.ordered_episodes.map(e => e.episode_id), project.planning_range.ordered_episode_ids), 'complete ordered episode scope required')
  const roles: [ArtifactRole, ArtifactRef][] = [
    ['story_foundation', scope.story_foundation], ['story_bible', scope.story_bible],
    ['master_outline', scope.master_outline], ['season_architecture', scope.season_architecture],
    ...scope.ordered_episodes.map(e => ['episode_outline', e.outline_ref] as [ArtifactRole, ArtifactRef]),
    ['direction', scope.direction_ref], ['episode_outline_set', scope.episode_outline_set_ref],
  ]
  const range = await exact(tx, project, project.planning_range.definition_ref)
  check(range.kind === 'planning_range', 'range definition required')
  const inputs = [range]
  for (const [role, requested] of roles) {
    const v = await exact(tx, project, requested)
    check(v.kind === roleKind(role) && artifactRole(v) === role, `invalid ${role} artifact`)
    inputs.push(v)
  }
  const subjectRefs = [ref(range), ...roles.slice(0, 4 + scope.ordered_episodes.length).map(([, r]) => r)]
  const contextRefs = [scope.direction_ref, scope.episode_outline_set_ref]
  check(uniqueRefs([...subjectRefs, ...contextRefs]).length === inputs.length, 'duplicate planning subjects')
  for (const episode of scope.ordered_episodes) {
    const outline = inputs.find(v => equal(ref(v), episode.outline_ref))!
    check(outline.episode_id === episode.episode_id, 'outline episode identity mismatch')
  }
  const set = inputs.at(-1)!
  check(equal(contentObject(set).ordered_episodes, scope.ordered_episodes), 'episode set does not bind exact scope')
  return { inputs, subjectRefs, contextRefs }
}
export function reviewValid(result: ReviewResult, subjects: ArtifactRef[], context: ArtifactRef[]) {
  const valid = (condition: unknown) => check(condition, 'invalid or incomplete review evidence', 'INVALID_REVIEW_OUTPUT')
  valid(result && Object.keys(result).sort().join(',') === 'blockers,context_refs,findings,outcome,subject_refs')
  valid(equal(result.subject_refs, subjects) && equal(result.context_refs, context))
  valid(['PASS', 'FAIL', 'BLOCKED'].includes(result.outcome) && Array.isArray(result.findings) && Array.isArray(result.blockers))
  const reviewed = new Set([...subjects, ...context].map(r => canonicalHash(r)))
  const codes = new Set<string>()
  for (const finding of result.findings) {
    valid(finding && Object.keys(finding).sort().join(',') === 'code,message,severity,subject_refs')
    valid(typeof finding.code === 'string' && finding.code.trim() && !codes.has(finding.code))
    codes.add(finding.code)
    valid(typeof finding.message === 'string' && finding.message.trim() && ['info', 'warning', 'blocker'].includes(finding.severity))
    valid(Array.isArray(finding.subject_refs) && finding.subject_refs.length && uniqueRefs(finding.subject_refs).length === finding.subject_refs.length)
    valid(finding.subject_refs.every(r => reviewed.has(canonicalHash(r))))
  }
  const blockers = result.findings.filter(f => f.severity === 'blocker').map(f => f.code)
  valid(equal(result.blockers, blockers))
  valid(result.outcome === 'PASS' ? blockers.length === 0 : blockers.length > 0)
}
export function independentReviewer(identity: string, inputs: ArtifactVersion[]) {
  for (const v of inputs) check(contentObject(v).generated_by !== identity, 'reviewer authored a subject', 'ROLE_SEPARATION')
}
