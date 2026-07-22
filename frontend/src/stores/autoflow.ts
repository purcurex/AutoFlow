import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { autoflowApi } from '@/api/autoflow'
import type {
  AutoFlowDashboard,
  CreateWorkflowRequest,
  FollowUpStage,
  LeadStatus,
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
    const result = await autoflowApi.getLeads(status)
    leads.value = result.items
  }

  async function fetchLead(id: string) {
    currentLead.value = await autoflowApi.getLead(id)
    return currentLead.value
  }

  async function generateMessage(id: string) {
    const task = await autoflowApi.generateMessage(id, { channel: 'whatsapp' })
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
    startDiscovery,
    fetchLeads,
    fetchLead,
    generateMessage,
    fetchOutreachTasks,
    updateOutreachTask,
    fetchFollowUps,
    loadWorkspace,
  }
})
