import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as rules from '../../packages/story-development/src/policy.js'

const directory = new URL('../../packages/dramago-contracts/contracts/', import.meta.url)
const published = JSON.parse(readFileSync(new URL('story-development-policy.v1.json', directory), 'utf8'))

describe('published Story policy', () => {
  it('uses precisely the six generator policies including the assembled episode set', () => {
    const expected = Object.fromEntries(Object.entries(published.steps)
      .filter(([, rule]: any) => rule.port === 'StoryGenerationPort')
      .map(([step, rule]: any) => [step, { research: rule.research, requires: rule.required_bindings, outputs: rule.outputs }]))
    expect(rules.STORY_POLICY_VERSION).toBe(published.policy_version)
    expect(rules.STEP_POLICIES).toEqual(expected)
  })
})

import * as contracts from '../../packages/story-development/src/contracts.js'
import { DomainError } from '../../packages/dramago-application/domain.js'

it('validates named checked-in definitions and envelopes, preserving DomainError codes', async () => {
  expect(contracts.assertShape).toBeTypeOf('function')
  expect(contracts.policy).toEqual(published)
  const good = { schema_version: 'dramago.story-idea/v1', premise: 'A debt', constraints: [] }
  expect(() => contracts.assertShape('idea', good)).not.toThrow()
  for (const [name, value] of [['idea', { ...good, premise: ' ' }], ['idea', { ...good, invented: true }], ['missing', good], ['story-development.schema.json', {}], ['artifact-version.schema.json', {}]] as const) {
    try { contracts.assertShape(name, value, 'INVALID_GENERATION_OUTPUT'); expect.fail('must reject') }
    catch (error) { expect(error).toBeInstanceOf(DomainError); expect(error).toMatchObject({ code: 'INVALID_GENERATION_OUTPUT' }) }
  }
  const shared = await import('../../packages/dramago-contracts/schema-validator.mjs')
  const script = await import('../../scripts/dramago-schema-instances.mjs')
  expect(shared.createInstanceValidator).toBe(script.createInstanceValidator)
  const validator = shared.createInstanceValidator(new Map([['bad.json', { $defs: { unused: { surpriseKeyword: true } } }]]))
  expect(validator.errors.join(' ')).toContain('unsupported validation keyword')
  expect(validator.validate({}, 'bad.json').length).toBeGreaterThan(0)
})

import { storyFixture, exactRef } from './helpers/p2-story-fixtures.mjs'
const fixture = () => {
  const graph = storyFixture()
  const get = (name: string): any => graph.artifacts.find((a: any) => a.version_id === `av_${name}`)!
  const context = (name: string): any => get(`context_${name}`).content
  return { ...graph, get, context }
}

it('identifies roles only through schema versions, and checks content shape and kind', () => {
  const f = fixture()
  expect(contracts.contentType).toBeTypeOf('function')
  for (const [role, kind] of Object.entries(published.content_kinds)) {
    const definition = JSON.parse(readFileSync(new URL('story-development.schema.json', directory), 'utf8')).$defs[role]
    const content = { schema_version: definition.properties.schema_version.const }
    expect(contracts.contentType(content)).toBe(role)
    expect(rules.artifactRole({ kind: 'wrong', content } as any)).toBe(role)
    expect(rules.roleKind(role)).toBe(kind)
  }
  for (const content of [null, [], 'story', {}, { artifact_role: 'direction' }, { schema_version: 'unknown' }]) {
    expect(contracts.contentType(content)).toBeUndefined()
    expect(rules.artifactRole({ kind: 'story_bible', content } as any)).toBeUndefined()
  }
  expect(rules.contentObject({ content: [] } as any)).toEqual({})
  expect(rules.contentObject({ content: null } as any)).toEqual({})
  const good = f.get('story_bible')
  expect(() => rules.validateContent(good, f.context('bible'), f.artifacts)).not.toThrow()
  for (const mutate of [(v: any) => { v.kind = 'other_drama' }, (v: any) => { v.content = 'prose' },
    (v: any) => { delete v.content.story_engine }, (v: any) => { v.content.approved = true }]) {
    const bad = structuredClone(good); mutate(bad)
    expect(() => rules.validateContent(bad, f.context('bible'), f.artifacts, 'INVALID_GENERATION_OUTPUT')).toThrowError(expect.objectContaining({ code: 'INVALID_GENERATION_OUTPUT' }))
  }
})

it('shares the canonical research validator with fixture conformance', async () => {
  const shared = await import('../../packages/dramago-contracts/story-validator.mjs')
  expect(rules.researchSnapshot).toBe(shared.researchSnapshot)
  const v = fixture().get('research')
  v.content.sources[0].locator = 'model:invented'
  expect(() => shared.researchSnapshot(v, true)).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }))
})

it('accepts schema-bound research only with explicit synthetic opt-in', () => {
  const v = fixture().get('research')
  expect(() => rules.researchSnapshot(v, true)).not.toThrow()
  expect(() => rules.researchSnapshot(v)).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }))
  v.content.data_class = 'observed'
  expect(() => rules.researchSnapshot(v)).not.toThrow()
  const mutations = [
    (c: any) => c.sources.push({ ...c.sources[0], title: 'Another title' }),
    (c: any) => c.claims.push({ ...c.claims[0], statement: 'Another statement' }),
    (c: any) => { c.claims[0].source_ids = ['missing_source'] },
    (c: any) => { c.sources[0].captured_at = '2026-01-01T00:00:01Z' },
    (c: any) => { c.sources[0].captured_at = '2026-02-30T00:00:00Z' },
    (c: any) => { delete c.sources[0].content_digest },
    (c: any) => { c.data_class = 'invented' },
  ]
  for (const mutate of mutations) {
    const bad = structuredClone(v); mutate(bad.content)
    expect(() => rules.researchSnapshot(bad, true)).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }))
  }
  expect(() => rules.researchSnapshot({ ...v, kind: 'story_bible' })).toThrow()
})

describe('typed scope and episode envelope', () => {
  it.each([
    ['season_architecture', 'season_architecture', (v: any) => v.content.ordered_episode_ids.reverse()],
    ['episode_outline_set', 'episode_outlines', (v: any) => v.content.ordered_episodes.reverse()],
    ['episode_outline_set', 'episode_outlines', (v: any) => { v.content.ordered_episodes[1].episode_id = 'ep_a' }],
    ['episode_outline_set', 'episode_outlines', (v: any) => { v.content.planning_scope.range_id = 'other_range' }],
    ['planning_review_evidence', 'planning_review', (v: any) => { v.content.planning_scope.range_id = 'other_range' }],
    ['ep_a', 'episode_outlines', (v: any) => { v.episode_id = 'ep_b' }],
    ['ep_a', 'episode_outlines', (v: any) => { delete v.episode_id }],
    ['ep_a', 'episode_outlines', (v: any) => { v.episode_id = v.content.episode_id = 'outside' }],
    ['story_bible', 'bible', (v: any) => { v.episode_id = 'ep_a' }],
  ])('rejects %s scope mutation %#', (name, operation, mutate) => {
    const f = fixture(), v = structuredClone(f.get(name as string)), c = f.context(operation as string)
    expect(() => rules.validateContent(v, c, f.artifacts)).not.toThrow()
    ;(mutate as (v: any) => void)(v)
    expect(() => rules.validateContent(v, c, f.artifacts, 'INVALID_GENERATION_OUTPUT')).toThrowError(expect.objectContaining({ code: 'INVALID_GENERATION_OUTPUT' }))
  })
})

describe.each([['master_outline', 'master_outline'], ['ep_a', 'episode_outlines']])('%s causal order', (name, operation) => {
  it.each(['duplicate-id', 'forward', 'self', 'missing', 'duplicate-predecessor'])('rejects %s causal IDs', attack => {
    const f = fixture(), v = f.get(name)
    const first = v.content.causal_beats[0]
    v.content.causal_beats.push({ ...first, beat_id: 'beat_b', action: 'React', predecessor_ids: ['beat_a'] })
    expect(() => rules.validateContent(v, f.context(operation), f.artifacts)).not.toThrow()
    if (attack === 'duplicate-id') v.content.causal_beats[1].beat_id = 'beat_a'
    if (attack === 'forward') first.predecessor_ids = ['beat_b']
    if (attack === 'self') first.predecessor_ids = ['beat_a']
    if (attack === 'missing') first.predecessor_ids = ['beat_missing']
    if (attack === 'duplicate-predecessor') v.content.causal_beats[1].predecessor_ids = ['beat_a', 'beat_a']
    expect(() => rules.validateContent(v, f.context(operation), f.artifacts, 'BAD_CONTENT')).toThrowError(expect.objectContaining({ code: 'BAD_CONTENT' }))
  })
})

it.each([['characters', 'want'], ['promises', 'setup']])('rejects duplicate Bible %s identities across distinct records', (collection, field) => {
  const f = fixture(), v = f.get('story_bible')
  v.content[collection].push({ ...v.content[collection][0], [field]: 'Different text, same stable ID' })
  expect(() => rules.validateContent(v, f.context('bible'), f.artifacts, 'BAD_CONTENT')).toThrowError(expect.objectContaining({ code: 'BAD_CONTENT' }))
})

it.each(['movement-id', 'schedule-id', 'movement-episode', 'movement-coverage', 'setup-episode', 'payoff-episode', 'promise-id', 'wrong-bible', 'no-bible', 'missing-engine'])('rejects season %s against its declared scope and selected Bible', attack => {
  const f = fixture(), v = f.get('season_architecture'), context = f.context('season_architecture')
  expect(() => rules.validateContent(v, context, f.artifacts)).not.toThrow()
  if (attack === 'movement-id') v.content.movements.push({ ...v.content.movements[0], turning_point: 'Different turning point' })
  if (attack === 'schedule-id') v.content.promise_schedule.push({ ...v.content.promise_schedule[0], payoff_episode_id: 'ep_a' })
  if (attack === 'movement-coverage') v.content.movements[0].episode_ids = ['ep_a']
  if (attack === 'movement-episode') v.content.movements[0].episode_ids = ['outside']
  if (attack === 'setup-episode') v.content.promise_schedule[0].setup_episode_id = 'outside'
  if (attack === 'payoff-episode') v.content.promise_schedule[0].payoff_episode_id = 'outside'
  if (attack === 'promise-id') v.content.promise_schedule[0].promise_id = 'missing_promise'
  if (attack === 'wrong-bible') {
    const selected = structuredClone(f.get('story_bible'))
    selected.version_id = 'av_other_bible'
    selected.content.promises[0].promise_id = 'other_promise'
    f.artifacts.push(selected); context.bindings.story_bible = exactRef(selected)
  }
  if (attack === 'no-bible') context.bindings.story_bible.version_id = 'av_missing'
  if (attack === 'missing-engine') delete f.get('story_bible').content.story_engine
  expect(() => rules.validateContent(v, context, f.artifacts, 'BAD_CONTENT')).toThrowError(expect.objectContaining({ code: 'BAD_CONTENT' }))
})

it('foundation freezes the exact context sources in declared order', () => {
  const f = fixture(), v = f.get('story_foundation'), c = f.context('adaptation')
  const refs = [exactRef(f.get('idea')), exactRef(f.get('direction'))]
  c.source_refs = structuredClone(refs)
  v.content.adaptation = { mode: 'adapted', source_refs: structuredClone(refs), decisions: ['Adapted with permission'] }
  expect(() => rules.validateContent(v, c, f.artifacts)).not.toThrow()
  v.content.adaptation.source_refs.reverse()
  expect(() => rules.validateContent(v, c, f.artifacts, 'BAD_CONTENT')).toThrowError(expect.objectContaining({ code: 'BAD_CONTENT' }))
  v.content.adaptation = { mode: 'original', source_refs: [], decisions: ['Original'] }
  expect(() => rules.validateContent(v, c, f.artifacts)).toThrow()
})

it.each(['omitted', 'foreign-claim', 'unselected-research', 'wrong-artifact', 'wrong-digest', 'missing-snapshot', 'wrong-kind'])('direction rejects %s market support', attack => {
  const f = fixture(), v = f.get('direction'), c = f.context('direction')
  expect(() => rules.validateContent(v, c, f.artifacts)).not.toThrow()
  if (attack === 'omitted') c.research = { status: 'omitted', reason: 'Initial ideas only' }
  if (attack === 'foreign-claim') v.content.market_claim_ids = ['missing_claim']
  if (attack === 'unselected-research') {
    const selected = structuredClone(f.get('research'))
    selected.version_id = 'av_selected_research'; selected.content.claims[0].claim_id = 'other_claim'
    f.artifacts.push(selected); c.research.snapshot_ref = exactRef(selected)
  }
  if (attack === 'wrong-artifact') c.research.snapshot_ref.artifact_id = 'art_other'
  if (attack === 'wrong-digest') c.research.snapshot_ref.content_digest = `sha256:${'f'.repeat(64)}`
  if (attack === 'missing-snapshot') c.research.snapshot_ref.version_id = 'av_missing'
  if (attack === 'wrong-kind') f.get('research').kind = 'story_bible'
  expect(() => rules.validateContent(v, c, f.artifacts, 'BAD_CONTENT')).toThrowError(expect.objectContaining({ code: 'BAD_CONTENT' }))
})

it('direction without market claims permits explicit omitted research', () => {
  const f = fixture(), v = f.get('direction'), c = f.context('direction')
  v.content.market_claim_ids = []; c.research = { status: 'omitted', reason: 'No market assertions' }
  expect(() => rules.validateContent(v, c, f.artifacts)).not.toThrow()
})
