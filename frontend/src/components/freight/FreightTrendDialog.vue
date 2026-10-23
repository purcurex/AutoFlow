<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import { scrollOuterPage } from '@/utils/pageWheel'
defineProps<{ name: string; scope: string }>()
const emit = defineEmits<{ close: [] }>()
const { locale } = useI18n(), titleId = useId(), scopeId = useId()
const dialog = ref<HTMLDialogElement>(), closeButton = ref<HTMLButtonElement>(), scroller = ref<HTMLElement>(), ready = ref(false)
let opener: HTMLElement | undefined
onMounted(() => { opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined; dialog.value?.showModal(); closeButton.value?.focus({ preventScroll: true }); ready.value = true })
onBeforeUnmount(() => { dialog.value?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }) })
</script>

<template>
  <Teleport to="body"><dialog ref="dialog" class="freight-dialog ov-panel" aria-modal="true" :aria-labelledby="titleId" :aria-describedby="scopeId" @cancel.prevent="emit('close')" @click.self="emit('close')" @wheel.self.prevent @touchmove.self.prevent><header class="ov-header"><div class="ov-heading"><h2 :id="titleId">{{ name }} · {{ String(locale).startsWith('zh') ? '实际运费趋势' : 'Actual freight trend' }}</h2><p :id="scopeId">{{ scope }}</p></div><button ref="closeButton" class="ov-secondary freight-close" :aria-label="String(locale).startsWith('zh') ? '关闭运费趋势' : 'Close freight trend'" @click="emit('close')"><X :size="18" /></button></header><div ref="scroller" class="ov-body freight-dialog-body" @wheel.capture="scrollOuterPage($event, scroller)"><slot v-if="ready" /></div></dialog></Teleport>
</template>
