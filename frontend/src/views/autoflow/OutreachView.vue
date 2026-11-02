<script setup lang="ts">
import { computed, onMounted, ref, watch, type Component } from 'vue'
import {
  CheckCircle2,
  ExternalLink,
  Facebook,
  Globe2,
  Image as ImageIcon,
  Info,
  Instagram,
  Mail,
  MessageCircle,
  MessageSquareReply,
  Radio,
  RotateCcw,
  Send,
  SkipForward,
  Store,
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useAutoFlowStore } from '@/stores'
import { AppLayout } from '@/components/layout'
import { EmptyState, PageHeader, StatusBadge } from '@/components/ui'
import type { OutreachChannel, OutreachStatus } from '@/api/autoflow'
import { withReturnTo } from '@/composables/useReturnNavigation'

const store = useAutoFlowStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const filters = ['all', 'draft', 'ready', 'sent', 'replied', 'skipped', 'failed'] as const
const channels = ['all', 'facebook', 'whatsapp', 'email', 'instagram', 'other'] as const
const validStatuses = new Set<string>(filters)
const validChannels = new Set<string>(channels)
const status = ref(validStatuses.has(String(route.query.status)) ? String(route.query.status) : 'all')
const channel = ref(validChannels.has(String(route.query.channel)) ? String(route.query.channel) : 'all')

const channelIcons: Record<OutreachChannel, Component> = {
  facebook: Facebook,
  whatsapp: MessageCircle,
  email: Mail,
  instagram: Instagram,
  other: Radio,
}

onMounted(() => store.fetchOutreachTasks())
watch(
  () => [route.query.status, route.query.channel],
  ([nextStatus, nextChannel]) => {
    status.value = validStatuses.has(String(nextStatus)) ? String(nextStatus) : 'all'
    channel.value = validChannels.has(String(nextChannel)) ? String(nextChannel) : 'all'
  },
)

const tasks = computed(() => store.outreachTasks.filter((task) => (
  (status.value === 'all' || task.status === status.value)
  && (channel.value === 'all' || task.channel === channel.value)
)))

function filterLabel(item: string) {
  return item === 'all' ? t('outreach.allTasks') : t(`outreach.${item}`)
}

function channelLabel(value: string) {
  return t(`outreach.channel_${value}`)
}

function setFilter(nextStatus: string, nextChannel = channel.value) {
  router.replace({
    query: {
      ...(nextStatus !== 'all' ? { status: nextStatus } : {}),
      ...(nextChannel !== 'all' ? { channel: nextChannel } : {}),
    },
  })
}

function setChannel(nextChannel: string) {
  setFilter(status.value, nextChannel)
}

function nextPrimaryAction(task: { status: string }) {
  if (task.status === 'draft') return { status: 'ready' as OutreachStatus, label: t('outreach.approve'), icon: CheckCircle2 }
  if (task.status === 'ready') return { status: 'sent' as OutreachStatus, label: t('outreach.markSent'), icon: Send }
  if (task.status === 'sent') return { status: 'replied' as OutreachStatus, label: t('outreach.markReplied'), icon: MessageSquareReply }
  if (task.status === 'failed') return { status: 'ready' as OutreachStatus, label: t('outreach.retry'), icon: RotateCcw }
  return null
}
</script>

<template>
  <AppLayout>
    <div class="app-page">
      <PageHeader :eyebrow="t('outreach.eyebrow')" :title="t('outreach.title')" :description="t('outreach.description')" />
      <div class="notice mb-4 border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200">
        <Info class="mt-0.5 h-4 w-4 shrink-0" />
        <p>{{ t('outreach.reviewHint') }}</p>
      </div>

      <div class="panel mb-4 flex flex-col gap-3 p-3 xl:flex-row xl:items-center">
        <div class="overflow-x-auto">
          <div class="segmented min-w-max">
            <button v-for="item in filters" :key="item" :class="{ active: status === item }" @click="setFilter(item)">
              {{ filterLabel(item) }}
            </button>
          </div>
        </div>
        <label class="relative min-w-56 xl:ml-auto">
          <component :is="channel === 'all' ? Globe2 : channelIcons[channel as OutreachChannel]" class="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <select :value="channel" class="input pl-10" @change="setChannel(($event.target as HTMLSelectElement).value)">
            <option v-for="item in channels" :key="item" :value="item">
              {{ item === 'all' ? t('outreach.allChannels') : channelLabel(item) }}
            </option>
          </select>
        </label>
      </div>

      <div v-if="tasks.length" class="grid gap-4">
        <article v-for="task in tasks" :key="task.id" class="panel overflow-hidden">
          <div class="flex flex-col gap-4 border-b px-5 py-4 lg:flex-row lg:items-center lg:justify-between" style="border-color: var(--color-border)">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="inline-flex h-8 w-8 items-center justify-center rounded-md bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-300">
                  <component :is="channelIcons[task.channel]" class="h-4 w-4" />
                </span>
                <p class="font-bold text-slate-950 dark:text-white">{{ channelLabel(task.channel) }}</p>
                <StatusBadge :status="task.status" />
              </div>
              <p class="mt-2 text-xs text-slate-500">
                {{ t('common.owner') }}: {{ task.owner }} · {{ t('outreach.followUp') }}: {{ task.nextFollowUpAt || t('outreach.notScheduled') }}
              </p>
              <p class="mt-1 text-xs font-medium text-orange-600 dark:text-orange-400">{{ task.recommendedNextAction }}</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <a v-if="task.status === 'ready' && task.sendUrl" :href="task.sendUrl" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">
                <ExternalLink class="h-4 w-4" />{{ t('outreach.openChannel', { channel: channelLabel(task.channel) }) }}
              </a>
              <button v-if="['draft','ready','failed'].includes(task.status)" class="btn btn-ghost" @click="store.updateOutreachTask(task.id, { status: 'skipped' })">
                <SkipForward class="h-4 w-4" />{{ t('outreach.skip') }}
              </button>
              <button v-if="nextPrimaryAction(task)" class="btn btn-primary" @click="store.updateOutreachTask(task.id, { status: nextPrimaryAction(task)!.status })">
                <component :is="nextPrimaryAction(task)!.icon" class="h-4 w-4" />{{ nextPrimaryAction(task)!.label }}
              </button>
            </div>
          </div>

          <div class="grid lg:grid-cols-[320px_minmax(0,1fr)]">
            <section class="border-b p-5 lg:border-b-0 lg:border-r" style="border-color: var(--color-border)">
              <p class="text-xs font-bold uppercase text-orange-600">{{ t('outreach.customerProfile') }}</p>
              <RouterLink :to="withReturnTo(`/leads/${task.leadId}`, route.fullPath)" class="mt-2 block text-lg font-bold text-slate-950 hover:text-orange-600 dark:text-white dark:hover:text-orange-300">
                {{ task.customer.name }}
              </RouterLink>
              <p class="mt-1 truncate text-sm text-slate-500">{{ task.customer.domain }}</p>
              <div class="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><p class="text-xs text-slate-500">{{ t('common.market') }}</p><p class="mt-1 font-semibold">{{ task.customer.country || t('common.unknown') }}</p></div>
                <div><p class="text-xs text-slate-500">{{ t('common.category') }}</p><p class="mt-1 font-semibold">{{ task.customer.category || t('common.unknown') }}</p></div>
                <div><p class="text-xs text-slate-500">{{ t('common.score') }}</p><p class="mt-1 font-bold">{{ task.customer.totalScore }}</p></div>
                <div><p class="text-xs text-slate-500">{{ t('common.status') }}</p><StatusBadge class="mt-1" :status="task.customer.status" /></div>
              </div>
              <div class="mt-4 flex flex-wrap gap-2">
                <RouterLink :to="withReturnTo(`/leads/${task.leadId}`, route.fullPath)" class="btn btn-secondary">
                  {{ t('outreach.openCustomerProfile') }}
                </RouterLink>
                <a v-if="task.customer.storeUrl" :href="task.customer.storeUrl" target="_blank" rel="noopener noreferrer" class="icon-btn" :title="t('outreach.openStore')">
                  <Store class="h-4 w-4" />
                </a>
              </div>
            </section>

            <section class="min-w-0 p-5">
              <div class="mb-4">
                <p class="text-xs font-bold uppercase text-slate-500">{{ t('outreach.availableChannels') }}</p>
                <div v-if="task.contactChannels.length" class="mt-2 flex flex-wrap gap-2">
                  <span
                    v-for="contact in task.contactChannels"
                    :key="`${contact.type}-${contact.value}`"
                    class="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold"
                    :class="contact.value === task.targetContact ? 'selection-active' : 'text-slate-600 dark:text-slate-300'"
                    style="border-color: var(--color-border)"
                  >
                    <component :is="channelIcons[contact.type as OutreachChannel] || Radio" class="h-3.5 w-3.5 shrink-0" />
                    <span>{{ channelLabel(contact.type) }}</span>
                    <span class="max-w-56 truncate font-normal">{{ contact.value }}</span>
                  </span>
                </div>
                <p v-else class="mt-2 text-sm text-slate-500">{{ t('outreach.noTargetContact') }}</p>
              </div>
              <div class="mb-3 flex flex-wrap gap-1.5">
                <span class="status-badge status-neutral">{{ t(`leads.quoteMode_${task.templateOptions.quoteMode}`) }}</span>
                <span v-if="task.templateOptions.includeProductVisual" class="status-badge status-info"><ImageIcon class="h-3 w-3" />{{ t('leads.includeProductVisual') }}</span>
                <span v-if="task.templateOptions.emphasizeSupplier" class="status-badge status-success">{{ t('leads.emphasizeSupplier') }}</span>
                <span v-if="task.templateOptions.emphasizeLogistics" class="status-badge status-info">{{ t('leads.emphasizeLogistics') }}</span>
              </div>
              <p v-if="task.subject" class="mb-2 text-xs font-semibold text-slate-500">{{ t('outreach.subject') }}: {{ task.subject }}</p>
              <img v-if="task.templateOptions.productImageUrl" :src="task.templateOptions.productImageUrl" alt="" class="mb-3 max-h-52 rounded-md border object-contain" style="border-color: var(--color-border)" />
              <p class="whitespace-pre-wrap rounded-md border bg-slate-50 p-4 text-sm leading-7 text-slate-700 dark:bg-[#171b21] dark:text-slate-300" style="border-color: var(--color-border)">{{ task.message }}</p>
            </section>
          </div>
        </article>
      </div>
      <div v-else class="panel"><EmptyState :message="t('outreach.noTasks')" /></div>
    </div>
  </AppLayout>
</template>
