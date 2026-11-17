import api from './index'
export interface AnalyticsCacheScope { cacheable: boolean; version?: string }
export const getAnalyticsCacheScope = (): Promise<AnalyticsCacheScope> => api.get('/workbench/analytics/cache-scope')
