import { describe, expect, it } from 'vitest'
import { workflowProgressDisplay } from '@/utils/workflowProgress'

describe('workflow progress display', () => {
  it('shows configuration pending instead of 100 percent when customer discovery was skipped', () => {
    expect(workflowProgressDisplay({
      progress: 100,
      customerDiscoveryStatus: 'pending_public_image',
    })).toEqual({
      percent: 0,
      labelKey: 'workflows.progressPendingConfiguration',
    })
  })

  it('keeps completed customer discovery at 100 percent', () => {
    expect(workflowProgressDisplay({
      progress: 100,
      customerDiscoveryStatus: 'completed',
    })).toEqual({
      percent: 100,
      labelKey: 'workflows.progressPercent',
      labelParams: { progress: 100 },
    })
  })

  it.each([
    { progress: -5, expected: 0 },
    { progress: 125, expected: 100 },
  ])('limits $progress to $expected for safe progress-bar rendering', ({ progress, expected }) => {
    expect(workflowProgressDisplay({
      progress,
      customerDiscoveryStatus: 'running',
    })).toMatchObject({
      percent: expected,
      labelParams: { progress: expected },
    })
  })
})
