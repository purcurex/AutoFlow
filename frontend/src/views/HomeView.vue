<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useNoteStore } from '@/stores'
import { AppLayout } from '@/components/layout'
import { RichTextEditor } from '@/components/editor'
import { ExportDialog } from '@/components/export'
import { AIChatPanel } from '@/components/ai'
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

// 导出相关
const showExportDialog = ref(false)
const notesToExport = ref<Note[]>([])
const selectedNoteIds = ref<Set<string>>(new Set())
const isSelectMode = ref(false)

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

// 监听当前业务记录变化，加载内容
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
    alert('请先选择或创建一条业务记录')
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
    const confirm = window.confirm('当前业务记录有未保存的更改，是否保存？')
    if (confirm) {
      await saveNote()
    }
  }

  // 加载选中的业务记录
  await noteStore.fetchNote(noteId)
}

async function createNewNote() {
  // 如果有未保存的更改，提示用户
  if (hasChanges.value && noteStore.currentNote) {
    const confirm = window.confirm('当前业务记录有未保存的更改，是否保存？')
    if (confirm) {
      await saveNote()
    }
  }

  const note = await noteStore.createNote({
    title: '无标题业务记录',
    content: '',
    folderId: noteStore.currentFolder?.id
  })
  // 设置当前业务记录并加载到编辑器
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
    // 如果删除的是当前正在编辑的业务记录，清空编辑器
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
  if (!folderId) return '所有业务记录'
  const folder = noteStore.folders.find((f: Folder) => f.id === folderId)
  return folder?.name || '未知记录分类'
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
    // 刷新业务记录列表
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

// 导出功能
function exportCurrentNote() {
  if (!noteStore.currentNote) return
  notesToExport.value = [noteStore.currentNote]
  showExportDialog.value = true
}

function toggleSelectMode() {
  isSelectMode.value = !isSelectMode.value
  if (!isSelectMode.value) {
    selectedNoteIds.value.clear()
  }
}

function toggleNoteSelection(noteId: string) {
  if (selectedNoteIds.value.has(noteId)) {
    selectedNoteIds.value.delete(noteId)
  } else {
    selectedNoteIds.value.add(noteId)
  }
}

function selectAllNotes() {
  // 如果已全选，则取消全选
  if (isAllSelected.value) {
    selectedNoteIds.value.clear()
  } else {
    // 否则全选
    displayedNotes.value.forEach((note: Note) => {
      selectedNoteIds.value.add(note.id)
    })
  }
}

const isAllSelected = computed(() => {
  return displayedNotes.value.length > 0 && selectedNoteIds.value.size === displayedNotes.value.length
})

function exportSelectedNotes() {
  if (selectedNoteIds.value.size === 0) return
  notesToExport.value = displayedNotes.value.filter((note: Note) =>
    selectedNoteIds.value.has(note.id)
  )
  showExportDialog.value = true
}

const selectedCount = computed(() => selectedNoteIds.value.size)

// AI助手 - 插入文本到编辑器
function insertAIText(text: string) {
  if (content.value) {
    content.value += '\n\n' + text
  } else {
    content.value = text
  }
  hasChanges.value = true
}
</script>

<template>
  <AppLayout>
    <div class="flex h-full">
      <!-- 业务记录列表 -->
      <div class="w-80 border-r border-[var(--color-border)] flex flex-col">
        <div class="p-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <h2 class="text-sm font-medium text-gray-500">
            {{ noteStore.currentFolder?.name || '所有业务记录' }}
            <span class="text-gray-400">({{ displayedNotes.length }})</span>
            <span v-if="isSelectMode && selectedCount > 0" class="text-primary-500 ml-2">
              (已选 {{ selectedCount }} 条)
            </span>
          </h2>
          <div class="flex items-center gap-1">
            <button
              v-if="!isSelectMode"
              @click="toggleSelectMode"
              class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
              title="批量选择"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </button>
            <template v-else>
              <button
                @click="selectAllNotes"
                class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                :class="isAllSelected ? 'text-green-500' : 'text-gray-500'"
                :title="isAllSelected ? '取消全选' : '全选'"
              >
                <div class="w-5 h-5 rounded border-2 flex items-center justify-center"
                  :class="isAllSelected ? 'bg-green-500 border-green-500' : 'border-gray-400'">
                  <svg v-if="isAllSelected" class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </button>
              <button
                @click="exportSelectedNotes"
                class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-primary-500"
                :disabled="selectedCount === 0"
                title="导出选中"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
              <button
                @click="toggleSelectMode"
                class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                title="取消选择"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </template>
            <button
              @click="createNewNote"
              class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-primary-500"
              title="新建业务记录"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>
        <div class="flex-1 overflow-auto">
          <div
            v-for="note in displayedNotes"
            :key="note.id"
            class="p-3 border-b border-[var(--color-border)] cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
            :class="{
              'bg-primary-50 dark:bg-primary-900/20': noteStore.currentNote?.id === note.id && !isSelectMode,
              'opacity-50': draggedNoteId === note.id,
              'bg-green-50 dark:bg-green-900/20': isSelectMode && selectedNoteIds.has(note.id),
              'ring-2 ring-green-500': isSelectMode && selectedNoteIds.has(note.id)
            }"
            :draggable="!isSelectMode"
            @dragstart="onDragStart(note.id)"
            @dragend="onDragEnd"
            @dragover="onDragOver"
            @drop="onDrop(note.id)"
          >
            <div class="flex items-start justify-between" @click="isSelectMode ? toggleNoteSelection(note.id) : selectNote(note.id)">
              <!-- 选择模式下显示复选框 -->
              <div v-if="isSelectMode" class="flex items-center gap-2 mr-2">
                <div
                  class="w-4 h-4 rounded border-2 flex items-center justify-center transition-colors"
                  :class="selectedNoteIds.has(note.id) ? 'bg-green-500 border-green-500' : 'border-gray-300'"
                >
                  <svg v-if="selectedNoteIds.has(note.id)" class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
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
                  title="移动到记录分类"
                >
                  <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                </button>
                <button
                  @click.stop="confirmDeleteNote(note.id)"
                  class="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30"
                  title="删除业务记录"
                >
                  <svg class="w-4 h-4 text-gray-400 hover:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <div v-if="displayedNotes.length === 0" class="p-4 text-center text-gray-400 text-sm">
            <p>暂无业务记录</p>
            <button
              @click="createNewNote"
              class="mt-2 text-primary-500 hover:text-primary-600"
            >
              点击创建第一条业务记录
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
              placeholder="业务记录标题"
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

              <button
                @click="exportCurrentNote"
                class="btn btn-secondary text-sm gap-1"
                title="导出业务记录"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                导出
              </button>
            </div>
          </div>
          <div class="flex-1 p-4 overflow-auto">
            <RichTextEditor v-model="content" placeholder="开始写点什么..." @update:model-value="onContentChange" />
          </div>
        </template>

        <!-- 未选中业务记录时的提示 -->
        <div v-else class="flex-1 flex items-center justify-center text-gray-400">
          <div class="text-center">
            <svg class="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p class="text-lg mb-2">选择或创建一条业务记录开始编辑</p>
            <button
              @click="createNewNote"
              class="btn btn-primary gap-2"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              新建业务记录
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 移动业务记录弹窗 -->
    <Teleport to="body">
      <div
        v-if="showMoveDialog"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        @click.self="closeMoveDialog"
      >
        <div class="bg-white dark:bg-gray-800 rounded-xl p-6 w-80 shadow-xl max-h-96 overflow-auto">
          <h3 class="text-lg font-semibold mb-4">移动到记录分类</h3>
          <ul class="space-y-1">
            <li>
              <button
                @click="moveNoteToFolder(null)"
                class="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-left"
              >
                <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span>所有业务记录（移出记录分类）</span>
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
            暂无记录分类，请先创建记录分类
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

    <!-- 删除业务记录确认弹窗 -->
    <Teleport to="body">
      <div
        v-if="showDeleteConfirm"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        @click.self="cancelDeleteNote"
      >
        <div class="bg-white dark:bg-gray-800 rounded-xl p-6 w-80 shadow-xl">
          <h3 class="text-lg font-semibold mb-2">删除业务记录</h3>
          <p class="text-gray-500 text-sm mb-4">确定要删除这条业务记录吗？删除后可在回收站中恢复。</p>
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

    <!-- 导出对话框 -->
    <ExportDialog
      :visible="showExportDialog"
      :notes="notesToExport"
      @close="showExportDialog = false"
    />

    <!-- AI助手面板 -->
    <AIChatPanel
      v-model:visible="showAIAssistant"
      :note-content="content"
      @insert-text="insertAIText"
    />
  </AppLayout>
</template>
