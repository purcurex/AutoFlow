import { randomUUID } from 'crypto'
import { hostname } from 'os'
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, Repository } from 'typeorm'
import { WorkflowJobEntity } from '../autoflow/entities'
import { WorkflowExecutionService } from './workflow-execution.service'

interface ClaimedWorkflowJob {
  id: string
  workflow_run_id: string
  owner_user_id: string
  attempts: number
  max_attempts: number
}

@Injectable()
export class WorkflowJobWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkflowJobWorkerService.name)
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID()}`
  private readonly pollIntervalMs: number
  private readonly leaseDurationMs: number
  private pollingTimer: NodeJS.Timeout | null = null
  private draining = false
  private shuttingDown = false

  constructor(
    @InjectRepository(WorkflowJobEntity)
    private readonly jobRepository: Repository<WorkflowJobEntity>,
    private readonly executionService: WorkflowExecutionService,
    private readonly dataSource: DataSource,
    configService: ConfigService,
  ) {
    this.pollIntervalMs = this.readPositiveInt(
      configService.get('WORKFLOW_JOB_POLL_INTERVAL_MS'),
      500,
    )
    this.leaseDurationMs = this.readPositiveInt(
      configService.get('WORKFLOW_JOB_LEASE_DURATION_MS'),
      30_000,
    )
  }

  onApplicationBootstrap(): void {
    this.pollingTimer = setInterval(() => void this.drain(), this.pollIntervalMs)
    this.pollingTimer.unref()
    void this.drain()
  }

  onApplicationShutdown(): void {
    this.shuttingDown = true
    if (this.pollingTimer) clearInterval(this.pollingTimer)
    this.pollingTimer = null
  }

  async runNextJob(): Promise<boolean> {
    await this.failExhaustedLeases()
    const job = await this.claimNextJob()
    if (!job) return false

    const heartbeatTimer = setInterval(
      () => void this.extendLease(job.id),
      Math.max(1_000, Math.floor(this.leaseDurationMs / 3)),
    )
    heartbeatTimer.unref()

    try {
      await this.executionService.executeQueuedDiscovery(job.owner_user_id, job.workflow_run_id)
      await this.jobRepository.update(
        { id: job.id, status: 'running', leaseOwner: this.workerId },
        {
          status: 'completed',
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: new Date(),
          lastError: null,
          completedAt: new Date(),
        },
      )
    } catch (error: unknown) {
      await this.handleFailure(job, error)
    } finally {
      clearInterval(heartbeatTimer)
    }

    return true
  }

  private async drain(): Promise<void> {
    if (this.draining || this.shuttingDown) return
    this.draining = true
    try {
      while (!this.shuttingDown && await this.runNextJob()) {
        // Drain all currently available work with one concurrent job per application instance.
      }
    } catch (error: unknown) {
      this.logger.error('Workflow queue polling failed', error)
    } finally {
      this.draining = false
    }
  }

  private async claimNextJob(): Promise<ClaimedWorkflowJob | null> {
    return this.dataSource.transaction(async (manager) => {
      const result = await manager.query(`
        WITH candidate AS (
          SELECT "id"
          FROM "workflow_jobs"
          WHERE (
            ("status" = 'queued' AND "available_at" <= now())
            OR ("status" = 'running' AND "lease_expires_at" < now())
          )
          AND "attempts" < "max_attempts"
          ORDER BY "available_at" ASC, "created_at" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "workflow_jobs" AS job
        SET
          "status" = 'running',
          "attempts" = job."attempts" + 1,
          "lease_owner" = $1,
          "lease_expires_at" = now() + ($2 * interval '1 millisecond'),
          "heartbeat_at" = now(),
          "updated_at" = now()
        FROM candidate
        WHERE job."id" = candidate."id"
        RETURNING job."id", job."workflow_run_id", job."owner_user_id", job."attempts", job."max_attempts"
      `, [this.workerId, this.leaseDurationMs]) as unknown
      const rows = this.unwrapRows<ClaimedWorkflowJob>(result)

      return rows[0] || null
    })
  }

  private async extendLease(jobId: string): Promise<void> {
    try {
      await this.jobRepository.update(
        { id: jobId, status: 'running', leaseOwner: this.workerId },
        {
          heartbeatAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + this.leaseDurationMs),
        },
      )
    } catch (error: unknown) {
      this.logger.warn(`Could not extend workflow job lease ${jobId}: ${this.errorMessage(error)}`)
    }
  }

  private async handleFailure(job: ClaimedWorkflowJob, error: unknown): Promise<void> {
    const lastError = this.errorMessage(error).slice(0, 4000)
    const exhausted = job.attempts >= job.max_attempts
    const retryDelayMs = Math.min(60_000, 1_000 * (2 ** Math.max(0, job.attempts - 1)))

    await this.jobRepository.update(
      { id: job.id, status: 'running', leaseOwner: this.workerId },
      exhausted
        ? {
            status: 'failed',
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: new Date(),
            lastError,
            completedAt: new Date(),
          }
        : {
            status: 'queued',
            availableAt: new Date(Date.now() + retryDelayMs),
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: new Date(),
            lastError,
            completedAt: null,
          },
    )
    this.logger.warn(
      `Workflow job ${job.id} ${exhausted ? 'failed permanently' : 'scheduled for retry'}: ${lastError}`,
    )
  }

  private async failExhaustedLeases(): Promise<void> {
    await this.dataSource.query(`
      WITH exhausted AS (
        UPDATE "workflow_jobs"
        SET
          "status" = 'failed',
          "lease_owner" = NULL,
          "lease_expires_at" = NULL,
          "last_error" = COALESCE("last_error", 'Worker lease expired after maximum attempts'),
          "completed_at" = now(),
          "updated_at" = now()
        WHERE "status" = 'running'
          AND "lease_expires_at" < now()
          AND "attempts" >= "max_attempts"
        RETURNING "workflow_run_id"
      )
      UPDATE "workflow_runs" AS workflow
      SET "status" = 'failed', "completed_at" = now(), "updated_at" = now()
      FROM exhausted
      WHERE workflow."id" = exhausted."workflow_run_id"
        AND workflow."status" = 'running'
    `)
  }

  private readPositiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || 'Unknown workflow execution error')
  }

  private unwrapRows<T>(result: unknown): T[] {
    if (!Array.isArray(result)) return []
    return Array.isArray(result[0]) ? result[0] as T[] : result as T[]
  }
}
