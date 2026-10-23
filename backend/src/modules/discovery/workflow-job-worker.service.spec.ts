import { BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { DataSource, Repository } from 'typeorm'
import type { WorkflowJobEntity } from '../autoflow/entities'
import type { WorkflowExecutionService } from './workflow-execution.service'
import { WorkflowJobWorkerService } from './workflow-job-worker.service'

describe('WorkflowJobWorkerService', () => {
  function createSubject(claimed: Record<string, unknown> | null) {
    const jobRepository = { update: jest.fn().mockResolvedValue({ affected: 1 }) }
    const executionService = { executeQueuedDiscovery: jest.fn().mockResolvedValue(undefined) }
    const manager = { query: jest.fn().mockResolvedValue(claimed ? [[claimed], 1] : [[], 0]) }
    const dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn().mockImplementation((callback) => callback(manager)),
    }
    const configService = { get: jest.fn().mockReturnValue(undefined) }
    const service = new WorkflowJobWorkerService(
      jobRepository as unknown as Repository<WorkflowJobEntity>,
      executionService as unknown as WorkflowExecutionService,
      dataSource as unknown as DataSource,
      configService as unknown as ConfigService,
    )
    return { service, jobRepository, executionService, dataSource, manager }
  }

  it('claims and completes an available workflow job', async () => {
    const claimed = {
      id: 'job-1',
      workflow_run_id: 'workflow-1',
      owner_user_id: 'owner-1',
      attempts: 1,
      max_attempts: 3,
    }
    const { service, jobRepository, executionService, manager } = createSubject(claimed)

    await expect(service.runNextJob()).resolves.toBe(true)

    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE SKIP LOCKED'), expect.any(Array))
    expect(executionService.executeQueuedDiscovery).toHaveBeenCalledWith('owner-1', 'workflow-1')
    expect(jobRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-1', status: 'running' }),
      expect.objectContaining({ status: 'completed', completedAt: expect.any(Date) }),
    )
  })

  it('returns an unsuccessful job to the queue while retry budget remains', async () => {
    const claimed = {
      id: 'job-2',
      workflow_run_id: 'workflow-2',
      owner_user_id: 'owner-2',
      attempts: 1,
      max_attempts: 3,
    }
    const { service, jobRepository, executionService } = createSubject(claimed)
    executionService.executeQueuedDiscovery.mockRejectedValueOnce(new Error('provider timeout'))

    await expect(service.runNextJob()).resolves.toBe(true)

    expect(jobRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-2', status: 'running' }),
      expect.objectContaining({ status: 'queued', lastError: 'provider timeout', availableAt: expect.any(Date) }),
    )
  })

  it('fails a deterministic image input error without consuming the remaining retry budget', async () => {
    const claimed = {
      id: 'job-image',
      workflow_run_id: 'workflow-image',
      owner_user_id: 'owner-image',
      attempts: 1,
      max_attempts: 3,
    }
    const { service, jobRepository, executionService } = createSubject(claimed)
    executionService.executeQueuedDiscovery.mockRejectedValueOnce(
      new BadRequestException('PipiAds product image fetch failed.'),
    )

    await expect(service.runNextJob()).resolves.toBe(true)

    expect(jobRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-image', status: 'running' }),
      expect.objectContaining({
        status: 'failed',
        lastError: 'PipiAds product image fetch failed.',
        completedAt: expect.any(Date),
      }),
    )
    expect(jobRepository.update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'queued' }),
    )
  })
})
