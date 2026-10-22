import api from './index'
import type { LoginRequest, RegisterRequest, AuthResponse, User } from '@/types'

const API_URL = import.meta.env.VITE_API_URL || '/api'

export const authApi = {
  login(data: LoginRequest): Promise<AuthResponse> {
    return api.post('/auth/login', data)
  },

  sendVerificationCode(email: string): Promise<{ success: boolean; message: string }> {
    return api.post('/auth/send-code', { email })
  },

  register(data: RegisterRequest & { verificationCode: string }): Promise<AuthResponse> {
    return api.post('/auth/register', data)
  },

  getProfile(): Promise<User> {
    return api.get('/users/profile')
  },

  updateProfile(data: Partial<User>): Promise<User> {
    return api.put('/users/profile', data)
  },

  async uploadAvatar(file: File): Promise<User & { avatarUrl: string }> {
    const formData = new FormData()
    formData.append('avatar', file)

    const response = await fetch(`${API_URL}/users/avatar`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || '上传失败')
    }

    return response.json()
  },

  changePassword(oldPassword: string, newPassword: string): Promise<void> {
    return api.put('/auth/password', { oldPassword, newPassword })
  },

  logout(): Promise<{ success: boolean }> {
    return api.post('/auth/logout')
  },
}
