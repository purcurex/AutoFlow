import axios from 'axios'
import { clearWorkbenchCounts } from '@/utils/workbench-counts'
import { useUserStore } from '@/stores/user'
import { assertCurrentSession, captureSession, isCurrentSession, StaleSessionError } from '@/utils/session'

declare module 'axios' {
  interface InternalAxiosRequestConfig { sessionEpoch?: number }
}

export { authApi } from './auth'
export { notesApi } from './notes'
export { foldersApi } from './folders'
export { aiApi } from './ai'
export { shopifySearchApi } from './shopify-search'
export { autoflowApi } from './autoflow'
export { fopApi } from './fop'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.request.use((config) => {
  config.sessionEpoch = captureSession()
  return config
}, undefined, { synchronous: true })

api.interceptors.response.use(
  (response) => {
    assertCurrentSession(response.config.sessionEpoch!)
    if (response.config.method && !['get', 'head', 'options'].includes(response.config.method) && response.config.url?.startsWith('/autoflow/integrations/fop/')) clearWorkbenchCounts()
    return response.data
  },
  (error) => {
    if (error.config?.sessionEpoch !== undefined && !isCurrentSession(error.config.sessionEpoch)) {
      return Promise.reject(new StaleSessionError())
    }
    // 登录失败的 401 交给登录页展示具体原因，避免整页跳转冲掉错误提示和已填写内容。
    if (error.response?.status === 401 && error.config?.url !== '/auth/login') {
      const userStore = useUserStore()
      userStore.clearSession()
      window.location.href = '/login'
    }
    const body = error.response?.data
    return Promise.reject(body && typeof body === 'object' ? { ...body, statusCode: body.statusCode ?? error.response.status } : body || error)
  },
)

export default api
export { quotationApi } from './quotation'
