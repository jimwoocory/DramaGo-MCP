import { isDeepStrictEqual } from 'node:util';

// Independent P0 policy floor from consensus section 7 / P0-TOOL-CATALOG tables.
// Never derive expected write/auth/revision policy from the catalog under test.
// Columns: name group domain mutability authorization_class async_result_kind.
const rows = `
dramago_project_create A project write workspace.project_create none
dramago_project_get A project read project.read none
dramago_artifact_get A version read project.read none
dramago_artifact_revision_create A version write project.artifact_write none
dramago_baseline_get A version read project.read none
dramago_approval_get A approval read project.read none
dramago_approval_revoke A approval write project.approval_revoke none
dramago_run_get A run read project.read creative_run_snapshot
dramago_workbench_get A project read project.read none
dramago_story_step_run B story write story.execute creative_run_id
dramago_planning_review B story write story.review creative_run_id
dramago_planning_baseline_approve B story write story.approve none
dramago_script_draft C script write script.write creative_run_id
dramago_script_review C script write script.review creative_run_id
dramago_script_baseline_approve C script write script.approve none
dramago_production_step_run D production write production.step_execute creative_run_id
dramago_production_package_approve D production write production.package_approve none
dramago_production_generation_prepare D production write production.prepare_quote execution_id
dramago_production_generate D production write production.execute_spend execution_id
dramago_production_execution_get D production read project.read execution_snapshot
dramago_production_result_review D production write production.result_adopt none
dramago_stage09_review D production read production.controlled_review controlled_review_result
quote_create E media write media.quotes.create none
generate_image E media write media.generate.image media_job_id
generate_video E media write media.generate.video media_job_id
job_get E media read media.jobs.read media_job_snapshot
asset_get E media read media.assets.read media_asset_snapshot
models_list E media read media.models.read none
models_get E media read media.models.read none
asset_create_upload E media write media.assets.write media_asset_id
asset_confirm E media write media.assets.write media_asset_id
job_cancel E media write media.jobs.cancel media_job_id
`.trim().split('\n').map((line) => line.split(' '));
const preserved = ['quote_create', 'generate_image', 'generate_video', 'job_get', 'asset_get'];
const planned = ['models_list', 'models_get', 'asset_create_upload', 'asset_confirm', 'job_cancel'];
const mediaInvariants = {
  quote_create: 'Preserve Quote request/response and idempotency contract; Quote/budget reservation is not creative approval or proof that a Quote service is implemented.',
  generate_image: 'Keep generic image request, Quote confirmation and Media Job semantics without required Drama fields; generation never mutates Drama approval state.',
  generate_video: 'Keep generic video request, Quote confirmation and Media Job semantics without required Drama fields; generation never mutates Drama approval state.',
  job_get: 'job_get means Media Job, not creative Run; report actual status/output_asset_ids, and never turn unknown/reconciling into permission to resubmit.',
  asset_get: 'Read a generic Media Asset and optional access URL, not a Drama creative identity; URL expiry triggers URL refresh, never regeneration or approval.',
};
const policies = {
  story_step_allowlist: ['direction', 'adaptation', 'bible', 'master_outline', 'season_architecture', 'episode_outlines'],
  production_step_allowlist: ['05', '06', '07', '08', '09'],
  production_plan_types: ['asset_generation_plan', 'video_production_package'],
  media_boundary: 'Keep Media Core generic. Media tools require no Drama project_id, planning_baseline_id or Canon; generate_* never mutate Drama approval state. Authorized linkage may create a review_required Drama candidate; a separate explicit authorized decision adopts or rejects that candidate.',
  compatibility: 'Preserve five Media tool names, input/output/error/async contracts, V10 adapter request keys and review_required semantics. Do not add media_* synonyms or rewrite integrations/media-mcp in P0.',
};
const fields = ['name', 'group', 'domain', 'maturity', 'implementation_status', 'mutability',
  'idempotency_required', 'expected_revision_required', 'authorization_class', 'async_result_kind', 'invariant'].sort();

export function validateToolPolicy(catalog, label) {
  const errors = [];
  const requireValue = (actual, expected, at) => {
    if (!isDeepStrictEqual(actual, expected)) errors.push(`${label}: ${at}: policy mismatch; expected ${JSON.stringify(expected)}`);
  };
  const requireSet = (actual, expected, at) => requireValue(Array.isArray(actual) ? [...actual].sort() : actual, [...expected].sort(), at);
  requireValue(catalog.runtime_registration, false, 'runtime_registration');
  requireValue(catalog.registered_aliases, [], 'registered_aliases');
  requireSet(catalog.preserved_media_names, preserved, 'preserved_media_names');
  requireSet(catalog.planned_media_names, planned, 'planned_media_names');
  for (const [key, expected] of Object.entries(policies)) {
    if (Array.isArray(expected)) requireSet(catalog.policies?.[key], expected, `policies.${key}`);
    else requireValue(catalog.policies?.[key], expected, `policies.${key}`);
  }
  const expectedNames = new Set(rows.map(([name]) => name));
  for (const tool of catalog.tools) {
    if (!tool || typeof tool.name !== 'string') continue;
    if (!expectedNames.has(tool.name)) errors.push(`${label}: unexpected tool ${tool.name}`);
  }
  for (const [name, group, domain, mutability, authorization_class, async_result_kind] of rows) {
    const tool = catalog.tools.find((t) => t?.name === name);
    if (!tool) continue; // name inventory provides the missing-tool diagnostic
    const existing = preserved.includes(name), reviewer = name === 'dramago_stage09_review';
    const expected = {
      group, domain, mutability, authorization_class, async_result_kind,
      idempotency_required: mutability === 'write',
      expected_revision_required: domain !== 'media' && mutability === 'write' && name !== 'dramago_project_create',
      maturity: existing || reviewer ? 'existing_contract' : domain === 'media' ? 'planned_p0' : 'planned_p1',
      implementation_status: existing ? 'adapter_contract_only' : reviewer ? 'local_controlled_review_only' : 'planned_not_yet_proven_implemented',
    };
    requireSet(Object.keys(tool), fields, `${name}: fields`);
    for (const [key, value] of Object.entries(expected)) requireValue(tool[key], value, `${name}: ${key}`);
    if (existing) requireValue(tool.invariant, mediaInvariants[name], `${name}: invariant`);
    if (typeof tool.invariant !== 'string' || !tool.invariant.trim()) errors.push(`${label}: ${name}: invariant must be nonempty text`);
    for (const [key, definitions] of [['authorization_class', 'authorization_classes'], ['async_result_kind', 'async_result_kinds'],
      ['maturity', 'maturity_definitions'], ['implementation_status', 'implementation_status_definitions']]) {
      if (typeof catalog[definitions]?.[tool[key]] !== 'string' || !catalog[definitions][tool[key]].trim()) {
        errors.push(`${label}: ${name}: missing definition for ${key}`);
      }
    }
  }
  return errors;
}
