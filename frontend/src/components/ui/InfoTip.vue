<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { CircleHelp } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

defineProps<{ label?: string }>()
const { locale } = useI18n()
const id = `info-tip-${useId()}`
const trigger = ref<HTMLButtonElement>()
const tip = ref<HTMLElement>()
const target = ref<HTMLElement | string>('body')
const visible = ref(false)
const position = ref({ left: '12px', top: '12px' })
let hovered = false, focused = false
let closeTimer: ReturnType<typeof setTimeout> | undefined

function close() { clearTimeout(closeTimer); visible.value = false }
function leave() {
  hovered = false
  if (!focused) closeTimer = setTimeout(close, 120)
}
async function open() {
  clearTimeout(closeTimer)
  target.value = trigger.value?.closest('dialog') ?? 'body'
  visible.value = true
  await nextTick()
  if (!visible.value || !trigger.value || !tip.value) return
  const rect = trigger.value.getBoundingClientRect()
  const box = tip.value.getBoundingClientRect()
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - box.width - 12))
  const top = rect.bottom + 8 + box.height <= window.innerHeight - 12
    ? rect.bottom + 8 : Math.max(12, rect.top - box.height - 8)
  position.value = { left: `${left}px`, top: `${top}px` }
}
function enter() { hovered = true; void open() }
function focus() { focused = true; void open() }
function blur() { focused = false; if (!hovered) close() }
function escape(event: KeyboardEvent) {
  if (visible.value && event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  }
}
function outside(event: Event) {
  if (!(event.target instanceof Node) || trigger.value?.contains(event.target) || tip.value?.contains(event.target)) return
  close()
}
function scroll(event: Event) { if (!(event.target instanceof Node) || !tip.value?.contains(event.target)) close() }
onMounted(() => {
  document.addEventListener('keydown', escape, true)
  document.addEventListener('pointerdown', outside)
  window.addEventListener('resize', close)
  window.addEventListener('scroll', scroll, true)
})
onBeforeUnmount(() => {
  close()
  document.removeEventListener('keydown', escape, true)
  document.removeEventListener('pointerdown', outside)
  window.removeEventListener('resize', close)
  window.removeEventListener('scroll', scroll, true)
})
</script>

<template>
  <span class="info-tip">
    <button ref="trigger" type="button" class="info-tip-trigger" :aria-label="label || (String(locale).startsWith('zh') ? '说明' : 'Information')" :aria-describedby="visible ? id : undefined" @mouseenter="enter" @mouseleave="leave" @focus="focus" @blur="blur" @click="open"><CircleHelp :size="14" :stroke-width="1.65" aria-hidden="true" /></button>
    <Teleport :to="target">
      <div v-if="visible" :id="id" ref="tip" role="tooltip" class="info-tip-popover" :style="position" @mouseenter="enter" @mouseleave="leave"><slot /></div>
    </Teleport>
  </span>
</template>

<style scoped>
.info-tip { display: inline-flex; flex: 0 0 auto; vertical-align: middle; margin-inline-start: 3px; }
.info-tip-trigger { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--color-text-secondary, #748399); opacity: .8; cursor: help; transition: color .15s, opacity .15s, background .15s; }
.info-tip-trigger:hover, .info-tip-trigger:focus-visible { color: var(--color-text, #243247); opacity: 1; background: color-mix(in srgb, var(--color-text-secondary, #748399) 9%, transparent); }
.info-tip-trigger:focus-visible { outline: 2px solid var(--color-chart-link, #7389bb); outline-offset: 2px; }
.info-tip-popover { position: fixed; z-index: 10000; width: max-content; max-width: min(340px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto; padding: 11px 14px; border: 1px solid var(--color-border, #d9e1eb); border-radius: 8px; background: var(--color-surface, #fff); color: var(--color-text-secondary, #526279); box-shadow: 0 8px 24px #0002; font-size: 12px; font-weight: 400; line-height: 1.75; letter-spacing: normal; text-transform: none; white-space: normal; overflow-wrap: anywhere; text-align: start; }
.info-tip-popover :deep(p) { margin: 0; color: inherit; font-size: inherit; line-height: inherit; }
.info-tip-popover :deep(p + p) { margin-top: 5px; }
</style>
