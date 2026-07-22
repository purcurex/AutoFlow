import api from './index'

/**
 * Facebook广告信息
 */
export interface FacebookAd {
  name: string
  url: string
  description?: string
  imageUrl?: string
}

/**
 * 搜索次数信息
 */
export interface SearchCountInfo {
  current: number
  remaining: number
  limit: number
}

/**
 * 搜索结果
 */
export interface FacebookAdsSearchResult {
  ads: FacebookAd[]
  noteContent: string
  noteTitle: string
  searchCountInfo?: SearchCountInfo
  error?: string
}

/**
 * API基础路径
 */
/**
 * 通过图片URL搜索Facebook广告
 */
export async function searchAdsByImageUrl(imageUrl: string): Promise<FacebookAdsSearchResult> {
  return api.post('/facebook-ads/by-image-url', {
    imageUrl,
  })
}

/**
 * 通过关键词搜索Facebook广告
 */
export async function searchAdsByKeyword(keyword: string): Promise<FacebookAdsSearchResult> {
  return api.post('/facebook-ads/by-keyword', {
    keyword,
  })
}

/**
 * 获取搜索统计信息
 */
export async function getSearchStats(): Promise<SearchCountInfo> {
  return api.post('/facebook-ads/stats')
}

/**
 * Facebook Ads API
 */
export const facebookAdsApi = {
  searchByImageUrl: searchAdsByImageUrl,
  searchByKeyword: searchAdsByKeyword,
  getStats: getSearchStats,
}
