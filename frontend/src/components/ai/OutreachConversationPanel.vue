<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Image as ImageIcon,
  Languages,
  LoaderCircle,
  MessageCircle,
  MessageSquareText,
  PackageCheck,
  Plus,
  Send,
  Sparkles,
  Truck,
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import {
  aiApi,
  type BilingualOutreachDraft,
  type OutreachConversation,
} from '@/api/ai'
import type {
  OutreachChannel,
  OutreachQuoteMode,
  StoreLead,
} from '@/api/autoflow'
import { StatusBadge } from '@/components/ui'

const props = defineProps<{ lead: StoreLead }>()
const { t, locale } = useI18n()

const conversation = ref<OutreachConversation | null>(null)
const channel = ref<OutreachChannel>('facebook')
const manualTarget = ref('')
const quoteMode = ref<OutreachQuoteMode>('none')
const includeProductVisual = ref(false)
const emphasizeSupplier = ref(false)
const emphasizeLogistics = ref(false)
const productImageUrl = ref('')
const verifiedQuoteContext = ref('')
const userMessage = ref('')
const englishSubject = ref('')
const englishMessage = ref('')
const chineseSubject = ref('')
const chineseMessage = ref('')
const busy = ref<'loading' | 'creating' | 'chat' | 'draft' | 'accept' | ''>('loading')
const errorMessage = ref('')

const quoteModes = [
  { value: 'none' as const, icon: MessageCircle },
  { value: 'product' as const, icon: PackageCheck },
  { value: 'logistics' as const, icon: Truck },
  { value: 'combined' as const, icon: Boxes },
]

const currentDraft = computed(() =>
  conversation.value?.drafts.find((draft) => draft.status === 'draft')
  || conversation.value?.drafts.find((draft) => draft.status === 'accepted')
  || null,
)
const configError = computed(() => {
  if (quoteMode.value !== 'none' && !verifiedQuoteContext.value.trim()) {
    return t('leads.quoteContextRequired')
  }
  if (includeProductVisual.value && !/^https:\/\//i.test(productImageUrl.value.trim())) {
    return t('leads.productImageRequired')
  }
  if (channel.value === 'other' && !manualTarget.value.trim()) {
    return t('outreach.manualTargetRequired')
  }
  return ''
})
const canChat = computed(() =>
  conversation.value && !['accepted', 'archived'].includes(conversation.value.status),
)

watch(currentDraft, (draft) => loadDraft(draft), { immediate: true })

onMounted(async () => {
  try {
    const conversations = await aiApi.listOutreachConversations(props.lead.id)
    applyConversation(conversations[0] || null)
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    busy.value = ''
  }
})

async function createConversation() {
  if (configError.value) return
  busy.value = 'creating'
  errorMessage.value = ''
  try {
    applyConversation(await aiApi.createOutreachConversation({
      leadId: props.lead.id,
      channel: channel.value,
      manualTarget: channel.value === 'other' ? manualTarget.value.trim() : undefined,
      quoteMode: quoteMode.value,
      includeProductVisual: includeProductVisual.value,
      emphasizeSupplier: emphasizeSupplier.value,
      emphasizeLogistics: emphasizeLogistics.value,
      productImageUrl: includeProductVisual.value ? productImageUrl.value.trim() : undefined,
      verifiedQuoteContext: quoteMode.value !== 'none'
        ? verifiedQuoteContext.value.trim()
        : undefined,
      responseLanguage: locale.value === 'en' ? 'en' : 'zh-CN',
    }))
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    busy.value = ''
  }
}

function startNewConversation() {
  applyConversation(null)
  channel.value = 'facebook'
  manualTarget.value = ''
  quoteMode.value = 'none'
  includeProductVisual.value = false
  emphasizeSupplier.value = false
  emphasizeLogistics.value = false
  productImageUrl.value = ''
  verifiedQuoteContext.value = ''
  userMessage.value = ''
  loadDraft(null)
  errorMessage.value = ''
}

function applyConversation(value: OutreachConversation | null) {
  conversation.value = value
  if (!value) return
  channel.value = value.options.channel
  manualTarget.value = value.options.manualTarget || ''
  quoteMode.value = value.options.quoteMode
  includeProductVisual.value = value.options.includeProductVisual
  emphasizeSupplier.value = value.options.emphasizeSupplier
  emphasizeLogistics.value = value.options.emphasizeLogistics
  productImageUrl.value = value.options.productImageUrl || ''
  verifiedQuoteContext.value = value.options.verifiedQuoteContext || ''
}

async function sendMessage() {
  if (!conversation.value || !userMessage.value.trim() || !canChat.value) return
  const content = userMessage.value.trim()
  busy.value = 'chat'
  errorMessage.value = ''
  try {
    const result = await aiApi.sendOutreachConversationMessage(conversation.value.id, content)
    conversation.value.messages.push(result.userMessage, result.assistantMessage)
    conversation.value.status = 'active'
    userMessage.value = ''
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    busy.value = ''
  }
}

async function generateDraft() {
  if (!conversation.value || !canChat.value) return
  busy.value = 'draft'
  errorMessage.value = ''
  try {
    const draft = await aiApi.generateOutreachDraft(conversation.value.id)
    conversation.value.drafts.forEach((item) => {
      if (item.status === 'draft') item.status = 'superseded'
    })
    conversation.value.drafts.unshift(draft)
    conversation.value.status = 'drafted'
    conversation.value.lastDraftVersion = draft.version
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    busy.value = ''
  }
}

async function acceptDraft() {
  const draft = currentDraft.value
  if (!draft || draft.status !== 'draft' || !englishMessage.value.trim() || !chineseMessage.value.trim()) return
  busy.value = 'accept'
  errorMessage.value = ''
  try {
    await aiApi.updateOutreachDraft(draft.id, {
      englishSubject: englishSubject.value.trim(),
      englishMessage: englishMessage.value.trim(),
      chineseSubject: chineseSubject.value.trim(),
      chineseMessage: chineseMessage.value.trim(),
    })
    const result = await aiApi.acceptOutreachDraft(draft.id)
    Object.assign(draft, result.draft)
    if (conversation.value) conversation.value.status = 'accepted'
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    busy.value = ''
  }
}

function loadDraft(draft: BilingualOutreachDraft | null) {
  englishSubject.value = draft?.englishSubject || ''
  englishMessage.value = draft?.englishMessage || ''
  chineseSubject.value = draft?.chineseSubject || ''
  chineseMessage.value = draft?.chineseMessage || ''
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : t('leads.aiUnavailable')
}
</script>

<template>
  <aside class="panel h-fit overflow-hidden xl:sticky xl:top-5">
    <div class="panel-header">
      <div>
        <h2 class="panel-title">{{ t('leads.aiWorkspace') }}</h2>
        <p class="panel-description">{{ t('leads.aiWorkspaceHint') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <StatusBadge v-if="conversation" :status="conversation.status" />
        <button v-if="conversation" type="button" class="icon-btn" :title="t('leads.newConversation')" @click="startNewConversation">
          <Plus class="h-4 w-4" />
        </button>
      </div>
    </div>

    <div v-if="busy === 'loading'" class="empty-state">
      <LoaderCircle class="mx-auto mb-2 h-5 w-5 animate-spin" />
      {{ t('common.loading') }}
    </div>

    <div v-else-if="!conversation" class="p-5">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="field-label">{{ t('leads.outreachChannel') }}
          <select v-model="channel" class="input mt-2">
            <option value="facebook">Facebook</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="instagram">Instagram</option>
            <option value="other">{{ t('outreach.channel_other') }}</option>
          </select>
        </label>
        <label class="field-label">{{ t('leads.quoteMode') }}
          <select v-model="quoteMode" class="input mt-2">
            <option v-for="item in quoteModes" :key="item.value" :value="item.value">
              {{ t(`leads.quoteMode_${item.value}`) }}
            </option>
          </select>
        </label>
      </div>
      <label v-if="channel === 'other'" class="field-label mt-4 block">
        {{ t('outreach.manualTarget') }}
        <input v-model="manualTarget" class="input mt-2" :placeholder="t('outreach.manualTargetPlaceholder')" />
      </label>
      <label v-if="quoteMode !== 'none'" class="field-label mt-4 block">
        {{ t('leads.verifiedQuoteContext') }}
        <textarea v-model="verifiedQuoteContext" class="input mt-2 min-h-24 resize-y" :placeholder="t(`leads.quoteContext_${quoteMode}`)" />
      </label>
      <div class="mt-4 space-y-2 border-y py-3" style="border-color: var(--color-border)">
        <label class="flex cursor-pointer items-center gap-3 text-sm font-semibold"><input v-model="includeProductVisual" type="checkbox" class="h-4 w-4 accent-orange-600" /><ImageIcon class="h-4 w-4 text-orange-500" />{{ t('leads.includeProductVisual') }}</label>
        <label class="flex cursor-pointer items-center gap-3 text-sm font-semibold"><input v-model="emphasizeSupplier" type="checkbox" class="h-4 w-4 accent-orange-600" /><PackageCheck class="h-4 w-4 text-emerald-600" />{{ t('leads.emphasizeSupplier') }}</label>
        <label class="flex cursor-pointer items-center gap-3 text-sm font-semibold"><input v-model="emphasizeLogistics" type="checkbox" class="h-4 w-4 accent-orange-600" /><Truck class="h-4 w-4 text-sky-600" />{{ t('leads.emphasizeLogistics') }}</label>
      </div>
      <label v-if="includeProductVisual" class="field-label mt-4 block">
        {{ t('leads.productImageUrl') }}
        <input v-model="productImageUrl" class="input mt-2" type="url" placeholder="https://.../product.jpg" />
      </label>
      <p v-if="configError" class="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-300">{{ configError }}</p>
      <button class="btn btn-primary mt-4 w-full" :disabled="!!configError || busy === 'creating'" @click="createConversation">
        <LoaderCircle v-if="busy === 'creating'" class="h-4 w-4 animate-spin" />
        <MessageSquareText v-else class="h-4 w-4" />
        {{ t('leads.startAiConversation') }}
      </button>
    </div>

    <div v-else>
      <div class="max-h-80 space-y-3 overflow-y-auto border-b bg-slate-50 p-4 dark:bg-[#0d1014]" style="border-color: var(--color-border)">
        <div
          v-for="message in conversation.messages"
          :key="message.id"
          class="flex"
          :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <div
            class="max-w-[88%] rounded-md px-3 py-2 text-sm leading-6"
            :class="message.role === 'user' ? 'bg-orange-600 text-white' : 'border bg-white text-slate-700 dark:bg-[#171b21] dark:text-slate-200'"
            style="border-color: var(--color-border)"
          >
            {{ message.content }}
          </div>
        </div>
      </div>

      <div v-if="canChat" class="border-b p-4" style="border-color: var(--color-border)">
        <textarea
          v-model="userMessage"
          class="input min-h-20 resize-y"
          :placeholder="t('leads.aiConversationPlaceholder')"
          @keydown.ctrl.enter.prevent="sendMessage"
        />
        <div class="mt-2 flex justify-between gap-2">
          <span class="text-xs text-slate-500">{{ t('leads.aiConversationHint') }}</span>
          <button class="btn btn-secondary" :disabled="!userMessage.trim() || busy === 'chat'" @click="sendMessage">
            <LoaderCircle v-if="busy === 'chat'" class="h-4 w-4 animate-spin" />
            <Send v-else class="h-4 w-4" />
            {{ t('leads.sendToAi') }}
          </button>
        </div>
      </div>

      <div class="p-4">
        <button v-if="canChat" class="btn btn-primary w-full" :disabled="busy === 'draft'" @click="generateDraft">
          <LoaderCircle v-if="busy === 'draft'" class="h-4 w-4 animate-spin" />
          <Sparkles v-else class="h-4 w-4" />
          {{ currentDraft ? t('leads.regenerateBilingualDraft') : t('leads.generateBilingualDraft') }}
        </button>

        <div v-if="currentDraft" class="mt-4 space-y-4">
          <div class="flex items-center justify-between">
            <span class="inline-flex items-center gap-2 text-sm font-bold"><Languages class="h-4 w-4 text-orange-500" />{{ t('leads.bilingualDraft') }} R{{ currentDraft.version }}</span>
            <StatusBadge :status="currentDraft.status" />
          </div>
          <section class="rounded-md border p-3" style="border-color: var(--color-border)">
            <h3 class="text-sm font-bold">English</h3>
            <input v-if="channel === 'email'" v-model="englishSubject" class="input mt-2" :placeholder="t('leads.subject')" :disabled="currentDraft.status !== 'draft'" />
            <textarea v-model="englishMessage" class="input mt-2 min-h-40 resize-y leading-6" :disabled="currentDraft.status !== 'draft'" />
          </section>
          <section class="rounded-md border bg-sky-50/60 p-3 dark:bg-sky-950/20" style="border-color: var(--color-border)">
            <h3 class="text-sm font-bold">简体中文</h3>
            <input v-if="channel === 'email'" v-model="chineseSubject" class="input mt-2" :placeholder="t('leads.subject')" :disabled="currentDraft.status !== 'draft'" />
            <textarea v-model="chineseMessage" class="input mt-2 min-h-40 resize-y leading-6" :disabled="currentDraft.status !== 'draft'" />
          </section>
          <div v-if="currentDraft.factsUsed.length" class="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            <strong>{{ t('leads.factsUsed') }}</strong>
            <p class="mt-1 leading-5">{{ currentDraft.factsUsed.join('；') }}</p>
          </div>
          <div v-if="currentDraft.missingFacts.length || currentDraft.warnings.length" class="rounded-md border tone-warning p-3 text-xs">
            <strong class="inline-flex items-center gap-1"><AlertTriangle class="h-3.5 w-3.5" />{{ t('leads.reviewWarnings') }}</strong>
            <p class="mt-1 leading-5">{{ [...currentDraft.missingFacts, ...currentDraft.warnings].join('；') }}</p>
          </div>
          <button
            v-if="currentDraft.status === 'draft'"
            class="btn btn-primary w-full"
            :disabled="busy === 'accept' || !englishMessage.trim() || !chineseMessage.trim()"
            @click="acceptDraft"
          >
            <LoaderCircle v-if="busy === 'accept'" class="h-4 w-4 animate-spin" />
            <CheckCircle2 v-else class="h-4 w-4" />
            {{ t('leads.acceptBilingualDraft') }}
          </button>
          <div v-else-if="currentDraft.status === 'accepted'" class="notice border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
            {{ t('leads.draftAccepted') }}
          </div>
        </div>
      </div>
    </div>

    <p v-if="errorMessage" class="mx-4 mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {{ errorMessage }}
    </p>
  </aside>
</template>
