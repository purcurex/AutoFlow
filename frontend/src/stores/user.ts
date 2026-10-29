import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose } from 'vue'
import type { User } from '@/types'
import { authApi } from '@/api/auth'
import { englishDisplayName, PRESET_AVATARS } from '@/utils/user-display'
import { assertCurrentSession, captureSession, invalidateSession, isCurrentSession, onSessionReset } from '@/utils/session'

const API_URL = import.meta.env.VITE_API_URL || '/api'

export const useUserStore = defineStore('user', () => {
  const user = ref<User | null>(null)
  onScopeDispose(onSessionReset(() => { user.value = null }))
  let authMutation: Promise<unknown> = Promise.resolve()
  function serializeAuth<T>(operation: () => Promise<T>): Promise<T> {
    const request = authMutation.then(operation)
    authMutation = request.catch(() => undefined)
    return request
  }
  const isLoggedIn = computed(() => !!user.value)
  const username = computed(() => user.value?.username || '')
  const displayName = computed(() => englishDisplayName(user.value))
  const isAdmin = computed(() => user.value?.role === 'admin')
  const avatarUrl = computed(() => {
    if (!user.value?.avatarUrl) return null
    if (PRESET_AVATARS.some(avatar => avatar.url === user.value?.avatarUrl)) return `${import.meta.env.BASE_URL}${user.value.avatarUrl.slice(1)}`
    // 如果是完整URL则直接返回，否则拼接API地址
    if (user.value.avatarUrl.startsWith('http')) {
      return user.value.avatarUrl
    }
    return `${API_URL.replace('/api', '')}${user.value.avatarUrl}`
  })

  async function login(email: string, password: string) {
    clearSession()
    const session = captureSession()
    const response = await serializeAuth(() => {
      assertCurrentSession(session)
      return authApi.login({ email, password })
    })
    assertCurrentSession(session)
    user.value = response.user
    localStorage.setItem('user', JSON.stringify(response.user))
    return response
  }

  async function sendVerificationCode(email: string) {
    return authApi.sendVerificationCode(email)
  }

  async function register(email: string, username: string, password: string, verificationCode: string) {
    clearSession()
    const session = captureSession()
    const response = await serializeAuth(() => {
      assertCurrentSession(session)
      return authApi.register({ email, username, password, verificationCode })
    })
    assertCurrentSession(session)
    user.value = response.user
    localStorage.setItem('user', JSON.stringify(response.user))
    return response
  }

  async function fetchUser() {
    // A remount during logout must not restore the still-expiring cookie session.
    if (!localStorage.getItem('user')) return
    const session = captureSession()
    try {
      const response = await authApi.getProfile()
      assertCurrentSession(session)
      const previous = user.value?.id || JSON.parse(localStorage.getItem('user') || '{}').id
      if (previous && previous !== response.id) invalidateSession()
      user.value = response
      localStorage.setItem('user', JSON.stringify(response))
    } catch {
      if (isCurrentSession(session)) clearSession()
    }
  }

  async function updateProfile(data: { username?: string; avatarUrl?: string }) {
    const session = captureSession()
    const response = await authApi.updateProfile(data)
    assertCurrentSession(session)
    user.value = response
    return response
  }

  async function uploadAvatar(file: File) {
    const session = captureSession()
    const response = await authApi.uploadAvatar(file)
    assertCurrentSession(session)
    user.value = response
    return response
  }

  function clearSession() {
    invalidateSession()
    user.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  function logout() {
    clearSession()
    // Serialize Set-Cookie mutations: a slow earlier login must finish before
    // logout/new login, otherwise its cookie could replace the current account.
    return serializeAuth(() => authApi.logout()).catch(() => undefined)
  }

  return {
    user,
    isLoggedIn,
    username,
    displayName,
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
