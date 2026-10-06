import { readFileSync, readdirSync } from 'node:fs';
import { DomainError, equal } from '../dramago-application/domain.js';
import { createInstanceValidator } from './schema-validator.mjs';
/** The checked-in policy is the runtime authority, not a parallel policy table. */
export const policy = JSON.parse(readFileSync(new URL('./contracts/story-development-policy.v1.json', import.meta.url), 'utf8'));
const directory = new URL('./contracts/', import.meta.url);
const library = 'story-development.schema.json';
const schemas = new Map(readdirSync(directory).filter(file => file.endsWith('.schema.json'))
    .map(file => [file, JSON.parse(readFileSync(new URL(file, directory), 'utf8'))]));
const definitions = schemas.get(library).$defs;
const named = new Map();
for (const name of Object.keys(definitions)) {
    const file = `${name}.runtime.schema.json`;
    schemas.set(file, { $ref: `${library}#/$defs/${name}` });
    named.set(name, file);
}
const validator = createInstanceValidator(schemas);
/** Validate a named Story definition or an existing fact envelope, never the library root. */
export function assertShape(name, value, code = 'VALIDATION_ERROR') {
    const file = named.get(name) ?? name;
    const errors = name === library ? ['Story definition name required'] : validator.validate(value, file, name);
    if (errors.length)
        throw new DomainError(code, `Invalid ${name}: ${errors.join('; ')}`);
}
const contentNames = new Map(Object.entries(definitions)
    .filter(([, definition]) => typeof definition.properties?.schema_version?.const === 'string')
    .map(([name, definition]) => [definition.properties.schema_version.const, name]));
export function contentType(content) {
    if (!content || typeof content !== 'object' || Array.isArray(content))
        return undefined;
    const version = content.schema_version;
    return typeof version === 'string' ? contentNames.get(version) : undefined;
}
function check(condition, message, code = "VALIDATION_ERROR") { if (!condition)
    throw new DomainError(code, message); }
export const roleKind = (role) => policy.content_kinds[role];
export const contentObject = (v) => typeof v.content === 'object' && v.content !== null && !Array.isArray(v.content) ? v.content : {};
export const artifactRole = (v) => contentType(v.content);
// Context is structurally typed while the service owns the port contract.
// The caller validates the context and reference graph before this semantic gate.
export function validateContent(v, context, artifacts, code = 'VALIDATION_ERROR') {
    const role = artifactRole(v);
    check(role && v.kind === roleKind(role), 'Story content type/kind mismatch', code);
    assertShape(role, v.content, code);
    const c = contentObject(v);
    if (role === 'master_outline' || role === 'episode_outline') {
        const seen = new Set();
        for (const beat of c.causal_beats) {
            check(!seen.has(beat.beat_id), 'duplicate beat_id', code);
            check(beat.predecessor_ids.every((id) => seen.has(id)), 'causal predecessor must be an earlier beat', code);
            seen.add(beat.beat_id);
        }
    }
    if (role === 'story_bible') {
        uniqueIds(c.characters, 'character_id', code);
        uniqueIds(c.promises, 'promise_id', code);
    }
    if (role === 'story_foundation')
        check(equal(c.adaptation.source_refs, context.source_refs), 'foundation adaptation sources must equal context source_refs', code);
    if (role === 'direction') {
        if (context.research.status === 'omitted')
            check(c.market_claim_ids.length === 0, 'direction without research cannot claim market evidence', code);
        else {
            const research = selectedContent(context.research.snapshot_ref, 'research_snapshot', artifacts, code);
            const claims = new Set(research.claims.map((claim) => claim.claim_id));
            check(c.market_claim_ids.every((id) => claims.has(id)), 'direction claim missing from exact context research', code);
        }
    }
    const declared = context.planning_scope;
    if (Object.hasOwn(c, 'planning_scope'))
        check(equal(c.planning_scope, declared), 'content scope differs from declared scope', code);
    if (role === 'season_architecture') {
        check(equal(c.ordered_episode_ids, declared.ordered_episode_ids), 'season episode scope mismatch', code);
        uniqueIds(c.movements, 'movement_id', code);
        uniqueIds(c.promise_schedule, 'promise_id', code);
        const bible = selectedContent(context.bindings.story_bible, 'story_bible', artifacts, code);
        const promises = new Set(bible.promises.map((promise) => promise.promise_id));
        const episodes = new Set(declared.ordered_episode_ids);
        for (const movement of c.movements)
            check(movement.episode_ids.every((id) => episodes.has(id)), 'movement episode outside declared scope', code);
        const covered = new Set(c.movements.flatMap((movement) => movement.episode_ids));
        check(declared.ordered_episode_ids.every((id) => covered.has(id)), 'movements must cover declared episode scope', code);
        for (const entry of c.promise_schedule) {
            check(promises.has(entry.promise_id), 'schedule promise missing from selected Bible', code);
            check(episodes.has(entry.setup_episode_id) && episodes.has(entry.payoff_episode_id), 'promise episode outside declared scope', code);
        }
    }
    if (role === 'episode_outline_set')
        check(equal(c.ordered_episodes.map((entry) => entry.episode_id), declared.ordered_episode_ids), 'episode set coverage/order mismatch', code);
    if (role === 'episode_outline') {
        check(v.episode_id === c.episode_id && declared.ordered_episode_ids.includes(c.episode_id), 'episode envelope/scope mismatch', code);
    }
    else
        check(!Object.hasOwn(v, 'episode_id'), 'non-episode Story content cannot have episode envelope', code);
}
export function researchSnapshot(v, allowSynthetic = false) {
    check(artifactRole(v) === 'research_snapshot' && v.kind === roleKind('research_snapshot'), 'research snapshot required');
    assertShape('research_snapshot', v.content);
    const c = contentObject(v);
    check(allowSynthetic || c.data_class !== 'synthetic', 'synthetic research requires explicit test opt-in');
    uniqueIds(c.sources, 'source_id');
    uniqueIds(c.claims, 'claim_id');
    const sources = new Set(c.sources.map((source) => source.source_id));
    for (const claim of c.claims)
        check(claim.source_ids.every((id) => sources.has(id)), 'research claim references missing source');
    for (const source of c.sources)
        check(Date.parse(source.captured_at) <= Date.parse(c.as_of), 'research capture after snapshot');
}
// Select only the explicitly frozen record. Ownership, digests and provenance are
// independently verified by the parent service; never pick a role-based fallback.
function selectedContent(reference, role, artifacts, code) {
    const matches = artifacts.filter(v => reference && v.artifact_id === reference.artifact_id
        && v.version_id === reference.version_id && v.content_digest === reference.content_digest);
    check(matches.length === 1, `exact selected ${role} required`, code);
    const v = matches[0];
    check(artifactRole(v) === role && v.kind === roleKind(role), `selected ${role} type/kind mismatch`, code);
    assertShape(role, v.content, code);
    return contentObject(v);
}
function uniqueIds(items, key, code = 'VALIDATION_ERROR') {
    check(new Set(items.map(item => item[key])).size === items.length, `duplicate ${key}`, code);
}
