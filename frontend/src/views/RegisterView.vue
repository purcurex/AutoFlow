<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores'

const router = useRouter()
const userStore = useUserStore()

const email = ref('')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const isLoading = ref(false)

async function handleRegister() {
  if (!email.value || !username.value || !password.value) {
    error.value = '请填写所有必填项'
    return
  }

  if (password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return
  }

  if (password.value.length < 6) {
    error.value = '密码长度至少6位'
    return
  }

  isLoading.value = true
  error.value = ''

  try {
    await userStore.register(email.value, username.value, password.value)
    router.push('/')
  } catch (err: any) {
    error.value = err.message || '注册失败，请稍后重试'
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-[var(--color-background-secondary)] px-4">
    <div class="w-full max-w-md">
      <!-- Logo -->
      <div class="text-center mb-8">
        <h1 class="text-3xl font-bold text-primary-600">NoteFlow</h1>
        <p class="text-gray-500 mt-2">智能笔记，高效记录</p>
      </div>

      <!-- 注册表单 -->
      <div class="card p-6">
        <h2 class="text-xl font-semibold mb-6">创建账号</h2>

        <form @submit.prevent="handleRegister" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">邮箱</label>
            <input
              v-model="email"
              type="email"
              placeholder="请输入邮箱"
              class="input"
              required
            />
          </div>

          <div>
            <label class="block text-sm font-medium mb-1">用户名</label>
            <input
              v-model="username"
              type="text"
              placeholder="请输入用户名"
              class="input"
              required
            />
          </div>

          <div>
            <label class="block text-sm font-medium mb-1">密码</label>
            <input
              v-model="password"
              type="password"
              placeholder="请输入密码（至少6位）"
              class="input"
              required
            />
          </div>

          <div>
            <label class="block text-sm font-medium mb-1">确认密码</label>
            <input
              v-model="confirmPassword"
              type="password"
              placeholder="请再次输入密码"
              class="input"
              required
            />
          </div>

          <div v-if="error" class="text-red-500 text-sm">{{ error }}</div>

          <button
            type="submit"
            class="w-full btn btn-primary"
            :disabled="isLoading"
          >
            {{ isLoading ? '注册中...' : '注册' }}
          </button>
        </form>

        <div class="mt-6 text-center text-sm text-gray-500">
          已有账号？
          <RouterLink to="/login" class="text-primary-600 hover:underline">
            立即登录
          </RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>
