<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { AppLayout } from '@/components/layout'
const { locale } = useI18n()
</script>
<template><AppLayout><div class="app-page"><div class="panel p-10 text-center"><h1 class="text-xl font-bold">{{ locale.startsWith('zh') ? '工作台访问受限' : 'Workbench access unavailable' }}</h1><p class="my-4 text-sm text-slate-500" role="alert">{{ locale.startsWith('zh') ? '当前账号未获授权，或暂时无法确认访问权限。请联系管理员或稍后重试。' : 'Your account is not authorized, or access could not be verified. Contact an administrator or retry later.' }}</p><RouterLink to="/" class="btn btn-secondary">{{ locale.startsWith('zh') ? '进入我的工作台' : 'Open my workbench' }}</RouterLink><RouterLink to="/dashboard" class="btn btn-ghost">{{ locale.startsWith('zh') ? 'Dashboard' : 'Dashboard' }}</RouterLink></div></div></AppLayout></template>
