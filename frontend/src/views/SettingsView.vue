<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore, useNoteStore } from '@/stores'
import { AppLayout } from '@/components/layout'
import { exportNotesToPdf } from '@/utils/export'
import type { Note } from '@/types'

const router = useRouter()
const userStore = useUserStore()
const noteStore = useNoteStore()

const username = ref('')
const email = ref('')
const isDarkMode = ref(false)
const isSaving = ref(false)
const isUploadingAvatar = ref(false)
const saveMessage = ref('')
const avatarInput = ref<HTMLInputElement | null>(null)
const isExporting = ref(false)

onMounted(async () => {
  // 获取用户信息
  await userStore.fetchUser()
  if (userStore.user) {
    username.value = userStore.user.username
    email.value = userStore.user.email
  }
  isDarkMode.value = document.documentElement.classList.contains('dark')
  // 获取兼容层中的业务记录列表
  await noteStore.fetchNotes()
})

function toggleDarkMode() {
  isDarkMode.value = !isDarkMode.value
  document.documentElement.classList.toggle('dark', isDarkMode.value)
  localStorage.setItem('darkMode', String(isDarkMode.value))
}

async function updateProfile() {
  if (!username.value.trim()) {
    saveMessage.value = '用户名不能为空'
    return
  }

  isSaving.value = true
  saveMessage.value = ''

  try {
    await userStore.updateProfile({ username: username.value })
    saveMessage.value = '保存成功！'
    setTimeout(() => {
      saveMessage.value = ''
    }, 2000)
  } catch (error: unknown) {
    const err = error as { message?: string }
    saveMessage.value = err.message || '保存失败'
  } finally {
    isSaving.value = false
  }
}

function triggerAvatarUpload() {
  avatarInput.value?.click()
}

async function handleAvatarChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  // 验证文件类型
  if (!file.type.match(/image\/(jpg|jpeg|png|gif|webp)/)) {
    saveMessage.value = '只支持 jpg, jpeg, png, gif, webp 格式的图片'
    return
  }

  // 验证文件大小 (5MB)
  if (file.size > 5 * 1024 * 1024) {
    saveMessage.value = '图片大小不能超过 5MB'
    return
  }

  isUploadingAvatar.value = true
  saveMessage.value = ''

  try {
    await userStore.uploadAvatar(file)
    saveMessage.value = '头像上传成功！'
    setTimeout(() => {
      saveMessage.value = ''
    }, 2000)
  } catch (error: unknown) {
    const err = error as { message?: string }
    saveMessage.value = err.message || '上传失败'
  } finally {
    isUploadingAvatar.value = false
    // 清空input以便重复选择同一文件
    input.value = ''
  }
}

function goBack() {
  router.push('/')
}

async function logout() {
  userStore.logout()
  router.push('/login')
}

// 导出所有业务记录
async function exportAllNotes() {
  if (isExporting.value) return

  // 获取所有业务记录
  const notes = noteStore.notes as Note[]
  if (!notes || notes.length === 0) {
    saveMessage.value = '没有业务记录可导出'
    setTimeout(() => { saveMessage.value = '' }, 2000)
    return
  }

  isExporting.value = true
  saveMessage.value = ''

  try {
    // 导出 PDF
    await exportNotesToPdf(notes, userStore.user?.username)
    saveMessage.value = `已导出 ${notes.length} 条业务记录`
    setTimeout(() => { saveMessage.value = '' }, 3000)
  } catch (error) {
    console.error('导出失败:', error)
    saveMessage.value = '导出失败，请重试'
    setTimeout(() => { saveMessage.value = '' }, 2000)
  } finally {
    isExporting.value = false
  }
}
</script>

<template>
  <AppLayout>
    <div class="max-w-2xl mx-auto p-6">
      <!-- 顶部导航 -->
      <div class="flex items-center gap-4 mb-6">
        <button
          @click="goBack"
          class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title="返回工作台"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <h1 class="text-2xl font-bold">设置</h1>
      </div>

      <!-- 个人信息 -->
      <div class="card p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">个人信息</h2>
        <div class="space-y-6">
          <!-- 头像上传 -->
          <div class="flex items-center gap-6">
            <div class="relative group">
              <div
                class="w-20 h-20 rounded-full bg-primary-500 flex items-center justify-center text-white text-2xl font-medium overflow-hidden"
              >
                <img
                  v-if="userStore.avatarUrl"
                  :src="userStore.avatarUrl"
                  alt="头像"
                  class="w-full h-full object-cover"
                />
                <span v-else>{{ (username || 'U').charAt(0).toUpperCase() }}</span>
              </div>
              <button
                @click="triggerAvatarUpload"
                class="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                :disabled="isUploadingAvatar"
              >
                <svg v-if="isUploadingAvatar" class="w-6 h-6 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <svg v-else class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <input
                ref="avatarInput"
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                class="hidden"
                @change="handleAvatarChange"
              />
            </div>
            <div>
              <div class="font-medium">头像</div>
              <div class="text-sm text-gray-500">点击更换头像，支持 jpg、png、gif、webp</div>
              <div class="text-xs text-gray-400">最大 5MB</div>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium mb-1">用户名</label>
            <input v-model="username" type="text" class="input" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">邮箱</label>
            <input v-model="email" type="email" class="input" disabled />
            <p class="text-xs text-gray-400 mt-1">邮箱不可更改</p>
          </div>
          <div class="flex items-center gap-4">
            <button
              @click="updateProfile"
              class="btn btn-primary"
              :disabled="isSaving"
            >
              {{ isSaving ? '保存中...' : '保存更改' }}
            </button>
            <span v-if="saveMessage" class="text-sm" :class="saveMessage.includes('成功') ? 'text-green-500' : 'text-red-500'">
              {{ saveMessage }}
            </span>
          </div>
        </div>
      </div>

      <!-- 外观设置 -->
      <div class="card p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">外观</h2>
        <div class="flex items-center justify-between">
          <div>
            <div class="font-medium">深色模式</div>
            <div class="text-sm text-gray-500">切换深色/浅色主题</div>
          </div>
          <button
            @click="toggleDarkMode"
            class="relative w-12 h-6 rounded-full transition-colors"
            :class="isDarkMode ? 'bg-primary-600' : 'bg-gray-300'"
          >
            <span
              class="absolute top-1 w-4 h-4 bg-white rounded-full transition-transform"
              :class="isDarkMode ? 'translate-x-7' : 'translate-x-1'"
            />
          </button>
        </div>
      </div>

      <!-- 数据管理 -->
      <div class="card p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">数据管理</h2>
        <div class="space-y-3">
          <button
            @click="exportAllNotes"
            class="btn btn-secondary w-full justify-start gap-2"
            :disabled="isExporting"
          >
            <svg v-if="isExporting" class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {{ isExporting ? '导出中...' : '导出所有业务记录 (PDF)' }}
          </button>
          <button class="btn btn-secondary w-full justify-start gap-2" disabled>
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            导入业务记录 (开发中)
          </button>
        </div>
        <p v-if="saveMessage" class="text-sm mt-2" :class="saveMessage.includes('导出') ? 'text-green-500' : 'text-red-500'">
          {{ saveMessage }}
        </p>
      </div>

      <!-- 退出登录 -->
      <div class="card p-6">
        <h2 class="text-lg font-semibold mb-4">账户</h2>
        <button
          @click="logout"
          class="btn bg-red-500 text-white hover:bg-red-600 w-full justify-start gap-2"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          退出登录
        </button>
      </div>
    </div>
  </AppLayout>
</template>
