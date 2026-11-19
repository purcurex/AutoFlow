import { createAutoFlowStore } from './autoflow'
import { autoflowApi } from '@/api/autoflow'
import { crmMockAutoflowApi } from '@/mocks/crm'

// Separate Pinia instance: no fixture data enters dashboard/task/follow-up stores.
export const useCrmMockStore = createAutoFlowStore('crm-mock', { ...autoflowApi, ...crmMockAutoflowApi })
