import type { ConfigService } from '@nestjs/config'
import type { DataSource, EntityManager, ObjectLiteral, Repository } from 'typeorm'
import {
  SourcingSearchEntity,
  SourcingSearchPageEntity,
} from './entities'
import type { SourcingPageExecutorService } from './sourcing-page-executor.service'
import { SourcingWorkerService } from './sourcing-worker.service'

describe('SourcingWorkerService', () => {
  function repository<T extends ObjectLiteral>() {
    return {
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as jest.Mocked<Repository<T>>
  }

  function setup(executionError?: Error) {
    const pages = repository<SourcingSearchPageEntity>()
    const searches = repository<SourcingSearchEntity>()
    const claimed = {
      id: 'page-1',
      search_id: 'search-1',
      workflow_run_id: 'workflow-1',
      owner_user_id: 'owner-1',
      page_number: 1,
      page_size: 20,
      attempts: 1,
      max_attempts: 3,
      lease_owner: 'worker-test',
    }
    const manager = {
      query: jest.fn().mockResolvedValue([claimed]),
    } as unknown as EntityManager
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    } as unknown as jest.Mocked<DataSource>
    const executor = {
      executePage: executionError
        ? jest.fn().mockRejectedValue(executionError)
        : jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SourcingPageExecutorService>
    const config = {
      get: jest.fn((_key: string, fallback?: unknown) => fallback),
    } as unknown as ConfigService
    const worker = new SourcingWorkerService(
      pages,
      searches,
      executor,
      dataSource,
      config,
      'worker-test',
    )
    return { worker, pages, searches, executor, manager }
  }

  it('atomically claims with SKIP LOCKED and executes the leased page', async () => {
    const { worker, executor, manager } = setup()

    await expect(worker.runNextPage()).resolves.toBe(true)

    const claimSql = (manager.query as jest.Mock).mock.calls[0][0]
    expect(claimSql).toContain('FOR UPDATE OF page SKIP LOCKED')
    expect(claimSql).toContain('lease_owner')
    expect(executor.executePage).toHaveBeenCalledWith(expect.objectContaining({
      id: 'page-1', leaseOwner: 'worker-test', attempts: 1,
    }))
  })

  it('returns a retryable failure to pending under the same lease', async () => {
    const timeout = Object.assign(new Error('timeout'), { code: 'PROVIDER_TIMEOUT', retryable: true })
    const { worker, pages } = setup(timeout)

    await worker.runNextPage()

    expect(pages.update).toHaveBeenCalledWith(
      { id: 'page-1', status: 'running', leaseOwner: 'worker-test' },
      expect.objectContaining({
        status: 'pending',
        availableAt: expect.any(Date),
        errorCode: 'PROVIDER_TIMEOUT',
      }),
    )
  })
})
