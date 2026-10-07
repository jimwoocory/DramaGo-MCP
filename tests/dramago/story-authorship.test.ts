import { describe, it, expect } from 'vitest'
import { canonicalHash } from '../../packages/dramago-application/index.js'
import { independentReviewer } from '../../packages/story-development/src/review.js'
import { trustedWriter } from '../../packages/story-development/src/authorship.js'
import { resolveDependencies } from '../../packages/story-development/src/dependencies.js'
import { setup, ref } from './helpers/story-runtime.js'

async function fixture() {
  const s = await setup()
  const idea = s.seed('idea')
  const verify = (inputs: any[], port?: any, identity = 'reviewer_a') =>
    independentReviewer(s.store, s.project, identity, inputs, port, true)
  return { ...s, idea, verify }
}

async function generated(edits: any = {}) {
  const s = await fixture()
  const { run, outputs } = await s.execute('direction', await s.command('direction', edits))
  expect(run.status).toBe('succeeded')
  expect(outputs).toHaveLength(1)
  const output = outputs[0]
  expect(output.content).not.toHaveProperty('generated_by')
  expect(output.content).not.toHaveProperty('creative_run_id')
  return { ...s, output, run }
}

// Repair every dependent seal and the context-addressed run key. A semantic
// forgery must not be rejected merely because an old hash/run lookup went stale.
function resealProof(s: any, context?: any) {
  const run = s.store._state.runs.get(s.run.run_id)
  if (context) {
    context.content_digest = canonicalHash(context.content)
    run.input_manifest.input_refs = run.input_manifest.input_refs.map((r: any) =>
      r.version_id === context.version_id ? ref(context) : r)
    s.output.content.run_context_ref = ref(context)
    s.store._state.runs.delete(run.run_id)
    run.run_id = `run_story_${canonicalHash(ref(context)).slice(7)}`
    s.store._state.runs.set(run.run_id, run)
  }
  run.input_manifest_digest = canonicalHash(run.input_manifest)
  run.steps[0].attempts[0].input_manifest_digest = run.input_manifest_digest
  s.output.content.dependency_refs = structuredClone(run.input_manifest.input_refs)
  s.output.content_digest = canonicalHash(s.output.content)
  s.store._state.versions.set(s.output.version_id, structuredClone(s.output))
  run.steps[0].attempts[0].output_refs = [ref(s.output)]
  expect(run.input_manifest_digest).toBe(canonicalHash(run.input_manifest))
  expect(s.output.content_digest).toBe(canonicalHash(s.output.content))
  expect(run.run_id).toBe(`run_story_${canonicalHash(s.output.content.run_context_ref).slice(7)}`)
}

const attestIdea = (s: any) => ({ attest: async ({ artifact }: any) => artifact.version_id === s.idea.version_id
  ? { artifact_ref: ref(s.idea), author_identities: ['import-author'] } : null })

describe('trusted Story authorship', () => {
  it('trusts persisted succeeded generation and its bound executor, not an author label', async () => {
    const s = await generated()
    await expect(trustedWriter(s.store, s.project, s.output)).resolves.toBe('writer_a')
    await expect(s.verify([s.output])).resolves.toBeUndefined()
    await expect(s.verify([s.output], undefined, 'writer_a')).rejects.toMatchObject({ code: 'ROLE_SEPARATION' })
  })
  it.each(['missing-run', 'failed-run', 'foreign-project', 'foreign-workspace', 'wrong-domain', 'wrong-output',
    'manifest', 'manifest-missing-ref', 'manifest-extra-ref', 'manifest-reordered', 'manifest-duplicate-ref',
    'stage', 'attempt-status', 'attempt-digest', 'attempt-number', 'writer', 'context-project',
    'context-workspace', 'context-stage', 'context-revision', 'run-id', 'run-schema', 'missing-attempts'])
  ('rejects invalid service authorship proof: %s', async attack => {
    const s = await generated()
    const run = s.store._state.runs.get(s.run.run_id)
    if (attack === 'missing-run') s.store._state.runs.delete(s.run.run_id)
    if (attack === 'failed-run') run.status = 'failed'
    if (attack === 'foreign-project') run.project_id = 'other'
    if (attack === 'foreign-workspace') run.workspace_id = 'other'
    if (attack === 'wrong-domain') run.domain = 'media'
    if (attack === 'wrong-output') run.steps[0].attempts[0].output_refs = [ref(s.idea)]
    if (attack === 'run-id') run.run_id = 'run_other'
    if (attack === 'run-schema') run.schema_version = 'dramago.creative-run/v0'
    if (attack === 'missing-attempts') delete run.steps[0].attempts
    if (attack.startsWith('manifest')) {
      if (attack === 'manifest') run.input_manifest.policy_version = 'forged'
      if (attack === 'manifest-missing-ref') run.input_manifest.input_refs = run.input_manifest.input_refs.filter((r: any) => r.version_id !== s.idea.version_id)
      if (attack === 'manifest-extra-ref') run.input_manifest.input_refs.push(ref(s.seed('reviewer_config')))
      if (attack === 'manifest-reordered') run.input_manifest.input_refs.reverse()
      if (attack === 'manifest-duplicate-ref') run.input_manifest.input_refs.push(ref(s.idea))
      resealProof(s)
    }
    if (attack === 'stage') run.steps[0].stage = 'story.bible'
    if (attack === 'attempt-status') run.steps[0].attempts[0].status = 'failed'
    if (attack === 'attempt-digest') run.steps[0].attempts[0].input_manifest_digest = canonicalHash('wrong')
    if (attack === 'attempt-number') run.steps[0].attempts[0].attempt = 0
    if (['writer', 'context-project', 'context-workspace', 'context-stage', 'context-revision'].includes(attack)) {
      const context = s.store._state.versions.get(s.output.content.run_context_ref.version_id)
      // Identity lives only in the context. A resealed reviewer-authored context
      // must still trigger role separation, not compare a removed writer label.
      if (attack === 'writer') context.content.executor.executor_id = 'reviewer_a'
      if (attack === 'context-project') context.project_id = 'other'
      if (attack === 'context-workspace') context.workspace_id = 'other'
      if (attack === 'context-stage') context.content.operation = 'bible'
      if (attack === 'context-revision') context.content.project_revision = -1
      resealProof(s, context)
    }
    await expect(s.verify([s.output])).rejects.toMatchObject({ code: 'ROLE_SEPARATION' })
  })
  it('does not transfer a real run proof to a schema-valid resealed imported copy', async () => {
    const s = await generated()
    const copy = await s.put({ ...s.output.content, logline: 'Reviewer wrote this imported replacement' })
    expect(copy.content_digest).toBe(canonicalHash(copy.content))
    expect(s.run.steps[0].attempts[0].output_refs).not.toContainEqual(ref(copy))
    await expect(s.verify([copy])).rejects.toMatchObject({ code: 'ROLE_SEPARATION' })
  })
  it('accepts only exact host attestation and supplies a deeply frozen request', async () => {
    const s = await fixture()
    let calls = 0
    await expect(s.verify([s.idea], { attest: async (request: any, signal: AbortSignal) => {
      calls++
      expect(request).toEqual({ artifact: s.idea, project: s.project, reviewer_identity: 'reviewer_a' })
      expect(Object.isFrozen(request)).toBe(true)
      expect(Object.isFrozen(request.artifact)).toBe(true)
      expect(Object.isFrozen(request.artifact.content.constraints)).toBe(true)
      expect(Object.isFrozen(request.project.planning_range)).toBe(true)
      expect(signal).toBeInstanceOf(AbortSignal)
      return { artifact_ref: ref(s.idea), author_identities: ['import-author'] }
    } })).resolves.toBeUndefined()
    expect(calls).toBe(1)
  })
  it.each(['null', 'wrong-ref', 'wrong-artifact', 'wrong-digest', 'empty', 'blank', 'reviewer', 'coauthor'])('refuses invalid host attestation: %s', async attack => {
    const s = await fixture()
    const value: any = { artifact_ref: ref(s.idea), author_identities: ['author'] }
    if (attack === 'wrong-ref') value.artifact_ref.version_id = 'wrong'
    if (attack === 'wrong-artifact') value.artifact_ref.artifact_id = 'wrong'
    if (attack === 'wrong-digest') value.artifact_ref.content_digest = canonicalHash('wrong')
    if (attack === 'empty') value.author_identities = []
    if (attack === 'blank') value.author_identities = [' ']
    if (attack === 'reviewer') value.author_identities = ['reviewer_a']
    if (attack === 'coauthor') value.author_identities.push('reviewer_a')
    await expect(s.verify([s.idea], { attest: async () => attack === 'null' ? null : value })).rejects.toMatchObject({ code: 'ROLE_SEPARATION' })
  })
  it('excludes validated range, contexts and bound configuration, but not imported ideas', async () => {
    const s = await generated()
    const inputs = await Promise.all(s.run.input_manifest.input_refs.map((r: any) => s.store.getArtifactVersion(r.version_id)))
    await expect(s.verify(inputs.filter((v: any) => v.version_id !== s.idea.version_id))).resolves.toBeUndefined()
    await expect(s.verify([s.output, ...inputs])).rejects.toMatchObject({ code: 'ROLE_SEPARATION' })
    await expect(s.verify([s.output, ...inputs], attestIdea(s))).resolves.toBeUndefined()
  })
  it('requires attestation for every transitive imported source, not just bound ideas', async () => {
    const s = await fixture()
    const ancestor = await s.put({ text: 'An imported source behind another source' })
    const source = await s.put({ text: 'Imported source', source_ref: ref(ancestor) })
    const { run, outputs } = await s.execute('direction', await s.command('direction', { source_refs: [ref(source)] }))
    expect(run.status).toBe('succeeded')
    const inputs = await resolveDependencies(s.store, s.project, outputs.map(ref))
    expect(inputs.map((v: any) => v.version_id)).toContain(ancestor.version_id)
    const attest = (allowed: any[]) => ({ attest: async ({ artifact }: any) => allowed.some(v => v.version_id === artifact.version_id)
      ? { artifact_ref: ref(artifact), author_identities: ['import-author'] } : null })
    await expect(s.verify(inputs, attest([s.idea, source]))).rejects.toMatchObject({ code: 'ROLE_SEPARATION' })
    await expect(s.verify(inputs, attest([s.idea, source, ancestor]))).resolves.toBeUndefined()
  })
  it.each(['unlabelled', 'forged-label'])('fails closed for %s imported creative content', async mode => {
    const s = await fixture()
    const idea = mode === 'unlabelled' ? s.idea : await s.put({ generated_by: 'someone-else', data: 'Imported idea' })
    await expect(s.verify([idea])).rejects.toMatchObject({ code: 'ROLE_SEPARATION' })
  })
})
