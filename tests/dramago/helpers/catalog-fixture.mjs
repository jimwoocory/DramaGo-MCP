// Deliberately minimal injected policy fixture, NOT a second production catalog.
export const fixtureCatalog = {
  schema_version: 'dramago-mcp/tool-catalog/v1',
  preserved_media_names: ['quote_create', 'generate_image', 'generate_video', 'job_get', 'asset_get'],
  tools: [
    ...[['quote_create', 'media.quotes.create'], ['generate_image', 'media.generate.image'],
      ['generate_video', 'media.generate.video'], ['job_get', 'media.jobs.read'], ['asset_get', 'media.assets.read']]
      .map(([name, authorization_class], index) => ({ name, domain: 'media', authorization_class,
        idempotency_required: index < 3, expected_revision_required: false })),
    { name: 'dramago_project_get', domain: 'project', authorization_class: 'project.read', idempotency_required: false, expected_revision_required: false },
    { name: 'dramago_artifact_revision_create', domain: 'version', authorization_class: 'project.artifact_write', idempotency_required: true, expected_revision_required: true },
    ...['dramago_workbench_get', 'dramago_story_step_run', 'dramago_script_draft', 'dramago_production_step_run', 'models_list']
      .map(name => ({ name, domain: 'reserved', authorization_class: 'reserved', idempotency_required: false, expected_revision_required: false })),
  ],
}
