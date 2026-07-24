import type { WorkflowStatus } from '@/api/autoflow'

export function canReviseWorkflow(status: WorkflowStatus): boolean {
  return ['failed', 'cancelled', 'completed'].includes(status)
}

export function canDeleteWorkflow(status: WorkflowStatus): boolean {
  return ['draft', 'failed', 'cancelled'].includes(status)
}

export function canArchiveWorkflow(status: WorkflowStatus): boolean {
  return status !== 'running'
}
