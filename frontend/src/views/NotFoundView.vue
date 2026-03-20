<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
    <div class="text-center">
      <h1 class="text-6xl font-bold text-gray-300 mb-4">404</h1>
      <p class="text-xl text-gray-500 mb-8">页面不存在</p>
      <button @click="router.push('/')" class="btn btn-primary">
        返回首页
      </button>
    </div>
  </div>
</template>
