import api from './index'
import type { Note, CreateNoteRequest, UpdateNoteRequest } from '@/types'

export interface AdminNote extends Note {
  user: {
    id: string
    username: string
    email: string
  }
}

export const notesApi = {
  getAll(): Promise<Note[]> {
    return api.get('/notes')
  },

  getById(id: string): Promise<Note> {
    return api.get(`/notes/${id}`)
  },

  create(data: CreateNoteRequest): Promise<Note> {
    return api.post('/notes', data)
  },

  update(id: string, data: UpdateNoteRequest): Promise<Note> {
    return api.put(`/notes/${id}`, data)
  },

  delete(id: string): Promise<void> {
    return api.delete(`/notes/${id}`)
  },

  restore(id: string): Promise<Note> {
    return api.post(`/notes/${id}/restore`)
  },

  getTrash(): Promise<Note[]> {
    return api.get('/notes/trash')
  },

  permanentDelete(id: string): Promise<void> {
    return api.delete(`/notes/${id}/permanent`)
  },

  search(query: string): Promise<Note[]> {
    return api.get('/notes/search', { params: { q: query } })
  },

  reorder(noteIds: string[]): Promise<{ message: string }> {
    return api.put('/notes/reorder', { noteIds })
  },

  exportExcel(noteIds: string[]): Promise<Blob> {
    return api.post('/notes/export/excel', { noteIds }, {
      responseType: 'blob'
    })
  },

  // 管理员接口
  adminGetAll(): Promise<AdminNote[]> {
    return api.get('/notes/admin/all')
  },

  adminDelete(id: string): Promise<{ message: string }> {
    return api.delete(`/notes/admin/${id}`)
  }
}
