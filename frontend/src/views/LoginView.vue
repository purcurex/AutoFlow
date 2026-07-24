<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRight, LockKeyhole, Mail } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useUserStore } from '@/stores'
import { BrandLogo, LanguageSwitch, ThemeToggle } from '@/components/ui'

const email = ref('')
const password = ref('')
const error = ref('')
const isLoading = ref(false)
const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const { t } = useI18n()

async function handleLogin() {
  if (!email.value || !password.value) {
    error.value = t('auth.loginRequired')
    return
  }
  isLoading.value = true
  error.value = ''
  try {
    await userStore.login(email.value, password.value)
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/'
    await router.push(redirect)
  } catch (err: unknown) {
    error.value = (err as { message?: string }).message || t('auth.loginFailed')
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <main class="grid min-h-screen bg-white dark:bg-[#090b0f] lg:grid-cols-[minmax(0,1fr)_520px]">
    <section class="relative hidden overflow-hidden border-r border-sky-200 bg-[#eaf4ff] px-12 py-10 text-slate-950 lg:flex lg:flex-col">
      <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-600 via-amber-400 to-emerald-500" />
      <BrandLogo />
      <div class="my-auto max-w-xl">
        <p class="text-xs font-bold uppercase text-orange-600">HyperZone Sales OS</p>
        <h1 class="mt-5 text-5xl font-bold leading-tight tracking-normal">{{ t('auth.welcome') }}</h1>
        <p class="mt-5 max-w-lg text-lg leading-8 text-slate-600">{{ t('auth.loginHint') }}</p>
        <div class="mt-10 grid grid-cols-3 gap-3 text-sm">
          <div class="border-l-2 border-orange-500 pl-3"><strong class="block text-slate-950">{{ t('auth.discover') }}</strong><span class="text-slate-500">{{ t('auth.discoverCaption') }}</span></div>
          <div class="border-l-2 border-amber-500 pl-3"><strong class="block text-slate-950">{{ t('auth.qualify') }}</strong><span class="text-slate-500">{{ t('auth.qualifyCaption') }}</span></div>
          <div class="border-l-2 border-emerald-500 pl-3"><strong class="block text-slate-950">{{ t('auth.connect') }}</strong><span class="text-slate-500">{{ t('auth.connectCaption') }}</span></div>
        </div>
      </div>
      <p class="text-xs text-slate-500">© 2026 HyperZone. AutoFlow Sales Operations.</p>
    </section>

    <section class="flex min-h-screen flex-col px-5 py-5 sm:px-10 lg:px-14">
      <div class="flex items-center justify-between lg:justify-end"><BrandLogo class="lg:hidden" /><div class="flex gap-2"><LanguageSwitch /><ThemeToggle /></div></div>
      <div class="my-auto w-full max-w-sm self-center py-10">
        <p class="text-xs font-bold uppercase text-orange-600 dark:text-orange-400">AutoFlow</p>
        <h2 class="mt-2 text-3xl font-bold tracking-normal text-slate-950 dark:text-white">{{ t('auth.welcome') }}</h2>
        <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">{{ t('auth.loginHint') }}</p>

        <form class="mt-8 space-y-5" @submit.prevent="handleLogin">
          <label class="block"><span class="field-label">{{ t('auth.email') }}</span><span class="relative block"><Mail class="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><input v-model="email" type="email" class="input pl-10" :placeholder="t('auth.emailPlaceholder')" autocomplete="email" required /></span></label>
          <label class="block"><span class="field-label">{{ t('auth.password') }}</span><span class="relative block"><LockKeyhole class="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><input v-model="password" type="password" class="input pl-10" :placeholder="t('auth.passwordPlaceholder')" autocomplete="current-password" required /></span></label>
          <div v-if="error" class="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{{ error }}</div>
          <button type="submit" class="btn btn-primary w-full" :disabled="isLoading"><span>{{ isLoading ? t('auth.loggingIn') : t('auth.login') }}</span><ArrowRight v-if="!isLoading" class="h-4 w-4" /></button>
        </form>
        <p class="mt-7 text-center text-sm text-slate-500">{{ t('auth.noAccount') }} <RouterLink to="/register" class="font-semibold text-orange-600 hover:text-orange-700 dark:text-orange-400">{{ t('auth.registerNow') }}</RouterLink></p>
      </div>
    </section>
  </main>
</template>
