import type { Request as ExpressRequest } from 'express'
import type { WorkbenchAccessService } from '../users/workbench-access.service'
import type { SourcingService } from '../sourcing/sourcing.service'
import { AutoflowController } from './autoflow.controller'
import type { AutoflowService } from './autoflow.service'
import type { WorkflowSeedAssetService } from './workflow-seed-asset.service'
import type { WorkflowExecutionService } from '../discovery/workflow-execution.service'

describe('AutoflowController sourcing trigger', () => {
  const ownerUserId = 'd90f3d90-7f2b-45e7-9c8f-88fa0d915c8d'
  const sourceWorkflowId = 'e1e830d6-8efe-4f04-a031-1afdfc88a902'
  const createdWorkflowId = '22222222-2222-4222-8222-222222222222'
  const request = { user: { userId: ownerUserId } } as ExpressRequest
  const body = {
    name: 'Pet brush prospecting',
    seedType: 'keyword' as const,
    seedValue: 'pet brush',
    targetMarket: 'United States',
  }

  function createController() {
    const autoflowService = {
      createWorkflow: jest.fn().mockResolvedValue({ id: createdWorkflowId, ...body }),
      createWorkflowRevision: jest.fn().mockImplementation(
        async (_ownerUserId: string, _sourceWorkflowId: string, revisionBody: typeof body) => ({
          id: createdWorkflowId,
          ...revisionBody,
        }),
      ),
    }
    const sourcingService = { runForWorkflow: jest.fn().mockResolvedValue(undefined) }
    const controller = new AutoflowController(
      autoflowService as unknown as AutoflowService,
      {} as WorkflowExecutionService,
      {} as WorkflowSeedAssetService,
      {} as WorkbenchAccessService,
      sourcingService as unknown as SourcingService,
    )
    return { controller, autoflowService, sourcingService }
  }

  it('queues 1688 sourcing after a keyword workflow is persisted', async () => {
    const { controller, autoflowService, sourcingService } = createController()

    await expect(controller.createWorkflow(request, body)).resolves.toMatchObject({ id: createdWorkflowId })

    expect(autoflowService.createWorkflow).toHaveBeenCalledWith(ownerUserId, body)
    expect(sourcingService.runForWorkflow).toHaveBeenCalledWith(ownerUserId, createdWorkflowId)
  })

  it('queues 1688 sourcing for the newly persisted image workflow revision', async () => {
    const { controller, autoflowService, sourcingService } = createController()
    const imageBody = {
      ...body,
      seedType: 'image' as const,
      seedValue: 'https://cdn.example.com/pet-brush.png',
    }

    await expect(controller.createWorkflowRevision(request, sourceWorkflowId, imageBody))
      .resolves.toMatchObject({ id: createdWorkflowId, seedType: 'image' })

    expect(autoflowService.createWorkflowRevision).toHaveBeenCalledWith(ownerUserId, sourceWorkflowId, imageBody)
    expect(sourcingService.runForWorkflow).toHaveBeenCalledWith(ownerUserId, createdWorkflowId)
  })
})
