import api from './index'

/**
 * 域名流量信息
 */
export interface DomainTraffic {
  /** 预估月访问量 */
  monthlyVisits?: number
  /** 访问量排名 */
  rank?: number
  /** 跳出率 */
  bounceRate?: number
  /** 平均访问时长（秒） */
  avgVisitDuration?: number
  /** 页面/访问 */
  pagesPerVisit?: number
  /** 数据来源 */
  source: string
}

export interface ShopifyStore {
  name: string
  url: string
  description?: string
  imageUrl?: string
  /** 域名流量信息 */
  traffic?: DomainTraffic
}

export interface ShopifySearchResult {
  stores: ShopifyStore[]
  noteContent: string
  noteTitle: string
  error?: string
}

export const shopifySearchApi = {
  async searchByImageUrl(imageUrl: string): Promise<ShopifySearchResult> {
    return api.post('/shopify-search/by-image-url', { imageUrl })
  },

  async searchByKeyword(keyword: string): Promise<ShopifySearchResult> {
    return api.post('/shopify-search/by-keyword', { keyword })
  },

  async searchByImageUpload(file: File): Promise<ShopifySearchResult> {
    const formData = new FormData()
    formData.append('image', file)

    const response = await fetch('/api/shopify-search/by-image-upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: formData
    })

    if (!response.ok) {
      throw new Error('图片上传搜索失败')
    }

    return response.json()
  }
}
