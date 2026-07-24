<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import { BrandLogo, LanguageSwitch, ThemeToggle } from '@/components/ui'
</script>

<template>
  <main class="flex min-h-screen flex-col bg-white p-5 dark:bg-[#090b0f]">
    <div class="flex items-center justify-between"><BrandLogo /><div class="flex gap-2"><LanguageSwitch /><ThemeToggle /></div></div>
    <div class="m-auto max-w-lg text-center"><p class="text-8xl font-bold text-orange-500">404</p><h1 class="mt-4 text-2xl font-bold text-slate-950 dark:text-white">{{ $t('notFound.title') }}</h1><p class="mt-2 text-slate-500">{{ $t('notFound.description') }}</p><RouterLink to="/" class="btn btn-primary mt-6"><ArrowLeft class="h-4 w-4" />{{ $t('notFound.home') }}</RouterLink></div>
  </main>
</template>
