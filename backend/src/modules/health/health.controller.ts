import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common'
import { DataSource } from 'typeorm'

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name)

  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async check() {
    try {
      await this.dataSource.query('SELECT 1')
      const queueRows = await this.dataSource.query(`
        SELECT "status", count(*)::int AS "count"
        FROM "workflow_jobs"
        GROUP BY "status"
      `) as Array<{ status: string; count: number }>
      const staleRows = await this.dataSource.query(`
        SELECT count(*)::int AS "count"
        FROM "workflow_jobs"
        WHERE "status" = 'running' AND "lease_expires_at" < now()
      `) as Array<{ count: number }>
      const workflowQueue = Object.fromEntries(queueRows.map((row) => [row.status, row.count]))
      workflowQueue.stale = staleRows[0]?.count || 0
      if ((workflowQueue.failed || 0) > 0 || workflowQueue.stale > 0) {
        this.logger.warn(`Workflow queue requires attention: ${JSON.stringify(workflowQueue)}`)
      }
      return {
        status: 'ok',
        database: 'up',
        workflowQueue,
        timestamp: new Date().toISOString(),
      }
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' })
    }
  }
}
