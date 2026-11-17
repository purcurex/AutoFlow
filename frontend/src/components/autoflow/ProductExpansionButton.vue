<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ChevronsDown, ChevronsUp } from 'lucide-vue-next'
defineProps<{ expanded: boolean; disabled?: boolean }>()
defineEmits<{ toggle: [] }>()
const { locale } = useI18n()
</script>
<template>
  <button type="button" class="workbench-button" data-testid="toggle-all-products" :disabled="disabled" :aria-expanded="expanded" @click="$emit('toggle')">
    <component :is="expanded ? ChevronsUp : ChevronsDown" :size="15" />
    {{ String(locale).startsWith('zh') ? expanded ? '全部收起（本页）' : '全部展开（本页）' : expanded ? 'Collapse all on page' : 'Expand all on page' }}
  </button>
</template>
