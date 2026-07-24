import type { LeadWorkflowDiscovery, StoreLead } from '@/api/autoflow'

export interface GroupedLeadEntry {
  lead: StoreLead
  discovery: LeadWorkflowDiscovery
}

export interface LeadWorkflowGroup {
  workflowRunId: string
  workflowDisplayId: string
  workflowName: string
  workflowCreatedAt: string
  entries: GroupedLeadEntry[]
}

const UNASSIGNED_WORKFLOW_ID = 'unassigned'

export function groupLeadsByWorkflow(leads: StoreLead[]): LeadWorkflowGroup[] {
  const groups = new Map<string, LeadWorkflowGroup>()

  for (const lead of leads) {
    const discoveries = lead.workflowDiscoveries?.length
      ? lead.workflowDiscoveries
      : [{
          workflowRunId: UNASSIGNED_WORKFLOW_ID,
          workflowDisplayId: '',
          workflowName: '',
          workflowCreatedAt: lead.createdAt,
          discoveredAt: lead.createdAt,
          score: lead.totalScore,
        }]

    for (const discovery of discoveries) {
      const group = groups.get(discovery.workflowRunId) || {
        workflowRunId: discovery.workflowRunId,
        workflowDisplayId: discovery.workflowDisplayId,
        workflowName: discovery.workflowName,
        workflowCreatedAt: discovery.workflowCreatedAt,
        entries: [],
      }
      if (!group.entries.some((entry) => entry.lead.id === lead.id)) {
        group.entries.push({ lead, discovery })
      }
      groups.set(discovery.workflowRunId, group)
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      entries: group.entries.sort((left, right) => (
        right.discovery.score - left.discovery.score
        || timestamp(right.discovery.discoveredAt) - timestamp(left.discovery.discoveredAt)
      )),
    }))
    .sort((left, right) => (
      timestamp(right.workflowCreatedAt) - timestamp(left.workflowCreatedAt)
      || left.workflowName.localeCompare(right.workflowName)
    ))
}

function timestamp(value: string): number {
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}
