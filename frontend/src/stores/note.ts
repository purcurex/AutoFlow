import { assertCurrentSession, captureSession, isCurrentSession, onSessionReset } from '@/utils/session'
import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose } from 'vue'
import type { Note, Folder, CreateFolderRequest } from '@/types'
import { notesApi, foldersApi } from '@/api'

export const useNoteStore = defineStore('note', () => {
  // State
  const notes = ref<Note[]>([])
  const folders = ref<Folder[]>([])
  const currentNote = ref<Note | null>(null)
  const currentFolder = ref<Folder | null>(null)
  const isLoading = ref(false)
  const searchQuery = ref('')

  onScopeDispose(onSessionReset(() => {
    notes.value = []
    folders.value = []
    currentNote.value = null
    currentFolder.value = null
    isLoading.value = false
    searchQuery.value = ''
  }))

  // Getters
  const filteredNotes = computed(() => {
    if (!notes.value) return []
    if (!searchQuery.value) return notes.value
    const query = searchQuery.value.toLowerCase()
    return notes.value.filter(
      note =>
        note.title.toLowerCase().includes(query) ||
        note.content.toLowerCase().includes(query)
    )
  })

  const notesByFolder = computed(() => {
    const map = new Map<string, Note[]>()
    if (!notes.value) return map
    notes.value.forEach(note => {
      const folderId = note.folderId || 'root'
      if (!map.has(folderId)) {
        map.set(folderId, [])
      }
      map.get(folderId)!.push(note)
    })
    return map
  })

  const favoriteNotes = computed(() =>
    notes.value?.filter(note => note.isFavorite) || []
  )

  // Actions
  async function fetchNotes() {
    const session = captureSession()
    isLoading.value = true
    try {
      const response = await notesApi.getAll()
      assertCurrentSession(session)
      notes.value = response
    } finally {
      if (isCurrentSession(session)) isLoading.value = false
    }
  }

  async function fetchNote(id: string) {
    const session = captureSession()
    isLoading.value = true
    try {
      const response = await notesApi.getById(id)
      assertCurrentSession(session)
      currentNote.value = response
      return currentNote.value
    } finally {
      if (isCurrentSession(session)) isLoading.value = false
    }
  }

  async function createNote(data: Partial<Note>) {
    const session = captureSession()
    const note = await notesApi.create(data)
    assertCurrentSession(session)
    notes.value.unshift(note)
    return note
  }

  async function updateNote(id: string, data: Partial<Note>) {
    const session = captureSession()
    const note = await notesApi.update(id, data)
    assertCurrentSession(session)
    const index = notes.value.findIndex(n => n.id === id)
    if (index !== -1) {
      notes.value[index] = note
    }
    if (currentNote.value?.id === id) {
      currentNote.value = note
    }
    return note
  }

  async function deleteNote(id: string) {
    const session = captureSession()
    await notesApi.delete(id)
    assertCurrentSession(session)
    notes.value = notes.value.filter(n => n.id !== id)
    if (currentNote.value?.id === id) {
      currentNote.value = null
    }
  }

  async function fetchFolders() {
    const session = captureSession()
    const response = await foldersApi.getAll()
    assertCurrentSession(session)
    folders.value = response
  }

  async function createFolder(data: CreateFolderRequest) {
    const session = captureSession()
    const folder = await foldersApi.create(data)
    assertCurrentSession(session)
    folders.value.push(folder)
    return folder
  }

  async function updateFolder(id: string, data: Partial<Folder>) {
    const session = captureSession()
    const folder = await foldersApi.update(id, data)
    assertCurrentSession(session)
    const index = folders.value.findIndex(f => f.id === id)
    if (index !== -1) {
      folders.value[index] = folder
    }
    return folder
  }

  async function deleteFolder(id: string) {
    const session = captureSession()
    await foldersApi.delete(id)
    assertCurrentSession(session)
    folders.value = folders.value.filter(f => f.id !== id)
  }

  async function reorderFolders(folderIds: string[]) {
    const session = captureSession()
    await foldersApi.reorder(folderIds)
    assertCurrentSession(session)
    // 更新本地排序
    folderIds.forEach((id, index) => {
      const folder = folders.value.find(f => f.id === id)
      if (folder) {
        folder.sortOrder = index
      }
    })
  }

  function setCurrentNote(note: Note | null) {
    currentNote.value = note
  }

  function setCurrentFolder(folder: Folder | null) {
    currentFolder.value = folder
  }

  return {
    // State
    notes,
    folders,
    currentNote,
    currentFolder,
    isLoading,
    searchQuery,
    // Getters
    filteredNotes,
    notesByFolder,
    favoriteNotes,
    // Actions
    fetchNotes,
    fetchNote,
    createNote,
    updateNote,
    deleteNote,
    fetchFolders,
    createFolder,
    updateFolder,
    deleteFolder,
    reorderFolders,
    setCurrentNote,
    setCurrentFolder
  }
})
