import api from './index'
import type { LoginRequest, RegisterRequest, AuthResponse, User } from '@/types'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

export const authApi = {
  login(data: LoginRequest): Promise<AuthResponse> {
    return api.post('/auth/login', data)
  },

  register(data: RegisterRequest): Promise<AuthResponse> {
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

    const token = localStorage.getItem('token')
    const response = await fetch(`${API_URL}/users/avatar`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
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
  }
}
