<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNoteStore } from '@/stores'
import { AppLayout } from '@/components/layout'
import { RichTextEditor } from '@/components/editor'

const route = useRoute()
const router = useRouter()
const noteStore = useNoteStore()

const title = ref('')
const content = ref('')
const isSaving = ref(false)
const lastSaved = ref<Date | null>(null)
const hasChanges = ref(false)
const isLoading = ref(true)

onMounted(async () => {
  const noteId = route.params.id as string
  isLoading.value = true
  try {
    await noteStore.fetchNote(noteId)
    if (noteStore.currentNote) {
      title.value = noteStore.currentNote.title
      content.value = noteStore.currentNote.content
    }
  } catch (error) {
    console.error('加载业务记录失败:', error)
    router.push('/')
  } finally {
    isLoading.value = false
  }
})

function onContentChange() {
  hasChanges.value = true
}

async function saveNote() {
  if (!noteStore.currentNote) return
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

async function toggleFavorite() {
  if (noteStore.currentNote) {
    await noteStore.updateNote(noteStore.currentNote.id, {
      isFavorite: !noteStore.currentNote.isFavorite
    })
  }
}

async function deleteNote() {
  if (noteStore.currentNote && confirm('确定要删除这条业务记录吗？')) {
    await noteStore.deleteNote(noteStore.currentNote.id)
    router.push('/')
  }
}

function formatLastSaved() {
  if (!lastSaved.value) return ''
  return `已于 ${lastSaved.value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 保存`
}
</script>

<template>
  <AppLayout>
    <div v-if="isLoading" class="flex items-center justify-center h-full">
      <div class="text-gray-400">加载中...</div>
    </div>

    <div v-else-if="noteStore.currentNote" class="flex flex-col h-full">
      <!-- 顶部操作栏 -->
      <div class="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
        <div class="flex items-center gap-2">
          <button
            @click="router.push('/')"
            class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <input
            v-model="title"
            type="text"
            placeholder="业务记录标题"
            class="text-xl font-semibold bg-transparent border-none outline-none flex-1"
            @input="onContentChange"
          />
        </div>
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
            @click="toggleFavorite"
            class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            :class="{ 'text-yellow-500': noteStore.currentNote?.isFavorite }"
          >
            <svg class="w-5 h-5" :fill="noteStore.currentNote?.isFavorite ? 'currentColor' : 'none'" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </button>
          <button
            @click="deleteNote"
            class="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 编辑区域 -->
      <div class="flex-1 p-4 overflow-auto">
        <RichTextEditor v-model="content" placeholder="开始写点什么..." @update:model-value="onContentChange" />
      </div>
    </div>

    <div v-else class="flex items-center justify-center h-full">
      <div class="text-center text-gray-400">
        <p>业务记录不存在</p>
        <button @click="router.push('/')" class="mt-4 btn btn-primary">
          返回首页
        </button>
      </div>
    </div>
  </AppLayout>
</template>
