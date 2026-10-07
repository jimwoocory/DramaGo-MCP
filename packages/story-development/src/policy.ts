import type { StoryStep } from './ports.js'
import { freeze } from './validation.js'
import { policy } from './contracts.js'
export { roleKind, contentObject, artifactRole, validateContent } from '../../dramago-contracts/story-validator.mjs'
export { researchSnapshot, marketClaimsValid } from './research.js'

interface StepPolicy { research: 'required' | 'optional'; requires: string[]; outputs: string[] }
export const STORY_POLICY_VERSION = policy.policy_version
export const STEP_POLICIES = freeze(Object.fromEntries(Object.entries(policy.steps)
  .filter(([, rule]) => rule.port === 'StoryGenerationPort')
  .map(([step, rule]) => [step, { research: rule.research, requires: rule.required_bindings, outputs: rule.outputs }]))) as Readonly<Record<StoryStep, StepPolicy>>
