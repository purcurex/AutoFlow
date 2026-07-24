import { describe, expect, it } from 'vitest'
import type { StoreLead } from '@/api/autoflow'
import { groupLeadsByWorkflow } from '@/utils/leadGrouping'

function lead(
  id: string,
  score: number,
  discoveredAt: string,
  workflowRunId = 'workflow-1',
  workflowDisplayId = '01',
  workflowName = 'US Pet Search',
): StoreLead {
  return {
    id,
    workflowRunId,
    brandName: id,
    domain: `${id}.test`,
    storeUrl: `https://${id}.test`,
    productUrl: null,
    ownerFacebookUrl: null,
    discoverySources: [],
    source: 'test',
    country: 'US',
    language: 'English',
    category: 'Pet',
    shopifyConfidence: score,
    adActivityScore: 0,
    trafficScore: 0,
    contactScore: 0,
    totalScore: score,
    status: 'new',
    discoveryStatus: 'first_seen',
    discoveryCount: 1,
    workflowDiscoveries: [{
      workflowRunId,
      workflowDisplayId,
      workflowName,
      workflowCreatedAt: '2026-07-24T01:00:00.000Z',
      discoveredAt,
      score,
    }],
    recommendedAngle: '',
    contacts: [],
    adEvidence: [],
    createdAt: discoveredAt,
  }
}

describe('lead workflow grouping', () => {
  it('groups by workflow and sorts score before discovery time', () => {
    const groups = groupLeadsByWorkflow([
      lead('newer-low', 60, '2026-07-24T03:00:00.000Z'),
      lead('older-high', 90, '2026-07-24T01:00:00.000Z'),
      lead('newer-high', 90, '2026-07-24T02:00:00.000Z'),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      workflowDisplayId: '01',
      workflowName: 'US Pet Search',
    })
    expect(groups[0].entries.map((entry) => entry.lead.id)).toEqual([
      'newer-high',
      'older-high',
      'newer-low',
    ])
  })

  it('places one globally deduplicated lead in every workflow that discovered it', () => {
    const shared = lead('shared', 80, '2026-07-24T01:00:00.000Z')
    shared.workflowDiscoveries!.push({
      workflowRunId: 'workflow-2',
      workflowDisplayId: '02',
      workflowName: 'CA Pet Search',
      workflowCreatedAt: '2026-07-24T02:00:00.000Z',
      discoveredAt: '2026-07-24T02:30:00.000Z',
      score: 75,
    })

    const groups = groupLeadsByWorkflow([shared])

    expect(groups.map((group) => group.workflowRunId)).toEqual(['workflow-2', 'workflow-1'])
    expect(groups.map((group) => group.workflowDisplayId)).toEqual(['02', '01'])
    expect(groups.every((group) => group.entries[0].lead.id === 'shared')).toBe(true)
  })
})
