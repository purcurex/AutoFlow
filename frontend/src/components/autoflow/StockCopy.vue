<script setup lang="ts">
import { ref } from 'vue'
import { Check, Copy } from 'lucide-vue-next'
import { copyText } from '@/utils/copyText'
defineProps<{ value: string }>()
const done = ref(false), error = ref(false)
async function copy(value: string) {
  try { await copyText(value); done.value = true; error.value = false } catch { error.value = true }
}
</script>
<template><span class="stock-copy"><span :title="value">{{ value }}</span><button type="button" :title="error ? '复制失败 / Copy failed' : done ? '已复制 / Copied' : '复制 / Copy'" :aria-label="`复制 / Copy ${value}`" @click="copy(value)" @mouseleave="done = false"><Check v-if="done" :size="12" /><Copy v-else :size="12" /></button></span></template>
<style scoped>.stock-copy{display:inline-flex;align-items:center;gap:5px;max-width:100%;min-width:0;vertical-align:middle}.stock-copy>span{min-width:0;overflow-wrap:anywhere}.stock-copy>button{flex:0 0 14px;display:grid;place-items:center;color:var(--color-text-secondary);padding:0;border:0;background:none}.stock-copy>button:hover{color:var(--color-text)}</style>
