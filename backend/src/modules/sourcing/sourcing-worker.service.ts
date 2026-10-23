import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { randomUUID } from 'crypto'
import { hostname } from 'os'
import { DataSource, Repository } from 'typeorm'
import { SourcingSearchEntity, SourcingSearchPageEntity } from './entities'
import { normalizeSourcingExecutionError } from './sourcing-error-policy'
import {
  SourcingPageExecutorService,
  type ClaimedSourcingPage,
} from './sourcing-page-executor.service'

export const SOURCING_WORKER_ID = Symbol('SOURCING_WORKER_ID')

interface ClaimedPageRow {
  id: string
  search_id: string
  workflow_run_id: string
  owner_user_id: string
  page_number: number
  page_size: number
  attempts: number
  max_attempts: number
  lease_owner: string
}

/** 数据库租约Worker：单实例串行领取，多个实例通过SKIP LOCKED安全并行。 */
@Injectable()
export class SourcingWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SourcingWorkerService.name)
  private readonly workerId: string
  private readonly pollIntervalMs: number
  private readonly leaseDurationMs: number
  private pollTimer: NodeJS.Timeout | null = null
  private polling = false

  constructor(
    @InjectRepository(SourcingSearchPageEntity)
    private readonly pageRepository: Repository<SourcingSearchPageEntity>,
    @InjectRepository(SourcingSearchEntity)
    private readonly searchRepository: Repository<SourcingSearchEntity>,
    private readonly executor: SourcingPageExecutorService,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    @Optional() @Inject(SOURCING_WORKER_ID) workerId?: string,
  ) {
    this.workerId = workerId || `${hostname()}:${process.pid}:${randomUUID()}`
    this.pollIntervalMs = this.positiveConfig('SOURCING_JOB_POLL_INTERVAL_MS', 500)
    this.leaseDurationMs = this.positiveConfig('SOURCING_JOB_LEASE_DURATION_MS', 30_000)
  }

  onModuleInit(): void {
    this.pollTimer = setInterval(() => void this.drainAvailablePages(), this.pollIntervalMs)
    this.pollTimer.unref()
    void this.drainAvailablePages()
  }

  onModuleDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  async runNextPage(): Promise<boolean> {
    const page = await this.claimPage()
    if (!page) return false
    const heartbeat = setInterval(
      () => void this.extendLease(page),
      Math.max(1_000, Math.floor(this.leaseDurationMs / 3)),
    )
    heartbeat.unref()
    try {
      await this.executor.executePage(page)
    } catch (error) {
      await this.handleFailure(page, error)
    } finally {
      clearInterval(heartbeat)
    }
    return true
  }

  private async drainAvailablePages(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      while (await this.runNextPage()) {
        // 单实例逐页处理；数据库租约允许多个应用实例安全并行。
      }
    } catch (error) {
      this.logger.error(
        `Sourcing worker poll failed: ${error instanceof Error ? error.message : 'unknown'}`,
      )
    } finally {
      this.polling = false
    }
  }

  private async claimPage(): Promise<ClaimedSourcingPage | null> {
    const rows = await this.dataSource.transaction((manager) => manager.query<ClaimedPageRow[]>(`
      WITH candidate AS (
        SELECT page."id", search."workflow_run_id"
        FROM "sourcing_search_pages" page
        INNER JOIN "sourcing_searches" search ON search."id" = page."search_id"
        WHERE (
          (page."status" = 'pending' AND page."available_at" <= now())
          OR (page."status" = 'running' AND page."lease_expires_at" < now())
        )
          AND page."attempts" < page."max_attempts"
        ORDER BY page."available_at", page."created_at"
        FOR UPDATE OF page SKIP LOCKED
        LIMIT 1
      ), claimed AS (
        UPDATE "sourcing_search_pages" page
        SET "status" = 'running',
            "attempts" = page."attempts" + 1,
            "lease_owner" = $1,
            "lease_expires_at" = now() + ($2::integer * interval '1 millisecond'),
            "heartbeat_at" = now(),
            "started_at" = COALESCE(page."started_at", now()),
            "updated_at" = now()
        FROM candidate
        WHERE page."id" = candidate."id"
        RETURNING page.*, candidate."workflow_run_id"
      )
      SELECT * FROM claimed
    `, [this.workerId, this.leaseDurationMs]))
    const row = rows[0]
    return row ? {
      id: row.id,
      searchId: row.search_id,
      workflowRunId: row.workflow_run_id,
      ownerUserId: row.owner_user_id,
      pageNumber: Number(row.page_number),
      pageSize: Number(row.page_size),
      attempts: Number(row.attempts),
      maxAttempts: Number(row.max_attempts),
      leaseOwner: row.lease_owner,
    } : null
  }

  private async extendLease(page: ClaimedSourcingPage): Promise<void> {
    const now = new Date()
    await this.pageRepository.update(
      { id: page.id, status: 'running', leaseOwner: page.leaseOwner },
      { heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + this.leaseDurationMs) },
    )
  }

  private async handleFailure(page: ClaimedSourcingPage, error: unknown): Promise<void> {
    const failure = normalizeSourcingExecutionError(error)
    const exhausted = !failure.retryable || page.attempts >= page.maxAttempts
    if (!exhausted) {
      const baseDelayMs = page.attempts <= 1 ? 1_000 : 3_000
      const delayMs = failure.retryAfterMs === null
        ? baseDelayMs
        : Math.min(60_000, Math.max(baseDelayMs, failure.retryAfterMs))
      await this.pageRepository.update(
        { id: page.id, status: 'running', leaseOwner: page.leaseOwner },
        {
          status: 'pending',
          availableAt: new Date(Date.now() + delayMs),
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          errorCode: failure.code,
          errorMessage: failure.message,
        },
      )
      return
    }

    const failedPageUpdate = await this.pageRepository.update(
      { id: page.id, status: 'running', leaseOwner: page.leaseOwner },
      {
        status: 'failed',
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        errorCode: failure.code,
        errorMessage: failure.message,
        completedAt: new Date(),
      },
    )
    // 租约已被其他实例接管时，旧 Worker 不得覆盖新 Worker 正在维护的搜索状态。
    if (failedPageUpdate.affected !== 1) return
    const succeededPages = await this.pageRepository.count({
      where: { searchId: page.searchId, ownerUserId: page.ownerUserId, status: 'succeeded' },
    })
    await this.searchRepository.update(
      { id: page.searchId, ownerUserId: page.ownerUserId },
      {
        status: succeededPages > 0 ? 'partial' : 'failed',
        errorCode: failure.code,
        errorMessage: failure.message,
        completedAt: new Date(),
      },
    )
  }

  private positiveConfig(key: string, fallback: number): number {
    const value = Number(this.configService.get<string | number>(key, fallback))
    return Number.isInteger(value) && value > 0 ? value : fallback
  }
}
