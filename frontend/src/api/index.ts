import axios from 'axios'
import { useUserStore } from '@/stores/user'

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

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      const userStore = useUserStore()
      userStore.clearSession()
      window.location.href = '/login'
    }
    return Promise.reject(error.response?.data || error)
  },
)

export default api
export { quotationApi } from './quotation'
