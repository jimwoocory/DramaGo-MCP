import { readFileSync } from 'node:fs'

// The checked-in schema owns the wire fields/step allowlist; no runtime DTOs here.
export const storyDefinitions = JSON.parse(readFileSync(new URL('../../packages/dramago-contracts/contracts/story-development.schema.json', import.meta.url), 'utf8')).$defs
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v)
export const stableStoryId = v => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(v) && !/^(latest|head|current)$/i.test(v)
export const exactStoryRef = v => object(v) && Object.keys(v).sort().join(',') === 'artifact_id,content_digest,version_id' &&
  typeof v.artifact_id === 'string' && /^art_[A-Za-z0-9][A-Za-z0-9_-]{0,123}$/.test(v.artifact_id) &&
  typeof v.version_id === 'string' && /^av_[A-Za-z0-9][A-Za-z0-9_-]{0,124}$/.test(v.version_id) && !/^av_(latest|head|current)$/i.test(v.version_id) &&
  typeof v.content_digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(v.content_digest)
export const isStoryTool = name => ['dramago_story_step_run', 'dramago_planning_review'].includes(name)
export function validStoryRequest(name, value) {
  const shape = storyDefinitions[name === 'dramago_story_step_run' ? 'step_request' : 'review_request']
  return object(value) && shape.required.every(k => Object.hasOwn(value, k)) &&
    Object.keys(value).every(k => Object.hasOwn(shape.properties, k)) && stableStoryId(value.project_id) &&
    Number.isSafeInteger(value.expected_revision) && value.expected_revision >= 0 &&
    typeof value.idempotency_key === 'string' && value.idempotency_key.trim().length > 0 && value.idempotency_key.length <= shape.properties.idempotency_key.maxLength &&
    exactStoryRef(value.context_ref) && (name !== 'dramago_story_step_run' || shape.properties.step.enum.includes(value.step))
}
export function storyResult(value) {
  if (!object(value) || !stableStoryId(value.creative_run_id)) throw new TypeError('Invalid Story result identity')
  // CreativeRun.run_id is the stored fact field; the public result is creative_run_id.
  return { creative_run_id: value.creative_run_id }
}
