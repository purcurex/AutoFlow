<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useNoteStore } from '@/stores'
import { AppLayout } from '@/components/layout'
import { RichTextEditor } from '@/components/editor'
import { notesApi } from '@/api'
import type { Note, Folder } from '@/types'

const noteStore = useNoteStore()

const title = ref('')
const content = ref('')
const isSaving = ref(false)
const lastSaved = ref<Date | null>(null)
const hasChanges = ref(false)
const showAIAssistant = ref(false)
const showMoveDialog = ref(false)
const showDeleteConfirm = ref<string | null>(null)
const selectedNoteToMove = ref<string | null>(null)
const draggedNoteId = ref<string | null>(null)

const displayedNotes = computed(() => {
  const notes = noteStore.filteredNotes || []
  if (noteStore.currentFolder) {
    return notes.filter(
      (note: Note) => note.folderId === noteStore.currentFolder?.id
    )
  }
  return notes
})

const availableFolders = computed(() => {
  return noteStore.folders || []
})

onMounted(async () => {
  await noteStore.fetchNotes()
  await noteStore.fetchFolders()
})

// 监听当前笔记变化，加载内容
watch(() => noteStore.currentNote, (newNote) => {
  if (newNote) {
    title.value = newNote.title
    content.value = newNote.content
    hasChanges.value = false
  } else {
    title.value = ''
    content.value = ''
    hasChanges.value = false
  }
}, { immediate: true })

function onContentChange() {
  hasChanges.value = true
}

async function saveNote() {
  if (!noteStore.currentNote) {
    alert('请先选择或创建一个笔记')
    return
  }
  if (!hasChanges.value) return

  isSaving.value = true
  try {
    await noteStore.updateNote(noteStore.currentNote.id, {
      title: title.value,
      content: content.value
    })
    lastSaved.value = new Date()
    hasChanges.value = false
  } catch (error) {
    console.error('保存失败:', error)
    alert('保存失败，请重试')
  } finally {
    isSaving.value = false
  }
}

async function selectNote(noteId: string) {
  // 如果有未保存的更改，提示用户
  if (hasChanges.value && noteStore.currentNote) {
    const confirm = window.confirm('当前笔记有未保存的更改，是否保存？')
    if (confirm) {
      await saveNote()
    }
  }

  // 加载选中的笔记
  await noteStore.fetchNote(noteId)
}

async function createNewNote() {
  // 如果有未保存的更改，提示用户
  if (hasChanges.value && noteStore.currentNote) {
    const confirm = window.confirm('当前笔记有未保存的更改，是否保存？')
    if (confirm) {
      await saveNote()
    }
  }

  const note = await noteStore.createNote({
    title: '无标题笔记',
    content: '',
    folderId: noteStore.currentFolder?.id
  })
  // 设置当前笔记并加载到编辑器
  noteStore.setCurrentNote(note)
  title.value = note.title
  content.value = note.content
  hasChanges.value = false
}

function openMoveDialog(noteId: string) {
  selectedNoteToMove.value = noteId
  showMoveDialog.value = true
}

async function moveNoteToFolder(folderId: string | null) {
  if (!selectedNoteToMove.value) return

  try {
    await noteStore.updateNote(selectedNoteToMove.value, { folderId })
    showMoveDialog.value = false
    selectedNoteToMove.value = null
  } catch (error) {
    console.error('移动失败:', error)
    alert('移动失败，请重试')
  }
}

function closeMoveDialog() {
  showMoveDialog.value = false
  selectedNoteToMove.value = null
}

function confirmDeleteNote(noteId: string) {
  showDeleteConfirm.value = noteId
}

function cancelDeleteNote() {
  showDeleteConfirm.value = null
}

async function deleteNote() {
  if (!showDeleteConfirm.value) return

  try {
    await noteStore.deleteNote(showDeleteConfirm.value)
    // 如果删除的是当前正在编辑的笔记，清空编辑器
    if (noteStore.currentNote?.id === showDeleteConfirm.value) {
      noteStore.setCurrentNote(null)
      title.value = ''
      content.value = ''
      hasChanges.value = false
    }
    showDeleteConfirm.value = null
  } catch (error) {
    console.error('删除失败:', error)
    alert('删除失败，请重试')
  }
}

function getFolderName(folderId: string | null): string {
  if (!folderId) return '所有笔记'
  const folder = noteStore.folders.find((f: Folder) => f.id === folderId)
  return folder?.name || '未知文件夹'
}

function formatDate(dateString: string) {
  const date = new Date(dateString)
  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatLastSaved() {
  if (!lastSaved.value) return ''
  return `已于 ${lastSaved.value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 保存`
}

// 拖拽排序
function onDragStart(noteId: string) {
  draggedNoteId.value = noteId
}

function onDragEnd() {
  draggedNoteId.value = null
}

async function onDrop(targetNoteId: string) {
  if (!draggedNoteId.value || draggedNoteId.value === targetNoteId) {
    draggedNoteId.value = null
    return
  }

  const notes = [...displayedNotes.value]
  const draggedIndex = notes.findIndex(n => n.id === draggedNoteId.value)
  const targetIndex = notes.findIndex(n => n.id === targetNoteId)

  if (draggedIndex === -1 || targetIndex === -1) {
    draggedNoteId.value = null
    return
  }

  // 重新排序数组
  const [draggedNote] = notes.splice(draggedIndex, 1)
  notes.splice(targetIndex, 0, draggedNote)

  // 提取新的ID顺序
  const newOrder = notes.map(n => n.id)

  // 调用后端更新排序
  try {
    await notesApi.reorder(newOrder)
    // 刷新笔记列表
    await noteStore.fetchNotes()
  } catch (error) {
    console.error('排序更新失败:', error)
    alert('排序更新失败，请重试')
  }

  draggedNoteId.value = null
}

function onDragOver(event: DragEvent) {
  event.preventDefault()
}
</script>

<template>
  <AppLayout>
    <div class="flex h-full">
      <!-- 笔记列表 -->
      <div class="w-64 border-r border-[var(--color-border)] flex flex-col">
        <div class="p-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <h2 class="text-sm font-medium text-gray-500">
            {{ noteStore.currentFolder?.name || '所有笔记' }}
            <span class="text-gray-400">({{ displayedNotes.length }})</span>
          </h2>
          <button
            @click="createNewNote"
            class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-primary-500"
            title="新建笔记"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
        <div class="flex-1 overflow-auto">
          <div
            v-for="note in displayedNotes"
            :key="note.id"
            class="p-3 border-b border-[var(--color-border)] cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
            :class="{
              'bg-primary-50 dark:bg-primary-900/20': noteStore.currentNote?.id === note.id,
              'opacity-50': draggedNoteId === note.id
            }"
            draggable="true"
            @dragstart="onDragStart(note.id)"
            @dragend="onDragEnd"
            @dragover="onDragOver"
            @drop="onDrop(note.id)"
          >
            <div class="flex items-start justify-between" @click="selectNote(note.id)">
              <div class="flex-1 min-w-0">
                <h3 class="font-medium text-sm truncate">{{ note.title || '无标题' }}</h3>
                <p class="text-xs text-gray-500 truncate mt-1">
                  {{ note.content.replace(/<[^>]+>/g, '').slice(0, 50) || '暂无内容' }}
                </p>
                <div class="flex items-center gap-2 mt-2 text-xs text-gray-400">
                  <span>{{ formatDate(note.updatedAt) }}</span>
                  <svg v-if="note.isFavorite" class="w-3 h-3 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  <span v-if="note.folderId" class="text-primary-500">{{ getFolderName(note.folderId) }}</span>
                </div>
              </div>
              <!-- 操作按钮 -->
              <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  @click.stop="openMoveDialog(note.id)"
                  class="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                  title="移动到文件夹"
                >
                  <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                </button>
                <button
                  @click.stop="confirmDeleteNote(note.id)"
                  class="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30"
                  title="删除笔记"
                >
                  <svg class="w-4 h-4 text-gray-400 hover:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <div v-if="displayedNotes.length === 0" class="p-4 text-center text-gray-400 text-sm">
            <p>暂无笔记</p>
            <button
              @click="createNewNote"
              class="mt-2 text-primary-500 hover:text-primary-600"
            >
              点击创建第一篇笔记
            </button>
          </div>
        </div>
      </div>

      <!-- 编辑区域 -->
      <div class="flex-1 flex flex-col">
        <template v-if="noteStore.currentNote">
          <div class="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
            <input
              v-model="title"
              type="text"
              placeholder="笔记标题"
              class="text-xl font-semibold bg-transparent border-none outline-none flex-1"
              @input="onContentChange"
            />
            <div class="flex items-center gap-3">
              <span v-if="isSaving" class="text-xs text-gray-400">保存中...</span>
              <span v-else-if="hasChanges" class="text-xs text-orange-400">未保存</span>
              <span v-else-if="lastSaved" class="text-xs text-green-500">{{ formatLastSaved() }}</span>

              <button
                @click="saveNote"
                class="btn btn-primary text-sm gap-1"
                :disabled="isSaving || !hasChanges"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                保存
              </button>

              <button
                @click="showAIAssistant = !showAIAssistant"
                class="btn btn-secondary text-sm gap-1"
                title="AI助手"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                AI
              </button>
            </div>
          </div>
          <div class="flex-1 p-4 overflow-auto">
            <RichTextEditor v-model="content" placeholder="开始写点什么..." @update:model-value="onContentChange" />
          </div>
        </template>

        <!-- 未选中笔记时的提示 -->
        <div v-else class="flex-1 flex items-center justify-center text-gray-400">
          <div class="text-center">
            <svg class="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p class="text-lg mb-2">选择或创建一个笔记开始编辑</p>
            <button
              @click="createNewNote"
              class="btn btn-primary gap-2"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              新建笔记
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 移动笔记弹窗 -->
    <Teleport to="body">
      <div
        v-if="showMoveDialog"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        @click.self="closeMoveDialog"
      >
        <div class="bg-white dark:bg-gray-800 rounded-xl p-6 w-80 shadow-xl max-h-96 overflow-auto">
          <h3 class="text-lg font-semibold mb-4">移动到文件夹</h3>
          <ul class="space-y-1">
            <li>
              <button
                @click="moveNoteToFolder(null)"
                class="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-left"
              >
                <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span>所有笔记（移出文件夹）</span>
              </button>
            </li>
            <li v-for="folder in availableFolders" :key="folder.id">
              <button
                @click="moveNoteToFolder(folder.id)"
                class="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-left"
              >
                <svg class="w-5 h-5 text-primary-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                </svg>
                <span>{{ folder.name }}</span>
              </button>
            </li>
          </ul>
          <div v-if="availableFolders.length === 0" class="py-4 text-center text-gray-400 text-sm">
            暂无文件夹，请先创建文件夹
          </div>
          <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              @click="closeMoveDialog"
              class="w-full btn btn-secondary"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 删除笔记确认弹窗 -->
    <Teleport to="body">
      <div
        v-if="showDeleteConfirm"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        @click.self="cancelDeleteNote"
      >
        <div class="bg-white dark:bg-gray-800 rounded-xl p-6 w-80 shadow-xl">
          <h3 class="text-lg font-semibold mb-2">删除笔记</h3>
          <p class="text-gray-500 text-sm mb-4">确定要删除这篇笔记吗？删除后可在回收站中恢复。</p>
          <div class="flex justify-end gap-2">
            <button
              @click="cancelDeleteNote"
              class="btn btn-secondary"
            >
              取消
            </button>
            <button
              @click="deleteNote"
              class="btn bg-red-500 hover:bg-red-600 text-white"
            >
              删除
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </AppLayout>
</template>
