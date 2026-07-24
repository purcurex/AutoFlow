<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useReturnNavigation } from '@/composables/useReturnNavigation'

const props = withDefaults(defineProps<{
  fallback: string
  compact?: boolean
  label?: string
}>(), {
  compact: false,
  label: '',
})

const { t } = useI18n()
const { goBack } = useReturnNavigation(props.fallback)
</script>

<template>
  <button
    type="button"
    :class="compact ? 'icon-btn' : 'btn btn-ghost'"
    :title="label || t('common.back')"
    :aria-label="label || t('common.back')"
    data-test="detail-return"
    @click="goBack"
  >
    <ArrowLeft class="h-4 w-4" />
    <span v-if="!compact">{{ label || t('common.back') }}</span>
  </button>
</template>
