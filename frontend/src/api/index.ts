import axios from 'axios'
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
    return Promise.reject(error.response?.data || error)
  },
)

export default api
export { quotationApi } from './quotation'
