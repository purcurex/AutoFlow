import axios from 'axios'

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

// 创建专门用于 Shopify 搜索的 axios 实例，设置更长的超时时间
const shopifyApi = axios.create({
  baseURL: '/api/shopify-search',
  withCredentials: true,
  timeout: 60000, // 60 秒超时，因为搜索需要调用多个外部 API
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器
shopifyApi.interceptors.request.use(
  (config) => {
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
shopifyApi.interceptors.response.use(
  (response) => response.data,
  (error) => {
    return Promise.reject(error.response?.data || error)
  }
)

export const shopifySearchApi = {
  async searchByImageUrl(imageUrl: string): Promise<ShopifySearchResult> {
    return shopifyApi.post('/by-image-url', { imageUrl })
  },

  async searchByKeyword(keyword: string): Promise<ShopifySearchResult> {
    return shopifyApi.post('/by-keyword', { keyword })
  },

  async searchByImageUpload(file: File): Promise<ShopifySearchResult> {
    const formData = new FormData()
    formData.append('image', file)

    const response = await fetch('/api/shopify-search/by-image-upload', {
      method: 'POST',
      credentials: 'include',
      body: formData
    })

    if (!response.ok) {
      throw new Error('图片上传搜索失败')
    }

    return response.json()
  }
}
