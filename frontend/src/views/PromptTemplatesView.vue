<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import PromptTemplateManager from '@/components/ai/PromptTemplateManager.vue'
import { AppLayout } from '@/components/layout'
import { PageHeader } from '@/components/ui'

const { t } = useI18n()
</script>

<template>
  <AppLayout>
    <div class="app-page mx-auto max-w-6xl">
      <PageHeader
        :eyebrow="t('prompts.eyebrow')"
        :title="t('prompts.title')"
        :description="t('prompts.description')"
      />
      <PromptTemplateManager />
    </div>
  </AppLayout>
</template>
