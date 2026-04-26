<script setup lang="ts">
import { ref, computed } from 'vue'
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

// 倒计时显示
const countdownText = computed(() => {
  return countdown.value > 0 ? `${countdown.value}s 后重新发送` : '发送验证码'
})

// 是否可以发送验证码
const canSendCode = computed(() => {
  return email.value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value) && countdown.value === 0 && !isSendingCode.value
})

// 发送验证码
async function handleSendCode() {
  if (!canSendCode.value) return

  isSendingCode.value = true
  error.value = ''

  try {
    const result = await userStore.sendVerificationCode(email.value)
    if (result.success) {
      // 开始倒计时
      countdown.value = 60
      const timer = setInterval(() => {
        countdown.value--
        if (countdown.value <= 0) {
          clearInterval(timer)
        }
      }, 1000)

      // 开发环境显示验证码
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
  // 验证
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

  if (password.value.length < 6) {
    error.value = '密码长度至少6位'
    return
  }

  if (verificationCode.value.length !== 6) {
    error.value = '请输入6位验证码'
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
  <div class="min-h-screen flex items-center justify-center bg-[var(--color-background-secondary)] px-4">
    <div class="w-full max-w-md">
      <!-- Logo -->
      <div class="text-center mb-8">
        <h1 class="text-3xl font-bold bg-gradient-to-r from-primary-500 to-purple-600 bg-clip-text text-transparent">NoteFlow</h1>
        <p class="text-gray-500 dark:text-gray-400 mt-2">智能笔记，高效记录</p>
      </div>

      <!-- 注册表单 -->
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
        <h2 class="text-xl font-semibold mb-6 text-gray-800 dark:text-gray-100">创建账号</h2>

        <form @submit.prevent="handleRegister" class="space-y-5" autocomplete="off">
          <!-- 邮箱 -->
          <div>
            <label class="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300">邮箱</label>
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
                @click="handleSendCode"
                :disabled="!canSendCode"
                class="px-4 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap"
                :class="canSendCode
                  ? 'bg-primary-500 text-white hover:bg-primary-600'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'"
              >
                {{ isSendingCode ? '发送中...' : countdownText }}
              </button>
            </div>
          </div>

          <!-- 验证码 -->
          <div>
            <label class="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300">验证码</label>
            <input
              v-model="verificationCode"
              type="text"
              placeholder="请输入6位验证码"
              class="input tracking-widest text-center"
              maxlength="6"
              autocomplete="one-time-code"
              required
            />
          </div>

          <!-- 用户名 -->
          <div>
            <label class="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300">用户名</label>
            <input
              v-model="username"
              type="text"
              placeholder="请输入用户名"
              class="input"
              autocomplete="new-username"
              required
            />
          </div>

          <!-- 密码 -->
          <div>
            <label class="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300">密码</label>
            <input
              v-model="password"
              type="password"
              placeholder="请输入密码（至少6位）"
              class="input"
              autocomplete="new-password"
              required
            />
          </div>

          <!-- 确认密码 -->
          <div>
            <label class="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300">确认密码</label>
            <input
              v-model="confirmPassword"
              type="password"
              placeholder="请再次输入密码"
              class="input"
              autocomplete="new-password"
              required
            />
          </div>

          <!-- 错误提示 -->
          <div v-if="error" class="text-red-500 text-sm bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
            {{ error }}
          </div>

          <!-- 注册按钮 -->
          <button
            type="submit"
            class="w-full btn btn-primary py-3 text-base font-medium"
            :disabled="isLoading"
          >
            <span v-if="isLoading" class="flex items-center justify-center gap-2">
              <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              注册中...
            </span>
            <span v-else>注册</span>
          </button>
        </form>

        <div class="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          已有账号？
          <RouterLink to="/login" class="text-primary-500 hover:text-primary-600 font-medium">
            立即登录
          </RouterLink>
        </div>
      </div>

      <!-- 提示 -->
      <p class="text-center text-xs text-gray-400 mt-6">
        注册即表示同意我们的服务条款和隐私政策
      </p>
    </div>
  </div>
</template>
