<script setup lang="ts">
import hyperZoneLogo from '@/assets/hyperzone-logo.png'

withDefaults(defineProps<{ compact?: boolean; inverse?: boolean }>(), {
  compact: false,
  inverse: false,
})
</script>

<template>
  <div class="flex min-w-0 items-center gap-3">
    <span class="brand-mark"><img :src="hyperZoneLogo" alt="HyperZone" /></span>
    <span v-if="!compact" class="min-w-0">
      <strong class="block text-[17px] font-bold tracking-normal" :class="inverse ? 'text-white' : 'text-slate-950 dark:text-white'">{{ $t('brand.product') }}</strong>
      <span class="block truncate text-[11px] text-slate-500 dark:text-slate-400">{{ $t('brand.tagline') }}</span>
    </span>
  </div>
</template>
