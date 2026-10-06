import { describe, it, expect } from 'vitest'
import { contextOf, seal, setup } from './helpers/story-runtime.js'
import { contentAttacks } from './helpers/story-content-attacks.mjs'
import { validateContent } from '../../packages/story-development/src/policy.js'
import { checkBundle } from './helpers/p2-story-conformance.mjs'
import { assertShape } from '../../packages/story-development/src/contracts.js'

describe('published contract → actual Story runtime → persisted conformance', () => {
  it.each(contentAttacks)('rejects resealed actual port output: $name', async attack => {
    const s = await setup({ generate: async (r: any, generate: any) => {
      const bundle = await generate(r)
      if (contextOf(r).operation === attack.step) {
        const output = bundle.proposals[0]
        validateContent(output, contextOf(r), r.artifacts)
        attack.mutate(output.content, r.artifacts)
        // Prove the semantic/schema gate, not a stale content digest, is rejecting.
        bundle.proposals[0] = seal(output)
        expect(() => validateContent(bundle.proposals[0], contextOf(r), r.artifacts)).toThrow(attack.message)
      }
      return bundle
    } })
    const steps = ['direction', 'adaptation', 'bible', 'master_outline', 'season_architecture', 'episode_outlines']
    for (const step of steps.slice(0, steps.indexOf(attack.step))) expect((await s.execute(step)).run.status).toBe('succeeded')
    const command = await s.command(attack.step), before = s.store._state.versions.size
    const e = await s.execute(attack.step, command)
    expect(e.run.status).toBe('failed')
    expect(e.outputs).toEqual([])
    expect(s.store._state.versions.size).toBe(before)
    expect([...s.store._state.audit.values()].at(-1)).toMatchObject({ error_code: 'INVALID_GENERATION_OUTPUT' })
  })
  it('executes every step and independent review, validating actual persisted facts', async () => {
    const s = await setup()
    const executions = await s.fullStory()
    executions.push(await s.execute('planning_review'))
    for (const e of executions) {
      assertShape('step' in e.request ? 'step_request' : 'review_request', e.request)
      assertShape('run_result', e.result)
      expect(e.run.status).toBe('succeeded')
      for (const output of e.outputs) assertShape('artifact-version.schema.json', output)
    }
    // Repository run revision is storage CAS metadata, not part of the wire fact.
    const runs = [...s.store._state.runs.values()].map(({ revision, ...run }: any) => run)
    checkBundle({ project: await s.store.getProject(s.project.project_id), artifacts: [...s.store._state.versions.values()], runs })
    for (const input of [...s.calls, ...s.reviewCalls]) assertShape('frozen_input', input)
    expect(s.store._state.approvals.size).toBe(0)
  })
})
