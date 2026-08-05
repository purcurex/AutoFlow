import type {
  CustomerDiscoveryStatus,
  WorkflowStatus,
  WorkflowStage,
  WorkflowStepStatus,
} from './autoflow.types'

interface CustomerDiscoveryStepState {
  stage: WorkflowStage
  status: WorkflowStepStatus
  output: Record<string, unknown> | null
}

const CUSTOMER_DISCOVERY_STAGES: WorkflowStage[] = ['ad_discovery', 'store_detection']

/**
 * 根据已持久化的客户发现步骤推导只读业务状态，避免为双模式新增数据库字段。
 * 明确的公网图片跳过原因优先级最高，使已正常结束的工作流仍能显示“客户发现待配置”。
 */
export function deriveCustomerDiscoveryStatus(
  workflowStatus: WorkflowStatus,
  steps: CustomerDiscoveryStepState[],
): CustomerDiscoveryStatus {
  const discoverySteps = steps.filter((step) => CUSTOMER_DISCOVERY_STAGES.includes(step.stage))
  if (discoverySteps.some((step) => (
    step.status === 'skipped'
    && step.output?.reasonCode === 'public_image_not_configured'
  ))) return 'pending_public_image'

  if (workflowStatus === 'failed' || discoverySteps.some((step) => step.status === 'failed')) {
    return 'failed'
  }

  const completedStages = new Set(
    discoverySteps.filter((step) => step.status === 'completed').map((step) => step.stage),
  )
  if (CUSTOMER_DISCOVERY_STAGES.every((stage) => completedStages.has(stage))) return 'completed'

  if (workflowStatus === 'running' || discoverySteps.some((step) => step.status === 'running')) {
    return 'running'
  }
  return 'not_started'
}
