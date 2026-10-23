import type { DataSource, ObjectLiteral, Repository } from 'typeorm'
import {
  WorkflowRunEntity,
  WorkflowStepEntity,
} from '../autoflow/entities'
import type { SourcingService } from '../sourcing/sourcing.service'
import type { DiscoveryService } from './discovery.service'
import { WorkflowExecutionService } from './workflow-execution.service'

describe('WorkflowExecutionService customer discovery modes', () => {
  function repository<T extends ObjectLiteral>() {
    return {
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as jest.Mocked<Repository<T>>
  }

  function createService() {
    const workflows = repository<WorkflowRunEntity>()
    const steps = repository<WorkflowStepEntity>()
    steps.find.mockResolvedValue([])
    workflows.findOne.mockResolvedValue({
      id: 'workflow-image',
      ownerUserId: 'owner-1',
      seedType: 'image',
      seedValue: 'http://localhost:3000/uploads/workflow-seeds/owner-1/product.jpg',
      status: 'running',
    } as WorkflowRunEntity)
    const discoveryService = {
      discoverEvidence: jest.fn().mockResolvedValue({
        status: 'skipped',
        reasonCode: 'public_image_not_configured',
        reason: 'Public image URL is not configured; customer discovery was skipped.',
        evidence: {
          workflowRunId: 'workflow-image',
          ads: [],
          stores: [],
          candidates: [],
        },
      }),
      getPersistedEvidence: jest.fn(),
    } as unknown as jest.Mocked<DiscoveryService>
    const sourcingService = {
      runForWorkflow: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SourcingService>
    const dataSource = {
      transaction: jest.fn(),
    } as unknown as jest.Mocked<DataSource>
    const service = new WorkflowExecutionService(
      workflows,
      steps,
      discoveryService,
      sourcingService,
      dataSource,
    )
    return { service, workflows, steps, discoveryService, sourcingService, dataSource }
  }

  it('starts 1688 sourcing and completes the workflow when local-image customer discovery is skipped', async () => {
    const {
      service,
      workflows,
      steps,
      discoveryService,
      sourcingService,
      dataSource,
    } = createService()

    await service.executeQueuedDiscovery('owner-1', 'workflow-image')

    expect(sourcingService.runForWorkflow).toHaveBeenCalledWith('owner-1', 'workflow-image')
    expect(sourcingService.runForWorkflow.mock.invocationCallOrder[0])
      .toBeLessThan(discoveryService.discoverEvidence.mock.invocationCallOrder[0])
    expect(steps.update).toHaveBeenCalledWith(
      expect.objectContaining({ workflowRunId: 'workflow-image' }),
      expect.objectContaining({
        status: 'skipped',
        output: {
          reasonCode: 'public_image_not_configured',
          reason: 'Public image URL is not configured; customer discovery was skipped.',
        },
        errorMessage: null,
      }),
    )
    expect(workflows.update).toHaveBeenLastCalledWith(
      { id: 'workflow-image', ownerUserId: 'owner-1' },
      expect.objectContaining({
        status: 'completed',
        currentStage: 'lead_scoring',
        progress: 100,
        leadCount: 0,
      }),
    )
    expect(dataSource.transaction).not.toHaveBeenCalled()
  })
})
