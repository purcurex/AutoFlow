<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { FollowUpStage } from '@/api/autoflow'
const props = defineProps<{ stages: FollowUpStage[]; loading: boolean; failed: boolean }>()
const { t, locale } = useI18n()
const copy = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const placeholders = ['new', 'qualified', 'contacted', 'replied', 'opportunity', 'won', 'lost', 'invalid']
const rows = computed(() => props.stages.length ? props.stages : placeholders.map(key => ({ key, label: '', count: null })))
const total = computed(() => props.stages.reduce((sum, s) => sum + s.count, 0))
</script>
<template>
  <section class="follow-up-stages panel" :aria-busy="loading" aria-labelledby="follow-up-stages-title">
    <header class="stage-heading">
      <h2 id="follow-up-stages-title">{{ copy('线索跟进', 'Lead follow-up') }}</h2>
      <RouterLink to="/leads" class="all-leads">{{ copy('全部线索', 'All leads') }}<strong>{{ stages.length ? total : '—' }}</strong><ArrowRight :size="14" /></RouterLink>
    </header>
    <nav class="stage-grid" :aria-label="copy('按跟进阶段查看线索', 'Browse leads by stage')">
      <RouterLink v-for="stage in rows" :key="stage.key" :to="`/leads?status=${stage.key}`" class="stage-card" :class="{ 'stage-closed': ['lost', 'invalid'].includes(stage.key) }">
        <span>{{ $te(`status.${stage.key}`) ? t(`status.${stage.key}`) : stage.label }}</span>
        <strong>{{ stage.count ?? '—' }}</strong>
      </RouterLink>
    </nav>
    <p v-if="failed" class="stage-unavailable" role="status">{{ copy('跟进阶段暂未加载，请使用上方刷新重试。', 'Stage data could not be loaded. Refresh to try again.') }}</p>
    <slot />
  </section>
</template>
<style scoped>
.follow-up-stages{overflow:hidden;min-width:0}.stage-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 22px 16px}.stage-heading h2{font-size:15px;font-weight:650}.all-leads{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--color-chart-link)}.all-leads strong{font-weight:600;font-variant-numeric:tabular-nums}.stage-grid{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));padding:0 12px 20px}.stage-card{display:flex;flex-direction:column;gap:9px;min-width:0;padding:10px 20px;text-align:left;transition:background .15s}.stage-card+.stage-card{border-left:1px solid var(--color-border)}.stage-card:hover{background:color-mix(in srgb,var(--color-chart-link) 7%,var(--color-surface))}.stage-card>span{color:var(--color-text-secondary);font-size:12px}.stage-card strong{font-size:24px;line-height:1.25;font-weight:650;font-variant-numeric:tabular-nums;color:var(--color-text)}.stage-closed strong{color:var(--color-text-secondary)}.stage-unavailable{padding:0 22px 16px;color:var(--color-text-secondary);font-size:12px}.stage-card:focus-visible,.all-leads:focus-visible{outline:2px solid var(--color-chart-link);outline-offset:-2px}@media(max-width:1000px){.stage-grid{grid-template-columns:repeat(4,minmax(0,1fr));row-gap:12px}.stage-card:nth-child(4n+1){border-left:0}}@media(max-width:480px){.stage-grid{padding:0 4px 16px}.stage-card{padding:10px}.stage-heading{padding:18px 14px}.stage-card strong{font-size:22px}}
</style>
