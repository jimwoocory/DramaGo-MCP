import { equal } from '@xiaoshuren/dramago-application/domain.js'
import type { ArtifactRole, ArtifactVersion, JsonObject, Proposal, StoryStep } from './ports.js'
import { check, freeze, text } from './validation.js'

interface StepPolicy { research: 'required' | 'optional'; requires: ArtifactRole[]; outputs: ArtifactRole[] }
export const STORY_POLICY_VERSION = 'story-development/v1'
export const STEP_POLICIES: Readonly<Record<StoryStep, StepPolicy>> = freeze({
  direction: { research: 'optional', requires: [], outputs: ['direction'] },
  adaptation: { research: 'required', requires: ['direction'], outputs: ['adaptation'] },
  bible: { research: 'required', requires: ['direction'], outputs: ['story_foundation', 'story_bible'] },
  master_outline: { research: 'required', requires: ['story_foundation', 'story_bible'], outputs: ['master_outline'] },
  season_architecture: { research: 'required', requires: ['master_outline'], outputs: ['season_architecture'] },
  episode_outlines: { research: 'required', requires: ['story_bible', 'master_outline', 'season_architecture'], outputs: ['episode_outline'] },
})
export const roleKind = (role: ArtifactRole): string => ['direction', 'adaptation', 'episode_outline_set'].includes(role) ? 'other_drama' : role
export const contentObject = (v: ArtifactVersion): JsonObject => typeof v.content === 'object' && v.content !== null ? v.content : {}
export const artifactRole = (v: ArtifactVersion): string => String(contentObject(v).artifact_role ?? v.kind)
export function stepDependencies(step: StoryStep, inputs: ArtifactVersion[]) {
  for (const required of STEP_POLICIES[step].requires) {
    const matches = inputs.filter(v => artifactRole(v) === required && v.kind === roleKind(required))
    check(matches.length === 1, `exactly one ${required} input required`)
  }
}
export function researchSnapshot(v: ArtifactVersion) {
  const c = contentObject(v)
  check(v.kind === 'other_drama' && c.schema_version === 'dramago.research-snapshot/v1', 'research snapshot required')
  text(c.snapshot_version); text(c.captured_at)
  check(Number.isFinite(Date.parse(c.captured_at)), 'invalid research timestamp')
  check(Array.isArray(c.sources) && c.sources.length > 0 && Object.hasOwn(c, 'evidence'), 'research sources/evidence required')
  for (const source of c.sources) {
    check(source && typeof source === 'object' && !Array.isArray(source), 'source record required')
    text(source.uri); text(source.retrieved_at)
    check(Number.isFinite(Date.parse(source.retrieved_at)), 'invalid retrieval timestamp')
  }
}
export function proposalsValid(value: { proposals: Proposal[] }, step: StoryStep, episodeIds: string[]) {
  const valid = (condition: unknown) => check(condition, 'invalid writer proposal or episode scope', 'INVALID_GENERATION_OUTPUT')
  valid(value && Object.keys(value).join(',') === 'proposals' && Array.isArray(value.proposals))
  const proposals = value.proposals
  if (step === 'episode_outlines') {
    valid(equal(proposals.map(p => p.episode_id ?? null), episodeIds))
    valid(proposals.every(p => p.role === 'episode_outline'))
  } else {
    valid(equal(proposals.map(p => p.role), STEP_POLICIES[step].outputs))
    valid(proposals.every(p => !Object.hasOwn(p, 'episode_id')))
  }
  for (const p of proposals) {
    valid(p && Object.keys(p).every(k => ['role', 'data', 'episode_id'].includes(k)))
    valid(typeof p.data === 'string' ? p.data.trim().length > 0 : p.data && typeof p.data === 'object' && !Array.isArray(p.data) && Object.keys(p.data).length > 0)
  }
}
