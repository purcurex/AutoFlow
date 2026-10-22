import { assertCurrentSession, captureSession, isCurrentSession, onSessionReset } from '@/utils/session'
import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import { autoflowApi } from '@/api/autoflow'
import type {
  AutoFlowDashboard,
  CreateWorkflowRequest,
  FollowUpStage,
  LeadStatus,
  GenerateMessageRequest,
  OutreachTask,
  StoreLead,
  UpdateOutreachTaskRequest,
  WorkflowRun,
} from '@/api/autoflow'

export const useAutoFlowStore = defineStore('autoflow', () => {
  const dashboard = ref<AutoFlowDashboard | null>(null)
  const workflows = ref<WorkflowRun[]>([])
  const leads = ref<StoreLead[]>([])
  const currentLead = ref<StoreLead | null>(null)
  const outreachTasks = ref<OutreachTask[]>([])
  const followUpStages = ref<FollowUpStage[]>([])
  const isLoading = ref(false)

  onScopeDispose(onSessionReset(() => {
    dashboard.value = null
    workflows.value = []
    leads.value = []
    currentLead.value = null
    outreachTasks.value = []
    followUpStages.value = []
    isLoading.value = false
  }))

  const topLeads = computed(() => [...leads.value].sort((a, b) => b.totalScore - a.totalScore).slice(0, 10))
  const readyTasks = computed(() => outreachTasks.value.filter((task) => task.status === 'ready'))

  async function fetchDashboard() {
    const session = captureSession()
    const response = await autoflowApi.getDashboard()
    assertCurrentSession(session)
    dashboard.value = response
    workflows.value = dashboard.value.recentWorkflows
    leads.value = dashboard.value.topLeads
    outreachTasks.value = dashboard.value.nextTasks
    followUpStages.value = dashboard.value.funnel
  }

  async function fetchWorkflows() {
    const session = captureSession()
    const result = await autoflowApi.getWorkflows()
    assertCurrentSession(session)
    workflows.value = result.items
  }

  async function createWorkflow(data: CreateWorkflowRequest) {
    const session = captureSession()
    const workflow = await autoflowApi.createWorkflow(data)
    assertCurrentSession(session)
    workflows.value.unshift(workflow)
    return workflow
  }

  async function getWorkflow(id: string) {
    const session = captureSession()
    const result = await autoflowApi.getWorkflow(id)
    assertCurrentSession(session)
    return result
  }

  async function reviseWorkflow(id: string, data: CreateWorkflowRequest) {
    const session = captureSession()
    const workflow = await autoflowApi.createWorkflowRevision(id, data)
    assertCurrentSession(session)
    workflows.value.unshift(workflow)
    return workflow
  }

  async function deleteWorkflow(id: string) {
    const session = captureSession()
    const result = await autoflowApi.deleteWorkflow(id)
    assertCurrentSession(session)
    workflows.value = workflows.value.filter((item) => item.id !== id)
    return result
  }

  async function archiveWorkflow(id: string) {
    const session = captureSession()
    const workflow = await autoflowApi.archiveWorkflow(id)
    assertCurrentSession(session)
    workflows.value = workflows.value.filter((item) => item.id !== id)
    return workflow
  }

  async function startDiscovery(id: string) {
    const session = captureSession()
    const result = await autoflowApi.startDiscovery(id)
    assertCurrentSession(session)
    const workflow = workflows.value.find((item) => item.id === id)
    if (workflow) {
      workflow.status = 'running'
      workflow.currentStage = 'ad_discovery'
      workflow.progress = Math.max(workflow.progress, 10)
    }
    return result
  }

  async function fetchLeads(status?: LeadStatus) {
    const session = captureSession()
    const firstPage = await autoflowApi.getLeads(status, 1, 100)
    assertCurrentSession(session)
    const items = [...firstPage.items]
    let page = 2
    while (items.length < firstPage.total) {
      const nextPage = await autoflowApi.getLeads(status, page, 100)
      assertCurrentSession(session)
      if (!nextPage.items.length) break
      items.push(...nextPage.items)
      page += 1
    }
    leads.value = items
  }

  async function fetchLead(id: string) {
    const session = captureSession()
    const response = await autoflowApi.getLead(id)
    assertCurrentSession(session)
    currentLead.value = response
    return currentLead.value
  }

  async function analyzeLeadContacts(id: string) {
    const session = captureSession()
    const response = await autoflowApi.analyzeLeadContacts(id)
    assertCurrentSession(session)
    currentLead.value = response
    return currentLead.value
  }

  async function generateMessage(id: string, data: GenerateMessageRequest) {
    const session = captureSession()
    const task = await autoflowApi.generateMessage(id, data)
    assertCurrentSession(session)
    outreachTasks.value.unshift(task)
    return task
  }

  async function fetchOutreachTasks() {
    const session = captureSession()
    const result = await autoflowApi.getOutreachTasks()
    assertCurrentSession(session)
    outreachTasks.value = result.items
  }

  async function updateOutreachTask(id: string, data: UpdateOutreachTaskRequest) {
    const session = captureSession()
    const task = await autoflowApi.updateOutreachTask(id, data)
    assertCurrentSession(session)
    const index = outreachTasks.value.findIndex((item) => item.id === id)
    if (index !== -1) {
      outreachTasks.value[index] = task
    }
    return task
  }

  async function fetchFollowUps() {
    const session = captureSession()
    const response = await autoflowApi.getFollowUps()
    assertCurrentSession(session)
    followUpStages.value = response
  }

  async function loadWorkspace() {
    const session = captureSession()
    isLoading.value = true
    try {
      await Promise.all([fetchDashboard(), fetchWorkflows(), fetchLeads(), fetchOutreachTasks(), fetchFollowUps()])
      assertCurrentSession(session)
    } finally {
      if (isCurrentSession(session)) isLoading.value = false
    }
  }

  return {
    dashboard,
    workflows,
    leads,
    currentLead,
    outreachTasks,
    followUpStages,
    isLoading,
    topLeads,
    readyTasks,
    fetchDashboard,
    fetchWorkflows,
    createWorkflow,
    getWorkflow,
    reviseWorkflow,
    deleteWorkflow,
    archiveWorkflow,
    startDiscovery,
    fetchLeads,
    fetchLead,
    analyzeLeadContacts,
    generateMessage,
    fetchOutreachTasks,
    updateOutreachTask,
    fetchFollowUps,
    loadWorkspace,
  }
})
