import type { QueryRunner } from 'typeorm'
import { AddAutoFlowCoreEntities1784700060000 } from '../migrations/1784700060000-AddAutoFlowCoreEntities'
import { AlignP1Contracts1784709000000 } from '../migrations/1784709000000-AlignP1Contracts'
import { AddLeadDiscoveryLinks1784709060000 } from '../migrations/1784709060000-AddLeadDiscoveryLinks'
import { AddDiscoveryEvidence1784710000000 } from '../migrations/1784710000000-AddDiscoveryEvidence'
import { AddWorkflowExecutionGuards1784711000000 } from '../migrations/1784711000000-AddWorkflowExecutionGuards'
import { FixLeadScoreUniqueIndex1784711060000 } from '../migrations/1784711060000-FixLeadScoreUniqueIndex'
import { AddWorkflowJobQueue1784712000000 } from '../migrations/1784712000000-AddWorkflowJobQueue'
import { AddDiscoveryVerificationEvidence1784713000000 } from '../migrations/1784713000000-AddDiscoveryVerificationEvidence'
import { AddQuotationSnapshots1784714000000 } from '../migrations/1784714000000-AddQuotationSnapshots'
import { AddFopHandoffs1784715000000 } from '../migrations/1784715000000-AddFopHandoffs'
import { AddOutreachDeliveryContext1784716000000 } from '../migrations/1784716000000-AddOutreachDeliveryContext'
import { AddAuditEvents1784717000000 } from '../migrations/1784717000000-AddAuditEvents'
import { AddShopifyProspectingEvidence1784718000000 } from '../migrations/1784718000000-AddShopifyProspectingEvidence'
import { AddUserDisplayIds1784719000000 } from '../migrations/1784719000000-AddUserDisplayIds'
import { AddAiPromptTemplates1784721000000 } from '../migrations/1784721000000-AddAiPromptTemplates'
import { AddWorkflowRevisionLifecycle1784722000000 } from '../migrations/1784722000000-AddWorkflowRevisionLifecycle'
import { AddAiOutreachConversations1784723000000 } from '../migrations/1784723000000-AddAiOutreachConversations'
import { AddAlibaba1688Sourcing1784724000000 } from '../migrations/1784724000000-AddAlibaba1688Sourcing'
import { AddLeadPoolWorkflowOrdering1784725000000 } from '../migrations/1784725000000-AddLeadPoolWorkflowOrdering'
import { AddOutreachOtherChannel1784726000000 } from '../migrations/1784726000000-AddOutreachOtherChannel'
import { AddOwnerScopedWorkflowDisplayIds1784727000000 } from '../migrations/1784727000000-AddOwnerScopedWorkflowDisplayIds'

describe('AutoFlow core migration', () => {
  function createQueryRunner() {
    return {
      query: jest.fn().mockResolvedValue(undefined),
    } as unknown as QueryRunner
  }

  it('creates every P1-A table and the legacy record links', async () => {
    const queryRunner = createQueryRunner()
    const migration = new AddAutoFlowCoreEntities1784700060000()

    await migration.up(queryRunner)

    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')

    for (const table of [
      'workflow_runs',
      'workflow_steps',
      'leads',
      'lead_contacts',
      'outreach_tasks',
      'crm_activities',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`)
    }
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "workflow_run_id" uuid')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "lead_id" uuid')
  })

  it('removes only AutoFlow additions when reverted', async () => {
    const queryRunner = createQueryRunner()
    const migration = new AddAutoFlowCoreEntities1784700060000()

    await migration.down(queryRunner)

    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')

    expect(sql).toContain('DROP TABLE IF EXISTS "workflow_runs"')
    expect(sql).toContain('DROP COLUMN IF EXISTS "workflow_run_id"')
    expect(sql).not.toContain('DROP TABLE IF EXISTS "notes"')
    expect(sql).not.toContain('DROP TABLE IF EXISTS "users"')
  })
})

describe('P1 contract and discovery-link migrations', () => {
  function createQueryRunner() {
    return { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner
  }

  it('adds the frozen P1 enum values', async () => {
    const queryRunner = createQueryRunner()
    await new AlignP1Contracts1784709000000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain("'cancelled'")
    expect(sql).toContain("'failed'")
    expect(sql).toContain("'linkedin'")
  })

  it('adds normalized-domain deduplication and workflow lead evidence', async () => {
    const queryRunner = createQueryRunner()
    await new AddLeadDiscoveryLinks1784709060000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain('"normalized_domain"')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "workflow_leads"')
    expect(sql).toContain('"uq_leads_owner_normalized_domain"')
  })

  it('adds normalized P2 discovery evidence and score snapshot tables', async () => {
    const queryRunner = createQueryRunner()
    await new AddDiscoveryEvidence1784710000000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "ad_creatives"')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "shopify_stores"')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "lead_scores"')
    expect(sql).toContain('"uq_shopify_stores_run_domain"')
  })

  it('prevents duplicate score snapshots for the same lead and workflow', async () => {
    const queryRunner = createQueryRunner()
    await new AddWorkflowExecutionGuards1784711000000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain('"uq_lead_scores_lead_workflow"')
    expect(sql).toContain('WHERE "workflow_run_id" IS NOT NULL')
  })

  it('uses an upsert-compatible lead score unique index', async () => {
    const queryRunner = createQueryRunner()
    await new FixLeadScoreUniqueIndex1784711060000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain('DROP INDEX IF EXISTS "uq_lead_scores_lead_workflow"')
    expect(sql).toContain('CREATE UNIQUE INDEX "uq_lead_scores_lead_workflow"')
    expect(sql).not.toContain('WHERE "workflow_run_id" IS NOT NULL')
  })

  it('adds a leased PostgreSQL workflow job queue', async () => {
    const queryRunner = createQueryRunner()
    await new AddWorkflowJobQueue1784712000000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "workflow_jobs"')
    expect(sql).toContain('"lease_expires_at" timestamptz')
    expect(sql).toContain('"uq_workflow_jobs_workflow_run"')
    expect(sql).toContain('"idx_workflow_jobs_status_available_at"')
  })

  it('adds store and contact verification evidence', async () => {
    const queryRunner = createQueryRunner()
    await new AddDiscoveryVerificationEvidence1784713000000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain('"verification_evidence" jsonb')
    expect(sql).toContain('"contacts" jsonb')
    expect(sql).toContain('"source_url" varchar(1000)')
    expect(sql).toContain('"chk_lead_contacts_confidence"')
  })

  it('adds versioned quotation request and provider result snapshots', async () => {
    const queryRunner = createQueryRunner()
    await new AddQuotationSnapshots1784714000000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "quotations"')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "quotation_versions"')
    expect(sql).toContain('"request_snapshot" jsonb NOT NULL')
    expect(sql).toContain('"result_snapshot" jsonb')
    expect(sql).toContain('"uq_quotation_versions_quote_version"')
  })

  it('adds idempotent FOP handoff references and conflict state', async () => {
    const queryRunner = createQueryRunner()
    await new AddFopHandoffs1784715000000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "fop_handoffs"')
    expect(sql).toContain('"uq_fop_handoffs_idempotency_key"')
    expect(sql).toContain('"fop_opportunity_id" varchar(160)')
    expect(sql).toContain('"conflicts" jsonb')
  })

  it('adds reviewed outreach delivery targets and template identity', async () => {
    const queryRunner = createQueryRunner()
    await new AddOutreachDeliveryContext1784716000000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain('"target_contact" varchar(500)')
    expect(sql).toContain('"subject" varchar(200)')
    expect(sql).toContain('"template_key" varchar(80)')
  })

  it('adds correlation-aware audit events without request payloads', async () => {
    const queryRunner = createQueryRunner()
    await new AddAuditEvents1784717000000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "audit_events"')
    expect(sql).toContain('"correlation_id" varchar(80)')
    expect(sql).toContain('"idx_audit_events_actor_created_at"')
    expect(sql).not.toContain('request_body')
  })

  it('adds Shopify product, source, ranking, and Google search evidence fields', async () => {
    const queryRunner = createQueryRunner()
    await new AddShopifyProspectingEvidence1784718000000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain('"search_options" jsonb')
    expect(sql).toContain('"product_url" varchar(1000)')
    expect(sql).toContain('"discovery_sources" jsonb')
    expect(sql).toContain('"validity_score" double precision')
    expect(sql).toContain('"idx_shopify_stores_run_validity"')
  })

  it('adds six-digit user display IDs and reserves 000001 for the admin', async () => {
    const queryRunner = createQueryRunner()
    await new AddUserDisplayIds1784719000000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain('"users_display_id_seq"')
    expect(sql).toContain('"display_id" varchar(6)')
    expect(sql).toContain('"display_id" = \'000001\', "username" = \'Admin\'')
    expect(sql).toContain('"chk_users_display_id"')
    expect(sql).toContain('"uq_users_display_id"')
  })

  it('adds owner-scoped AI prompt templates and one active binding per module', async () => {
    const queryRunner = createQueryRunner()
    await new AddAiPromptTemplates1784721000000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain('CREATE TABLE "ai_prompt_templates"')
    expect(sql).toContain('CREATE TABLE "ai_prompt_bindings"')
    expect(sql).toContain('"uq_ai_prompt_templates_system_module"')
    expect(sql).toContain('"uq_ai_prompt_bindings_owner_module"')
    expect(sql).toContain('ON DELETE CASCADE')
  })

  it('adds workflow revision lineage, archive state, and deletion-safe foreign keys', async () => {
    const queryRunner = createQueryRunner()
    await new AddWorkflowRevisionLifecycle1784722000000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain('"parent_workflow_run_id" uuid')
    expect(sql).toContain('"root_workflow_run_id" uuid')
    expect(sql).toContain('"revision_no" integer NOT NULL DEFAULT 1')
    expect(sql).toContain('"archived_at" timestamptz')
    expect(sql).toContain('ON DELETE SET NULL')
    expect(sql).toContain('"chk_workflow_runs_revision_no"')
    expect(sql).toContain('"idx_workflow_runs_owner_archived_at"')
  })

  it('adds owner-scoped workflow display IDs and deterministic historical backfill', async () => {
    const queryRunner = createQueryRunner()
    await new AddOwnerScopedWorkflowDisplayIds1784727000000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain('"next_workflow_number" integer NOT NULL DEFAULT 1')
    expect(sql).toContain('PARTITION BY "owner_user_id"')
    expect(sql).toContain('ORDER BY "created_at", "id"')
    expect(sql).toContain("LPAD(ranked_workflows.sequence_number::text, 2, '0')")
    expect(sql).toContain('"uq_workflow_runs_owner_display_id"')
    expect(sql).toContain('"chk_workflow_runs_display_id"')
    expect(sql).toContain('BETWEEN 1 AND 999999')
  })

  it('adds AI outreach conversations, messages, and bilingual draft versions', async () => {
    const queryRunner = createQueryRunner()
    await new AddAiOutreachConversations1784723000000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain('CREATE TABLE "ai_outreach_conversations"')
    expect(sql).toContain('CREATE TABLE "ai_outreach_messages"')
    expect(sql).toContain('CREATE TABLE "outreach_draft_versions"')
    expect(sql).toContain('"english_message" text NOT NULL')
    expect(sql).toContain('"chinese_message" text NOT NULL')
    expect(sql).toContain('"facts_used" jsonb')
    expect(sql).toContain('"uq_ai_outreach_messages_conversation_sequence"')
    expect(sql).toContain('ON DELETE SET NULL')
  })

  it('adds owner-scoped 1688 sourcing searches, suppliers, and offers', async () => {
    const queryRunner = createQueryRunner()
    await new AddAlibaba1688Sourcing1784724000000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')

    expect(sql).toContain('CREATE TABLE "sourcing_searches"')
    expect(sql).toContain('CREATE TABLE "sourcing_suppliers"')
    expect(sql).toContain('CREATE TABLE "sourcing_offers"')
    expect(sql).toContain('"provider" = \'alibaba_1688\'')
    expect(sql).toContain('"sourcing_score" double precision')
    expect(sql).not.toContain('lead_contacts')
    expect(sql).not.toContain('lead_scores')
  })

  it('adds score-first workflow lead pool ordering', async () => {
    const queryRunner = createQueryRunner()
    await new AddLeadPoolWorkflowOrdering1784725000000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')

    expect(sql).toContain('"idx_workflow_leads_run_score_discovered"')
    expect(sql).toContain('"workflow_run_id", "source_score" DESC, "discovered_at" DESC')
  })

  it('adds the manually specified outreach channel to task and contact enums', async () => {
    const queryRunner = createQueryRunner()
    await new AddOutreachOtherChannel1784726000000().up(queryRunner)
    const sql = (queryRunner.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n')

    expect(sql).toContain('"autoflow_outreach_channel_enum"')
    expect(sql).toContain('"autoflow_lead_contact_type_enum"')
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'other'")
  })
})
