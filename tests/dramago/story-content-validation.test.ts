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
import { auth, seal, setup as runtimeSetup } from './helpers/story-runtime.js'

const screenplayFormats = [
  ['interior slugline', 'INT. ROOM - NIGHT'],
  ['embedded exterior slugline', 'Maya faces a choice.\n  EXT. CITY STREET - DAY\nShe risks discovery.'],
  ['dialogue block', 'MAYA: Leave now.\nELI: I cannot.'],
  ['reviewer screenplay bypass', 'MAYA\n(whispering)\nI know what you did.\n\nELI\nThen keep your voice down.'],
  ['standalone cues without parentheticals', 'MAYA\nI know what you did.\nELI\nThen keep your voice down.'],
  ['wrapped standalone speech', 'MAYA\nI know what you did\nlast summer.\nELI\nThen keep your voice down.'],
  ['wrapped parenthetical speech', 'MAYA\n(whispering)\nLast summer,\nI saw what you did.'],
  ['wrapped speech before colon cue', 'MAYA\nLeave now.\nTonight.\nELI: I cannot.'],
  ['transition after wrapped body', 'MAYA\nA reluctant leader\nlearning to trust.\nCUT TO:'],
  ['slugline after wrapped body', 'MAYA\nA reluctant leader\nlearning to trust.\nINT./EXT. CAR - NIGHT'],
  ['indented CRLF voiceover cues', '  MAYA (V.O.)\r\n  (whispering)\r\n  I know what you did.\r\n\r\n  ELI (O.S.)\r\n  Then keep your voice down.'],
  ['single parenthetical speech block', 'MAYA\n(whispering)\nI know what you did.'],
  ['mixed standalone and colon cues', 'MAYA\nLeave now.\nELI: I cannot.'],
  ['lowercase us is speech', 'MAYA: Stay with us.\nELI: Not tonight.'],
  ['sentence-initial Us is speech', 'MAYA: Us against the world.\nELI: Not tonight.'],
  ['sentence-initial pronoun I is speech', 'MAYA\n(whispering)\nI remember everything.'],
  ['clause-initial pronoun I in wrapped speech', 'MAYA\n(whispering)\nLast summer,\nI saw everything.'],
  ['contracted pronoun I is speech', "MAYA\n(whispering)\nTonight I'm leaving."],
  ['embedded indented dialogue block', 'The confrontation escalates.\r\n  MAYA: Leave now.\r\n\r\n  ELI: I cannot.'],
  ['quoted dialogue cue', 'MAYA: "Leave now."'],
  ['transition', 'CUT TO:'],
  ['transition after standalone cue', 'MAYA\nCUT TO:'],
  ['combined slugline after standalone cue', 'MAYA\nINT./EXT. CAR - NIGHT'],
  ['embedded transition', 'The confrontation escalates.\r\n  CUT TO:\r\nThe fallout begins.'],
] as const

const planningProse = [
  'Maya enters the room at night and asks Eli to leave; his refusal forces her to act.',
  'The outline describes a scene, dialogue goals, and a cut to the aftermath without drafting it.',
  'Avoid INT./EXT. sluglines and the CUT TO: transition in the eventual outline.',
  'Goal: expose the lender.\nStakes: her family could lose their home.',
  'GOAL: Expose the lender.\nSTAKES: Her family could lose their home.',
  'MAYA: A reluctant leader who learns to trust.',
  'Maya: reluctant leader.\nEli: compromised ally.',
  'MAYA: A reluctant leader who learns to trust.\nELI: A compromised ally seeking redemption.',
  'MAYA: A former US Army medic searching for her brother.\nELI: A compromised ally seeking redemption.',
  'MAYA: A US Navy veteran.\nELI: An ally based in the US.',
  'MAYA\nA former US Army medic searching for her brother.\n\nELI\nA compromised ally seeking redemption.',
  'MAYA\n(background)\nA former US Army medic searching for her brother.',
  'MAYA\n(background)\nA former World War I medic searching for her brother.',
  'MAYA: A former World War I medic searching for her brother.\nELI: A compromised ally seeking redemption.',
  'MAYA\n(background)\nA former World War\nI medic searching for her brother.',
  'MAYA\n(background)\nA former US Army medic\nsearching for her brother.',
  'MAYA\n(background)\nA former Queen Mary I adviser\nsearching for her brother.',
  'MAYA\nA reluctant leader who learns to trust.\nELI\nA compromised ally seeking redemption.',
  'MAYA\nA reluctant leader\nwho learns to trust.\nELI\nA compromised ally\nseeking redemption.',
  'MAYA\n(background)\nA reluctant leader\nwho learns to trust.',
  'MAYA\n(background)\nA reluctant leader\nwho learns to trust.\nGOAL\nWe explore the cost of trust.',
  'MAYA\n(background)\nA reluctant leader\nwho learns to trust.\nGOAL: We explore the cost of trust.',
  'GOAL\nWe explore the cost of trust.\nSTAKES\nOur characters risk their home.',
  'MAYA',
  'She treats the phrase "Leave now" as a threat, not a request.',
  'The INT. ROOM - NIGHT heading is discussed here, not used as a scene heading.',
] as const

describe('generated planning strings stay outside Script', () => {
  it.each(screenplayFormats)('fails and durably replays %s without publishing', async (_name, text) => {
    let generated: any
    const s = await runtimeSetup({ generate: async (request: any, generate: any) => {
      const bundle = await generate(request)
      bundle.proposals[0].content.logline = text
      generated = seal(bundle.proposals[0])
      bundle.proposals[0] = generated
      return bundle
    } })
    const command = await s.command('direction')
    const before = structuredClone(s.store._state)
    const result = await s.service.runStep(auth, command)
    expect(Object.keys(result)).toEqual(['creative_run_id'])
    const run = await s.store.getRun(result.creative_run_id)
    expect(run.status).toBe('failed')
    expect(run.steps[0].attempts[0]).toMatchObject({ status: 'failed', output_refs: [] })
    expect([...s.store._state.audit.values()].at(-1)).toMatchObject({ error_code: 'INVALID_GENERATION_OUTPUT' })
    expect(await s.store.getArtifactVersion(generated.version_id)).toBeNull()
    expect(s.store._state.versions).toEqual(before.versions)
    expect(s.store._state.projects).toEqual(before.projects)
    expect(s.store._state.baselines).toEqual(before.baselines)
    expect(s.store._state.approvals).toEqual(before.approvals)
    const failedState = structuredClone(s.store._state)
    expect(await s.service.runStep(auth, command)).toEqual(result)
    expect(s.calls).toHaveLength(1)
    expect(s.store._state).toEqual(failedState)
  })

  it.each(planningProse)('publishes normal planning prose unchanged: %s', async text => {
    const s = await runtimeSetup({ generate: async (request: any, generate: any) => {
      const bundle = await generate(request)
      bundle.proposals[0].content.logline = text
      bundle.proposals[0] = seal(bundle.proposals[0])
      return bundle
    } })
    const { run, outputs } = await s.execute('direction')
    expect(run.status).toBe('succeeded')
    expect(outputs[0].content.logline).toBe(text)
  })

  it.each([
    ['adaptation', (c: any) => { c.adaptation.decisions[0] = 'INT. ROOM - NIGHT' }],
    ['bible', (c: any) => { c.characters[0].want = 'MAYA: Leave now.\nELI: I cannot.' }],
    ['master_outline', (c: any) => { c.causal_beats[0].action = 'CUT TO:' }],
    ['season_architecture', (c: any) => { c.movements[0].dramatic_function = 'EXT. CITY STREET - DAY' }],
    ['episode_outlines', (c: any) => { c.continuity_out[0] = 'MAYA: "Leave now."' }],
  ] as const)('also rejects nested object/array strings generated by %s', async (step, mutate) => {
    let attack = false
    const s = await runtimeSetup({ generate: async (request: any, generate: any) => {
      const bundle = await generate(request)
      if (attack) {
        mutate(bundle.proposals[0].content)
        bundle.proposals[0] = seal(bundle.proposals[0])
      }
      return bundle
    } })
    for (const prerequisite of Object.keys(published.steps)) {
      if (prerequisite === step) break
      expect((await s.execute(prerequisite)).run.status).toBe('succeeded')
    }
    const command = await s.command(step)
    const before = structuredClone(s.store._state)
    attack = true
    const { run, outputs } = await s.execute(step, command)
    expect(run.status).toBe('failed')
    expect(outputs).toEqual([])
    expect([...s.store._state.audit.values()].at(-1)).toMatchObject({ error_code: 'INVALID_GENERATION_OUTPUT' })
    expect(s.store._state.versions).toEqual(before.versions)
    expect(s.store._state.projects).toEqual(before.projects)
  })
})
const fixture = () => {
  const graph = storyFixture()
  const get = (name: string): any => graph.artifacts.find((a: any) => a.version_id === `av_${name}`)!
  const context = (name: string): any => get(`context_${name}`).content
  return { ...graph, get, context }
}

it.each(screenplayFormats)('shared semantic authority rejects %s with the caller error code', async (_name, text) => {
  const shared = await import('../../packages/dramago-contracts/story-validator.mjs')
  expect(rules.validateContent).toBe(shared.validateContent)
  const f = fixture(), v = f.get('direction')
  v.content.logline = text
  const resealed = seal(v)
  // Shape and digest are valid: the content-semantic gate must be the rejection.
  expect(() => contracts.assertShape('direction', resealed.content)).not.toThrow()
  expect(() => shared.validateContent(resealed, f.context('direction'), f.artifacts, 'BAD_CONTENT'))
    .toThrowError(expect.objectContaining({ code: 'BAD_CONTENT', message: 'screenplay formatting is not allowed in Story planning content' }))
})

it.each(planningProse)('shared semantic authority accepts normal planning prose: %s', async text => {
  const shared = await import('../../packages/dramago-contracts/story-validator.mjs')
  const f = fixture(), v = f.get('direction')
  v.content.logline = text
  const resealed = seal(v)
  expect(() => contracts.assertShape('direction', resealed.content)).not.toThrow()
  expect(() => shared.validateContent(resealed, f.context('direction'), f.artifacts, 'INVALID_GENERATION_OUTPUT')).not.toThrow()
})

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
