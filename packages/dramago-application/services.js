import { randomUUID } from 'node:crypto'
import { DomainError, canonicalHash, snapshot, equal } from './domain.js'

const required = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new DomainError('VALIDATION_ERROR', `${name} is required`)
  return value
}
const nonnegative = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new DomainError('VALIDATION_ERROR', `${name} must be a nonnegative integer`)
  return value
}
const refKey = ref => `${ref?.artifact_id ?? ''}|${ref?.version_id ?? ''}|${ref?.content_digest ?? ''}`
const sameRef = (a, b) => refKey(a) === refKey(b)
const approvalTarget = baseline => ({
  artifact_id: baseline.artifact_id,
  version_id: baseline.version_id,
  content_digest: baseline.content_digest,
})

const stages = {
  story: new Set(['story.direction','story.adaptation','story.bible','story.master_outline','story.season_architecture','story.episode_outlines','story.planning_review']),
  script: new Set(['usvds.03','usvds.04']),
  production: new Set(['usvds.05','usvds.06','usvds.07','usvds.08','usvds.09']),
}

function assertRun(run) {
  if (!stages[run?.domain]) throw new DomainError('VALIDATION_ERROR', 'invalid run domain')
  if (!Array.isArray(run.steps) || run.steps.length === 0 || run.steps.some(step => !stages[run.domain].has(step.stage))) {
    throw new DomainError('INVALID_STATE_TRANSITION', 'run stage does not belong to domain')
  }
}
async function validateRunFacts(store, run) {
  const project = await store.getProject(run.project_id)
  if (!project || project.workspace_id !== run.workspace_id) throw new DomainError('VALIDATION_ERROR', 'run ownership mismatch')
  const refs = run.input_manifest?.input_refs
  if (!Array.isArray(refs) || !refs.length || new Set(refs.map(refKey)).size !== refs.length ||
      run.input_manifest_digest !== canonicalHash(run.input_manifest)) throw new DomainError('VALIDATION_ERROR', 'invalid frozen input manifest')
  for (const ref of refs) await exactFact(store, ref, project)
  const steps = new Set()
  for (const step of run.steps) {
    required(step.step_id, 'step_id')
    if (steps.has(step.step_id) || !Array.isArray(step.attempts) || !step.attempts.length) throw new DomainError('VALIDATION_ERROR', 'unique steps and ordered attempts required')
    steps.add(step.step_id)
    let previous = 0
    for (const attempt of step.attempts) {
      if (!Number.isSafeInteger(attempt.attempt) || attempt.attempt <= previous || attempt.input_manifest_digest !== run.input_manifest_digest) {
        throw new DomainError('VALIDATION_ERROR', 'attempt must use frozen input digest and increasing unique identity')
      }
      previous = attempt.attempt
    }
  }
}
async function exactFact(store, ref, project) {
  required(ref?.artifact_id, 'artifact_id'); required(ref?.version_id, 'version_id')
  const artifact = await store.getArtifactVersion(ref.version_id)
  const baseline = typeof store.getBaselineByVersion === 'function' ? await store.getBaselineByVersion(ref.version_id, project.project_id) : null
  if (artifact && baseline) throw new DomainError('VALIDATION_ERROR', 'ambiguous immutable version')
  const fact = artifact ?? baseline
  const owner = artifact ?? baseline?.manifest
  if (!fact || !sameRef(fact, ref) || owner?.project_id !== project.project_id || owner?.workspace_id !== project.workspace_id) {
    throw new DomainError('VALIDATION_ERROR', 'unresolved immutable fact or ownership mismatch')
  }
  assertDigest(fact, ...(artifact ? ['dramago.artifact-version/v1'] : ['dramago.planning-baseline/v1', 'dramago.script-baseline/v1']))
  return fact
}
function assertAuthContext(auth) {
  for (const k of ['tenantId','subjectId','clientId']) required(auth?.[k], k)
  if (!Array.isArray(auth?.scopes)) throw new DomainError('FORBIDDEN', 'scopes required')
}
async function replay(store, scope, key, payload) {
  required(key, 'idempotency_key')
  const hash = canonicalHash(payload)
  const found = await store.findIdempotency(scope, key)
  if (!found) return { hash }
  if (found.payloadHash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', 'idempotency key reused with different payload')
  return { hash, result: snapshot(found.result) }
}
async function persistReplay(store, scope, key, hash, result) {
  await store.putIdempotency({ scope, key, payloadHash: hash, result: snapshot(result) })
}
function assertDigest(record, ...expectedSchemas) {
  if (!expectedSchemas.includes(record?.schema_version)) throw new DomainError('VALIDATION_ERROR', 'unexpected immutable fact schema')
  let content
  if (record.schema_version === 'dramago.artifact-version/v1') {
    if (Object.hasOwn(record, 'manifest')) throw new DomainError('VALIDATION_ERROR', 'artifact cannot contain a manifest')
    content = record.content
  }
  else if (['dramago.planning-baseline/v1', 'dramago.script-baseline/v1'].includes(record.schema_version)) content = record.manifest
  else if (record.schema_version === 'dramago.approval-decision/v1') {
    const { artifact_id, version_id, content_digest, ...body } = record
    content = body
  } else throw new DomainError('VALIDATION_ERROR', 'unknown immutable fact schema')
  if (record.content_digest !== canonicalHash(content)) throw new DomainError('VALIDATION_ERROR', 'content digest does not match canonical content')
}
async function exactVersion(store, ref, projectId) {
  if (!ref?.version_id) throw new DomainError('VALIDATION_ERROR', 'version ref required')
  const v = await store.getArtifactVersion(ref.version_id)
  if (!v || v.project_id !== projectId || !sameRef(v, ref)) throw new DomainError('VALIDATION_ERROR', 'version reference mismatch')
  assertDigest(v, 'dramago.artifact-version/v1')
  return v
}
function assertDecisionOwner(decision, project) {
  if (decision?.project_id !== project.project_id || decision?.workspace_id !== project.workspace_id) {
    throw new DomainError('APPROVAL_INVALID', 'approval ownership mismatch')
  }
}
function assertActor(auth, decision) {
  if (!['human', 'service_authorized'].includes(decision?.actor?.actor_type) || decision.actor.actor_id !== auth.subjectId) {
    throw new DomainError('APPROVAL_INVALID', 'approval actor must be the authenticated authority')
  }
}
async function assertAuthority(store, decision, project) {
  assertDecisionOwner(decision, project)
  const authorization = await exactVersion(store, decision.actor.authorization_ref, project.project_id)
  if (authorization.workspace_id !== project.workspace_id || authorization.kind !== 'authorization_evidence' ||
      authorization.content?.actor_id !== decision.actor.actor_id || authorization.content?.policy_version !== decision.policy_version) {
    throw new DomainError('APPROVAL_INVALID', 'authorization evidence must bind actor, project and policy')
  }
}
function approvalMatches(approval, baseline, requiredEvidence = []) {
  if (approval?.schema_version !== 'dramago.approval-decision/v1' || approval.decision !== 'approved') {
    throw new DomainError('APPROVAL_INVALID', 'approved decision required')
  }
  if (!Array.isArray(approval.target_refs) || approval.target_refs.length !== 1 || !sameRef(approval.target_refs[0], approvalTarget(baseline))) {
    throw new DomainError('APPROVAL_INVALID', 'approval must bind exact baseline')
  }
  if (!approval.actor || approval.actor.actor_type === 'model' || !approval.actor.authorization_ref) {
    throw new DomainError('APPROVAL_INVALID', 'authorized non-model actor required')
  }
  const evidence = new Set((approval.evidence_refs ?? []).map(refKey))
  for (const ref of requiredEvidence) if (!evidence.has(refKey(ref))) throw new DomainError('APPROVAL_INVALID', 'required evidence missing')
}
async function requireEffectiveApproval(store, baseline, project) {
  const decisions = await store.listApprovals(approvalTarget(baseline))
  for (const decision of decisions) assertDecisionOwner(decision, project)
  const revoked = new Set(decisions.filter(d => d.decision === 'revoked').map(d => refKey(d.revoked_decision_ref)))
  const approved = decisions.filter(d => d.decision === 'approved' && !revoked.has(refKey(d)))
  if (!approved.length) throw new DomainError('APPROVAL_INVALID', 'effectively approved Planning Baseline required')
  for (const decision of approved) {
    assertDigest(decision, 'dramago.approval-decision/v1')
    approvalMatches(decision, baseline, baseline.manifest.review_evidence.map(e => e.evidence_ref))
    await assertAuthority(store, decision, project)
  }
}
const sameRefs = (actual, expected) => Array.isArray(actual) && actual.length === expected.length &&
  equal(actual.map(refKey).sort(), expected.map(refKey).sort())
async function resolveReview(store, evidence, subjects, outcome, kind, project) {
  const report = await exactVersion(store, evidence?.evidence_ref, project.project_id)
  const content = report.content
  if (report.workspace_id !== project.workspace_id || report.kind !== 'review_report' ||
      content?.review_kind !== kind || content.outcome !== outcome || evidence.outcome !== outcome ||
      !sameRefs(evidence.subject_refs, subjects) || !sameRefs(content.subject_refs, subjects)) {
    throw new DomainError('APPROVAL_INVALID', 'review must resolve to matching immutable report and exact subjects')
  }
  return content
}
function orderedPlanningEpisodes(project, baseline) {
  const declared = project?.planning_range?.ordered_episode_ids
  const actual = baseline?.manifest?.ordered_episodes
  if (!Array.isArray(declared) || declared.length === 0 || !Array.isArray(actual)) throw new DomainError('BASELINE_INCOMPLETE', 'planning range incomplete')
  const ids = actual.map(e => e.episode_id)
  if (new Set(ids).size !== ids.length || ids.length !== declared.length || ids.some((id, i) => id !== declared[i])) {
    throw new DomainError('BASELINE_INCOMPLETE', 'episode coverage must exactly match declared ordered scope')
  }
  return actual
}

export class ProjectService {
  constructor(store, { now = () => new Date(), id = randomUUID } = {}) { this.store = store; this.now = now; this.id = id }
  async createProject(auth, input) {
    assertAuthContext(auth)
    const workspaceId = required(input.workspace_id ?? auth.defaultWorkspaceId, 'workspace_id')
    await this.store.authorize(auth, 'workspace.project_create', { workspace_id: workspaceId })
    const scope = { workspace_id: workspaceId, command: 'project.create' }
    const payload = { workspace_id: workspaceId, project_id: input.project_id ?? null, name: input.name, planning_range: input.planning_range }
    return this.store.transaction(async store => {
      const replayed = await replay(store, scope, input.idempotency_key, payload)
      if (replayed.result) return replayed.result
      const project = {
        schema_version: 'dramago.drama-project/v1',
        workspace_id: workspaceId,
        project_id: input.project_id ?? `project_${this.id()}`,
        name: required(input.name, 'name'),
        revision: 0,
        planning_range: snapshot(input.planning_range),
        created_at: this.now().toISOString(),
      }
      await store.createProject(project)
      await persistReplay(store, scope, input.idempotency_key, replayed.hash, project)
      await store.appendAudit({ event_id: `audit_${this.id()}`, project_id: project.project_id, workspace_id: workspaceId, action: 'project.created' })
      return snapshot(project)
    })
  }
  async getProject(auth, input) {
    assertAuthContext(auth); required(input.project_id, 'project_id')
    await this.store.authorize(auth, 'project.read', { project_id: input.project_id, workspace_id: input.workspace_id ?? auth.defaultWorkspaceId })
    const project = await this.store.getProject(input.project_id)
    if (!project) throw new DomainError('NOT_FOUND', 'project not found')
    return project
  }
}

export class ArtifactService {
  constructor(store, { now = () => new Date(), id = randomUUID } = {}) { this.store=store; this.now=now; this.id=id }
  async createArtifactRevision(auth, input) {
    assertAuthContext(auth); required(input.project_id, 'project_id'); nonnegative(input.expected_revision, 'expected_revision')
    await this.store.authorize(auth, 'project.artifact_write', { project_id: input.project_id, workspace_id: input.workspace_id ?? auth.defaultWorkspaceId })
    const scope = { project_id: input.project_id, command: 'artifact.revision.create' }
    const payload = { ...input }; delete payload.idempotency_key
    return this.store.transaction(async store => {
      const replayed = await replay(store, scope, input.idempotency_key, payload)
      if (replayed.result) return replayed.result
      const project = await store.getProject(input.project_id)
      if (!project) throw new DomainError('NOT_FOUND', 'project not found')
      const version = snapshot(input.artifact_version ?? {
        schema_version:'dramago.artifact-version/v1',
        artifact_id: required(input.artifact_id,'artifact_id'),
        version_id: input.version_id ?? `av_${this.id()}`,
        content_digest: input.content_digest ?? canonicalHash(input.content),
        workspace_id: project.workspace_id,
        project_id: project.project_id,
        kind: required(input.kind,'kind'),
        content: snapshot(input.content),
        created_at: this.now().toISOString(),
        ...(input.episode_id ? { episode_id: input.episode_id } : {}),
      })
      if (version.project_id !== project.project_id || version.workspace_id !== project.workspace_id) throw new DomainError('VALIDATION_ERROR','artifact ownership mismatch')
      assertDigest(version, 'dramago.artifact-version/v1')
      await store.putArtifactVersion(version)
      const head = await store.compareAndSetProject(project.project_id, input.expected_revision, {})
      const result = { artifact_version: version, project_revision: head.revision }
      await persistReplay(store, scope, input.idempotency_key, replayed.hash, result)
      return result
    })
  }
  async getArtifact(auth, input) {
    assertAuthContext(auth); required(input.version_id,'version_id')
    const version = await this.store.getArtifactVersion(input.version_id)
    if (!version) throw new DomainError('NOT_FOUND','artifact version not found')
    await this.store.authorize(auth,'project.read',{ project_id:version.project_id, workspace_id:version.workspace_id })
    return version
  }
}

export class ApprovalService {
  constructor(store) { this.store=store }
  async approvePlanningBaseline(auth, input) {
    return this.#approve(auth, input, 'planning')
  }
  async approveScriptBaseline(auth, input) {
    return this.#approve(auth, input, 'script')
  }
  async #approve(auth, input, kind) {
    assertAuthContext(auth); required(input.project_id,'project_id'); nonnegative(input.expected_revision,'expected_revision')
    assertActor(auth, input.approval)
    const action = kind === 'planning' ? 'story.approve' : 'script.approve'
    const scope = { project_id: input.project_id, command: `${kind}.baseline.approve` }
    const payload = { baseline: input.baseline, approval: input.approval, expected_revision: input.expected_revision }
    return this.store.transaction(async store => {
      const project = await store.getProject(input.project_id)
      if (!project) throw new DomainError('NOT_FOUND','project not found')
      await store.authorize(auth, action, { project_id: project.project_id, workspace_id: project.workspace_id })
      const replayed = await replay(store, scope, input.idempotency_key, payload)
      if (replayed.result) return replayed.result
      const baseline = snapshot(input.baseline)
      if (baseline?.manifest?.project_id !== project.project_id || baseline?.manifest?.workspace_id !== project.workspace_id) throw new DomainError('VALIDATION_ERROR','baseline ownership mismatch')
      let evidence = []
      if (kind === 'planning') {
        if (baseline.schema_version !== 'dramago.planning-baseline/v1') throw new DomainError('VALIDATION_ERROR','planning baseline required')
        const episodes = orderedPlanningEpisodes(project, baseline)
        if (!Array.isArray(baseline.manifest.review_evidence) || !baseline.manifest.review_evidence.length) throw new DomainError('BASELINE_INCOMPLETE', 'planning review required')
        const coreRefs = [
          baseline.manifest.range_definition_ref,
          baseline.manifest.story_foundation,
          baseline.manifest.story_bible,
          baseline.manifest.master_outline,
          baseline.manifest.season_architecture,
          ...episodes.map(e => e.outline_ref),
          ...baseline.manifest.review_evidence.map(e => e.evidence_ref),
        ]
        for (const ref of coreRefs) await exactVersion(store, ref, project.project_id)
        if (!Array.isArray(baseline.manifest.review_evidence) || baseline.manifest.review_evidence.length === 0 ||
            baseline.manifest.review_evidence.some(e => e.outcome !== 'PASS' || (Array.isArray(e.blockers) && e.blockers.length))) {
          throw new DomainError('BASELINE_INCOMPLETE','passing planning review without blockers required')
        }
        const subjects = coreRefs.slice(0, 5 + episodes.length)
        for (const item of baseline.manifest.review_evidence) {
          const report = await resolveReview(store, item, subjects, 'PASS', 'planning', project)
          if (!Array.isArray(report.blockers) || report.blockers.length) throw new DomainError('APPROVAL_INVALID', 'planning review has blockers')
        }
        evidence = baseline.manifest.review_evidence.map(e => e.evidence_ref)
      } else {
        if (baseline.schema_version !== 'dramago.script-baseline/v1') throw new DomainError('VALIDATION_ERROR','script baseline required')
        const planning = await store.getBaseline(baseline.manifest.planning_baseline_id)
        if (!planning || planning.schema_version !== 'dramago.planning-baseline/v1' ||
            planning.manifest.project_id !== project.project_id || planning.manifest.workspace_id !== project.workspace_id ||
            !sameRef(planning, baseline.manifest.planning_baseline_ref)) throw new DomainError('APPROVAL_INVALID','planning baseline mismatch')
        assertDigest(planning, 'dramago.planning-baseline/v1')
        await requireEffectiveApproval(store, planning, project)
        const planned = planning.manifest.ordered_episodes.find(e => e.episode_id === baseline.manifest.episode_id)
        if (!planned || !sameRef(planned.outline_ref, baseline.manifest.episode_outline)) throw new DomainError('APPROVAL_INVALID','episode outline not in planning baseline')
        for (const ref of [
          baseline.manifest.episode_outline,
          baseline.manifest.screenplay,
          baseline.manifest.beat_to_scene_trace,
          baseline.manifest.continuity_input,
          baseline.manifest.continuity_output,
          baseline.manifest.doctor_evidence?.evidence_ref,
          baseline.manifest.continuity_evidence?.evidence_ref,
        ]) await exactVersion(store, ref, project.project_id)
        if (baseline.manifest.doctor_evidence?.outcome !== 'PASS' || baseline.manifest.continuity_evidence?.outcome !== 'CLEAR') {
          throw new DomainError('APPROVAL_INVALID','Doctor PASS and Continuity CLEAR required')
        }
        const screen = baseline.manifest.screenplay
        for (const item of [baseline.manifest.doctor_evidence, baseline.manifest.continuity_evidence]) {
          if (!Array.isArray(item.subject_refs) || !item.subject_refs.some(ref => sameRef(ref, screen))) throw new DomainError('APPROVAL_INVALID','review evidence must bind exact screenplay version')
        }
        const doctor = await resolveReview(store, baseline.manifest.doctor_evidence, [screen], 'PASS', 'script_doctor', project)
        if (doctor.mandatory_fail !== false) throw new DomainError('APPROVAL_INVALID', 'Script Doctor mandatory fail')
        const continuity = await resolveReview(store, baseline.manifest.continuity_evidence, [screen], 'CLEAR', 'script_continuity', project)
        if (!sameRef(continuity.input_ref, baseline.manifest.continuity_input) || !sameRef(continuity.output_ref, baseline.manifest.continuity_output)) throw new DomainError('APPROVAL_INVALID', 'continuity ledger binding mismatch')
        evidence = [baseline.manifest.doctor_evidence.evidence_ref, baseline.manifest.continuity_evidence.evidence_ref]
      }
      approvalMatches(input.approval, baseline, evidence)
      await assertAuthority(store, input.approval, project)
      for (const ref of evidence) await exactVersion(store, ref, project.project_id)
      assertDigest(baseline, `dramago.${kind}-baseline/v1`)
      assertDigest(input.approval, 'dramago.approval-decision/v1')
      await store.putBaseline(baseline)
      await store.appendApproval(snapshot(input.approval))
      const head = await store.compareAndSetProject(project.project_id, input.expected_revision, {})
      const result = { baseline, approval: snapshot(input.approval), project_revision: head.revision }
      await persistReplay(store, scope, input.idempotency_key, replayed.hash, result)
      await store.appendOutbox({ event_id:`outbox_${randomUUID()}`, project_id:project.project_id, type:`${kind}.baseline.approved`, baseline_id: baseline.planning_baseline_id ?? baseline.script_baseline_id })
      return result
    })
  }
  async revokeApproval(auth, input) {
    assertAuthContext(auth); required(input.project_id,'project_id'); nonnegative(input.expected_revision,'expected_revision')
    assertActor(auth, input.approval)
    const scope={ project_id:input.project_id, command:'approval.revoke' }
    const payload={ approval:input.approval, expected_revision:input.expected_revision }
    return this.store.transaction(async store => {
      const project=await store.getProject(input.project_id); if(!project) throw new DomainError('NOT_FOUND','project not found')
      await store.authorize(auth,'project.approval_revoke',{ project_id:project.project_id, workspace_id:project.workspace_id })
      const replayed=await replay(store,scope,input.idempotency_key,payload)
      if (replayed.result) return replayed.result
      if (input.approval?.decision !== 'revoked' || !input.approval.revoked_decision_ref) throw new DomainError('APPROVAL_INVALID','revocation decision required')
      assertDecisionOwner(input.approval, project)
      const targets = input.approval.target_refs
      if (!Array.isArray(targets) || targets.length !== 1) throw new DomainError('APPROVAL_INVALID','exact revocation target required')
      const decisions = await store.listApprovals(targets[0])
      const previous = decisions.find(a => sameRef(a, input.approval.revoked_decision_ref))
      if (!previous || previous.decision !== 'approved' || !equal(previous.target_refs, targets)) throw new DomainError('APPROVAL_INVALID','revoked decision must resolve to the same exact target')
      assertDecisionOwner(previous, project)
      assertDigest(previous, 'dramago.approval-decision/v1')
      await assertAuthority(store, input.approval, project)
      assertDigest(input.approval, 'dramago.approval-decision/v1')
      await store.appendApproval(snapshot(input.approval))
      const head=await store.compareAndSetProject(project.project_id,input.expected_revision,{})
      const result={ approval:snapshot(input.approval), project_revision:head.revision }
      await persistReplay(store,scope,input.idempotency_key,replayed.hash,result)
      return result
    })
  }
  async getApproval(auth,input) {
    assertAuthContext(auth)
    const project = await this.store.getProject(required(input.project_id, 'project_id'))
    if (!project) throw new DomainError('NOT_FOUND', 'project not found')
    await this.store.authorize(auth,'project.read',{ project_id:project.project_id, workspace_id:project.workspace_id })
    const approvals=await this.store.listApprovals(input.target_ref)
    for (const decision of approvals) assertDecisionOwner(decision, project)
    if (!approvals.length) throw new DomainError('NOT_FOUND','approval not found')
    return { approvals }
  }
  async getBaseline(auth,input) {
    assertAuthContext(auth)
    const baseline=await this.store.getBaseline(required(input.baseline_id,'baseline_id'))
    if(!baseline) throw new DomainError('NOT_FOUND','baseline not found')
    await this.store.authorize(auth,'project.read',{ project_id:baseline.manifest.project_id, workspace_id:baseline.manifest.workspace_id })
    return baseline
  }
}

export class RunService {
  constructor(store) { this.store=store }
  async createRun(auth, input) {
    assertAuthContext(auth); assertRun(input.run)
    const action = { story:'story.execute', script:'script.write', production:'production.step_execute' }[input.run.domain]
    await this.store.authorize(auth, action, { project_id:input.run.project_id, workspace_id:input.run.workspace_id })
    const run = snapshot(input.run)
    return this.store.transaction(async store => {
      await validateRunFacts(store, run)
      return store.putRun(run)
    })
  }
  async updateRun(auth,input) {
    assertAuthContext(auth); nonnegative(input.expected_revision,'expected_revision')
    const run=await this.store.getRun(required(input.run_id,'run_id')); if(!run) throw new DomainError('NOT_FOUND','run not found')
    const action = { story:'story.execute', script:'script.write', production:'production.step_execute' }[run.domain]
    await this.store.authorize(auth,action,{ project_id:run.project_id, workspace_id:run.workspace_id })
    const patch = snapshot(input.patch)
    for (const key of ['run_id', 'domain', 'schema_version', 'workspace_id', 'project_id', 'created_at', 'revision', 'input_manifest', 'input_manifest_digest']) {
      if (Object.hasOwn(patch, key)) throw new DomainError('VALIDATION_ERROR', `cannot patch ${key}`)
    }
    const next={ ...run, ...patch, revision:input.expected_revision+1 }
    assertRun(next)
    return this.store.transaction(async store => {
      await validateRunFacts(store, next)
      return store.compareAndSetRun(run.run_id,input.expected_revision,patch)
    })
  }
  async getRun(auth,input) {
    assertAuthContext(auth); const run=await this.store.getRun(required(input.run_id,'run_id')); if(!run) throw new DomainError('NOT_FOUND','run not found')
    await this.store.authorize(auth,'project.read',{project_id:run.project_id,workspace_id:run.workspace_id})
    return run
  }
}

export function createDramaApplication(store, options={}) {
  const project=new ProjectService(store,options)
  const artifact=new ArtifactService(store,options)
  const approval=new ApprovalService(store)
  const run=new RunService(store)
  return {
    createProject: project.createProject.bind(project),
    getProject: project.getProject.bind(project),
    getArtifact: artifact.getArtifact.bind(artifact),
    createArtifactRevision: artifact.createArtifactRevision.bind(artifact),
    getBaseline: approval.getBaseline.bind(approval),
    getApproval: approval.getApproval.bind(approval),
    revokeApproval: approval.revokeApproval.bind(approval),
    getRun: run.getRun.bind(run),
    // No workbench projection in P1: leave the catalog entry unimplemented.
    // Consumers needing only the project fact must use getProject.
    approvePlanningBaseline: approval.approvePlanningBaseline.bind(approval),
    approveScriptBaseline: approval.approveScriptBaseline.bind(approval),
    createRun: run.createRun.bind(run),
    updateRun: run.updateRun.bind(run),
  }
}
