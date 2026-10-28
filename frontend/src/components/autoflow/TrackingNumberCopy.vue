<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Copy } from 'lucide-vue-next'
import { copyText } from '@/utils/copyText'
const props = defineProps<{ number: string; prefix?: string; title?: string }>()
const { locale } = useI18n()
const text = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const copied = ref(false), failed = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
let active = true
onBeforeUnmount(() => { active = false; clearTimeout(timer) })
async function copy() {
  try { await copyText(props.number); if (active) { copied.value = true; failed.value = false } }
  catch { if (active) { copied.value = false; failed.value = true } }
  if (!active) return
  clearTimeout(timer)
  timer = setTimeout(() => { copied.value = false; failed.value = false }, 2400)
}
</script>
<template>
  <span class="tracking-copy-wrap">
    <button type="button" class="tracking-copy" :title="title || number" :aria-label="`${text('复制物流跟踪号', 'Copy tracking number')} ${number}`" @click="copy">
      <span class="tracking-value"><template v-if="prefix">{{ prefix }}: </template>{{ number }}</span><Check v-if="copied" :size="12" /><Copy v-else :size="12" />
    </button>
    <span v-if="copied" class="sr-only" role="status">{{ text('跟踪号已复制', 'Tracking number copied') }}</span>
    <small v-if="failed" class="tracking-copy-error" role="alert">{{ text('复制失败，请手动复制', 'Copy failed. Please copy manually.') }}</small>
  </span>
</template>
<style scoped>
.tracking-copy-wrap { display: inline-flex; flex-direction: column; min-width: 0; max-width: 100%; }
.tracking-copy { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; color: var(--color-text-secondary); font-size: 11px; font-variant-numeric: tabular-nums; text-align: left; user-select: text; }
.tracking-value { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.tracking-copy svg { flex-shrink: 0; opacity: .7; }
.tracking-copy:hover svg, .tracking-copy:focus-visible svg { color: var(--color-chart-link); opacity: 1; }
.tracking-copy-error { font-size: 10px; color: var(--color-warning); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
