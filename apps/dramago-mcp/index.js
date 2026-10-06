import { readFileSync } from 'node:fs'
import { isStoryTool, validStoryRequest, storyResult } from './story-contract.js'

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

// Internal dispatcher salvaged from D@975464f; not an MCP transport/server.
// This is the sole production catalog location, owned by the contracts branch.
export const DEFAULT_CATALOG_URL = new URL('../../packages/dramago-contracts/contracts/tool-catalog.v1.json', import.meta.url)
export function loadCatalog() {
  return JSON.parse(readFileSync(DEFAULT_CATALOG_URL, 'utf8'))
}

// Registration allowlist, not a duplicate catalog or public policy definition.
export const MEDIA_TOOL_NAMES = Object.freeze(['quote_create', 'generate_image', 'generate_video', 'job_get', 'asset_get'])

function catalogSnapshot(value) {
  const catalog = jsonSnapshot(value)
  if (catalog.schema_version !== 'dramago-mcp/tool-catalog/v1' || !Array.isArray(catalog.tools) ||
      !Array.isArray(catalog.preserved_media_names) ||
      JSON.stringify(catalog.preserved_media_names) !== JSON.stringify(MEDIA_TOOL_NAMES)) {
    throw new TypeError('Invalid DramaGo catalog')
  }
  const names = new Set()
  for (const tool of catalog.tools) {
    if (!isObject(tool) || !nonblank(tool.name) || names.has(tool.name) || !nonblank(tool.domain) ||
        !nonblank(tool.authorization_class) || typeof tool.idempotency_required !== 'boolean' ||
        typeof tool.expected_revision_required !== 'boolean') throw new TypeError('Invalid DramaGo catalog tool')
    names.add(tool.name)
  }
  return catalog
}

const errorDefinitions = deepFreeze({
  NOT_FOUND: [-32004, 'Resource not found.'],
  FORBIDDEN: [-32003, 'Access denied.'],
  VALIDATION_ERROR: [-32602, 'Invalid tool arguments.'],
  REVISION_CONFLICT: [-32009, 'Expected revision conflicts with current revision.'],
  IDEMPOTENCY_CONFLICT: [-32010, 'Idempotency key conflicts with an earlier request.'],
  BASELINE_INCOMPLETE: [-32011, 'Baseline is incomplete.'],
  BASELINE_IMMUTABLE: [-32012, 'Baseline is immutable.'],
  APPROVAL_INVALID: [-32013, 'Approval is invalid.'],
  INVALID_STATE_TRANSITION: [-32014, 'State transition is not allowed.'],
  INTERNAL_ERROR: [-32603, 'Internal application error.'],
  TOOL_NOT_FOUND: [-32601, 'Unknown tool.'],
  TOOL_NOT_IMPLEMENTED: [-32001, 'Tool is declared but not implemented.'],
})

function errorResult(code) {
  if (typeof code !== 'string' || !Object.hasOwn(errorDefinitions, code)) code = 'INTERNAL_ERROR'
  const [jsonRpcCode, message] = errorDefinitions[code]
  const error = { code, message, jsonRpcCode }
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error }) }], structuredContent: { error } }
}

const factMethods = Object.freeze({
  dramago_project_create: 'createProject',
  dramago_project_get: 'getProject',
  dramago_artifact_get: 'getArtifact',
  dramago_artifact_revision_create: 'createArtifactRevision',
  dramago_baseline_get: 'getBaseline',
  dramago_approval_get: 'getApproval',
  dramago_approval_revoke: 'revokeApproval',
  dramago_run_get: 'getRun',
  dramago_planning_baseline_approve: 'approvePlanningBaseline',
  dramago_script_baseline_approve: 'approveScriptBaseline',
})

const nonblank = value => typeof value === 'string' && value.trim().length > 0
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function validAuth(auth) {
  return isObject(auth) && ['tenantId', 'subjectId', 'clientId'].every(key => nonblank(auth[key])) &&
    Array.isArray(auth.scopes) && auth.scopes.every(nonblank) &&
    (auth.defaultWorkspaceId === undefined || nonblank(auth.defaultWorkspaceId))
}

function jsonSnapshot(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) return value
  if (!isObject(value) && !Array.isArray(value)) throw new TypeError('Expected JSON')
  if (ancestors.has(value)) throw new TypeError('Expected acyclic JSON')
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError('Expected a JSON object')
  }
  ancestors.add(value)
  const result = Array.isArray(value)
    ? Array.from(value, child => jsonSnapshot(child, ancestors))
    : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSnapshot(child, ancestors)]))
  ancestors.delete(value)
  return deepFreeze(result)
}

function validPreconditions(tool, input) {
  if (!isObject(input)) return false
  if (Object.hasOwn(input, 'workspace_id') && !nonblank(input.workspace_id)) return false
  if (tool.idempotency_required) {
    if (!nonblank(input.idempotency_key)) return false
    if (tool.domain === 'media' && (input.idempotency_key.length < 16 || input.idempotency_key.length > 128)) return false
  }
  if (tool.expected_revision_required &&
      (!Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0)) return false
  return true
}

function successResult(value) {
  if (!isObject(value)) return errorResult('INTERNAL_ERROR')
  try {
    const snapshot = jsonSnapshot(value)
    return { isError: false, content: [{ type: 'text', text: JSON.stringify(snapshot) }], structuredContent: snapshot }
  } catch {
    return errorResult('INTERNAL_ERROR')
  }
}

export function createDramaGoMcp({ catalog: suppliedCatalog = loadCatalog(), services = {},
  storyService = /** @type {import('./story-ports.js').StoryService} */ ({}), mediaPorts = {}, authorize } = {}) {
  const catalog = catalogSnapshot(suppliedCatalog)
  const handlers = new Map()
  for (const [name, method] of Object.entries(factMethods)) {
    if (typeof services[method] === 'function') handlers.set(name, services[method].bind(services))
  }
  if (typeof storyService?.writer?.runStoryStep === 'function') {
    handlers.set('dramago_story_step_run', storyService.writer.runStoryStep.bind(storyService.writer))
  }
  if (typeof storyService?.reviewer?.reviewPlanning === 'function') {
    handlers.set('dramago_planning_review', storyService.reviewer.reviewPlanning.bind(storyService.reviewer))
  }
  const mediaHandlers = new Map()
  for (const name of MEDIA_TOOL_NAMES) {
    if (typeof mediaPorts?.[name] === 'function') mediaHandlers.set(name, mediaPorts[name].bind(mediaPorts))
  }
  const descriptors = deepFreeze(catalog.tools.map(tool => ({
    name: tool.name,
    catalog: tool,
    status: handlers.has(tool.name) ? 'implemented' : mediaHandlers.has(tool.name) ? 'pass_through' : 'declared_unimplemented',
    callable: handlers.has(tool.name) || mediaHandlers.has(tool.name),
  })))
  const byName = new Map(descriptors.map(descriptor => [descriptor.name, descriptor]))
  return Object.freeze({
    descriptors,
    listTools: () => descriptors.filter(descriptor => descriptor.callable),
    async callTool(name, input, auth) {
      if (!byName.has(name)) return errorResult('TOOL_NOT_FOUND')
      if (!handlers.has(name) && !mediaHandlers.has(name)) return errorResult('TOOL_NOT_IMPLEMENTED')
      const tool = byName.get(name).catalog
      try { auth = jsonSnapshot(auth) } catch { return errorResult('FORBIDDEN') }
      if (!validAuth(auth) || !auth.scopes.includes(tool.authorization_class)) return errorResult('FORBIDDEN')
      try { input = jsonSnapshot(input) } catch { return errorResult('VALIDATION_ERROR') }
      if (!validPreconditions(tool, input) || (isStoryTool(name) && !validStoryRequest(name, input))) return errorResult('VALIDATION_ERROR')
      let authorized = false
      try {
        authorized = typeof authorize === 'function' && await authorize(auth, tool.authorization_class, {
          toolName: name, workspaceId: input.workspace_id ?? auth.defaultWorkspaceId, input,
        }) === true
      } catch (error) {
        return errorResult(error?.code)
      }
      if (!authorized) return errorResult('FORBIDDEN')
      if (mediaHandlers.has(name)) {
        const value = await mediaHandlers.get(name)(input, auth)
        if (isObject(value) && typeof value.isError === 'boolean' && Array.isArray(value.content) && isObject(value.structuredContent)) return value
        return successResult(value)
      }
      try {
        const value = await handlers.get(name)(auth, input)
        return successResult(isStoryTool(name) ? storyResult(value) : value)
      } catch (error) {
        return errorResult(error?.code)
      }
    },
  })
}