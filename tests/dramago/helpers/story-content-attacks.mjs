// The same semantic attacks exercise resealed fixtures and actual injected outputs.
export const contentAttacks = [
  ...['screenplay', 'dialogue', 'dialogues', 'scene', 'scenes', 'scene_list'].map(field => ({
    name: `episode outline forbids ${field}`, step: 'episode_outlines', target: 'ep_a',
    mutate: c => { c[field] = 'Not an outline field'; }, message: /additionalProperties/,
  })),
  { name: 'nested dialogue is not a causal beat', step: 'episode_outlines', target: 'ep_a', mutate: c => { c.causal_beats[0].dialogue = 'Hello'; }, message: /additionalProperties/ },
  ...['master_outline', 'episode_outlines'].flatMap(step => ['self', 'forward', 'missing', 'duplicate'].map(attack => ({
    name: `${step} ${attack} predecessor`, step, target: step === 'master_outline' ? step : 'ep_a',
    mutate: c => {
      const first = c.causal_beats[0];
      c.causal_beats.push({ ...first, beat_id: 'beat_b', predecessor_ids: ['beat_a'] });
      if (attack === 'self') first.predecessor_ids = ['beat_a'];
      if (attack === 'forward') first.predecessor_ids = ['beat_b'];
      if (attack === 'missing') first.predecessor_ids = ['missing'];
      if (attack === 'duplicate') c.causal_beats[1].predecessor_ids = ['beat_a', 'beat_a'];
    }, message: /predecessor|uniqueItems/,
  }))),
  { name: 'season movement membership', step: 'season_architecture', target: 'season_architecture', mutate: c => { c.movements[0].episode_ids = ['outside']; }, message: /outside declared scope/ },
  { name: 'season movement coverage', step: 'season_architecture', target: 'season_architecture', mutate: c => { c.movements[0].episode_ids = ['ep_a']; }, message: /cover declared episode/ },
  { name: 'schedule Bible promise reference', step: 'season_architecture', target: 'season_architecture', mutate: c => { c.promise_schedule[0].promise_id = 'unknown'; }, message: /selected Bible/ },
  ...['setup_episode_id', 'payoff_episode_id'].map(field => ({ name: `schedule ${field}`, step: 'season_architecture', target: 'season_architecture', mutate: c => { c.promise_schedule[0][field] = 'outside'; }, message: /outside declared scope/ })),
  { name: 'adaptation exact sources', step: 'adaptation', target: 'story_foundation', mutate: (c, artifacts) => {
    const idea = artifacts.find(a => a.content.schema_version === 'dramago.story-idea/v1');
    c.adaptation.source_refs = [{ artifact_id: idea.artifact_id, version_id: idea.version_id, content_digest: idea.content_digest }];
  }, message: /adaptation sources/ },
  { name: 'Bible duplicate character identity', step: 'bible', target: 'story_bible', mutate: c => { c.characters.push({ ...c.characters[0], want: 'Different want' }); }, message: /duplicate character_id/ },
  { name: 'Bible duplicate promise identity', step: 'bible', target: 'story_bible', mutate: c => { c.promises.push({ ...c.promises[0], setup: 'Different setup' }); }, message: /duplicate promise_id/ },
];
