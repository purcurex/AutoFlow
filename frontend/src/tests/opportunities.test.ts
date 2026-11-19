import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { opportunityPayload } from '@/api/opportunities'
import { invalidateSession } from '@/utils/session'
const api = vi.hoisted(() => ({ options: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), followUp: vi.fn(), remove: vi.fn(), export: vi.fn(), fromLead: vi.fn() }))
vi.mock('@/api/opportunities', async importOriginal => ({ ...await importOriginal<any>(), opportunitiesApi: api }))
vi.mock('@/components/layout', () => ({ AppLayout: { template: '<main><slot /></main>' } }))
const options = { stages: [{ value: 'first', label: '初步接触' }, { value: 'negotiation', label: '洽谈中' }], dailyVolumes: [{ value: 'ten', label: '1-10' }, { value: 'twenty', label: '11-20' }, { value: 'fifty', label: '20-50' }, { value: 'more', label: '50以上' }], countries: [{ value: 'US', label: '美国' }], currency: 'USD' }
const row = { id: 'o1', number: 'SJ001', customerName: '客户甲', ownerName: '业务员甲', ownerUserId: 'u1', status: 'draft', stage: 'first', dailyVolume: 'ten', monthlyAmount: null, currency: 'USD', country: 'US', registeredOn: '2026-11-18', version: 2, canEdit: true, canDelete: true, followUps: [] }
async function setup(kind: 'list' | 'detail' | 'button', path = '/opportunities') {
 const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }] })
 await router.push(path)
 const module = kind === 'list' ? await import('@/views/autoflow/OpportunitiesView.vue') : kind === 'detail' ? await import('@/views/autoflow/OpportunityDetailView.vue') : await import('@/components/opportunities/GenerateOpportunityButton.vue')
 const wrapper = mount(module.default, { props: kind === 'button' ? { leadId: 'lead1' } : {}, global: { plugins: [router] } })
 await flushPromises(); return { wrapper, router }
}
beforeEach(() => { vi.clearAllMocks(); api.options.mockResolvedValue(options); api.list.mockResolvedValue({ items: [row], total: 1, page: 1, pageSize: 20, owners: [{ id: 'u1', name: '业务员甲' }] }); api.get.mockResolvedValue(row) })
describe('opportunity workflows', () => {
 it('preserves empty optional text as strings while keeping unknown amounts null', () => { expect(opportunityPayload({ customerName: ' 客户甲 ', monthlyAmount: '', mainProducts: null, city: null, businessScope: null, whatsapp: null, storeUrl: null, currentFollowUp: null, nextFollowUpPlan: null, problemFeedback: null } as any)).toEqual(expect.objectContaining({ customerName: '客户甲', monthlyAmount: null, mainProducts: '', city: '', businessScope: '', whatsapp: '', storeUrl: '', currentFollowUp: '', nextFollowUpPlan: '', problemFeedback: '' })) })
 it('automatically queries changed filters and passes the same filters to export', async () => {
  const { wrapper: w } = await setup('list'); await w.get('select[aria-label="商机阶段"]').setValue('negotiation'); await flushPromises(); expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'negotiation', page: 1 }));
  api.export.mockRejectedValue(new Error('导出测试')); await w.get('[data-test="export"]').trigger('click'); await flushPromises(); expect(api.export).toHaveBeenCalledWith(expect.objectContaining({ stage: 'negotiation' })); w.unmount()
 })
 it('does not show a false zero count after failed loading', async () => { api.list.mockRejectedValue(new Error('查询失败')); const { wrapper: w } = await setup('list'); expect(w.get('[role="alert"]').text()).toContain('查询失败'); expect(w.text()).not.toContain('共 0'); expect(w.text()).not.toContain('暂无商机'); w.unmount() })
 it('saves a name-only draft without inventing a zero amount', async () => { api.create.mockResolvedValue(row); const { wrapper: w, router } = await setup('detail', '/opportunities/new'); await w.get('[name="customerName"]').setValue('客户甲'); await w.get('form[data-test="opportunity-form"]').trigger('submit'); await flushPromises(); expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ customerName: '客户甲', monthlyAmount: null })); expect(router.currentRoute.value.path).toBe('/opportunities/o1'); w.unmount() })
 it('retains edited values and explicitly reports a version conflict', async () => { api.update.mockRejectedValue({ statusCode: 409 }); const { wrapper: w } = await setup('detail', '/opportunities/o1'); await w.get('[name="customerName"]').setValue('修改客户'); await w.get('form[data-test="opportunity-form"]').trigger('submit'); await flushPromises(); expect(w.get('[role="alert"]').text()).toContain('其他操作更新'); expect((w.get('[name="customerName"]').element as HTMLInputElement).value).toBe('修改客户'); expect(api.update).toHaveBeenCalledWith('o1', expect.objectContaining({ version: 2 })); w.unmount() })
 it('appends a follow-up and displays returned history', async () => { api.followUp.mockResolvedValue({ ...row, version: 3, followUps: [{ id: 'f1', followedOn: '2026-11-18', stage: 'first', dailyVolume: 'ten', monthlyAmount: '20.00', currentFollowUp: '已联系客户', nextFollowUpPlan: '发送样品', problemFeedback: '', createdAt: '' }] }); const { wrapper: w } = await setup('detail', '/opportunities/o1'); await w.get('[data-test="add-follow-up"]').trigger('click'); await w.get('[name="followedOn"]').setValue('2026-11-18'); await w.get('[name="followMonthlyAmount"]').setValue('20'); await w.get('[name="followCurrent"]').setValue('已联系客户'); await w.get('[name="followNext"]').setValue('发送样品'); await w.get('form[data-test="follow-up-form"]').trigger('submit'); await flushPromises(); expect(api.followUp).toHaveBeenCalledWith('o1', expect.objectContaining({ version: 2, monthlyAmount: '20', currentFollowUp: '已联系客户' })); expect(w.get('[data-test="history"]').text()).toContain('已联系客户'); w.unmount() })
 it('keeps unsaved customer edits and requires saving before opening follow-up', async () => {
  api.update.mockResolvedValue({ ...row, customerName: '修改客户', version: 3 })
  const { wrapper: w } = await setup('detail', '/opportunities/o1')
  await w.get('[name="customerName"]').setValue('修改客户')
  await w.get('[data-test="add-follow-up"]').trigger('click')
  expect(w.find('[role="dialog"]').exists()).toBe(false)
  expect(w.get('[role="alert"]').text()).toContain('请先保存商机')
  expect((w.get('[name="customerName"]').element as HTMLInputElement).value).toBe('修改客户')
  expect(api.update).not.toHaveBeenCalled()
  expect(api.followUp).not.toHaveBeenCalled()
  await w.get('form[data-test="opportunity-form"]').trigger('submit'); await flushPromises()
  await w.get('[data-test="add-follow-up"]').trigger('click')
  expect(w.get('[role="dialog"]').text()).toContain('修改客户')
  w.unmount()
 })
 it('hides mutation controls and disables fields for read-only records', async () => { api.get.mockResolvedValue({ ...row, canEdit: false, canDelete: false }); const { wrapper: w } = await setup('detail', '/opportunities/o1'); expect(w.find('[data-test="add-follow-up"]').exists()).toBe(false); expect(w.findAll('button').some(b => /删除商机|保存商机/.test(b.text()))).toBe(false); expect(w.get('fieldset').attributes('disabled')).toBeDefined(); w.unmount() })
 it('requires deletion confirmation and sends the current version', async () => { api.remove.mockResolvedValue(undefined); const { wrapper: w, router } = await setup('detail', '/opportunities/o1'); await w.findAll('button').find(b => b.text() === '删除商机')!.trigger('click'); expect(api.remove).not.toHaveBeenCalled(); await w.get('[role="dialog"]').findAll('button').find(b => b.text() === '确认删除')!.trigger('click'); await flushPromises(); expect(api.remove).toHaveBeenCalledWith('o1', 2); expect(router.currentRoute.value.path).toBe('/opportunities'); w.unmount() })
 it('prevents repeated saves while a create request is pending', async () => { let resolve!: (v: unknown) => void; api.create.mockReturnValue(new Promise(r => resolve = r)); const { wrapper: w } = await setup('detail', '/opportunities/new'); await w.get('[name="customerName"]').setValue('客户甲'); await w.get('form[data-test="opportunity-form"]').trigger('submit'); await w.get('form[data-test="opportunity-form"]').trigger('submit'); expect(api.create).toHaveBeenCalledTimes(1); resolve(row); await flushPromises(); w.unmount() })
 it('clears sensitive data on session reset and discards an old list response', async () => { const { wrapper: w } = await setup('list'); let resolve!: (v: unknown) => void; api.list.mockReturnValue(new Promise(r => resolve = r)); await w.get('select[aria-label="商机阶段"]').setValue('negotiation'); invalidateSession(); resolve({ items: [row], total: 1, owners: [] }); await flushPromises(); expect(w.text()).not.toContain('客户甲'); w.unmount() })
 it('generates from a lead with duplicate-click protection and opens the result', async () => { let resolve!: (v: unknown) => void; api.fromLead.mockReturnValue(new Promise(r => resolve = r)); const { wrapper: w, router } = await setup('button'); await w.get('button').trigger('click'); await w.get('button').trigger('click'); expect(api.fromLead).toHaveBeenCalledTimes(1); expect(api.fromLead).toHaveBeenCalledWith('lead1'); resolve(row); await flushPromises(); expect(router.currentRoute.value.path).toBe('/opportunities/o1'); w.unmount() })
})
