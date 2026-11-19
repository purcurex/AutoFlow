import api from './index'

export interface OpportunityOption { value: string; label: string }
export interface OpportunityOptions { stages: OpportunityOption[]; dailyVolumes: OpportunityOption[]; countries: OpportunityOption[]; currency: 'USD' }
export interface OpportunityFields {
  customerName: string; stage: string | null; dailyVolume: string | null; monthlyAmount: string | null;
  mainProducts: string | null; country: string | null; city: string | null; businessScope: string | null;
  whatsapp: string | null; storeUrl: string | null; registeredOn: string | null;
  currentFollowUp: string | null; nextFollowUpPlan: string | null; problemFeedback: string | null;
}
export interface OpportunityFollowUp {
  id: string; followedOn: string; stage: string; dailyVolume: string; monthlyAmount: string;
  currentFollowUp: string; nextFollowUpPlan: string; problemFeedback: string | null; createdAt: string;
  createdByName?: string;
}
export type FollowUpInput = Omit<OpportunityFollowUp, 'id' | 'createdAt' | 'createdByName'> & { version: number }
export interface Opportunity extends OpportunityFields {
  id: string; number: string; ownerUserId: string; ownerName: string; sourceLeadId: string | null;
  sourceLeadName: string | null; status: 'draft'; currency: 'USD'; lastFollowedOn: string | null;
  version: number; createdAt: string; updatedAt: string; canEdit: boolean; canDelete: boolean; followUps?: OpportunityFollowUp[];
}
export interface OpportunityQuery { sortBy?: 'registeredOn' | 'lastFollowedOn'; sortDirection?: 'asc' | 'desc'; search?: string; stage?: string; country?: string; ownerId?: string; from?: string; to?: string; page?: number; pageSize?: number }
export interface OpportunityList { items: Opportunity[]; total: number; page: number; pageSize: number; owners: { id: string; name: string }[] }
export const opportunitiesApi = {
  options: () => api.get<never, OpportunityOptions>('/opportunities/options'),
  list: (params: OpportunityQuery) => api.get<never, OpportunityList>('/opportunities', { params }),
  get: (id: string) => api.get<never, Opportunity>(`/opportunities/${encodeURIComponent(id)}`),
  create: (fields: OpportunityFields) => api.post<never, Opportunity>('/opportunities', fields),
  fromLead: (id: string) => api.post<never, Opportunity>(`/opportunities/from-lead/${encodeURIComponent(id)}`),
  update: (id: string, fields: OpportunityFields & { version: number }) => api.patch<never, Opportunity>(`/opportunities/${encodeURIComponent(id)}`, fields),
  followUp: (id: string, fields: FollowUpInput) => api.post<never, Opportunity>(`/opportunities/${encodeURIComponent(id)}/follow-ups`, fields),
  remove: (id: string, version: number) => api.delete<never, void>(`/opportunities/${encodeURIComponent(id)}`, { params: { version } }),
  export: (params: OpportunityQuery) => api.get<never, Blob>('/opportunities/export', { params, responseType: 'blob' }),
}
export function opportunityError(error: unknown) {
  const e = error as { statusCode?: number; response?: { status?: number }; message?: string | string[] }
  if (e?.statusCode === 409 || e?.response?.status === 409) return '商机已被其他操作更新，当前填写内容已保留。请先复制需要保留的内容，再重新加载后保存。'
  return Array.isArray(e?.message) ? e.message.join('；') : e?.message || '操作失败，请重试。'
}
export const optionLabel = (options: OpportunityOption[], value: string | null | undefined) => options.find(item => item.value === value)?.label || value || '—'
export function emptyOpportunity(): OpportunityFields {
  return { customerName: '', stage: null, dailyVolume: null, monthlyAmount: null, mainProducts: null, country: null, city: null, businessScope: null, whatsapp: null, storeUrl: null, registeredOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()), currentFollowUp: null, nextFollowUpPlan: null, problemFeedback: null }
}
export function opportunityPayload(fields: OpportunityFields): OpportunityFields {
  const nullable = new Set(['stage', 'dailyVolume', 'monthlyAmount', 'country'])
  return Object.fromEntries(Object.keys(emptyOpportunity()).map(key => { const value = fields[key as keyof OpportunityFields]; const cleaned = typeof value === 'string' ? value.trim() : ''; return [key, cleaned || (nullable.has(key) ? null : '')] })) as unknown as OpportunityFields
}
