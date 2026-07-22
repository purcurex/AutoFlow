import { getMetadataArgsStorage } from 'typeorm'
import { Note } from '../../notes/note.entity'
import {
  CrmActivityEntity,
  LeadContactEntity,
  LeadEntity,
  OutreachTaskEntity,
  WorkflowRunEntity,
  WorkflowStepEntity,
  WorkflowLeadEntity,
  LeadScoreEntity,
  WorkflowJobEntity,
} from './index'
import { AdCreativeEntity, ShopifyStoreEntity } from '../../discovery/entities'

describe('AutoFlow persistence entities', () => {
  const storage = getMetadataArgsStorage()

  it.each([
    [WorkflowRunEntity, 'workflow_runs'],
    [WorkflowStepEntity, 'workflow_steps'],
    [LeadEntity, 'leads'],
    [LeadContactEntity, 'lead_contacts'],
    [OutreachTaskEntity, 'outreach_tasks'],
    [CrmActivityEntity, 'crm_activities'],
    [WorkflowLeadEntity, 'workflow_leads'],
    [LeadScoreEntity, 'lead_scores'],
    [WorkflowJobEntity, 'workflow_jobs'],
    [AdCreativeEntity, 'ad_creatives'],
    [ShopifyStoreEntity, 'shopify_stores'],
  ])('maps %p to table %s', (entity, tableName) => {
    const table = storage.tables.find((metadata) => metadata.target === entity)

    expect(table?.name).toBe(tableName)
  })

  it.each([
    WorkflowRunEntity,
    LeadEntity,
    OutreachTaskEntity,
    CrmActivityEntity,
    LeadScoreEntity,
    AdCreativeEntity,
    ShopifyStoreEntity,
  ])(
    'adds user and optional team ownership to %p',
    (entity) => {
      const columns = storage.columns
        .filter((metadata) => metadata.target === entity)
        .map((metadata) => metadata.propertyName)

      expect(columns).toEqual(expect.arrayContaining(['ownerUserId', 'teamId']))
    },
  )

  it('adds workflow and lead links to legacy business records', () => {
    const columns = storage.columns
      .filter((metadata) => metadata.target === Note)
      .map((metadata) => metadata.propertyName)

    expect(columns).toEqual(expect.arrayContaining(['workflowRunId', 'leadId']))
  })

  it('defines owner, workflow, status, and timestamp indexes', () => {
    const indexNames = storage.indices.map((metadata) => metadata.name)

    expect(indexNames).toEqual(
      expect.arrayContaining([
        'idx_workflow_runs_owner_created_at',
        'idx_workflow_steps_run_sequence',
        'idx_leads_owner_status',
        'idx_leads_workflow_run_id',
        'idx_outreach_tasks_owner_status',
        'idx_outreach_tasks_next_follow_up_at',
        'idx_crm_activities_lead_occurred_at',
        'uq_leads_owner_normalized_domain',
        'idx_workflow_leads_run_discovered_at',
        'idx_ad_creatives_owner_discovered_at',
        'idx_shopify_stores_owner_domain',
        'idx_lead_scores_owner_total_score',
        'idx_workflow_jobs_status_available_at',
        'idx_workflow_jobs_lease_expires_at',
      ]),
    )
  })
})
