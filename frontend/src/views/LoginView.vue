<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
    error.value = '请输入邮箱和密码'
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
  <div class="flex min-h-screen items-center justify-center bg-[var(--color-background-secondary)] px-4">
    <div class="w-full max-w-md">
      <div class="mb-8 text-center">
        <h1 class="text-3xl font-bold text-primary-600">AutoFlow</h1>
        <p class="mt-2 text-gray-500">Dropshipping 客户开发自动化工作台</p>
      </div>

      <div class="card p-6">
        <h2 class="mb-6 text-xl font-semibold">登录</h2>

        <form class="space-y-4" @submit.prevent="handleLogin">
          <div>
            <label class="mb-1 block text-sm font-medium">邮箱</label>
            <input
              v-model="email"
              type="email"
              placeholder="请输入邮箱"
              class="input"
              required
            />
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium">密码</label>
            <input
              v-model="password"
              type="password"
              placeholder="请输入密码"
              class="input"
              required
            />
          </div>

          <div v-if="error" class="text-sm text-red-500">{{ error }}</div>

          <button type="submit" class="btn btn-primary w-full" :disabled="isLoading">
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
