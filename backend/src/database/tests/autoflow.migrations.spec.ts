import type { QueryRunner } from 'typeorm'
import { AddAutoFlowCoreEntities1784700060000 } from '../migrations/1784700060000-AddAutoFlowCoreEntities'

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
