import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import SupplierFollowUpDialog from '@/components/autoflow/SupplierFollowUpDialog.vue'
import api from '@/api'
import * as chat from '@/utils/supplierChat'
import { invalidateSession } from '@/utils/session'
vi.mock('@/api', () => ({ default: { get: vi.fn() } }))
const contact = (id: string, availability = 'ready') => ({ purchaseOrderId: id, purchaseOrderNumber: `PO-${id}`, platformOrderNumber: '1688-001', supplier: { id: `s-${id}`, name: `供应商${id}`, wangwangAccount: `卖家${id}` }, shipmentStatus: 'partial', lines: [{ fulfillmentLineId: 'l1', purchaseLineId: `pl-${id}`, sku: 'SKU1', name: '背包', pendingQuantity: 2 }], availability, contactVersion: 'a'.repeat(64) })
let wrapper: VueWrapper | undefined
async function show(items = [contact('p1')], source = 'fop') {
  vi.mocked(api.get).mockImplementation(async (path) => path.endsWith('/launch')
    ? { source, mode: source === 'mock' ? 'demo' : 'live', orderId: 'o1', purchaseOrderId: path.includes('/p2/') ? 'p2' : 'p1', wangwangAccount: path.includes('/p2/') ? '卖家p2' : '卖家p1', url: source === 'mock' ? null : `aliim:sendmsg?touid=cnalichn${encodeURIComponent(path.includes('/p2/') ? '卖家p2' : '卖家p1')}` }
    : { source, orderId: 'o1', orderNumber: 'ORDER-1', refreshedAt: new Date().toISOString(), items })
  wrapper = mount(SupplierFollowUpDialog, { props: { orderId: 'o1', orderNumber: 'ORDER-1' }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: { Teleport: true } } })
  await flushPromises()
  return wrapper
}
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.clearAllMocks() })
describe('supplier follow-up contact selection', () => {
  it('attempts the sole live contact with a fresh version check', async () => {
    const open = vi.spyOn(chat, 'openSupplierChat').mockImplementation(() => {})
    const w = await show()
    expect(w.text()).toContain('PO-p1')
    expect(w.text()).toContain('卖家p1')
    expect(api.get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/fulfillment-orders/o1/supplier-follow-ups/p1/launch', { params: { contactVersion: 'a'.repeat(64) } })
    expect(open).toHaveBeenCalledWith('aliim:sendmsg?touid=cnalichn%E5%8D%96%E5%AE%B6p1', '卖家p1')
    expect(w.text()).toContain('已尝试打开旺旺')
  })
  it('requires selection when multiple purchases exist and opens only the chosen supplier', async () => {
    const open = vi.spyOn(chat, 'openSupplierChat').mockImplementation(() => {})
    const w = await show([contact('p1'), contact('p2')])
    expect(open).not.toHaveBeenCalled()
    await w.get('[data-purchase="p2"] .open-chat').trigger('click'); await flushPromises()
    expect(open).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledWith('aliim:sendmsg?touid=cnalichn%E5%8D%96%E5%AE%B6p2', '卖家p2')
  })
  it('never opens a demo account and disables contacts without verified chat details', async () => {
    const open = vi.spyOn(chat, 'openSupplierChat').mockImplementation(() => {})
    const w = await show([contact('p1')], 'mock')
    expect(open).not.toHaveBeenCalled()
    expect(w.text()).toContain('当前无法打开聊天')
    expect(w.text()).not.toContain('演示环境')
    wrapper?.unmount()
    const blocked = await show([contact('p1', 'missing_account')])
    expect(blocked.get('.open-chat').attributes('disabled')).toBeDefined()
    expect(open).not.toHaveBeenCalled()
  })
  it('clears old contacts after a changed supplier or permission failure', async () => {
    const open = vi.spyOn(chat, 'openSupplierChat').mockImplementation(() => {})
    const w = await show([contact('p1'), contact('p2')])
    vi.mocked(api.get).mockRejectedValueOnce({ code: 'supplier_contact_changed', message: '采购单或供应商信息已变化，请刷新后重新选择。' })
    await w.get('[data-purchase="p1"] .open-chat').trigger('click'); await flushPromises()
    expect(w.find('.open-chat').exists()).toBe(false)
    expect(w.text()).toContain('信息已变化')
    expect(open).not.toHaveBeenCalled()
  })
  it.each(['close', 'session'])('ignores an in-flight launch after %s', async (reason) => {
    const open = vi.spyOn(chat, 'openSupplierChat').mockImplementation(() => {})
    const w = await show([contact('p1'), contact('p2')])
    let finish!: (value: unknown) => void
    vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await w.get('[data-purchase="p1"] .open-chat').trigger('click')
    if (reason === 'close') await w.get('[aria-label="关闭 / Close"]').trigger('click'); else invalidateSession()
    finish({ source: 'fop', mode: 'live', orderId: 'o1', purchaseOrderId: 'p1', wangwangAccount: '卖家p1', url: 'aliim:sendmsg?touid=cnalichn%E5%8D%96%E5%AE%B6p1' })
    await flushPromises()
    expect(open).not.toHaveBeenCalled()
    expect(w.emitted('close')).toBeTruthy()
  })
})

describe('safe supplier chat launcher', () => {
  it.each(['javascript:alert(1)', 'https://evil.test/', 'aliim:sendmsg?touid=cnalichnother', 'aliim:sendmsg?touid=cnalichnAlice&text=secret', 'aliim:sendmsg?touid=cnalichnAlice&touid=cnalichnother'])('rejects %s before invoking the OS', url => {
    expect(() => chat.openSupplierChat(url, 'Alice')).toThrow()
  })
})
