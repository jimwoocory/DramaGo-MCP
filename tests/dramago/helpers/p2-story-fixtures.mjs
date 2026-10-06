// Synthetic conformance fixtures only. No provider, persistence or approval calls.
import { canonicalHash } from '../../../packages/dramago-application/domain.js';

export const exactRef = ({ artifact_id, version_id, content_digest }) => ({ artifact_id, version_id, content_digest });
export const reseal = artifact => { artifact.content_digest = canonicalHash(artifact.content); return artifact; };
export function storyFixture() {
  const artifacts = [], runs = [];
  const at = '2026-01-01T00:00:00Z';
  const put = (name, kind, content, episode_id) => {
    const value = reseal({ schema_version: 'dramago.artifact-version/v1', artifact_id: `art_${name}`, version_id: `av_${name}`,
      workspace_id: 'ws_fixture', project_id: 'project_fixture', kind, content, created_at: at,
      ...(episode_id ? { episode_id } : {}) });
    artifacts.push(value); return value;
  };
  const range = put('range', 'planning_range', { workspace_id: 'ws_fixture', project_id: 'project_fixture',
    range_id: 'range_fixture', ordered_episode_ids: ['ep_a', 'ep_b'] });
  const project = { schema_version: 'dramago.drama-project/v1', workspace_id: 'ws_fixture', project_id: 'project_fixture',
    name: 'Synthetic P2 contract fixture', revision: 0, created_at: at,
    planning_range: { range_id: 'range_fixture', definition_ref: exactRef(range), ordered_episode_ids: ['ep_a', 'ep_b'] } };
  const writer = put('writer_config', 'other_drama', { purpose: 'Synthetic writer configuration' });
  const reviewer = put('reviewer_config', 'other_drama', { purpose: 'Synthetic reviewer configuration' });
  const research = put('research', 'other_drama', { schema_version: 'dramago.research-snapshot/v1', data_class: 'synthetic',
    as_of: at, territories: ['US'], question: 'Fixture question, not market research', sources: [{ source_id: 'source_a',
      locator: 'https://example.invalid/fixture', title: 'Synthetic source', captured_at: at,
      content_digest: canonicalHash('Synthetic excerpt'), excerpt: 'Synthetic excerpt' }],
    claims: [{ claim_id: 'claim_a', statement: 'Synthetic claim only', source_ids: ['source_a'] }], limitations: ['Not real market data'] });
  const idea = put('idea', 'other_drama', { schema_version: 'dramago.story-idea/v1', premise: 'A debt exposes an ally', constraints: [] });
  const beat = { beat_id: 'beat_a', cause: 'Debt called in', action: 'Expose lender', consequence: 'Ally implicated', predecessor_ids: [] };
  const generated = (name, kind, fields, context, manifest, episode_id) => put(name, kind, {
    schema_version: `dramago.${(episode_id ? 'episode_outline' : name).replaceAll('_', '-')}/v1`,
    run_context_ref: exactRef(context), dependency_refs: manifest.input_refs, ...fields,
  }, episode_id);
  const execute = (operation, bindings, build, extra = []) => {
    const review = operation === 'planning_review';
    const context = put(`context_${operation}`, 'other_drama', {
      schema_version: 'dramago.story-run-context/v1', policy_version: 'story-development/v1', operation, project_revision: 0,
      planning_scope: project.planning_range, instructions: 'Synthetic conformance fixture only',
      executor: { role: review ? 'reviewer' : 'writer', executor_id: review ? 'reviewer_a' : 'writer_a', configuration_ref: exactRef(review ? reviewer : writer) },
      bindings: Object.fromEntries(Object.entries(bindings).map(([key, value]) => [key, exactRef(value)])), source_refs: [],
      research: { status: 'supplied', snapshot_ref: exactRef(research) },
    });
    const manifest = { schema_version: 'dramago.run-input-manifest/v1', policy_version: 'story-development/v1',
      input_refs: [exactRef(context), exactRef(range), exactRef(review ? reviewer : writer), ...Object.values(context.content.bindings), exactRef(research), ...extra] };
    const result = build(context, manifest);
    runs.push({ schema_version: 'dramago.creative-run/v1', workspace_id: project.workspace_id, project_id: project.project_id,
      run_id: `run_${operation}`, domain: 'story', status: 'succeeded', input_manifest: manifest, input_manifest_digest: canonicalHash(manifest),
      steps: [{ step_id: `step_${operation}`, stage: `story.${operation}`, attempts: [{ attempt: 1, status: 'succeeded', input_manifest_digest: canonicalHash(manifest), output_refs: result.map(exactRef) }] }], created_at: at });
    return result;
  };
  const [direction] = execute('direction', { idea }, (c, m) => [generated('direction', 'other_drama', {
    logline: 'A debt exposes an ally', audience: 'Fixture audience', genre: 'Thriller', tone: 'Tense',
    story_promise: 'Justice at a cost', differentiation: 'Synthetic', market_claim_ids: ['claim_a'],
  }, c, m)]);
  const [foundation] = execute('adaptation', { idea, direction }, (c, m) => [generated('story_foundation', 'story_foundation', {
    premise: 'Debt exposes an ally', theme: 'Trust', conflict: 'Debtor versus lender', stakes: 'Family',
    adaptation: { mode: 'original', source_refs: [], decisions: ['Original synthetic premise'] },
  }, c, m)]);
  const [bible] = execute('bible', { story_foundation: foundation }, (c, m) => [generated('story_bible', 'story_bible', {
    characters: [{ character_id: 'char_a', want: 'Freedom', need: 'Trust', contradiction: 'Lies for honesty' }],
    relationships: ['Ally becomes rival'], story_engine: 'Each debt creates another', canon_rules: ['Debt cannot be erased'],
    promises: [{ promise_id: 'promise_a', setup: 'Unsigned letter', payoff: 'Ally wrote it' }],
  }, c, m)]);
  const [master] = execute('master_outline', { story_foundation: foundation, story_bible: bible }, (c, m) => [generated('master_outline', 'master_outline', {
    opening: 'Debt called', ending: 'Price paid', causal_beats: [beat], character_arcs: ['Learns trust'],
  }, c, m)]);
  const [season] = execute('season_architecture', { story_foundation: foundation, story_bible: bible, master_outline: master }, (c, m) => [generated('season_architecture', 'season_architecture', {
    ordered_episode_ids: ['ep_a', 'ep_b'], movements: [{ movement_id: 'movement_a', episode_ids: ['ep_a', 'ep_b'], dramatic_function: 'Expose lender', turning_point: 'Ally implicated' }],
    promise_schedule: [{ promise_id: 'promise_a', setup_episode_id: 'ep_a', payoff_episode_id: 'ep_b' }],
  }, c, m)]);
  const episodeResults = execute('episode_outlines', { story_foundation: foundation, story_bible: bible, master_outline: master, season_architecture: season }, (c, m) => {
    const outlines = ['ep_a', 'ep_b'].map(id => generated(id, 'episode_outline', { episode_id: id, title: 'Debt', opening_hook: 'Summons',
      ending_hook: 'Ally revealed', causal_beats: [beat], character_turns: ['Loses trust'], continuity_in: ['Debt owed'], continuity_out: ['Debt transferred'] }, c, m, id));
    const set = generated('episode_outline_set', 'other_drama', { planning_scope: project.planning_range,
      ordered_episodes: outlines.map(o => ({ episode_id: o.episode_id, outline_ref: exactRef(o) })),
      dependency_refs: [...m.input_refs, ...outlines.map(exactRef)],
    }, c, m);
    return [...outlines, set];
  });
  const set = episodeResults.at(-1);
  const subjects = [range, foundation, bible, master, season, ...episodeResults.slice(0, -1)].map(exactRef);
  const inspected = [range, direction, foundation, bible, master, season, set, ...episodeResults.slice(0, -1), research].map(exactRef);
  const [evidence] = execute('planning_review', { direction, story_foundation: foundation, story_bible: bible, master_outline: master,
    season_architecture: season, episode_outline_set: set }, (c, m) => [generated('planning_review_evidence', 'review_report', {
    planning_scope: project.planning_range, review_kind: 'planning', subject_refs: subjects, inspected_refs: inspected, reviewer_id: 'reviewer_a', reviewed_writer_ids: ['writer_a'],
    outcome: 'PASS', findings: [], blockers: [],
  }, c, m)], episodeResults.slice(0, -1).map(exactRef));
  const candidate = { schema_version: 'dramago.planning-manifest/v1', workspace_id: project.workspace_id, project_id: project.project_id,
    range_id: project.planning_range.range_id, range_definition_ref: exactRef(range), story_foundation: exactRef(foundation),
    story_bible: exactRef(bible), master_outline: exactRef(master), season_architecture: exactRef(season),
    ordered_episodes: set.content.ordered_episodes,
    review_evidence: [{ evidence_ref: exactRef(evidence), subject_refs: subjects, outcome: 'PASS' }], policy_version: 'story-development/v1' };
  return structuredClone({ project, artifacts, runs, candidate });
}
