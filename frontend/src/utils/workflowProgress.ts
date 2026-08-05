import type { CustomerDiscoveryStatus } from '@/api/autoflow'

interface WorkflowProgressSource {
  progress: number
  customerDiscoveryStatus: CustomerDiscoveryStatus
}

export interface WorkflowProgressDisplay {
  percent: number
  labelKey: 'workflows.progressPendingConfiguration' | 'workflows.progressPercent'
  labelParams?: { progress: number }
}

/**
 * 将后端编排进度转换为页面展示模型。
 * 客户发现因公网图片未配置而跳过时，不能用编排已处理完成的100%冒充客户发现完成度。
 */
export function workflowProgressDisplay(workflow: WorkflowProgressSource): WorkflowProgressDisplay {
  if (workflow.customerDiscoveryStatus === 'pending_public_image') {
    return {
      percent: 0,
      labelKey: 'workflows.progressPendingConfiguration',
    }
  }

  const percent = Math.min(100, Math.max(0, workflow.progress))
  return {
    percent,
    labelKey: 'workflows.progressPercent',
    labelParams: { progress: percent },
  }
}

