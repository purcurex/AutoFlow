import axios from 'axios'

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
const API_BASE_URL = '/api/facebook-ads'

/**
 * 通过图片URL搜索Facebook广告
 */
export async function searchAdsByImageUrl(imageUrl: string): Promise<FacebookAdsSearchResult> {
  const response = await axios.post<FacebookAdsSearchResult>(`${API_BASE_URL}/by-image-url`, {
    imageUrl,
  })
  return response.data
}

/**
 * 通过关键词搜索Facebook广告
 */
export async function searchAdsByKeyword(keyword: string): Promise<FacebookAdsSearchResult> {
  const response = await axios.post<FacebookAdsSearchResult>(`${API_BASE_URL}/by-keyword`, {
    keyword,
  })
  return response.data
}

/**
 * 获取搜索统计信息
 */
export async function getSearchStats(): Promise<SearchCountInfo> {
  const response = await axios.post<SearchCountInfo>(`${API_BASE_URL}/stats`)
  return response.data
}

/**
 * Facebook Ads API
 */
export const facebookAdsApi = {
  searchByImageUrl: searchAdsByImageUrl,
  searchByKeyword: searchAdsByKeyword,
  getStats: getSearchStats,
}
