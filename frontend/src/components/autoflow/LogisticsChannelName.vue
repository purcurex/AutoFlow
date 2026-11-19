<script setup lang="ts">
import { computed } from 'vue'
import { channelNameParts } from '@/utils/logistics-channel-text'

const props = defineProps<{ name?: string | null }>()
const parts = computed(() => channelNameParts(props.name?.trim() || '—'))
</script>

<template>
  <span class="channel-name-text"><template v-for="(part, index) in parts" :key="index"><span v-if="part.trim()" class="channel-name-part">{{ part }}</span><template v-else>{{ part }}</template></template></span>
</template>

<style scoped>
.channel-name-text { display: block; min-width: 0; max-width: 100%; white-space: normal; word-break: normal; overflow-wrap: normal; }
/* A complete word/qualifier moves to the next line; only an oversized one splits. */
.channel-name-part { display: inline-block; max-width: 100%; vertical-align: top; white-space: normal; word-break: normal; overflow-wrap: anywhere; }
</style>
