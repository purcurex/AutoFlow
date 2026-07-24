<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { onClickOutside } from '@vueuse/core'
import cnFlag from 'flag-icons/flags/4x3/cn.svg'
import usFlag from 'flag-icons/flags/4x3/us.svg'
import { setLocale, type AppLocale } from '@/i18n'

const { locale } = useI18n()
const root = ref<HTMLElement | null>(null)
const open = ref(false)
const options: Array<{ value: AppLocale; label: string; flag: string }> = [
  { value: 'zh-CN', label: '简体中文', flag: cnFlag },
  { value: 'en', label: 'English', flag: usFlag },
]
const current = computed(() => options.find((option) => option.value === locale.value) || options[0])
const availableOptions = computed(() => options.filter((option) => option.value !== locale.value))

function changeLocale(value: AppLocale) {
  setLocale(value)
  open.value = false
}

onClickOutside(root, () => { open.value = false })
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="flex h-10 w-[140px] items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#15181d] dark:text-slate-100 dark:hover:bg-[#20242b]"
      :aria-label="$t('common.language')"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="open = !open"
      @keydown.esc="open = false"
    >
      <img :src="current.flag" alt="" class="h-4 w-6 rounded-[2px] object-cover shadow-sm" />
      <span class="flex-1 whitespace-nowrap text-left">{{ current.label }}</span>
      <ChevronDown class="h-4 w-4 transition-transform" :class="open ? 'rotate-180' : ''" />
    </button>

    <div
      v-if="open"
      class="absolute right-0 top-full z-50 mt-1.5 w-[140px] overflow-hidden rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-[#15181d]"
      role="menu"
    >
      <button
        v-for="option in availableOptions"
        :key="option.value"
        type="button"
        class="flex w-full items-center gap-2 rounded px-2 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-orange-50 hover:text-orange-700 dark:text-slate-100 dark:hover:bg-orange-950/40 dark:hover:text-orange-300"
        role="menuitemradio"
        aria-checked="false"
        @click="changeLocale(option.value)"
      >
        <img :src="option.flag" alt="" class="h-4 w-6 rounded-[2px] object-cover shadow-sm" />
        <span class="flex-1 whitespace-nowrap">{{ option.label }}</span>
      </button>
    </div>
  </div>
</template>
