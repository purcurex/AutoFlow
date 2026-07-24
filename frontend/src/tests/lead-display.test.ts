import { describe, expect, it } from 'vitest'
import { leadCustomerName } from '@/utils/leadDisplay'

describe('lead customer display', () => {
  it('removes only a trailing .com suffix from the internal customer name', () => {
    expect(leadCustomerName('joom.com')).toBe('joom')
    expect(leadCustomerName('LeChampDesCouleurs.COM')).toBe('LeChampDesCouleurs')
    expect(leadCustomerName('Acme Commerce')).toBe('Acme Commerce')
  })
})
