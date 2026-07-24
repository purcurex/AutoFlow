import api from './index'

export interface QuoteDraftPayload {
  leadId?: string
  title?: string
  currency: string
  products: Array<{
    lineId: string
    productReference: string
    unit: string
    quantityTiers: Array<{
      minQuantity: number
      maxQuantity?: number
      customerUnitPrice: string
      purchaseCost?: string
    }>
    productProfitMarginRate: number
  }>
  destinationCountries: string[]
  packages: Array<{
    quantity: number
    weight: number
    weightUnit: string
    length: number
    width: number
    height: number
    dimensionUnit: string
  }>
  logisticsChannels: Array<{
    customChannelCode: string
    customChannelName: string
    actualChannelCode: string
    actualChannelName: string
    carrierName?: string
    logisticsProfitMarginRate: number
  }>
}

export interface QuotationVersion {
  id: string
  version: number
  requestSnapshot: QuoteDraftPayload
  resultSnapshot: Record<string, unknown> | null
  productCostStatus: string
  logisticsRateStatus: string
  createdAt: string
}

export interface Quotation {
  id: string
  leadId: string | null
  title: string
  status: string
  currency: string
  currentVersion: number
  versions: QuotationVersion[]
}

export const quotationApi = {
  create(payload: QuoteDraftPayload): Promise<Quotation> {
    return api.post('/autoflow/quotes', payload)
  },
  createVersion(id: string, payload: QuoteDraftPayload): Promise<Quotation> {
    const { leadId: _leadId, title: _title, ...version } = payload
    return api.post(`/autoflow/quotes/${id}/versions`, version)
  },
  get(id: string): Promise<Quotation> {
    return api.get(`/autoflow/quotes/${id}`)
  },
  requestFop(id: string): Promise<Quotation> {
    return api.post(`/autoflow/quotes/${id}/request-fop`)
  },
  exportExcel(id: string, version: number): Promise<Blob> {
    return api.get(`/autoflow/quotes/${id}/versions/${version}/export.xlsx`, {
      responseType: 'blob',
    })
  },
}
