<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { PackageSearch } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ src: string | null; name: string }>()
const { locale } = useI18n()
const text = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const trigger = ref<HTMLButtonElement>(), open = ref(false), pinned = ref(false), failed = ref(false)
const position = ref({ left: 0, top: 0, size: 280 }), previewId = useId()
const previewOwner = Symbol('product-preview')
const usable = computed(() => !!props.src && !failed.value)
const previewStyle = computed(() => ({ left: `${position.value.left}px`, top: `${position.value.top}px`, width: `${position.value.size}px` }))
function close() { open.value = false; pinned.value = false }
function claimPreview() { window.dispatchEvent(new CustomEvent('hyperzone:product-preview', { detail: previewOwner })) }
function anotherPreview(event: Event) { if ((event as CustomEvent<symbol>).detail !== previewOwner) close() }
function locate() {
  const bounds = trigger.value?.getBoundingClientRect()
  if (!bounds) return
  const size = Math.max(1, Math.min(320, window.innerWidth - 24, window.innerHeight - 32))
  const preferredLeft = bounds.right + 16 + size < window.innerWidth - 12 ? bounds.right + 16 : bounds.left - size - 16
  position.value = { size, left: Math.max(12, Math.min(preferredLeft, window.innerWidth - size - 12)), top: Math.max(12, Math.min(bounds.top - size / 2 + bounds.height / 2, window.innerHeight - size - 12)) }
}
function hover(event: PointerEvent) {
  if (!usable.value || event.pointerType === 'touch') return
  claimPreview(); locate(); open.value = true
}
function toggle() {
  if (pinned.value) close()
  else { claimPreview(); locate(); open.value = true; pinned.value = true }
}
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') close() }
function outside(event: PointerEvent) { if (!trigger.value?.contains(event.target as Node)) close() }
function fail() { failed.value = true; close() }
watch(() => props.src, () => { failed.value = false; close() })
onMounted(() => {
  window.addEventListener('hyperzone:product-preview', anotherPreview)
  window.addEventListener('scroll', close, true)
  window.addEventListener('resize', close)
  window.addEventListener('blur', close)
  window.addEventListener('keydown', keydown)
  document.addEventListener('pointerdown', outside)
})
onBeforeUnmount(() => {
  window.removeEventListener('hyperzone:product-preview', anotherPreview)
  window.removeEventListener('scroll', close, true)
  window.removeEventListener('resize', close)
  window.removeEventListener('blur', close)
  window.removeEventListener('keydown', keydown)
  document.removeEventListener('pointerdown', outside)
})
</script>

<template>
  <button v-if="usable" ref="trigger" type="button" class="product-image-trigger" :aria-label="`${text('放大商品图片', 'Enlarge product image')} · ${name}`" :aria-expanded="open" :aria-describedby="open ? previewId : undefined" @pointerenter="hover" @pointerleave="!pinned && close()" @blur="close" @click="toggle">
    <img :src="src!" :alt="name" loading="lazy" @error="fail" />
  </button>
  <span v-else class="product-image-fallback" :aria-label="text('暂无商品图片', 'No product image')"><PackageSearch :size="20" /></span>
  <Teleport to="body">
    <div v-if="open && usable" :id="previewId" class="product-image-preview" role="tooltip" :style="previewStyle">
      <div class="zoom-image"><img :src="src!" :alt="name" @error="fail" /></div>
    </div>
  </Teleport>
</template>

<style scoped>
.product-image-trigger,.product-image-fallback{width:42px;height:42px;flex:0 0 42px;border-radius:6px;position:relative;display:grid;place-items:center;border:1px solid var(--color-border);padding:0;background:var(--color-background);color:var(--color-text-secondary)}
.product-image-trigger{cursor:pointer;overflow:hidden}.product-image-trigger:focus-visible{outline:2px solid var(--color-primary);outline-offset:3px}
.product-image-trigger>img{width:100%;height:100%;object-fit:contain}
.product-image-preview{position:fixed;z-index:9000;pointer-events:none;padding:5px;box-sizing:border-box;border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface);box-shadow:0 12px 32px #0005;overflow:hidden;color:var(--color-text-secondary)}
.zoom-image{width:100%;aspect-ratio:1;overflow:hidden;border-radius:8px;background:var(--color-background)}.zoom-image img{width:100%;height:100%;object-fit:contain}
</style>
