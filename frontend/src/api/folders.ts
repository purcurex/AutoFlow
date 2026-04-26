import api from './index'
import type { Folder, CreateFolderRequest, UpdateFolderRequest } from '@/types'

export const foldersApi = {
  getAll(): Promise<Folder[]> {
    return api.get('/folders')
  },

  getById(id: string): Promise<Folder> {
    return api.get(`/folders/${id}`)
  },

  create(data: CreateFolderRequest): Promise<Folder> {
    return api.post('/folders', data)
  },

  update(id: string, data: UpdateFolderRequest): Promise<Folder> {
    return api.put(`/folders/${id}`, data)
  },

  delete(id: string): Promise<void> {
    return api.delete(`/folders/${id}`)
  },

  reorder(folderIds: string[]): Promise<void> {
    return api.put('/folders/reorder', { folderIds })
  }
}
