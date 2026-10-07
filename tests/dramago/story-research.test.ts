import { describe, it, expect } from 'vitest'
import { canonicalHash } from '../../packages/dramago-application/index.js'
import { marketClaimsValid } from '../../packages/story-development/src/research.js'
import { setup as runtimeSetup, ref, seal } from './helpers/story-runtime.js'

const at = '2026-01-01T00:00:00Z'
const snapshot = (): any => ({
  schema_version: 'dramago.research-snapshot/v1', data_class: 'observed', as_of: at,
  territories: ['US'], question: 'What does the retained source report?',
  sources: [{ source_id: 'source_1', locator: 'urn:archive:report-1', title: 'Retained report', captured_at: at,
    content_digest: canonicalHash('Retained report bytes'), excerpt: 'The pilot reached 100 viewers.' }],
  claims: [{ claim_id: 'claim_1', statement: 'The pilot reached 100 viewers.', source_ids: ['source_1'] }], limitations: [],
})
async function setup(research: any = snapshot(), options: any = {}, data: any = { market_claim_ids: [] }, input?: any) {
  const s = await runtimeSetup({
    // The shared offline fixture opts in. These tests must exercise the strict
    // production default unless this individual case explicitly grants trust.
    config: { allowSyntheticResearch: undefined, ...options },
    generate: async (request: any, generate: any) => {
      const bundle = await generate(request)
      bundle.proposals = bundle.proposals.map((v: any) => seal({ ...v, content: { ...v.content, market_claim_ids: [], ...data } }))
      return bundle
    },
  })
  const selected = research === null ? null : await s.put(research)
  // Published ideas have a closed schema. Imported creative source payloads
  // carry arbitrary nested claims without an unrelated idea-schema failure.
  const source = input === undefined ? null : await s.put(input)
  const command = await s.command('direction', {
    research: selected ? { status: 'supplied', snapshot_ref: ref(selected) } : { status: 'omitted', reason: 'No research selected for this direction' },
    source_refs: source ? [ref(source)] : [],
  })
  return { ...s, selected, run: () => s.execute('direction', command) }
}
async function expectGenerationFailure(s: Awaited<ReturnType<typeof setup>>) {
  const before = structuredClone(s.store._state)
  const { result, run, outputs } = await s.run()
  // The published response contains only the execution identifier. Status and
  // error details must be read from durable records, not invented response fields.
  expect(result).toEqual({ creative_run_id: run.run_id })
  expect(run.status).toBe('failed')
  expect(run.steps[0].attempts[0]).toMatchObject({ status: 'failed', output_refs: [] })
  expect(outputs).toEqual([])
  expect(s.calls).toHaveLength(1)
  expect([...s.store._state.audit.values()]).toContainEqual(expect.objectContaining({
    creative_run_id: run.run_id, status: 'failed', error_code: 'INVALID_GENERATION_OUTPUT',
  }))
  expect(s.store._state.versions).toEqual(before.versions)
  expect(s.store._state.projects).toEqual(before.projects)
}

const malformedClaims = [null, 'claim_1', ['claim_1', 'claim_1'], [''], [' '], ['claim bad']].map(ids => ({ ids }))

describe('Story research provenance', () => {
  it.each(['allowSyntheticResearch', 'allow_synthetic_research'])('permits synthetic evidence only with trusted offline option %s', async option => {
    const c = snapshot(); c.data_class = 'synthetic'
    const s = await setup(c, { [option]: true })
    expect((await s.run()).run.status).toBe('succeeded')
  })
  it.each([null, snapshot()])('rejects unsupported writer market claims with research %j', async research => {
    const s = await setup(research, {}, { market_claim_ids: ['invented'] })
    await expectGenerationFailure(s)
  })
  it('accepts writer claims supported by the selected snapshot', async () => {
    const s = await setup(snapshot(), {}, { market_claim_ids: ['claim_1'] })
    const { run, outputs } = await s.run()
    expect(run.status).toBe('succeeded')
    expect(outputs[0].content.market_claim_ids).toEqual(['claim_1'])
  })
  it('permits empty market claims without research', async () => {
    const s = await setup(null, {}, { market_claim_ids: [] })
    expect((await s.run()).run.status).toBe('succeeded')
  })
  it.each([null, snapshot()])('rejects unsupported input market claims before generation with research %j', async research => {
    const s = await setup(research, {}, {}, { data: [{ nested: { market_claim_ids: ['invented'] } }] })
    const before = structuredClone(s.store._state)
    await expect(s.run()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(s.calls).toHaveLength(0)
    expect(s.store._state).toEqual(before)
  })
  it.each(malformedClaims)('rejects malformed writer market claim lists: $ids', async ({ ids }) => {
    const s = await setup(snapshot(), {}, { market_claim_ids: ids })
    await expectGenerationFailure(s)
  })
  it.each(malformedClaims)('rejects malformed nested writer market claim lists: $ids', async ({ ids }) => {
    const payload = { nested: [{ market_claim_ids: ids }] }
    const s = await setup(snapshot(), {}, payload)
    // Closed published output schemas also reject unknown nested fields. Assert
    // the recursive semantic validator separately so schema rejection cannot
    // conceal losing the original nested-claim validation coverage.
    expect(() => marketClaimsValid(payload, s.selected, 'INVALID_GENERATION_OUTPUT'))
      .toThrow(expect.objectContaining({ code: 'INVALID_GENERATION_OUTPUT' }))
    await expectGenerationFailure(s)
  })
  it.each(malformedClaims)('rejects malformed nested input claims before writes: $ids', async ({ ids }) => {
    const s = await setup(snapshot(), {}, {}, { data: [{ market_claim_ids: ids }] })
    const before = structuredClone(s.store._state)
    await expect(s.run()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(s.calls).toHaveLength(0)
    expect(s.store._state).toEqual(before)
  })
  it('accepts supported claims recursively through input objects and arrays', async () => {
    const input = { data: [{ market_claim_ids: ['claim_1'] }, { nested: { market_claim_ids: [] } }] }
    const s = await setup(snapshot(), {}, {}, input)
    expect(() => marketClaimsValid(input, s.selected, 'INVALID_GENERATION_OUTPUT')).not.toThrow()
    expect((await s.run()).run.status).toBe('succeeded')
  })
  it.each([
    ['null evidence', (c: any) => { c.evidence = null }],
    ['synthetic by default', (c: any) => { c.data_class = 'synthetic' }],
    ['missing classification', (c: any) => { delete c.data_class }],
    ['invented model locator', (c: any) => { c.sources[0].locator = 'model:invented' }],
    ['obfuscated model locator', (c: any) => { c.sources[0].locator = ' Model :invented' }],
    ['blank excerpt', (c: any) => { c.sources[0].excerpt = ' ' }],
    ['blank locator', (c: any) => { c.sources[0].locator = ' ' }],
    ['blank title', (c: any) => { c.sources[0].title = ' ' }],
    ['bad source digest', (c: any) => { c.sources[0].content_digest = 'a URL is not a digest' }],
    ['bad source id', (c: any) => { c.sources[0].source_id = 'source bad' }],
    ['duplicate source id', (c: any) => { c.sources.push({ ...c.sources[0], title: 'Other' }) }],
    ['duplicate claim id', (c: any) => { c.claims.push({ ...c.claims[0], statement: 'Other' }) }],
    ['unsupported claim', (c: any) => { c.claims[0].source_ids = ['unknown'] }],
    ['empty support', (c: any) => { c.claims[0].source_ids = [] }],
    ['duplicate support', (c: any) => { c.claims[0].source_ids.push('source_1') }],
    ['blank claim', (c: any) => { c.claims[0].statement = '' }],
    ['whitespace claim', (c: any) => { c.claims[0].statement = ' ' }],
    ['future capture', (c: any) => { c.sources[0].captured_at = '2026-01-02T00:00:00Z' }],
    ['invalid date', (c: any) => { c.as_of = '2026-02-30T00:00:00Z' }],
    ['date only', (c: any) => { c.as_of = '2026-01-01' }],
    ['invalid capture', (c: any) => { c.sources[0].captured_at = 'yesterday' }],
    ['impossible capture date', (c: any) => { c.sources[0].captured_at = '2025-02-30T00:00:00Z' }],
    ['empty territories', (c: any) => { c.territories = [] }],
  ])('rejects %s before generation or writes', async (_, mutate) => {
    const content = snapshot(); (mutate as (c: any) => void)(content)
    const s = await setup(content)
    const before = structuredClone(s.store._state)
    await expect(s.run()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(s.calls).toHaveLength(0)
    expect(s.store._state).toEqual(before)
  })
  it('accepts the published observed snapshot shape without legacy evidence fields', async () => {
    const s = await setup()
    const { result, run } = await s.run()
    expect(result).toEqual({ creative_run_id: run.run_id })
    expect(run.status).toBe('succeeded')
    expect(s.calls).toHaveLength(1)
    expect(s.calls[0].artifacts).toContainEqual(s.selected)
    expect(s.researchCalls).toEqual([{
      workspace_id: s.project.workspace_id, project_id: s.project.project_id, snapshot_ref: ref(s.selected),
    }])
  })
})
