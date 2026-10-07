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
// Inspect generated planning content, not imported ideas, research or reviewer
// quotations. Derive the roles from the same published policy used by runtime.
const planningRoles = new Set(Object.values(policy.steps)
    .filter(step => step.port === 'StoryGenerationPort').flatMap(step => step.outputs));
// These are planning labels, not speaker cues, even when capitalized.
const planningLabels = new Set(['ACT', 'ACTION', 'ARC', 'BEAT', 'CHARACTER', 'CONFLICT', 'CONSTRAINTS',
    'DECISION', 'EPISODE', 'GOAL', 'HOOK', 'LOGLINE', 'MOTIVATION', 'NOTE', 'NOTES', 'OUTCOME',
    'PAYOFF', 'PREMISE', 'RISK', 'SCENE', 'SETTING', 'SETUP', 'STAKES', 'SUMMARY', 'THEME', 'TODO', 'TONE']);
function assertPlanningStrings(value, code) {
    if (typeof value === 'string') {
        // Deliberately conservative, not a general screenplay classifier. A lone
        // NAME: synopsis is ambiguous; require quoted speech or adjacent cues
        // with direct-address speech, not merely a list of character summaries.
        // Line anchors preserve ordinary prose discussing INT./EXT. or CUT TO:.
        let previousCue = false, previousSpeech = false;
        for (const line of value.split(/[\x0a\x0d]/).map(line => line.trim())) {
            if (!line) continue;
            const slugline = /^(?:INT\.(?:\/EXT\.)?|EXT\.|INT\/EXT\.)[ \t]+[A-Z0-9][A-Z0-9 .,'’()\/&–—-]*$/.test(line);
            const transition = /^CUT TO:[ \t]*$/.test(line);
            const cue = /^([A-Z][A-Z0-9 .’'-]{0,59})(?:[ \t]+\((?:V\.O\.|O\.S\.)\))?:[ \t]*(\S.*)$/.exec(line);
            const speaker = cue && !planningLabels.has(cue[1].trim());
            const speech = speaker && /\b(?:I|me|my|mine|we|us|our|ours|you|your|yours)\b|[?!]$/i.test(cue[2]);
            const dialogue = speaker && ((previousCue && (previousSpeech || speech)) || /^["“‘'].*["”’'][.!?]?$/.test(cue[2]));
            check(!slugline && !transition && !dialogue,
                'screenplay formatting is not allowed in Story planning content', code);
            previousCue = Boolean(speaker);
            previousSpeech = Boolean(speech);
        }
    }
    else if (value && typeof value === 'object')
        for (const child of Object.values(value)) assertPlanningStrings(child, code);
}
// Context is structurally typed while the service owns the port contract.
// The caller validates the context and reference graph before this semantic gate.
export function validateContent(v, context, artifacts, code = 'VALIDATION_ERROR') {
    const role = artifactRole(v);
    check(role && v.kind === roleKind(role), 'Story content type/kind mismatch', code);
    assertShape(role, v.content, code);
    const c = contentObject(v);
    if (planningRoles.has(role)) assertPlanningStrings(c, code);
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
function researchTimestamp(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/i.exec(value);
    check(match, 'invalid research timestamp');
    const [, y, m, d, h, min, sec, oh = '0', om = '0'] = match;
    const days = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
    check(Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= days
        && Number(h) <= 23 && Number(min) <= 59 && Number(sec) <= 59 && Number(oh) <= 23
        && Number(om) <= 59 && Number.isFinite(Date.parse(value)), 'invalid research timestamp');
    return Date.parse(value);
}
export function researchSnapshot(v, allowSynthetic = false) {
    check(artifactRole(v) === 'research_snapshot' && v.kind === roleKind('research_snapshot'), 'research snapshot required');
    assertShape('research_snapshot', v.content);
    const c = contentObject(v);
    check(c.data_class === 'observed' || (allowSynthetic === true && c.data_class === 'synthetic'), 'synthetic research requires explicit test opt-in');
    uniqueIds(c.sources, 'source_id');
    uniqueIds(c.claims, 'claim_id');
    const sources = new Set(c.sources.map((source) => source.source_id));
    for (const claim of c.claims)
        check(claim.source_ids.every((id) => sources.has(id)), 'research claim references missing source');
    const asOf = researchTimestamp(c.as_of);
    for (const source of c.sources) {
        check(!/^\s*model\s*:/i.test(source.locator), 'model memory is not research evidence');
        check(researchTimestamp(source.captured_at) <= asOf, 'research capture after snapshot');
    }
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
