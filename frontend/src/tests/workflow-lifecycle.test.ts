import { describe, expect, it } from 'vitest'
import {
  canArchiveWorkflow,
  canDeleteWorkflow,
  canReviseWorkflow,
} from '@/utils/workflowLifecycle'

describe('workflow lifecycle actions', () => {
  it('allows revisions only after a terminal execution state', () => {
    expect(canReviseWorkflow('failed')).toBe(true)
    expect(canReviseWorkflow('cancelled')).toBe(true)
    expect(canReviseWorkflow('completed')).toBe(true)
    expect(canReviseWorkflow('draft')).toBe(false)
    expect(canReviseWorkflow('running')).toBe(false)
  })

  it('limits physical deletion to disposable workflow states', () => {
    expect(canDeleteWorkflow('draft')).toBe(true)
    expect(canDeleteWorkflow('failed')).toBe(true)
    expect(canDeleteWorkflow('cancelled')).toBe(true)
    expect(canDeleteWorkflow('completed')).toBe(false)
    expect(canDeleteWorkflow('running')).toBe(false)
  })

  it('never archives a running workflow', () => {
    expect(canArchiveWorkflow('running')).toBe(false)
    expect(canArchiveWorkflow('failed')).toBe(true)
    expect(canArchiveWorkflow('completed')).toBe(true)
  })
})
