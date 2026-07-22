<template>
  <div class="min-h-screen bg-gray-100 dark:bg-gray-900 transition-colors">
    <!-- 头部 -->
    <div class="bg-gradient-to-r from-primary-500 to-purple-600 text-white px-6 py-4 flex justify-between items-center">
      <h1 class="text-xl font-semibold m-0">管理员面板</h1>
      <button @click="goBack" class="bg-white/20 border border-white/30 text-white px-4 py-2 rounded-lg hover:bg-white/30 transition-colors">
        返回主页
      </button>
    </div>

    <div class="p-6 max-w-7xl mx-auto">
      <!-- 统计卡片 -->
      <div class="flex gap-6 mb-6">
        <div class="bg-gradient-to-r from-primary-500 to-purple-600 px-6 py-5 rounded-xl shadow-lg min-w-[150px]">
          <div class="text-3xl font-bold text-white">{{ notes.length }}</div>
          <div class="text-white/90 mt-1 text-sm">业务记录总数</div>
        </div>
        <div class="bg-gradient-to-r from-green-500 to-emerald-600 px-6 py-5 rounded-xl shadow-lg min-w-[150px]">
          <div class="text-3xl font-bold text-white">{{ uniqueUsers }}</div>
          <div class="text-white/90 mt-1 text-sm">用户数量</div>
        </div>
      </div>

      <!-- 业务记录表格 -->
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow p-6 transition-colors">
        <h2 class="text-lg font-semibold m-0 mb-4 text-gray-800 dark:text-gray-100">所有业务记录</h2>

        <!-- 搜索栏 -->
        <div class="mb-4">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索业务记录标题或作者..."
            class="px-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary-500 transition-colors w-80"
          />
        </div>

        <!-- 表格 -->
        <div class="overflow-x-auto">
          <table class="w-full border-collapse">
            <thead>
              <tr>
                <th @click="sortBy('title')" class="px-4 py-3 text-left border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 font-semibold text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none">
                  <div class="flex items-center gap-1">
                    标题
                    <span v-if="sortField === 'title'" class="text-primary-500">
                      {{ sortOrder === 'asc' ? '↑' : '↓' }}
                    </span>
                  </div>
                </th>
                <th @click="sortBy('author')" class="px-4 py-3 text-left border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 font-semibold text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none">
                  <div class="flex items-center gap-1">
                    作者
                    <span v-if="sortField === 'author'" class="text-primary-500">
                      {{ sortOrder === 'asc' ? '↑' : '↓' }}
                    </span>
                  </div>
                </th>
                <th @click="sortBy('email')" class="px-4 py-3 text-left border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 font-semibold text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none">
                  <div class="flex items-center gap-1">
                    邮箱
                    <span v-if="sortField === 'email'" class="text-primary-500">
                      {{ sortOrder === 'asc' ? '↑' : '↓' }}
                    </span>
                  </div>
                </th>
                <th @click="sortBy('createdAt')" class="px-4 py-3 text-left border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 font-semibold text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none">
                  <div class="flex items-center gap-1">
                    创建时间
                    <span v-if="sortField === 'createdAt'" class="text-primary-500">
                      {{ sortOrder === 'asc' ? '↑' : '↓' }}
                    </span>
                  </div>
                </th>
                <th @click="sortBy('updatedAt')" class="px-4 py-3 text-left border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 font-semibold text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none">
                  <div class="flex items-center gap-1">
                    更新时间
                    <span v-if="sortField === 'updatedAt'" class="text-primary-500">
                      {{ sortOrder === 'asc' ? '↑' : '↓' }}
                    </span>
                  </div>
                </th>
                <th class="px-4 py-3 text-left border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 font-semibold text-gray-700 dark:text-gray-200">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="note in filteredAndSortedNotes" :key="note.id" class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                <td class="px-4 py-3 border-b border-gray-100 dark:border-gray-700 text-gray-800 dark:text-gray-200 max-w-xs truncate">{{ note.title || '无标题' }}</td>
                <td class="px-4 py-3 border-b border-gray-100 dark:border-gray-700 text-gray-600 dark:text-gray-300">{{ note.user?.username || '-' }}</td>
                <td class="px-4 py-3 border-b border-gray-100 dark:border-gray-700 text-gray-600 dark:text-gray-300">{{ note.user?.email || '-' }}</td>
                <td class="px-4 py-3 border-b border-gray-100 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm">{{ formatDate(note.createdAt) }}</td>
                <td class="px-4 py-3 border-b border-gray-100 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm">{{ formatDate(note.updatedAt) }}</td>
                <td class="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                  <button @click="viewNote(note)" class="px-3 py-1 text-xs rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50 mr-2 transition-colors">查看</button>
                  <button @click="confirmDelete(note)" class="px-3 py-1 text-xs rounded bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 transition-colors">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="filteredAndSortedNotes.length === 0" class="text-center py-12 text-gray-400 dark:text-gray-500">
          暂无业务记录
        </div>
      </div>
    </div>

    <!-- 删除确认对话框 -->
    <div v-if="showDeleteDialog" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-white dark:bg-gray-800 p-6 rounded-xl max-w-md w-[90%] shadow-xl">
        <h3 class="text-lg font-semibold m-0 mb-2 text-gray-800 dark:text-gray-100">确认删除</h3>
        <p class="text-gray-600 dark:text-gray-300 mb-4">确定要删除业务记录「{{ noteToDelete?.title || '无标题' }}」吗？此操作不可恢复。</p>
        <div class="flex justify-end gap-3">
          <button @click="showDeleteDialog = false" class="px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">取消</button>
          <button @click="deleteNote" class="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors">删除</button>
        </div>
      </div>
    </div>

    <!-- 业务记录预览对话框 -->
    <div v-if="showViewDialog" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-white dark:bg-gray-800 p-6 rounded-xl max-w-3xl w-[90%] max-h-[80vh] overflow-y-auto shadow-xl">
        <h3 class="text-lg font-semibold m-0 mb-2 text-gray-800 dark:text-gray-100">{{ viewingNote?.title || '无标题' }}</h3>
        <p class="text-gray-500 dark:text-gray-400 text-sm mb-4">
          作者: {{ viewingNote?.user?.username }} | 创建时间: {{ formatDate(viewingNote?.createdAt) }}
        </p>
        <div class="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg max-h-96 overflow-y-auto text-gray-800 dark:text-gray-200" v-html="viewingNote?.content"></div>
        <div class="flex justify-end mt-4">
          <button @click="showViewDialog = false" class="px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { notesApi, type AdminNote } from '@/api/notes'

const router = useRouter()
const notes = ref<AdminNote[]>([])
const searchQuery = ref('')
const showDeleteDialog = ref(false)
const noteToDelete = ref<AdminNote | null>(null)
const showViewDialog = ref(false)
const viewingNote = ref<AdminNote | null>(null)

// 排序状态
const sortField = ref<string>('createdAt')
const sortOrder = ref<'asc' | 'desc'>('desc')

const uniqueUsers = computed(() => {
  const userIds = new Set(notes.value.map(n => n.userId))
  return userIds.size
})

// 筛选后的业务记录
const filteredNotes = computed(() => {
  if (!searchQuery.value) return notes.value

  const query = searchQuery.value.toLowerCase()
  return notes.value.filter(note =>
    note.title?.toLowerCase().includes(query) ||
    note.user?.username?.toLowerCase().includes(query)
  )
})

// 排序后的业务记录
const filteredAndSortedNotes = computed(() => {
  const result = [...filteredNotes.value]

  result.sort((a, b) => {
    let valueA: string | number = ''
    let valueB: string | number = ''

    switch (sortField.value) {
      case 'title':
        valueA = a.title || ''
        valueB = b.title || ''
        break
      case 'author':
        valueA = a.user?.username || ''
        valueB = b.user?.username || ''
        break
      case 'email':
        valueA = a.user?.email || ''
        valueB = b.user?.email || ''
        break
      case 'createdAt':
        valueA = new Date(a.createdAt || 0).getTime()
        valueB = new Date(b.createdAt || 0).getTime()
        break
      case 'updatedAt':
        valueA = new Date(a.updatedAt || 0).getTime()
        valueB = new Date(b.updatedAt || 0).getTime()
        break
    }

    if (typeof valueA === 'string' && typeof valueB === 'string') {
      const comparison = valueA.localeCompare(valueB, 'zh-CN')
      return sortOrder.value === 'asc' ? comparison : -comparison
    }

    if (typeof valueA === 'number' && typeof valueB === 'number') {
      return sortOrder.value === 'asc' ? valueA - valueB : valueB - valueA
    }

    return 0
  })

  return result
})

// 排序切换
function sortBy(field: string) {
  if (sortField.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortField.value = field
    sortOrder.value = 'asc'
  }
}

function formatDate(dateStr: string | undefined) {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN')
}

function goBack() {
  router.push('/')
}

function viewNote(note: AdminNote) {
  viewingNote.value = note
  showViewDialog.value = true
}

function confirmDelete(note: AdminNote) {
  noteToDelete.value = note
  showDeleteDialog.value = true
}

async function deleteNote() {
  if (!noteToDelete.value) return
  try {
    await notesApi.adminDelete(noteToDelete.value.id)
    notes.value = notes.value.filter(n => n.id !== noteToDelete.value!.id)
    showDeleteDialog.value = false
    noteToDelete.value = null
  } catch (error) {
    console.error('删除失败:', error)
    alert('删除失败')
  }
}

async function fetchNotes() {
  try {
    notes.value = await notesApi.adminGetAll()
  } catch (error) {
    console.error('获取业务记录列表失败:', error)
  }
}

onMounted(() => {
  fetchNotes()
})
</script>
