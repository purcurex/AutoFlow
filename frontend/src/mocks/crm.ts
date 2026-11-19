import { COUNTRIES } from '@/utils/countries'
import type { StoreLead, OutreachTask, RegisterLeadInput, LeadImportResult, autoflowApi } from '@/api/autoflow'
import type { Opportunity, OpportunityFields, OpportunityQuery, OpportunityOptions, opportunitiesApi } from '@/api/opportunities'
import { sortCrmDates } from '@/utils/crmDateSort'
import { useUserStore } from '@/stores/user'
import { onSessionReset, captureSession, assertCurrentSession } from '@/utils/session'

// Module-scoped presentation fixtures. No backend request or production record mutation.
export const isCrmMockId = (id: string) => id.startsWith('crm-demo-')
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
let sequence = Date.now()
const nextId = () => ++sequence
const date = (days = 0) => { const d = new Date(); d.setDate(d.getDate() - days); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(d) }
const stages = [
  ['a_a_intentional_cooperation', '意向下单'], ['f_non-viable_lead', '无效商机'], ['a_Place_an_order', '正式下单'],
  ['b_related_stores', '关联店铺'], ['c_registration_platform', '注册平台'], ['d_business_opportunity_conflict', '商机冲突'], ['e_terminate_cooperation', '停止合作'],
].map(([value, label]) => ({ value: value!, label: label! }))
const options: OpportunityOptions = { stages, dailyVolumes: [{ value: 'ten', label: '1-10' }, { value: 'twenty', label: '11-20' }, { value: 'fifty', label: '20-50' }, { value: 'more', label: '50以上' }], countries: COUNTRIES.map(c=>({value:c.code,label:c.name})), currency: 'USD' }
const names = ['Maple & Home', 'Paw Haven', 'Nordic Glow', 'Urban Trail', 'Bloom Living', 'Cozy Nest', 'Little Sprout', 'Bright Studio', 'Ocean Essentials', 'Willow Garden', 'Pure Motion', 'Amber Atelier']
const categories = ['家居收纳', '宠物用品', '灯具照明', '户外运动', '家居装饰', '保暖家纺']
const statuses: StoreLead['status'][] = ['new', 'qualified', 'contacted', 'replied', 'opportunity', 'won', 'lost', 'invalid']
let state: { ownerId: string; leads: StoreLead[]; opportunities: Opportunity[]; tasks: OutreachTask[] } | undefined
onSessionReset(() => { state = undefined })
function actor() {
  // Router already verifies the session; restored pages may not hydrate the profile store yet.
  let user = useUserStore().user
  if (!user && typeof localStorage !== 'undefined') {
    try { user = JSON.parse(localStorage.getItem('user') || 'null') } catch { /* invalid local session */ }
  }
  if (!user?.id) throw new Error('请先登录')
  return { id: user.id, name: user.username || user.email }
}
function makeLead(data: RegisterLeadInput, index: number, type: StoreLead['leadType']): StoreLead {
  const owner = actor(), domain = new URL(data.storeUrl).hostname
  return { id: `crm-demo-lead-${index}`, brandName: data.brandName, domain, storeUrl: data.storeUrl, productUrl: null,
    leadType: type, registeredOn: data.registeredOn || date(), contactedOn: data.contactedOn || null,
    ownerName: owner.name, registrarName: owner.name, city: data.city || '', category: data.category || '', country: data.country,
    currentFollowUp: data.currentFollowUp || '', nextFollowUpPlan: data.nextFollowUpPlan || '', ownerFacebookUrl: data.facebook || null,
    workflowRunId: type === 'automatic' ? 'crm-demo-workflow' : null,
    workflowDiscoveries: type === 'automatic' ? [{ workflowRunId: 'crm-demo-workflow', workflowDisplayId: 'DEV-2026-001', workflowName: '秋冬家居与宠物用品客户开发', workflowCreatedAt: date(14), discoveredAt: date(3), score: 86 }] : [],
    discoverySources: type === 'automatic' ? ['google_search'] : [], source: type || 'manual', language: 'en', shopifyConfidence: 95,
    adActivityScore: 78, trafficScore: 82, contactScore: 90, totalScore: 86, status: 'new', discoveryStatus: 'first_seen', discoveryCount: 1,
    recommendedAngle: '结合客户产品类目，介绍采购、质检及跨境履约服务。', adEvidence: [], createdAt: `${data.registeredOn || date()}T08:00:00Z`,
    contacts: [...(data.whatsapp ? [{ type: 'whatsapp' as const, value: data.whatsapp, label: 'WhatsApp', verified: false, sourceUrl: data.storeUrl, sourceType: type || 'manual', verificationStatus: 'unverified' as const, confidence: 80, evidence: {}, sourcePageTitle: 'Contact', sourcePageKind: 'contact', extractedFrom: data.storeUrl }] : []), { type: 'email', value: `hello@${domain}`, label: '商务邮箱', verified: false, sourceUrl: data.storeUrl, sourceType: type || 'manual', verificationStatus: 'unverified', confidence: 80, evidence: {}, sourcePageTitle: 'Contact', sourcePageKind: 'contact', extractedFrom: data.storeUrl }],
  }
}
function makeOpportunity(fields: OpportunityFields, index: number): Opportunity {
  const owner = actor()
  return { ...fields, id: `crm-demo-opportunity-${index}`, number: `SJ${date().replaceAll('-', '')}${String(index).padStart(4, '0')}`, ownerUserId: owner.id, ownerName: owner.name,
    sourceLeadId: null, sourceLeadName: null, status: 'draft', currency: 'USD', lastFollowedOn: null, version: 1,
    createdAt: `${date()}T08:00:00Z`, updatedAt: new Date().toISOString(), canEdit: true, canDelete: true, followUps: [] }
}
function makeTask(lead: StoreLead, index: number): OutreachTask {
  const channel = (['email', 'whatsapp', 'facebook', 'instagram', 'other'] as const)[index % 5]!
  return { id: `crm-demo-task-${index}`, leadId: lead.id, leadName: lead.brandName,
    customer: { id: lead.id, name: lead.brandName, domain: lead.domain, storeUrl: lead.storeUrl, country: lead.country, category: lead.category, totalScore: lead.totalScore, status: lead.status },
    contactChannels: lead.contacts.map(c => ({ type: c.type, value: c.value, label: c.label, verified: c.verified, confidence: c.confidence })),
    channel, status: (['draft', 'ready', 'sent', 'replied', 'skipped', 'failed'] as const)[index % 6]!,
    message: `Hi ${lead.brandName} team,\n\nWe noticed your ${lead.category} collection. HyperZone can help with product sourcing, quality inspection and order fulfillment. Would you like to discuss your current delivery needs?\n\nBest regards,\n${actor().name}`,
    targetContact: channel === 'email' ? `hello@${lead.domain}` : lead.brandName, subject: `Fulfillment support for ${lead.brandName}`, templateKey: 'introduction',
    templateOptions: { quoteMode: 'none', includeProductVisual: false, emphasizeSupplier: true, emphasizeLogistics: true, productImageUrl: null, verifiedQuoteContext: null },
    sendUrl: null, recommendedNextAction: '确认客户需求，安排下一次沟通', nextFollowUpAt: date(-2), owner: actor().name, createdAt: `${date(index)}T08:30:00Z` }
}
function data() {
  const owner = actor()
  if (!state || state.ownerId !== owner.id) {
    const leads = names.map((brandName, i) => {
      const lead = makeLead({ brandName, country: ['US','GB','DE','AU','CA','FR'][i % 6]!, city: ['New York', 'London', 'Berlin', 'Sydney', 'Toronto', 'Paris'][i % 6], category: categories[i % 6], storeUrl: `https://store-${i + 1}.example`, facebook: `https://store-${i + 1}.example/social`, whatsapp: `+1 202 555 ${String(100 + i).padStart(4, '0')}`, registeredOn: date(i + 1), contactedOn: date(i), currentFollowUp: ['已收集店铺信息，待首次联系', '客户关注运输时效，已发送服务介绍', '正在确认样品及采购报价'][i % 3], nextFollowUpPlan: '确认采购规模与目标市场，安排视频沟通' }, i + 1, (['manual', 'import', 'automatic'] as const)[i % 3])
      lead.status = statuses[i % statuses.length]!
      return lead
    })
    const opportunities = leads.slice(0, 8).map((lead, i) => ({ ...makeOpportunity({ customerName: lead.brandName, stage: stages[i % stages.length]!.value, dailyVolume: options.dailyVolumes[i % 4]!.value, monthlyAmount: String(2500 + i * 1850), mainProducts: lead.category, country: lead.country, city: lead.city || '', businessScope: '独立站零售及跨境电商', whatsapp: '', storeUrl: lead.storeUrl, registeredOn: lead.registeredOn!, currentFollowUp: lead.currentFollowUp!, nextFollowUpPlan: lead.nextFollowUpPlan!, problemFeedback: i === 2 ? '需进一步确认偏远地区配送时效' : '' }, i + 1), sourceLeadId: lead.id, sourceLeadName: lead.brandName, lastFollowedOn: date(i), followUps: [{ id: `crm-demo-history-${i}`, followedOn: date(i), stage: stages[i % stages.length]!.value, dailyVolume: options.dailyVolumes[i % 4]!.value, monthlyAmount: String(2500 + i * 1850), currentFollowUp: lead.currentFollowUp!, nextFollowUpPlan: lead.nextFollowUpPlan!, problemFeedback: null, createdAt: `${date(i)}T08:00:00Z`, createdByName: owner.name }] }))
    state = { ownerId: owner.id, leads, opportunities, tasks: leads.slice(0, 10).map(makeTask) }
  }
  return state
}
function find<T extends { id: string }>(items: T[], id: string) { const value = items.find(item => item.id === id); if (!value) throw new Error('记录不存在'); return value }
function paginate<T>(items: T[], page = 1, pageSize = 100) { return copy({ items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize }) }
function register(input: RegisterLeadInput, type: StoreLead['leadType'] = 'manual') {
  if (!input.brandName.trim() || !input.country.trim() || !/^https?:\/\//i.test(input.storeUrl)) throw new Error('请填写客户名称、国家及有效店铺链接')
  const rows = data().leads, domain = new URL(input.storeUrl).hostname.toLowerCase()
  if (rows.some(l => l.domain.toLowerCase() === domain)) throw new Error('该店铺已登记')
  const row = makeLead(input, nextId(), type); rows.unshift(row); return copy(row)
}
async function workbook() { const { default: ExcelJS } = await import('exceljs'); return new ExcelJS.Workbook() }
async function excel(headers: string[], rows: (string | number | null)[][]) { const book = await workbook(), sheet = book.addWorksheet('数据'); sheet.addRow(headers); rows.forEach(row => sheet.addRow(row)); sheet.columns.forEach(col => { col.width = 24 }); return new Blob([new Uint8Array(await book.xlsx.writeBuffer())], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) }
const importHeaders = ['客户名称', '国家', '店铺链接', '城市', '产品分类', '目前跟进情况', '下一步跟进计划']
export const crmMockAutoflowApi: Pick<typeof autoflowApi, 'getLeads' | 'listRegisteredLeads' | 'registerLead' | 'importLeads' | 'leadImportTemplate' | 'getLead' | 'analyzeLeadContacts' | 'generateMessage' | 'updateLeadStatus' | 'getOutreachTasks' | 'updateOutreachTask'> = {
  async listRegisteredLeads(params) { const q = params.search?.trim().toLowerCase(); return paginate(sortCrmDates(data().leads.filter(l => (!params.status || l.status === params.status) && (!params.leadType || l.leadType === params.leadType) && (!q || [l.brandName, l.domain, l.country, l.category].some(v => v.toLowerCase().includes(q)))), l => params.sortBy === 'contactedOn' ? l.contactedOn : l.registeredOn || l.createdAt.slice(0,10), params.sortDirection), params.page, params.pageSize) },
  async getLeads(status, page, pageSize) { return this.listRegisteredLeads({ status, page: page || 1, pageSize: pageSize || 100 }) },
  async registerLead(input) { return register(input) },
  async leadImportTemplate() { return excel(importHeaders, []) },
  async importLeads(file) {
    if (file.size > 5 * 1024 * 1024) throw new Error('请选择5MB以内的文件')
    const session = captureSession(); const book = await workbook(); await book.xlsx.load(await file.arrayBuffer()); assertCurrentSession(session); const sheet = book.worksheets[0]; if (!sheet) throw new Error('文件无数据')
    if (sheet.rowCount > 1001) throw new Error('单次最多导入1000行')
    const headers = Array.from({ length: sheet.columnCount }, (_, i) => sheet.getRow(1).getCell(i + 1).text)
    if (!importHeaders.slice(0, 3).every(h => headers.includes(h))) throw new Error('缺少客户名称、国家或店铺链接列')
    const result: LeadImportResult = { total: 0, created: 0, duplicates: 0, failed: 0, results: [] }
    sheet.eachRow((row, n) => { if (n === 1) return; result.total++; try {
      row.eachCell(cell => { if (cell.value && typeof cell.value === 'object' && 'formula' in cell.value) throw new Error('不支持公式') })
      const get = (h: string) => headers.includes(h) ? row.getCell(headers.indexOf(h) + 1).text.trim() : ''
      const lead = register({ brandName: get('客户名称'), country: get('国家'), storeUrl: get('店铺链接'), city: get('城市'), category: get('产品分类'), currentFollowUp: get('目前跟进情况'), nextFollowUpPlan: get('下一步跟进计划') }, 'import')
      result.created++; result.results.push({ row: n, status: 'created', message: '已导入', id: lead.id })
    } catch (error) { const message = (error as Error).message, duplicate = message === '该店铺已登记'; if (duplicate) result.duplicates++; else result.failed++; result.results.push({ row: n, status: duplicate ? 'duplicate' : 'failed', message }) } })
    return result
  },
  async getLead(id) { return copy(find(data().leads, id)) },
  async analyzeLeadContacts(id) { return this.getLead(id) },
  async updateLeadStatus(id, status, note) { const lead = find(data().leads, id); lead.status = status; if (note) lead.currentFollowUp = note; return copy(lead) },
  async generateMessage(id, input) { const task = makeTask(find(data().leads, id), nextId()); task.channel = input.channel || 'email'; task.status = 'draft'; data().tasks.unshift(task); return copy(task) },
  async getOutreachTasks() { return paginate(data().tasks) },
  async updateOutreachTask(id, input) { const task = find(data().tasks, id); Object.assign(task, input); return copy(task) },
}
function filtered(query: OpportunityQuery) { return sortCrmDates(data().opportunities.filter(o => (!query.search || `${o.number} ${o.customerName}`.toLowerCase().includes(query.search.toLowerCase())) && (!query.stage || o.stage === query.stage) && (!query.country || o.country === query.country) && (!query.ownerId || o.ownerUserId === query.ownerId) && (!query.from || (o.registeredOn || '') >= query.from) && (!query.to || (o.registeredOn || '') <= query.to)), o => query.sortBy === 'lastFollowedOn' ? o.lastFollowedOn : o.registeredOn, query.sortDirection) }
function versioned(id: string, version: number) { const row = find(data().opportunities, id); if (row.version !== version) throw { statusCode: 409, message: '记录已更新' }; return row }
export const crmMockOpportunitiesApi: typeof opportunitiesApi = {
  async options() { return copy(options) },
  async list(query) { return { ...paginate(filtered(query), query.page, query.pageSize || 50), owners: [{ id: actor().id, name: actor().name }] } },
  async get(id) { return copy(find(data().opportunities, id)) },
  async create(fields) { if (!fields.customerName.trim()) throw new Error('请填写客户名称'); const row = makeOpportunity(fields, nextId()); data().opportunities.unshift(row); return copy(row) },
  async fromLead(id) { const rows = data().opportunities, existing = rows.find(o => o.sourceLeadId === id); if (existing) return copy(existing); const lead = find(data().leads, id); const row = await this.create({ customerName: lead.brandName, stage: stages[0]!.value, dailyVolume: null, monthlyAmount: null, mainProducts: lead.category, country: lead.country, city: lead.city || '', businessScope: '', whatsapp: '', storeUrl: lead.storeUrl, registeredOn: date(), currentFollowUp: lead.currentFollowUp || '', nextFollowUpPlan: lead.nextFollowUpPlan || '', problemFeedback: '' }); const saved = find(rows, row.id); saved.sourceLeadId = id; saved.sourceLeadName = lead.brandName; lead.status = 'opportunity'; return copy(saved) },
  async update(id, fields) { const row = versioned(id, fields.version); Object.assign(row, fields, { version: row.version + 1, updatedAt: new Date().toISOString() }); return copy(row) },
  async followUp(id, input) { const row = versioned(id, input.version); const { version: _, ...fields } = input; row.followUps ||= []; row.followUps.unshift({ ...fields, id: `crm-demo-follow-${Date.now()}`, createdAt: new Date().toISOString(), createdByName: actor().name }); if (!row.lastFollowedOn || input.followedOn >= row.lastFollowedOn) Object.assign(row, fields, { lastFollowedOn: input.followedOn }); row.version++; return copy(row) },
  async remove(id, version) { versioned(id, version); data().opportunities = data().opportunities.filter(o => o.id !== id) },
  async export(query) { return excel(['商机单号', '客户名称', '业务员', '商机阶段', '预计月订单额（USD）', '国家', '登记日期', '跟进情况'], filtered(query).map(o => [o.number, o.customerName, o.ownerName, stages.find(s => s.value === o.stage)?.label || '', o.monthlyAmount, o.country, o.registeredOn, o.currentFollowUp])) },
}
