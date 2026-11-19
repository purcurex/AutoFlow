import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUserStore } from '@/stores/user'
import { invalidateSession } from '@/utils/session'
import { crmMockAutoflowApi as leads, crmMockOpportunitiesApi as opportunities } from '@/mocks/crm'
import { useCrmMockStore } from '@/stores/crm-mock'
import { useAutoFlowStore } from '@/stores/autoflow'
import api from '@/api'

beforeEach(() => { localStorage.clear(); invalidateSession(); setActivePinia(createPinia()); useUserStore().user = { id: 'user-1', username: 'Alex', email: 'alex@example.com' } as any })
describe('isolated CRM demo data', () => {
 it('covers all lead types and filters/paginates without network access', async () => {
  const spy = vi.spyOn(api, 'get')
  expect((await leads.getLeads()).total).toBe(12)
  for (const leadType of ['manual', 'import', 'automatic']) {
   const page = await leads.listRegisteredLeads({ page: 1, pageSize: 2, leadType })
   expect(page.total).toBe(4); expect(page.items).toHaveLength(2); expect(page.items.every(l => l.leadType === leadType)).toBe(true)
  }
  expect((await leads.listRegisteredLeads({ page: 1, pageSize: 100, search: 'Nordic' })).total).toBe(1)
  expect(spy).not.toHaveBeenCalled(); spy.mockRestore()
 })
 it('restores fixture ownership when the profile store has not hydrated', async () => {
  useUserStore().user = null
  localStorage.setItem('user', JSON.stringify({ id: 'restored', username: 'Admin', email: 'admin@example.com' }))
  expect((await leads.getLeads()).items[0]!.ownerName).toBe('Admin')
 })
 it('keeps mock Pinia state separate from real modules', async () => {
  const real = useAutoFlowStore(), mock = useCrmMockStore()
  await mock.fetchLeads(); await mock.fetchOutreachTasks()
  expect(mock.leads).toHaveLength(12); expect(mock.outreachTasks).toHaveLength(10)
  expect(real.leads).toEqual([]); expect(real.outreachTasks).toEqual([])
 })
 it('supports local creation, opportunity conversion, follow-up and version conflicts', async () => {
  const lead = await leads.registerLead({ brandName: 'New Store', country: 'US', storeUrl: 'https://new.example' })
  expect(lead.leadType).toBe('manual')
  const opportunity = await opportunities.fromLead(lead.id)
  expect((await opportunities.fromLead(lead.id)).id).toBe(opportunity.id)
  const saved = await opportunities.followUp(opportunity.id, { version: 1, followedOn: '2026-11-18', stage: 'a_Place_an_order', dailyVolume: 'ten', monthlyAmount: '1200', currentFollowUp: '已确认样品', nextFollowUpPlan: '安排首单', problemFeedback: null })
  expect(saved.followUps).toHaveLength(1); expect(saved.version).toBe(2)
  await expect(opportunities.remove(saved.id, 1)).rejects.toMatchObject({ statusCode: 409 })
  await opportunities.remove(saved.id, 2)
  await expect(opportunities.get(saved.id)).rejects.toThrow('记录不存在')
 })
 it('updates communication locally and clears changes when the login session changes', async () => {
  const task = (await leads.getOutreachTasks()).items[0]!
  await leads.updateOutreachTask(task.id, { status: 'sent' })
  expect((await leads.getOutreachTasks()).items[0]!.status).toBe('sent')
  invalidateSession(); useUserStore().user = { id: 'user-2', username: 'Wendy', email: 'wendy@example.com' } as any
  expect((await leads.getOutreachTasks()).items[0]!.status).toBe('draft')
  expect((await leads.getLeads()).items.every(l => l.ownerName === 'Wendy')).toBe(true)
 })
 it('imports xlsx locally with duplicate and invalid row feedback, exports filtered data', async () => {
  const { default: ExcelJS } = await import('exceljs'); const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('线索')
  sheet.addRow(['客户名称', '国家', '店铺链接']); sheet.addRow(['Imported', 'US', 'https://imported.example']); sheet.addRow(['Duplicate', 'US', 'https://imported.example']); sheet.addRow(['Missing', '', 'https://invalid.example'])
  const bytes = await book.xlsx.writeBuffer()
  const result = await leads.importLeads({ size: bytes.byteLength, arrayBuffer: async () => bytes } as File)
  expect(result).toMatchObject({ total: 3, created: 1, duplicates: 1, failed: 1 })
  expect((await leads.getLead(result.results[0]!.id!)).leadType).toBe('import')
  const blob = await opportunities.export({ country: 'US' }); expect(blob.size).toBeGreaterThan(1000)
 })
})


describe('CRM date ordering across all results', () => {
 it('sorts leads before pagination and places empty contact dates last in both directions', async () => {
  await leads.registerLead({brandName:'No date',country:'US',storeUrl:'https://no-date.example'})
  for (const sortDirection of ['asc','desc'] as const) {
   const all=await leads.listRegisteredLeads({page:1,pageSize:100,sortBy:'contactedOn',sortDirection})
   expect(all.items.at(-1)!.brandName).toBe('No date')
   const dates=all.items.slice(0,-1).map(r=>r.contactedOn!)
   expect(dates).toEqual([...dates].sort((a,b)=>sortDirection==='asc'?a.localeCompare(b):b.localeCompare(a)))
   const second=await leads.listRegisteredLeads({page:2,pageSize:3,sortBy:'contactedOn',sortDirection})
   expect(second.items.map(r=>r.id)).toEqual(all.items.slice(3,6).map(r=>r.id))
  }
 })
 it('sorts opportunities before pagination, with null follow-up dates last', async () => {
  await opportunities.create({...((await opportunities.list({})).items[0]!),customerName:'Not followed'})
  for (const sortDirection of ['asc','desc'] as const) {
   const all=await opportunities.list({sortBy:'lastFollowedOn',sortDirection,pageSize:100})
   expect(all.items.at(-1)!.customerName).toBe('Not followed')
   const dates=all.items.slice(0,-1).map(r=>r.lastFollowedOn!)
   expect(dates).toEqual([...dates].sort((a,b)=>sortDirection==='asc'?a.localeCompare(b):b.localeCompare(a)))
   expect((await opportunities.list({sortBy:'lastFollowedOn',sortDirection,page:2,pageSize:3})).items.map(r=>r.id)).toEqual(all.items.slice(3,6).map(r=>r.id))
  }
 })
})
