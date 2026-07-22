import type { QueryRunner } from 'typeorm'
import { AddAutoFlowCoreEntities1784700060000 } from '../migrations/1784700060000-AddAutoFlowCoreEntities'
import { AlignP1Contracts1784709000000 } from '../migrations/1784709000000-AlignP1Contracts'
import { AddLeadDiscoveryLinks1784709060000 } from '../migrations/1784709060000-AddLeadDiscoveryLinks'
import { AddDiscoveryEvidence1784710000000 } from '../migrations/1784710000000-AddDiscoveryEvidence'
import { AddWorkflowExecutionGuards1784711000000 } from '../migrations/1784711000000-AddWorkflowExecutionGuards'
import { FixLeadScoreUniqueIndex1784711060000 } from '../migrations/1784711060000-FixLeadScoreUniqueIndex'

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
})
