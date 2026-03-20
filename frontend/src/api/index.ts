import axios from 'axios'
import { useUserStore } from '@/stores/user'

export { authApi } from './auth'
export { notesApi } from './notes'
export { foldersApi } from './folders'
export { aiApi } from './ai'
export { shopifySearchApi } from './shopify-search'

const api = axios.create({
  baseURL: '/api',  // 使用相对路径，通过 Vite 代理访问后端
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      const userStore = useUserStore()
      userStore.logout()
      window.location.href = '/login'
    }
    return Promise.reject(error.response?.data || error)
  }
)

export default api
