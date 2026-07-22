<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores'

const router = useRouter()
const userStore = useUserStore()

const email = ref('')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const verificationCode = ref('')
const error = ref('')
const isLoading = ref(false)
const isSendingCode = ref(false)
const countdown = ref(0)

const countdownText = computed(() => {
  return countdown.value > 0 ? `${countdown.value}s 后重新发送` : '发送验证码'
})

const canSendCode = computed(() => {
  return email.value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value) && countdown.value === 0 && !isSendingCode.value
})

async function handleSendCode() {
  if (!canSendCode.value) return

  isSendingCode.value = true
  error.value = ''

  try {
    const result = await userStore.sendVerificationCode(email.value)
    if (result.success) {
      countdown.value = 60
      const timer = setInterval(() => {
        countdown.value--
        if (countdown.value <= 0) {
          clearInterval(timer)
        }
      }, 1000)

      if (result.message.includes('开发模式')) {
        alert(result.message)
      }
    } else {
      error.value = result.message
    }
  } catch (err: any) {
    error.value = err.response?.data?.message || '发送验证码失败'
  } finally {
    isSendingCode.value = false
  }
}

async function handleRegister() {
  if (!email.value || !username.value || !password.value || !verificationCode.value) {
    error.value = '请填写所有必填项'
    return
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
    error.value = '请输入有效的邮箱地址'
    return
  }

  if (password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return
  }

  if (password.value.length < 10) {
    error.value = '密码长度至少 10 位'
    return
  }

  if (verificationCode.value.length !== 6) {
    error.value = '请输入 6 位验证码'
    return
  }

  isLoading.value = true
  error.value = ''

  try {
    await userStore.register(email.value, username.value, password.value, verificationCode.value)
    router.push('/')
  } catch (err: any) {
    error.value = err.response?.data?.message || '注册失败，请稍后重试'
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-[var(--color-background-secondary)] px-4">
    <div class="w-full max-w-md">
      <div class="mb-8 text-center">
        <h1 class="bg-gradient-to-r from-primary-500 to-teal-500 bg-clip-text text-3xl font-bold text-transparent">AutoFlow</h1>
        <p class="mt-2 text-gray-500 dark:text-gray-400">为 Dropshipping 销售团队提效</p>
      </div>

      <div class="rounded-2xl bg-white p-8 shadow-xl dark:bg-gray-800">
        <h2 class="mb-6 text-xl font-semibold text-gray-800 dark:text-gray-100">创建账号</h2>

        <form class="space-y-5" autocomplete="off" @submit.prevent="handleRegister">
          <div>
            <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">邮箱</label>
            <div class="flex gap-2">
              <input
                v-model="email"
                type="email"
                placeholder="请输入邮箱"
                class="input flex-1"
                autocomplete="new-email"
                required
              />
              <button
                type="button"
                :disabled="!canSendCode"
                class="whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all"
                :class="canSendCode
                  ? 'bg-primary-500 text-white hover:bg-primary-600'
                  : 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'"
                @click="handleSendCode"
              >
                {{ isSendingCode ? '发送中...' : countdownText }}
              </button>
            </div>
          </div>

          <div>
            <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">验证码</label>
            <input
              v-model="verificationCode"
              type="text"
              placeholder="请输入 6 位验证码"
              class="input text-center tracking-widest"
              maxlength="6"
              autocomplete="one-time-code"
              required
            />
          </div>

          <div>
            <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">用户名</label>
            <input
              v-model="username"
              type="text"
              placeholder="请输入用户名"
              class="input"
              autocomplete="new-username"
              required
            />
          </div>

          <div>
            <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">密码</label>
            <input
              v-model="password"
              type="password"
              placeholder="请输入密码，至少 10 位"
              class="input"
              autocomplete="new-password"
              required
            />
          </div>

          <div>
            <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">确认密码</label>
            <input
              v-model="confirmPassword"
              type="password"
              placeholder="请再次输入密码"
              class="input"
              autocomplete="new-password"
              required
            />
          </div>

          <div v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-500 dark:bg-red-900/20">
            {{ error }}
          </div>

          <button type="submit" class="btn btn-primary w-full py-3 text-base font-medium" :disabled="isLoading">
            {{ isLoading ? '注册中...' : '注册' }}
          </button>
        </form>

        <div class="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          已有账号？
          <RouterLink to="/login" class="font-medium text-primary-500 hover:text-primary-600">
            立即登录
          </RouterLink>
        </div>
      </div>

      <p class="mt-6 text-center text-xs text-gray-400">
        注册即表示同意公司内部销售自动化工具使用规范。
      </p>
    </div>
  </div>
</template>
