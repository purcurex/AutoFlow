<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChartNoAxesCombined, X } from 'lucide-vue-next'
import { scrollOuterPage } from '@/utils/pageWheel'

defineProps<{ name: string; code: string; scope: string }>()
const emit = defineEmits<{ close: [] }>()
const { locale } = useI18n()
const t = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const titleId = useId(), scopeId = useId()
const dialog = ref<HTMLDialogElement>(), closeButton = ref<HTMLButtonElement>()
const dialogScroller = ref<HTMLElement>()
const ready = ref(false)
let opener: HTMLElement | undefined

onMounted(() => {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  dialog.value?.showModal()
  closeButton.value?.focus({ preventScroll: true })
  // Mount charts only after the dialog has a visible, measurable viewport.
  ready.value = true
})
onBeforeUnmount(() => {
  dialog.value?.close()
  if (opener?.isConnected) opener.focus({ preventScroll: true })
})
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="ov-trend-dialog ov-selected" aria-modal="true" :aria-labelledby="titleId" :aria-describedby="scopeId" @cancel.prevent="emit('close')" @click.self="emit('close')" @wheel.self.prevent @touchmove.self.prevent>
      <header class="ov-trend-dialog-header">
        <div class="ov-trend-dialog-heading">
          <span class="ov-trend-dialog-icon"><ChartNoAxesCombined :size="21" /></span>
          <div><p>{{ t('客户订单趋势', 'Customer order trend') }}</p><h2 :id="titleId">{{ name }}<span>{{ code }}</span></h2></div>
        </div>
        <button ref="closeButton" type="button" class="ov-trend-dialog-close" :aria-label="t('关闭客户趋势', 'Close customer trend')" @click="emit('close')"><X :size="20" /></button>
        <p :id="scopeId" class="ov-trend-dialog-scope">{{ scope }}</p>
      </header>
      <div ref="dialogScroller" class="ov-trend-dialog-body" @wheel.capture="scrollOuterPage($event, dialogScroller)"><slot v-if="ready" /></div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.ov-trend-dialog{position:fixed;inset:0;width:min(1160px,calc(100vw - 48px));max-width:none;max-height:calc(100dvh - 48px);margin:auto;padding:0;border:1px solid var(--color-border);border-radius:14px;background:var(--color-surface);color:var(--color-text);box-shadow:0 24px 90px #15274730;overflow:hidden}
.ov-trend-dialog[open]{display:flex;flex-direction:column}
.ov-trend-dialog::backdrop{background:rgb(24 37 58 / 38%);backdrop-filter:blur(3px)}
.ov-trend-dialog-header{display:flex;align-items:center;flex-wrap:wrap;gap:14px;padding:22px 26px 18px;border-bottom:1px solid var(--color-border);flex-shrink:0}
.ov-trend-dialog-heading{display:flex;align-items:center;gap:12px;min-width:0;flex:1}
.ov-trend-dialog-icon{display:grid;place-items:center;flex-shrink:0;width:44px;height:44px;border-radius:12px;color:#7188c1;background:#94a5dd18}
.ov-trend-dialog-heading p{font-size:11px;color:#8793a7;margin-bottom:4px}
.ov-trend-dialog-heading h2{font-size:18px;font-weight:650;overflow-wrap:anywhere}
.ov-trend-dialog-heading h2 span{margin-left:12px;font-size:12px;color:#8793a7;font-weight:400}
.ov-trend-dialog-close{display:grid;place-items:center;width:34px;height:34px;flex-shrink:0;border:1px solid var(--color-border);border-radius:8px;color:#8793a7;background:var(--color-surface)}
.ov-trend-dialog-close:hover{background:#8793a710;color:var(--color-text)}
.ov-trend-dialog :deep(button:focus){outline:none;box-shadow:none}
.ov-trend-dialog :deep(button:focus-visible){outline:1px solid #9ba8b9;outline-offset:2px}
.ov-trend-dialog-scope{width:100%;font-size:11px;line-height:1.7;color:#8793a7}
.ov-trend-dialog-body{overflow:auto;overscroll-behavior:contain;padding:0 26px 22px;min-height:0}
.ov-trend-dialog-body :deep(.ov-empty){min-height:240px;display:grid;place-items:center}
.ov-trend-dialog-body :deep(.ov-trend){height:clamp(220px,40dvh,340px)}
:global(body:has(.ov-trend-dialog[open])),:global(body:has(.ov-trend-dialog[open]) main){overflow:hidden}
@media(max-width:640px){.ov-trend-dialog{width:calc(100vw - 24px);max-height:calc(100dvh - 24px);border-radius:10px}.ov-trend-dialog-header{padding:16px;gap:12px}.ov-trend-dialog-heading h2{font-size:16px}.ov-trend-dialog-body{padding:0 16px 16px}.ov-trend-dialog-body :deep(.ov-kpis){gap:14px;padding:18px 0}.ov-trend-dialog-body :deep(.ov-kpis .ov-period){gap:4px}}
</style>
