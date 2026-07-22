import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User } from '@/types'
import { authApi } from '@/api/auth'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

export const useUserStore = defineStore('user', () => {
  const user = ref<User | null>(null)
  const isLoggedIn = computed(() => !!user.value)
  const username = computed(() => user.value?.username || '')
  const isAdmin = computed(() => user.value?.role === 'admin')
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
    user.value = response.user
    localStorage.setItem('user', JSON.stringify(response.user))
    return response
  }

  async function sendVerificationCode(email: string) {
    return authApi.sendVerificationCode(email)
  }

  async function register(email: string, username: string, password: string, verificationCode: string) {
    const response = await authApi.register({ email, username, password, verificationCode })
    user.value = response.user
    localStorage.setItem('user', JSON.stringify(response.user))
    return response
  }

  async function fetchUser() {
    try {
      const response = await authApi.getProfile()
      user.value = response
      localStorage.setItem('user', JSON.stringify(response))
    } catch {
      clearSession()
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

  function clearSession() {
    user.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  function logout() {
    void authApi.logout().finally(clearSession)
  }

  return {
    user,
    isLoggedIn,
    username,
    isAdmin,
    avatarUrl,
    login,
    sendVerificationCode,
    register,
    fetchUser,
    updateProfile,
    uploadAvatar,
    logout,
    clearSession,
  }
})
