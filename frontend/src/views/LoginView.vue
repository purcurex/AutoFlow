<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '@/stores'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const email = ref('')
const password = ref('')
const error = ref('')
const isLoading = ref(false)

async function handleLogin() {
  if (!email.value || !password.value) {
    error.value = '请填写邮箱和密码'
    return
  }

  isLoading.value = true
  error.value = ''

  try {
    await userStore.login(email.value, password.value)
    const redirect = route.query.redirect as string
    router.push(redirect || '/')
  } catch (err: any) {
    error.value = err.message || '登录失败，请检查邮箱和密码'
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

      <!-- 登录表单 -->
      <div class="card p-6">
        <h2 class="text-xl font-semibold mb-6">登录</h2>

        <form @submit.prevent="handleLogin" class="space-y-4">
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
            <label class="block text-sm font-medium mb-1">密码</label>
            <input
              v-model="password"
              type="password"
              placeholder="请输入密码"
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
            {{ isLoading ? '登录中...' : '登录' }}
          </button>
        </form>

        <div class="mt-6 text-center text-sm text-gray-500">
          还没有账号？
          <RouterLink to="/register" class="text-primary-600 hover:underline">
            立即注册
          </RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>
