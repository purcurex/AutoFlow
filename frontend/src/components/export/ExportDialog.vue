<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Note } from '@/types'
import {
  downloadBlob,
  exportNoteToPdf,
  exportNotesToPdf
} from '@/utils/export'
import { useUserStore } from '@/stores/user'
import { notesApi } from '@/api/notes'

const userStore = useUserStore()

const props = defineProps<{
  visible: boolean
  notes: Note[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const exportFormat = ref<'excel' | 'pdf'>('pdf')
const isExporting = ref(false)

const isMultipleNotes = computed(() => props.notes.length > 1)
const noteCount = computed(() => props.notes.length)

const noteTitle = computed(() => {
  if (props.notes.length === 1) {
    return props.notes[0].title || '无标题业务记录'
  }
  return null
})

async function handleExport() {
  if (props.notes.length === 0) return

  isExporting.value = true

  try {
    // 使用 setTimeout 让 UI 有时间更新
    await new Promise(resolve => setTimeout(resolve, 100))

    if (exportFormat.value === 'excel') {
      const blob = await notesApi.exportExcel(props.notes.map(note => note.id))
      const date = new Date().toISOString().slice(0, 10)
      downloadBlob(blob, `业务记录导出_${props.notes.length}条_${date}.xlsx`)
    } else {
      if (props.notes.length === 1) {
        exportNoteToPdf(props.notes[0], userStore.username)
      } else {
        exportNotesToPdf(props.notes, userStore.username)
      }
    }

    emit('close')
  } catch (error) {
    console.error('导出失败:', error)
    alert('导出失败，请重试')
  } finally {
    isExporting.value = false
  }
}

function closeDialog() {
  if (!isExporting.value) {
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      @click.self="closeDialog"
    >
      <div class="bg-white dark:bg-gray-800 rounded-xl p-6 w-96 shadow-xl">
        <h3 class="text-lg font-semibold mb-4">
          {{ isMultipleNotes ? `导出 ${noteCount} 条业务记录` : '导出业务记录' }}
        </h3>

        <div v-if="noteTitle" class="mb-4 text-sm text-gray-500">
          业务记录: {{ noteTitle }}
        </div>

        <!-- 格式选择 -->
        <div class="mb-6">
          <label class="block text-sm font-medium mb-2">导出格式</label>
          <div class="flex gap-4">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                v-model="exportFormat"
                value="pdf"
                class="text-primary-500"
              />
              <span class="text-sm">PDF 文档</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                v-model="exportFormat"
                value="excel"
                class="text-primary-500"
              />
              <span class="text-sm">Excel 表格</span>
            </label>
          </div>

          <div class="mt-3 text-xs text-gray-400">
            <template v-if="exportFormat === 'pdf'">
              PDF 格式保留业务记录排版，适合打印和分享
            </template>
            <template v-else>
              Excel 格式便于数据整理和后续编辑
            </template>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex justify-end gap-2">
          <button
            @click="closeDialog"
            class="btn btn-secondary"
            :disabled="isExporting"
          >
            取消
          </button>
          <button
            @click="handleExport"
            class="btn btn-primary gap-2"
            :disabled="isExporting"
          >
            <svg
              v-if="isExporting"
              class="w-4 h-4 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {{ isExporting ? '导出中...' : '导出' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
