import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
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
    isLoading.value = true
    try {
      notes.value = await notesApi.getAll()
    } finally {
      isLoading.value = false
    }
  }

  async function fetchNote(id: string) {
    isLoading.value = true
    try {
      currentNote.value = await notesApi.getById(id)
      return currentNote.value
    } finally {
      isLoading.value = false
    }
  }

  async function createNote(data: Partial<Note>) {
    const note = await notesApi.create(data)
    notes.value.unshift(note)
    return note
  }

  async function updateNote(id: string, data: Partial<Note>) {
    const note = await notesApi.update(id, data)
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
    await notesApi.delete(id)
    notes.value = notes.value.filter(n => n.id !== id)
    if (currentNote.value?.id === id) {
      currentNote.value = null
    }
  }

  async function fetchFolders() {
    folders.value = await foldersApi.getAll()
  }

  async function createFolder(data: CreateFolderRequest) {
    const folder = await foldersApi.create(data)
    folders.value.push(folder)
    return folder
  }

  async function updateFolder(id: string, data: Partial<Folder>) {
    const folder = await foldersApi.update(id, data)
    const index = folders.value.findIndex(f => f.id === id)
    if (index !== -1) {
      folders.value[index] = folder
    }
    return folder
  }

  async function deleteFolder(id: string) {
    await foldersApi.delete(id)
    folders.value = folders.value.filter(f => f.id !== id)
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
    setCurrentNote,
    setCurrentFolder
  }
})
