<script setup lang="ts">
import { sessionEpoch } from '@/utils/session'
</script>

<template>
  <RouterView :key="sessionEpoch" />
</template>
