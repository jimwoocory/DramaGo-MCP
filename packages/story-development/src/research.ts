import type { ArtifactVersion } from './ports.js'
import { check } from './validation.js'
// One canonical schema/semantic research gate for runtime and contract fixtures.
export { researchSnapshot } from '../../dramago-contracts/story-validator.mjs'

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const stableId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(v) && !['latest', 'LATEST', 'head', 'HEAD', 'current', 'CURRENT'].includes(v) && !/\s/.test(v)
/** Check structured market assertions throughout a payload against selected research. */
export function marketClaimsValid(value: unknown, researchArtifact?: ArtifactVersion | null, code = 'VALIDATION_ERROR'): void {
  const content = researchArtifact?.content
  const claims = record(content) && Array.isArray(content.claims) ? content.claims : []
  const supported = new Set(claims.flatMap(claim => record(claim) ? [claim.claim_id] : []))
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(visit); return }
    if (!record(v)) return
    if (Object.hasOwn(v, 'market_claim_ids')) {
      const ids = v.market_claim_ids
      check(Array.isArray(ids) && new Set(ids).size === ids.length && ids.every(id => stableId(id) && supported.has(id)), 'market claim lacks selected research support', code)
    }
    Object.values(v).forEach(visit)
  }
  visit(value)
}
