<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useNoteStore } from '@/stores'
import { useRouter } from 'vue-router'
import type { Folder } from '@/types'

const props = defineProps<{
  collapsed: boolean
}>()

const emit = defineEmits<{
  toggle: []
}>()

const router = useRouter()
const noteStore = useNoteStore()

const showNewFolderDialog = ref(false)
const newFolderName = ref('')
const isCreatingFolder = ref(false)
const showDeleteConfirm = ref<string | null>(null)

const folderTree = computed(() => {
  const buildTree = (folders: Folder[], parentId: string | null = null): (Folder & { children: Folder[] })[] => {
    return folders
      .filter(f => f.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(folder => ({
        ...folder,
        children: buildTree(folders, folder.id)
      }))
  }
  return buildTree(noteStore.folders || [])
})

onMounted(async () => {
  await noteStore.fetchFolders()
})

function createNewNote() {
  router.push('/')
  noteStore.createNote({ title: '无标题笔记', content: '' })
}

function selectFolder(folder: Folder | null) {
  noteStore.setCurrentFolder(folder)
}

function openNewFolderDialog() {
  newFolderName.value = ''
  showNewFolderDialog.value = true
}

async function createFolder() {
  if (!newFolderName.value.trim()) return

  isCreatingFolder.value = true
  try {
    await noteStore.createFolder({ name: newFolderName.value.trim() })
    showNewFolderDialog.value = false
    newFolderName.value = ''
  } catch (error) {
    console.error('创建文件夹失败:', error)
  } finally {
    isCreatingFolder.value = false
  }
}

function cancelCreateFolder() {
  showNewFolderDialog.value = false
  newFolderName.value = ''
}

async function deleteFolder(folderId: string) {
  try {
    await noteStore.deleteFolder(folderId)
    // 如果当前选中的是被删除的文件夹，清除选中状态
    if (noteStore.currentFolder?.id === folderId) {
      noteStore.setCurrentFolder(null)
    }
    showDeleteConfirm.value = null
  } catch (error) {
    console.error('删除文件夹失败:', error)
    alert('删除失败，该文件夹下可能有子文件夹')
  }
}

function confirmDelete(folderId: string) {
  showDeleteConfirm.value = folderId
}

function cancelDelete() {
  showDeleteConfirm.value = null
}
</script>

<template>
  <aside
    class="h-full bg-[var(--color-background-secondary)] border-r border-[var(--color-border)] transition-all duration-300 flex flex-col"
    :class="collapsed ? 'w-0 overflow-hidden' : 'w-64'"
  >
    <!-- 新建笔记按钮 -->
    <div class="p-3">
      <button
        @click="createNewNote"
        class="w-full btn btn-primary gap-2"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        新建笔记
      </button>
    </div>

    <!-- 收藏夹 -->
    <div class="px-3 py-2">
      <div
        class="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
        :class="{ 'bg-primary-50 dark:bg-primary-900/30': noteStore.currentFolder === null }"
        @click="selectFolder(null)"
      >
        <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <span class="text-sm">所有笔记</span>
        <span class="ml-auto text-xs text-gray-400">{{ noteStore.notes?.length || 0 }}</span>
      </div>
    </div>

    <!-- 文件夹列表 -->
    <div class="flex-1 overflow-auto px-3">
      <div class="text-xs font-medium text-gray-400 uppercase tracking-wider px-2 py-2">
        文件夹
      </div>
      <ul class="space-y-1">
        <li
          v-for="folder in folderTree"
          :key="folder.id"
          class="group"
        >
          <div
            class="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
            :class="{ 'bg-primary-50 dark:bg-primary-900/30': noteStore.currentFolder?.id === folder.id }"
          >
            <div class="flex items-center gap-2 flex-1 min-w-0" @click="selectFolder(folder)">
              <svg class="w-5 h-5 text-primary-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
              </svg>
              <span class="text-sm truncate">{{ folder.name }}</span>
              <span class="text-xs text-gray-400">
                {{ noteStore.notesByFolder.get(folder.id)?.length || 0 }}
              </span>
            </div>
            <!-- 删除按钮 -->
            <button
              v-if="showDeleteConfirm !== folder.id"
              @click.stop="confirmDelete(folder.id)"
              class="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              title="删除文件夹"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
            <!-- 确认删除 -->
            <div v-else class="flex items-center gap-1">
              <button
                @click.stop="deleteFolder(folder.id)"
                class="p-1 rounded bg-red-500 text-white hover:bg-red-600"
                title="确认删除"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
              </button>
              <button
                @click.stop="cancelDelete"
                class="p-1 rounded bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500"
                title="取消"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <!-- 子文件夹 -->
          <ul v-if="folder.children.length > 0" class="ml-4 space-y-1">
            <li
              v-for="child in folder.children"
              :key="child.id"
              class="group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 text-sm"
              :class="{ 'bg-primary-50 dark:bg-primary-900/30': noteStore.currentFolder?.id === child.id }"
              @click="selectFolder(child)"
            >
              <svg class="w-4 h-4 text-primary-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
              </svg>
              <span class="truncate flex-1">{{ child.name }}</span>
              <button
                @click.stop="confirmDelete(child.id)"
                class="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                title="删除文件夹"
              >
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          </ul>
        </li>
      </ul>
      <div v-if="folderTree.length === 0" class="px-2 py-4 text-center text-gray-400 text-xs">
        暂无文件夹
      </div>
    </div>

    <!-- 底部操作 -->
    <div class="p-3 border-t border-[var(--color-border)]">
      <button
        @click="openNewFolderDialog"
        class="w-full btn btn-secondary text-sm gap-2"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        新建文件夹
      </button>
    </div>

    <!-- 新建文件夹弹窗 -->
    <Teleport to="body">
      <div
        v-if="showNewFolderDialog"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        @click.self="cancelCreateFolder"
      >
        <div class="bg-white dark:bg-gray-800 rounded-xl p-6 w-80 shadow-xl">
          <h3 class="text-lg font-semibold mb-4">新建文件夹</h3>
          <input
            v-model="newFolderName"
            type="text"
            placeholder="输入文件夹名称"
            class="input mb-4"
            @keyup.enter="createFolder"
            autofocus
          />
          <div class="flex justify-end gap-2">
            <button
              @click="cancelCreateFolder"
              class="btn btn-secondary"
            >
              取消
            </button>
            <button
              @click="createFolder"
              class="btn btn-primary"
              :disabled="!newFolderName.trim() || isCreatingFolder"
            >
              {{ isCreatingFolder ? '创建中...' : '创建' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </aside>
</template>
