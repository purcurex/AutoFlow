import { deriveCustomerDiscoveryStatus } from './customer-discovery-status'

describe('deriveCustomerDiscoveryStatus', () => {
  it('reports pending public image when discovery steps carry the explicit skip reason', () => {
    expect(deriveCustomerDiscoveryStatus('completed', [{
      stage: 'ad_discovery',
      status: 'skipped',
      output: { reasonCode: 'public_image_not_configured' },
    }])).toBe('pending_public_image')
  })

  it('reports completed only after both provider discovery stages complete', () => {
    expect(deriveCustomerDiscoveryStatus('completed', [
      { stage: 'ad_discovery', status: 'completed', output: { count: 2 } },
      { stage: 'store_detection', status: 'completed', output: { count: 1 } },
    ])).toBe('completed')
  })

  it('distinguishes running, failed, and not-started workflows', () => {
    expect(deriveCustomerDiscoveryStatus('running', [
      { stage: 'ad_discovery', status: 'running', output: null },
    ])).toBe('running')
    expect(deriveCustomerDiscoveryStatus('failed', [
      { stage: 'ad_discovery', status: 'failed', output: null },
    ])).toBe('failed')
    expect(deriveCustomerDiscoveryStatus('draft', [])).toBe('not_started')
  })
})
