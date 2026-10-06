import { equal, canonicalHash } from '@xiaoshuren/dramago-application/domain.js'
import type { ArtifactRef, ArtifactVersion, ProjectFact, StoryRepository } from './ports.js'
import { check, exact, ref, uniqueRefs } from './validation.js'
import { artifactRole, contentObject } from './policy.js'

// Only the foundation/Bible outputs of one frozen input cohort supersede
// each other's historical inputs. Other roles and legacy records stay strict.
function pairedBibleRevision(a: ArtifactVersion, b: ArtifactVersion): boolean {
  const left = contentObject(a), right = contentObject(b)
  return ((a.kind === 'story_foundation' && b.kind === 'story_bible') ||
    (a.kind === 'story_bible' && b.kind === 'story_foundation')) &&
    left.artifact_role === a.kind && right.artifact_role === b.kind &&
    left.schema_version === 'dramago.story-proposal/v1' && right.schema_version === 'dramago.story-proposal/v1' &&
    left.status === 'proposal' && right.status === 'proposal' &&
    Array.isArray(left.direct_dependency_refs) && Array.isArray(right.direct_dependency_refs) &&
    typeof left.input_manifest_digest === 'string' && left.input_manifest_digest.trim().length > 0 &&
    left.input_manifest_digest === right.input_manifest_digest
}

// Walk iteratively and cap expansion. A forged or unbounded graph never reaches a port.
export async function resolveDependencies(tx: StoryRepository, project: ProjectFact, roots: ArtifactVersion[], requireCoherentScope: boolean): Promise<ArtifactVersion[]> {
  const key = (v: ArtifactVersion) => v.episode_id ? `episode:${v.episode_id}` : artifactRole(v)
  const declared = new Map(roots.map(v => [key(v), v]))
  const resolved = new Map(roots.map(v => [canonicalHash(ref(v)), v]))
  const pending = [...roots]
  const selections: { refs: ArtifactRef[]; direct: ArtifactRef[] }[] = []
  for (let i = 0; i < pending.length; i++) {
    check(pending.length <= 4096, 'story dependency graph exceeds bound')
    const v = pending[i]
    const dependencies = contentObject(v).dependency_refs
    const direct = contentObject(v).direct_dependency_refs as unknown as ArtifactRef[] | undefined
    if (direct !== undefined) check(Array.isArray(dependencies) && Array.isArray(direct), 'direct dependency refs require full dependency refs and an array')
    if (dependencies === undefined) continue
    check(Array.isArray(dependencies), 'dependency refs must be an array')
    const refs = dependencies as unknown as ArtifactRef[]
    check(uniqueRefs(refs).length === refs.length, 'duplicate dependency refs')
    if (direct !== undefined) {
      check(uniqueRefs(direct).length === direct.length, 'duplicate direct dependency refs')
      check(direct.every(r => refs.some(full => equal(r, full))), 'direct dependency missing from full provenance')
      selections.push({ refs, direct })
    }
    for (const r of refs) {
      const digest = canonicalHash(r)
      let dependency = resolved.get(digest)
      if (!dependency) {
        dependency = await exact(tx, project, r)
        resolved.set(digest, dependency)
        pending.push(dependency)
      }
      const selected = declared.get(key(dependency))
      // Historical ancestors remain verified provenance, not selected scope.
      // Legacy artifacts without direct refs retain the conservative check.
      if (requireCoherentScope && i < roots.length && selected && key(dependency) !== key(v) && (direct === undefined || direct.some(r => equal(r, ref(dependency))))) {
        check(equal(ref(dependency), ref(selected)) || pairedBibleRevision(v, selected), 'planning scope conflicts with exact dependency')
      }
    }
  }
  for (const { refs, direct } of selections) {
    const reachable = new Set(direct.map(r => canonicalHash(r)))
    for (const digest of reachable) {
      const ancestor = resolved.get(digest)!
      const inherited = contentObject(ancestor).dependency_refs as unknown as ArtifactRef[] | undefined
      for (const r of inherited ?? []) reachable.add(canonicalHash(r))
    }
    // A caller cannot hide a conflicting dependency by merely omitting it
    // from the direct list: excluded refs must be genuine ancestors.
    check(refs.every(r => reachable.has(canonicalHash(r))), 'direct dependency refs do not cover full provenance')
  }
  return pending
}
