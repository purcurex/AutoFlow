<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'neutral' | 'info' | 'warning' | 'success' | 'danger' }>(), { tone: 'neutral' })
</script>

<template><span class="workbench-status-badge" :data-tone="tone"><slot /></span></template>

<style scoped>
.workbench-status-badge{--badge-neutral:#526176;--badge-info:#405f88;--badge-warning:#805d26;--badge-success:#356b5a;--badge-danger:#9d484c;--badge-ink:var(--badge-neutral);display:inline-flex;align-items:center;min-height:26px;max-width:100%;padding:3px 8px;border:1px solid color-mix(in srgb,var(--badge-ink) 23%,transparent);border-radius:5px;color:var(--badge-ink);background:color-mix(in srgb,var(--badge-ink) 9%,var(--color-surface));font-size:12px;font-weight:500;line-height:1.5;overflow-wrap:normal}
.dark .workbench-status-badge{--badge-neutral:#b4c1d3;--badge-info:#a5bfdf;--badge-warning:#d3b77e;--badge-success:#9ecab9;--badge-danger:#e0a2a5}
[data-tone=info]{--badge-ink:var(--badge-info)}[data-tone=warning]{--badge-ink:var(--badge-warning)}[data-tone=success]{--badge-ink:var(--badge-success)}[data-tone=danger]{--badge-ink:var(--badge-danger)}
</style>
