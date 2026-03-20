import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User } from '@/types'
import { authApi } from '@/api/auth'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

export const useUserStore = defineStore('user', () => {
  const user = ref<User | null>(null)
  const token = ref<string | null>(localStorage.getItem('token'))

  const isLoggedIn = computed(() => !!token.value)
  const username = computed(() => user.value?.username || '')
  const avatarUrl = computed(() => {
    if (!user.value?.avatarUrl) return null
    // 如果是完整URL则直接返回，否则拼接API地址
    if (user.value.avatarUrl.startsWith('http')) {
      return user.value.avatarUrl
    }
    return `${API_URL.replace('/api', '')}${user.value.avatarUrl}`
  })

  async function login(email: string, password: string) {
    const response = await authApi.login({ email, password })
    token.value = response.token
    user.value = response.user
    localStorage.setItem('token', response.token)
    return response
  }

  async function register(email: string, username: string, password: string) {
    const response = await authApi.register({ email, username, password })
    token.value = response.token
    user.value = response.user
    localStorage.setItem('token', response.token)
    return response
  }

  async function fetchUser() {
    if (!token.value) return
    try {
      const response = await authApi.getProfile()
      user.value = response
    } catch {
      logout()
    }
  }

  async function updateProfile(data: { username?: string; avatarUrl?: string }) {
    const response = await authApi.updateProfile(data)
    user.value = response
    return response
  }

  async function uploadAvatar(file: File) {
    const response = await authApi.uploadAvatar(file)
    user.value = response
    return response
  }

  function logout() {
    user.value = null
    token.value = null
    localStorage.removeItem('token')
  }

  return {
    user,
    token,
    isLoggedIn,
    username,
    avatarUrl,
    login,
    register,
    fetchUser,
    updateProfile,
    uploadAvatar,
    logout
  }
})
