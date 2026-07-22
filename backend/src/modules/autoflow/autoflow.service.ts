import { Injectable, NotFoundException } from '@nestjs/common'
import type { CreateWorkflowDto, GenerateMessageDto, UpdateOutreachTaskDto } from './dto/autoflow.dto'
import {
  AutoFlowDashboard,
  LeadStatus,
  OutreachTask,
  StoreLead,
  WorkflowRun,
} from './autoflow.types'

@Injectable()
export class AutoflowService {
  private workflows: WorkflowRun[] = [
    {
      id: 'wf-001',
      name: 'Pet grooming brush prospects',
      seedType: 'keyword',
      seedValue: 'pet grooming brush',
      targetMarket: 'United States',
      status: 'completed',
      currentStage: 'crm',
      progress: 100,
      leadCount: 42,
      createdAt: '2026-04-24T10:30:00.000Z',
      updatedAt: '2026-04-24T11:10:00.000Z',
    },
    {
      id: 'wf-002',
      name: 'Portable blender image scan',
      seedType: 'image',
      seedValue: 'https://example.com/portable-blender.jpg',
      targetMarket: 'Canada',
      status: 'running',
      currentStage: 'lead_scoring',
      progress: 68,
      leadCount: 18,
      createdAt: '2026-04-26T07:00:00.000Z',
      updatedAt: '2026-04-26T07:25:00.000Z',
    },
  ]

  private leads: StoreLead[] = [
    {
      id: 'lead-001',
      workflowRunId: 'wf-001',
      brandName: 'PawSpark',
      domain: 'pawspark.co',
      storeUrl: 'https://pawspark.co',
      source: 'Facebook Ads Library',
      country: 'United States',
      language: 'English',
      category: 'Pet Supplies',
      shopifyConfidence: 94,
      adActivityScore: 88,
      trafficScore: 72,
      contactScore: 80,
      totalScore: 86,
      status: 'qualified',
      recommendedAngle: 'Lead with fast-moving pet grooming SKUs and emphasize low-MOQ test orders.',
      contacts: [
        { type: 'whatsapp', value: '+1 415 555 0188', verified: false },
        { type: 'email', value: 'buyer@pawspark.co', verified: true },
      ],
      createdAt: '2026-04-24T10:42:00.000Z',
    },
    {
      id: 'lead-002',
      workflowRunId: 'wf-001',
      brandName: 'FurryNest',
      domain: 'furrynest.shop',
      storeUrl: 'https://furrynest.shop',
      source: 'Google Lens + SERP',
      country: 'United Kingdom',
      language: 'English',
      category: 'Pet Supplies',
      shopifyConfidence: 91,
      adActivityScore: 82,
      trafficScore: 65,
      contactScore: 74,
      totalScore: 80,
      status: 'contacted',
      recommendedAngle: 'Reference their active brush creatives and propose a bundle expansion.',
      contacts: [{ type: 'whatsapp', value: '+44 7700 900123', verified: false }],
      createdAt: '2026-04-24T10:48:00.000Z',
    },
    {
      id: 'lead-003',
      workflowRunId: 'wf-002',
      brandName: 'BlendJetty',
      domain: 'blendjetty.store',
      storeUrl: 'https://blendjetty.store',
      source: 'Facebook Ads Library',
      country: 'Canada',
      language: 'English',
      category: 'Kitchen Gadgets',
      shopifyConfidence: 87,
      adActivityScore: 79,
      trafficScore: 58,
      contactScore: 60,
      totalScore: 74,
      status: 'new',
      recommendedAngle: 'Open with summer travel creatives and a lightweight blender sourcing offer.',
      contacts: [{ type: 'email', value: 'hello@blendjetty.store', verified: false }],
      createdAt: '2026-04-26T07:12:00.000Z',
    },
  ]

  private outreachTasks: OutreachTask[] = [
    {
      id: 'task-001',
      leadId: 'lead-001',
      leadName: 'PawSpark',
      channel: 'whatsapp',
      status: 'ready',
      message:
        'Hi PawSpark team, I noticed your active pet grooming brush ads. We help Shopify pet brands test new grooming SKUs with low MOQ and fast fulfillment. Would you like a quick product sheet?',
      nextFollowUpAt: '2026-04-27T02:00:00.000Z',
      owner: 'Sales A',
    },
    {
      id: 'task-002',
      leadId: 'lead-002',
      leadName: 'FurryNest',
      channel: 'whatsapp',
      status: 'sent',
      message:
        'Hi FurryNest, your pet brush ads look strong. We can support a grooming bundle with better landed cost and custom packaging.',
      nextFollowUpAt: '2026-04-28T02:00:00.000Z',
      owner: 'Sales A',
    },
  ]

  getDashboard(): AutoFlowDashboard {
    return {
      metrics: {
        activeWorkflows: this.workflows.filter((workflow) => workflow.status === 'running').length,
        newLeads: this.leads.filter((lead) => lead.status === 'new').length,
        readyOutreach: this.outreachTasks.filter((task) => task.status === 'ready').length,
        replies: this.leads.filter((lead) => lead.status === 'replied').length,
        opportunities: this.leads.filter((lead) => lead.status === 'opportunity').length,
      },
      funnel: this.getCrm(),
      recentWorkflows: this.workflows.slice(0, 5),
      topLeads: [...this.leads].sort((a, b) => b.totalScore - a.totalScore).slice(0, 5),
      nextTasks: this.outreachTasks.filter((task) => task.status === 'ready').slice(0, 5),
    }
  }

  getWorkflows(): WorkflowRun[] {
    return this.workflows
  }

  createWorkflow(data: CreateWorkflowDto): WorkflowRun {
    const now = new Date().toISOString()
    const workflow: WorkflowRun = {
      id: `wf-${Date.now()}`,
      name: data.name || `${data.seedValue} prospect workflow`,
      seedType: data.seedType,
      seedValue: data.seedValue,
      targetMarket: data.targetMarket || 'United States',
      status: 'draft',
      currentStage: 'seed',
      progress: 0,
      leadCount: 0,
      createdAt: now,
      updatedAt: now,
    }
    this.workflows.unshift(workflow)
    return workflow
  }

  getLeads(status?: LeadStatus): StoreLead[] {
    if (!status) return this.leads
    return this.leads.filter((lead) => lead.status === status)
  }

  getLead(id: string): StoreLead {
    const lead = this.leads.find((item) => item.id === id)
    if (!lead) {
      throw new NotFoundException('Lead not found')
    }
    return lead
  }

  generateMessage(leadId: string, data: GenerateMessageDto): OutreachTask {
    const lead = this.getLead(leadId)
    const task: OutreachTask = {
      id: `task-${Date.now()}`,
      leadId: lead.id,
      leadName: lead.brandName,
      channel: data.channel || 'whatsapp',
      status: 'ready',
      message: this.buildMessage(lead, data),
      nextFollowUpAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      owner: 'Unassigned',
    }
    this.outreachTasks.unshift(task)
    return task
  }

  getOutreachTasks(): OutreachTask[] {
    return this.outreachTasks
  }

  updateOutreachTask(id: string, data: UpdateOutreachTaskDto): OutreachTask {
    const task = this.outreachTasks.find((item) => item.id === id)
    if (!task) {
      throw new NotFoundException('Outreach task not found')
    }
    Object.assign(task, data)
    return task
  }

  getCrm() {
    const stages: { key: LeadStatus; label: string; value: number }[] = [
      { key: 'new', label: 'New', value: 0 },
      { key: 'qualified', label: 'Qualified', value: 1200 },
      { key: 'contacted', label: 'Contacted', value: 1800 },
      { key: 'replied', label: 'Replied', value: 2600 },
      { key: 'opportunity', label: 'Opportunity', value: 5200 },
      { key: 'won', label: 'Won', value: 9000 },
      { key: 'lost', label: 'Lost', value: 0 },
    ]

    return stages.map((stage) => ({
      ...stage,
      count: this.leads.filter((lead) => lead.status === stage.key).length,
    }))
  }

  private buildMessage(lead: StoreLead, data: GenerateMessageDto): string {
    const offer = data.offer || 'low-MOQ sourcing, fast fulfillment, and product testing support'
    return `Hi ${lead.brandName} team, I noticed your ${lead.category.toLowerCase()} ads and ${lead.domain} store. We help Shopify sellers with ${offer}. Would you like me to share a short product sheet for your next test campaign?`
  }
}
