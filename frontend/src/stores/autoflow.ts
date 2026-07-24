import { computed, ref } from 'vue'
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

  const topLeads = computed(() => [...leads.value].sort((a, b) => b.totalScore - a.totalScore).slice(0, 10))
  const readyTasks = computed(() => outreachTasks.value.filter((task) => task.status === 'ready'))

  async function fetchDashboard() {
    dashboard.value = await autoflowApi.getDashboard()
    workflows.value = dashboard.value.recentWorkflows
    leads.value = dashboard.value.topLeads
    outreachTasks.value = dashboard.value.nextTasks
    followUpStages.value = dashboard.value.funnel
  }

  async function fetchWorkflows() {
    const result = await autoflowApi.getWorkflows()
    workflows.value = result.items
  }

  async function createWorkflow(data: CreateWorkflowRequest) {
    const workflow = await autoflowApi.createWorkflow(data)
    workflows.value.unshift(workflow)
    return workflow
  }

  async function getWorkflow(id: string) {
    return autoflowApi.getWorkflow(id)
  }

  async function reviseWorkflow(id: string, data: CreateWorkflowRequest) {
    const workflow = await autoflowApi.createWorkflowRevision(id, data)
    workflows.value.unshift(workflow)
    return workflow
  }

  async function deleteWorkflow(id: string) {
    const result = await autoflowApi.deleteWorkflow(id)
    workflows.value = workflows.value.filter((item) => item.id !== id)
    return result
  }

  async function archiveWorkflow(id: string) {
    const workflow = await autoflowApi.archiveWorkflow(id)
    workflows.value = workflows.value.filter((item) => item.id !== id)
    return workflow
  }

  async function startDiscovery(id: string) {
    const result = await autoflowApi.startDiscovery(id)
    const workflow = workflows.value.find((item) => item.id === id)
    if (workflow) {
      workflow.status = 'running'
      workflow.currentStage = 'ad_discovery'
      workflow.progress = Math.max(workflow.progress, 10)
    }
    return result
  }

  async function fetchLeads(status?: LeadStatus) {
    const firstPage = await autoflowApi.getLeads(status, 1, 100)
    const items = [...firstPage.items]
    let page = 2
    while (items.length < firstPage.total) {
      const nextPage = await autoflowApi.getLeads(status, page, 100)
      if (!nextPage.items.length) break
      items.push(...nextPage.items)
      page += 1
    }
    leads.value = items
  }

  async function fetchLead(id: string) {
    currentLead.value = await autoflowApi.getLead(id)
    return currentLead.value
  }

  async function analyzeLeadContacts(id: string) {
    currentLead.value = await autoflowApi.analyzeLeadContacts(id)
    return currentLead.value
  }

  async function generateMessage(id: string, data: GenerateMessageRequest) {
    const task = await autoflowApi.generateMessage(id, data)
    outreachTasks.value.unshift(task)
    return task
  }

  async function fetchOutreachTasks() {
    const result = await autoflowApi.getOutreachTasks()
    outreachTasks.value = result.items
  }

  async function updateOutreachTask(id: string, data: UpdateOutreachTaskRequest) {
    const task = await autoflowApi.updateOutreachTask(id, data)
    const index = outreachTasks.value.findIndex((item) => item.id === id)
    if (index !== -1) {
      outreachTasks.value[index] = task
    }
    return task
  }

  async function fetchFollowUps() {
    followUpStages.value = await autoflowApi.getFollowUps()
  }

  async function loadWorkspace() {
    isLoading.value = true
    try {
      await Promise.all([fetchDashboard(), fetchWorkflows(), fetchLeads(), fetchOutreachTasks(), fetchFollowUps()])
    } finally {
      isLoading.value = false
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
