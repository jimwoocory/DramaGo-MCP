import { readFileSync } from 'node:fs';
import { storyDefinitions as definitions, stableStoryId, exactStoryRef, validStoryRequest, storyResult } from './story-contract.js';
import { canonicalHash, equal, DomainError } from '@xiaoshuren/dramago-application/domain.js';
import type { ArtifactRef, ArtifactVersion, ProjectFact, StoryDevelopmentService, StoryRepository, StoryStep } from '@xiaoshuren/story-development';

export type StoryAuth = Readonly<{
  tenantId: string;
  subjectId: string;
  clientId: string;
  scopes: readonly string[];
  defaultWorkspaceId?: string;
}>;

/** Public DTOs: story-development.schema.json step_request/review_request/run_result. */
export type StoryCommand = Readonly<{
  project_id: string;
  idempotency_key: string;
  expected_revision: number;
  context_ref: ArtifactRef;
}>;
export type StoryStepCommand = StoryCommand & Readonly<{ step: StoryStep }>;
export type StoryRunResult = Readonly<{ creative_run_id: string }>;
export interface StoryWriterPort {
  runStoryStep(auth: StoryAuth, input: StoryStepCommand): Promise<StoryRunResult> | StoryRunResult;
}
export interface StoryReviewerPort {
  reviewPlanning(auth: StoryAuth, input: StoryCommand): Promise<StoryRunResult> | StoryRunResult;
}
/** No writer fallback for review, approval capability, or inferred registration. */
export interface StoryService {
  readonly writer?: StoryWriterPort;
  readonly reviewer?: StoryReviewerPort;
}

type Facts = Pick<StoryRepository, 'getProject' | 'getArtifactVersion' | 'getBaselineByVersion' | 'authorize'>;
const policy = JSON.parse(readFileSync(new URL('../../packages/dramago-contracts/contracts/story-development-policy.v1.json', import.meta.url), 'utf8'));

const object = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
function check(value: unknown, message: string, code = 'VALIDATION_ERROR'): asserts value {
  if (!value) throw new DomainError(code, message);
}
function text(v: unknown): asserts v is string { check(typeof v === 'string' && v.trim().length > 0, 'nonblank text required'); }
function stable(v: unknown): asserts v is string {
  check(stableStoryId(v), 'stable ID required');
}
function keys(v: unknown, required: string[], optional: string[] = []): asserts v is Record<string, any> {
  check(object(v) && required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => [...required, ...optional].includes(k)), 'invalid DTO fields');
}
function exactRef(v: unknown): asserts v is ArtifactRef {
  check(exactStoryRef(v), 'exact immutable reference required');
}
const reference = (v: ArtifactRef): ArtifactRef => ({ artifact_id: v.artifact_id, version_id: v.version_id, content_digest: v.content_digest });
const unique = (refs: ArtifactRef[]) => [...new Map(refs.map(r => [canonicalHash(r), r])).values()];

/** Explicit local anti-corruption boundary. Never resolves an artifact head/latest. */
export function createLocalStoryPorts(service: StoryDevelopmentService, facts: Facts): StoryService {
  async function prepare(auth: StoryAuth, input: StoryCommand | StoryStepCommand, operation: string) {
    const command = structuredClone(input);
    const actor = { tenantId: auth.tenantId, subjectId: auth.subjectId, clientId: auth.clientId, scopes: [...auth.scopes] };
    check(validStoryRequest(operation === 'planning_review' ? 'dramago_planning_review' : 'dramago_story_step_run', command), 'invalid public Story request');
    check(Object.hasOwn(policy.steps, operation), 'unsupported Story operation');
    const action = operation === 'planning_review' ? 'story.review' : 'story.execute';
    check(actor.scopes.includes(action), 'missing scope', 'FORBIDDEN');
    const project = await facts.getProject(command.project_id);
    check(project, 'project not found', 'NOT_FOUND');
    stable(project.workspace_id);
    check(await facts.authorize(actor, action, { project_id: command.project_id, workspace_id: project.workspace_id }) === true, 'authorization denied', 'FORBIDDEN');
    async function resolve(r: ArtifactRef): Promise<ArtifactVersion> {
      exactRef(r);
      const v = await facts.getArtifactVersion(r.version_id);
      check(v && equal(reference(v), r) && v.project_id === project!.project_id && v.workspace_id === project!.workspace_id, 'unresolved or foreign exact reference');
      check(v.schema_version === 'dramago.artifact-version/v1' && !Object.hasOwn(v, 'manifest') && !await facts.getBaselineByVersion(r.version_id, command.project_id), 'invalid artifact envelope');
      check(canonicalHash(v.content) === r.content_digest, 'stored content digest mismatch');
      return structuredClone(v);
    }
    const context = await resolve(command.context_ref);
    check(context.kind === 'other_drama', 'run context kind required');
    const c: unknown = context.content;
    keys(c, definitions.run_context.required);
    check(c.schema_version === 'dramago.story-run-context/v1' && c.policy_version === policy.policy_version && c.operation === operation, 'context operation/policy mismatch');
    check(c.project_revision === command.expected_revision, 'context revision mismatch');
    keys(c.planning_scope, ['range_id', 'definition_ref', 'ordered_episode_ids']);
    stable(c.planning_scope.range_id); exactRef(c.planning_scope.definition_ref);
    check(Array.isArray(c.planning_scope.ordered_episode_ids) && c.planning_scope.ordered_episode_ids.length > 0 && new Set(c.planning_scope.ordered_episode_ids).size === c.planning_scope.ordered_episode_ids.length, 'ordered episode scope required');
    c.planning_scope.ordered_episode_ids.forEach(stable);
    text(c.instructions);
    keys(c.executor, ['role', 'executor_id', 'configuration_ref']);
    check(c.executor.role === (operation === 'planning_review' ? 'reviewer' : 'writer'), 'executor role mismatch');
    stable(c.executor.executor_id);
    keys(c.bindings, policy.steps[operation].required_bindings);
    check(Array.isArray(c.source_refs), 'source refs required');
    c.source_refs.forEach(exactRef);
    check(unique(c.source_refs).length === c.source_refs.length, 'duplicate source refs');
    keys(c.research, ['status'], ['snapshot_ref', 'reason']);
    let research: ArtifactRef | null = null;
    if (c.research.status === 'supplied') {
      keys(c.research, ['status', 'snapshot_ref']); exactRef(c.research.snapshot_ref); research = c.research.snapshot_ref;
    } else {
      keys(c.research, ['status', 'reason']); text(c.research.reason);
      check(c.research.status === 'omitted' && policy.steps[operation].research === 'optional', 'required research snapshot missing');
    }
    const refs = unique([command.context_ref, c.planning_scope.definition_ref, c.executor.configuration_ref, ...Object.values(c.bindings) as ArtifactRef[], ...c.source_refs, ...(research ? [research] : [])]);
    for (const r of refs) await resolve(r);
    for (const [role, r] of Object.entries(c.bindings)) {
      const v = await resolve(r as ArtifactRef);
      check(v.kind === policy.content_kinds[role], 'binding kind mismatch');
      if (v.kind === 'other_drama') {
        check(object(v.content) && (v.content.schema_version === definitions[role].properties.schema_version.const || v.content.artifact_role === role), 'binding content role mismatch');
      }
    }
    return { actor, command, context: c, resolve, refs, base: {
      project_id: command.project_id, workspace_id: project.workspace_id,
      expected_revision: command.expected_revision, idempotency_key: command.idempotency_key,
      context_planning_scope: c.planning_scope as ProjectFact['planning_range'],
      ...(research ? { research_ref: research } : { omit_research: true as const }),
      executor: { role: c.executor.role as 'writer' | 'reviewer', executor_id: c.executor.executor_id as string },
    } };
  }
  return Object.freeze({ writer: Object.freeze({
    async runStoryStep(auth: StoryAuth, input: StoryStepCommand): Promise<StoryRunResult> {
      const p = await prepare(auth, input, input.step);
      const step = (p.command as StoryStepCommand).step;
      // The legacy Bible runtime needs direction, while the public contract binds
      // foundation. Recover it only from that immutable foundation's provenance.
      if (step === 'bible') {
        const pending: ArtifactRef[] = [p.context.bindings.story_foundation];
        const seen = new Set<string>();
        const directions: ArtifactRef[] = [];
        for (let i = 0; i < pending.length; i++) {
          check(pending.length <= 4096, 'dependency graph exceeds bound');
          const r = pending[i]; exactRef(r);
          const key = canonicalHash(r);
          if (seen.has(key)) continue;
          seen.add(key);
          const v = await p.resolve(r);
          if (object(v.content)) {
            if (v.kind === 'other_drama' && v.content.artifact_role === 'direction') directions.push(r);
            if (Object.hasOwn(v.content, 'dependency_refs')) {
              check(Array.isArray(v.content.dependency_refs), 'dependency refs required');
              for (const dependency of v.content.dependency_refs) { exactRef(dependency); pending.push(dependency); }
            }
          }
        }
        check(directions.length === 1, 'one exact foundation direction dependency required');
        p.refs = unique([...p.refs, directions[0]]);
      }
      const result = await service.runStep(p.actor, { ...p.base, step, input_refs: p.refs });
      return storyResult(result);
    },
  }), reviewer: Object.freeze({
    async reviewPlanning(auth: StoryAuth, input: StoryCommand): Promise<StoryRunResult> {
      const p = await prepare(auth, input, 'planning_review');
      const b = p.context.bindings;
      const set = await p.resolve(b.episode_outline_set);
      const content: unknown = set.content;
      check(object(content) && Array.isArray(content.ordered_episodes), 'exact episode set required');
      const ordered = content.ordered_episodes;
      check(equal(ordered.map((e: unknown) => object(e) ? e.episode_id : null), p.context.planning_scope.ordered_episode_ids), 'complete ordered episode scope required');
      for (const e of ordered) {
        keys(e, ['episode_id', 'outline_ref']);
        const outline = await p.resolve(e.outline_ref);
        check(outline.kind === 'episode_outline' && outline.episode_id === e.episode_id, 'episode identity mismatch');
      }
      const result = await service.planningReview(p.actor, { ...p.base, context_refs: p.refs, planning_scope: {
        direction_ref: b.direction, story_foundation: b.story_foundation, story_bible: b.story_bible,
        master_outline: b.master_outline, season_architecture: b.season_architecture,
        episode_outline_set_ref: b.episode_outline_set, ordered_episodes: ordered as unknown as { episode_id: string; outline_ref: ArtifactRef }[],
      } });
      return storyResult(result);
    },
  }) });
}
