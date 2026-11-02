<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { installSelectDropdowns } from '@/utils/selectDropdowns'
import { onSessionReset } from '@/utils/session'
defineProps<{ title: string; busy?: boolean; size?: 'compact' }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>(), content = ref<HTMLElement>(), titleId = useId()
let cleanup: (() => void) | undefined, opener: HTMLElement | undefined
onMounted(() => { opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined; dialog.value?.showModal?.(); if (!dialog.value?.open) dialog.value?.setAttribute('open', ''); if (content.value) cleanup = installSelectDropdowns(content.value) })
const off = onSessionReset(() => emit('close'))
onBeforeUnmount(() => { cleanup?.(); off(); dialog.value?.close?.(); if (opener?.isConnected) opener.focus({ preventScroll: true }) })
</script>
<template><Teleport to="body"><dialog ref="dialog" class="org-modal" :class="{ 'org-modal-compact': size === 'compact' }" :aria-labelledby="titleId" aria-modal="true" @cancel.prevent="!busy && emit('close')"><header><h2 :id="titleId">{{ title }}</h2><button class="btn btn-secondary" type="button" aria-label="关闭 / Close" :disabled="busy" @click="emit('close')">×</button></header><div ref="content" class="org-modal-content"><slot /></div><footer><slot name="footer" /></footer></dialog></Teleport></template>
<style scoped>
.org-modal{position:fixed;inset:0;margin:auto;width:min(960px,calc(100vw - 32px));max-width:none;max-height:calc(100dvh - 40px);padding:0;border:1px solid var(--color-border);border-radius:14px;background:var(--color-surface);color:var(--color-text);box-shadow:0 24px 70px #18263c30;overflow:auto}.org-modal::backdrop{background:#16273e66;backdrop-filter:blur(2px)}.org-modal header,.org-modal footer{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 24px;background:var(--color-surface);position:sticky;z-index:2}.org-modal header{top:0;border-bottom:1px solid var(--color-border)}.org-modal footer{bottom:0;border-top:1px solid var(--color-border);justify-content:flex-end}.org-modal h2{font-size:18px;font-weight:650}.org-modal-content{padding:22px 24px}.org-modal :deep(.org-fields){display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.org-modal :deep(.input){width:100%}.org-modal :deep(.org-error){padding:12px;margin-bottom:16px;border-radius:8px;color:#a33745;background:#fff2f3;font-size:13px;line-height:1.7}@media(max-width:600px){.org-modal :deep(.org-fields){grid-template-columns:1fr}.org-modal-content{padding:16px}}
.org-modal-compact{width:min(600px,calc(100vw - 32px))}.org-modal-compact footer:empty{display:none}
</style>
