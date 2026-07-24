<script setup lang="ts">
import { Moon, Sun } from 'lucide-vue-next'
import { useTheme } from '@/composables/useTheme'

const { isDark, toggleTheme } = useTheme()
</script>

<template>
  <button class="icon-btn" :title="isDark ? $t('common.light') : $t('common.dark')" @click="toggleTheme">
    <Sun v-if="isDark" class="h-4 w-4" />
    <Moon v-else class="h-4 w-4" />
    <span class="sr-only">{{ isDark ? $t('common.light') : $t('common.dark') }}</span>
  </button>
</template>
