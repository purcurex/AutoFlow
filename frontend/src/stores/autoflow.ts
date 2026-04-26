import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { autoflowApi } from '@/api/autoflow'
import type {
  AutoFlowDashboard,
  CreateWorkflowRequest,
  CrmStage,
  LeadStatus,
  OutreachTask,
  StoreLead,
  WorkflowRun,
} from '@/api/autoflow'

export const useAutoFlowStore = defineStore('autoflow', () => {
  const dashboard = ref<AutoFlowDashboard | null>(null)
  const workflows = ref<WorkflowRun[]>([])
  const leads = ref<StoreLead[]>([])
  const currentLead = ref<StoreLead | null>(null)
  const outreachTasks = ref<OutreachTask[]>([])
  const crmStages = ref<CrmStage[]>([])
  const isLoading = ref(false)

  const topLeads = computed(() => [...leads.value].sort((a, b) => b.totalScore - a.totalScore).slice(0, 10))
  const readyTasks = computed(() => outreachTasks.value.filter((task) => task.status === 'ready'))

  async function fetchDashboard() {
    dashboard.value = await autoflowApi.getDashboard()
    workflows.value = dashboard.value.recentWorkflows
    leads.value = dashboard.value.topLeads
    outreachTasks.value = dashboard.value.nextTasks
    crmStages.value = dashboard.value.funnel
  }

  async function fetchWorkflows() {
    workflows.value = await autoflowApi.getWorkflows()
  }

  async function createWorkflow(data: CreateWorkflowRequest) {
    const workflow = await autoflowApi.createWorkflow(data)
    workflows.value.unshift(workflow)
    return workflow
  }

  async function fetchLeads(status?: LeadStatus) {
    leads.value = await autoflowApi.getLeads(status)
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
    outreachTasks.value = await autoflowApi.getOutreachTasks()
  }

  async function updateOutreachTask(id: string, data: Partial<OutreachTask>) {
    const task = await autoflowApi.updateOutreachTask(id, data)
    const index = outreachTasks.value.findIndex((item) => item.id === id)
    if (index !== -1) {
      outreachTasks.value[index] = task
    }
    return task
  }

  async function fetchCrm() {
    crmStages.value = await autoflowApi.getCrm()
  }

  async function loadWorkspace() {
    isLoading.value = true
    try {
      await Promise.all([fetchDashboard(), fetchWorkflows(), fetchLeads(), fetchOutreachTasks(), fetchCrm()])
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
    crmStages,
    isLoading,
    topLeads,
    readyTasks,
    fetchDashboard,
    fetchWorkflows,
    createWorkflow,
    fetchLeads,
    fetchLead,
    generateMessage,
    fetchOutreachTasks,
    updateOutreachTask,
    fetchCrm,
    loadWorkspace,
  }
})
