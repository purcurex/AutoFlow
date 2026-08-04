<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Archive,
  CircleAlert,
  Image,
  ImagePlus,
  Info,
  KeyRound,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  PackageSearch,
  RefreshCw,
  SearchCode,
  Trash2,
  Upload,
  X,
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useAutoFlowStore } from '@/stores'
import { AppLayout } from '@/components/layout'
import { EmptyState, PageHeader, ReturnButton, StatusBadge } from '@/components/ui'
import {
  autoflowApi,
  type SeedType,
  type WorkflowDeletionImpact,
  type WorkflowImageUpload,
  type WorkflowRun,
} from '@/api/autoflow'
import { getClipboardImage, validateWorkflowImage } from '@/utils/workflowImage'
import {
  canArchiveWorkflow,
  canDeleteWorkflow,
  canReviseWorkflow,
} from '@/utils/workflowLifecycle'
import { withReturnTo } from '@/composables/useReturnNavigation'
import { workflowCreatedDate } from '@/utils/workflowDisplay'
import usFlag from 'flag-icons/flags/4x3/us.svg'
import euFlag from 'flag-icons/flags/4x3/eu.svg'
import caFlag from 'flag-icons/flags/4x3/ca.svg'
import auFlag from 'flag-icons/flags/4x3/au.svg'
import unFlag from 'flag-icons/flags/4x3/un.svg'

const props = defineProps<{ create?: boolean; reviseId?: string }>()
const route = useRoute()
const router = useRouter()
const store = useAutoFlowStore()
const { t } = useI18n()
const activeWorkflowIds = reactive(new Set<string>())
const actionMessage = ref('')
const imageInput = ref<HTMLInputElement | null>(null)
const imagePreviewUrl = ref('')
const imageUpload = ref<WorkflowImageUpload | null>(null)
const imageUploadError = ref('')
const isUploadingImage = ref(false)
const seedValues = reactive<Record<SeedType, string>>({ keyword: '', image: '' })
const revisionSource = ref<WorkflowRun | null>(null)
const detailWorkflow = ref<WorkflowRun | null>(null)
const lifecycleTarget = ref<WorkflowRun | null>(null)
const lifecycleMode = ref<'delete' | 'archive' | null>(null)
const deletionImpact = ref<WorkflowDeletionImpact | null>(null)
const lifecycleBusy = ref(false)
let disposed = false
const form = reactive({
  name: '',
  seedType: 'keyword' as SeedType,
  seedValue: '',
  seedAssetPath: undefined as string | undefined,
  seedAssetMimeType: undefined as WorkflowImageUpload['mimeType'] | undefined,
  seedAssetSize: undefined as number | undefined,
  seedAssetSha256: undefined as string | undefined,
  targetMarket: 'United States',
  searchOptions: {
    exactPhrase: true,
    titleMatch: false,
    excludeMarketplaces: true,
    findOwnerFacebook: true,
  },
})
const targetMarkets = [
  { code: 'US', flagUrl: usFlag, value: 'United States', labelKey: 'workflows.marketUnitedStates' },
  { code: 'EU', flagUrl: euFlag, value: 'European Union', labelKey: 'workflows.marketEuropeanUnion' },
  { code: 'CA', flagUrl: caFlag, value: 'Canada', labelKey: 'workflows.marketCanada' },
  { code: 'AU', flagUrl: auFlag, value: 'Australia', labelKey: 'workflows.marketAustralia' },
  { code: 'OT', flagUrl: unFlag, value: 'Other', labelKey: 'workflows.marketOther' },
]

const googleOptionFields: Array<{ key: keyof typeof form.searchOptions; labelKey: string }> = [
  { key: 'exactPhrase', labelKey: 'workflows.exactPhrase' },
  { key: 'titleMatch', labelKey: 'workflows.titleMatch' },
  { key: 'excludeMarketplaces', labelKey: 'workflows.excludeMarketplaces' },
  { key: 'findOwnerFacebook', labelKey: 'workflows.findOwnerFacebook' },
]

function resolveTargetMarket(value: string) {
  return targetMarkets.find((market) => market.value === value)
    || { code: value.slice(0, 2).toUpperCase(), flagUrl: unFlag }
}

/**
 * 修订页只依赖指定工作流详情完成表单回显，避免列表接口失败阻断详情请求。
 */
async function loadRevisionSource(reviseId: string) {
  try {
    const source = await store.getWorkflow(reviseId)
    if (!canReviseWorkflow(source.status)) {
      actionMessage.value = t('workflows.revisionUnavailable')
      return
    }
    revisionSource.value = source
    form.name = source.name
    form.seedType = source.seedType
    form.seedValue = source.seedValue
    form.seedAssetPath = source.seedAssetPath || undefined
    form.seedAssetMimeType = source.seedAssetMimeType as WorkflowImageUpload['mimeType'] || undefined
    form.seedAssetSize = source.seedAssetSize ? Number(source.seedAssetSize) : undefined
    form.seedAssetSha256 = source.seedAssetSha256 || undefined
    seedValues[source.seedType] = source.seedValue
    form.targetMarket = source.targetMarket
    Object.assign(form.searchOptions, source.searchOptions)
  } catch {
    actionMessage.value = t('workflows.loadFailed')
  }
}

onMounted(async () => {
  // 不同页面只加载自身必需的数据，修订页不再等待工作流列表请求。
  if (props.reviseId) {
    await loadRevisionSource(props.reviseId)
    return
  }
  if (!props.create) await store.fetchWorkflows()
})
onBeforeUnmount(() => {
  disposed = true
  if (imagePreviewUrl.value) URL.revokeObjectURL(imagePreviewUrl.value)
})
const title = computed(() => props.reviseId
  ? t('workflows.reviseTitle')
  : props.create ? t('workflows.createTitle') : t('workflows.title'))
const googleQueryPreview = computed(() => {
  const keyword = form.seedValue.trim() || t('workflows.keywordPlaceholder')
  const term = form.searchOptions.titleMatch
    ? `intitle:"${keyword}"`
    : form.searchOptions.exactPhrase ? `"${keyword}"` : keyword
  const exclusions = form.searchOptions.excludeMarketplaces
    ? ' -site:amazon.com -site:ebay.com -site:walmart.com'
    : ''
  return `${term} inurl:/products/ "Powered by Shopify"${exclusions}`
})

watch(() => form.seedType, (nextType, previousType) => {
  seedValues[previousType] = form.seedValue
  form.seedValue = seedValues[nextType]
  imageUploadError.value = ''
  if (nextType !== 'image') clearImageAssetMetadata()
})

watch(() => form.seedValue, (value) => {
  seedValues[form.seedType] = value
  if (form.seedType === 'image' && imageUpload.value && value !== imageUpload.value.publicUrl) {
    imageUpload.value = null
    clearImageAssetMetadata()
    if (imagePreviewUrl.value) URL.revokeObjectURL(imagePreviewUrl.value)
    imagePreviewUrl.value = ''
  }
})

function openImagePicker() {
  imageInput.value?.click()
}

function removeImage() {
  if (imagePreviewUrl.value) URL.revokeObjectURL(imagePreviewUrl.value)
  imagePreviewUrl.value = ''
  imageUpload.value = null
  imageUploadError.value = ''
  form.seedValue = ''
  clearImageAssetMetadata()
  if (imageInput.value) imageInput.value.value = ''
}

async function uploadImage(file: File) {
  const validationError = validateWorkflowImage(file)
  if (validationError) {
    imageUploadError.value = t(`workflows.imageInvalid${validationError === 'type' ? 'Type' : 'Size'}`)
    return
  }

  if (imagePreviewUrl.value) URL.revokeObjectURL(imagePreviewUrl.value)
  imagePreviewUrl.value = URL.createObjectURL(file)
  imageUpload.value = null
  imageUploadError.value = ''
  form.seedValue = ''
  isUploadingImage.value = true
  try {
    const result = await autoflowApi.uploadWorkflowImage(file)
    imageUpload.value = result
    form.seedValue = result.publicUrl
    form.seedAssetPath = result.assetPath
    form.seedAssetMimeType = result.mimeType
    form.seedAssetSize = result.size
    form.seedAssetSha256 = result.sha256
  } catch {
    imageUploadError.value = t('workflows.imageUploadFailed')
  } finally {
    isUploadingImage.value = false
  }
}

function clearImageAssetMetadata() {
  form.seedAssetPath = undefined
  form.seedAssetMimeType = undefined
  form.seedAssetSize = undefined
  form.seedAssetSha256 = undefined
}

function handleImageSelection(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) void uploadImage(file)
}

function handleImagePaste(event: ClipboardEvent) {
  const file = getClipboardImage(event.clipboardData)
  if (!file) return
  event.preventDefault()
  void uploadImage(file)
}

function handleImageDrop(event: DragEvent) {
  const file = Array.from(event.dataTransfer?.files || []).find((item) => item.type.startsWith('image/'))
  if (file) void uploadImage(file)
}

async function submitWorkflow() {
  if (!form.seedValue.trim() || isUploadingImage.value) return
  actionMessage.value = ''
  try {
    const workflow = props.reviseId
      ? await store.reviseWorkflow(props.reviseId, { ...form })
      : await store.createWorkflow({ ...form })
    if (props.reviseId) await store.startDiscovery(workflow.id)
    await router.push('/workflows')
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : t('workflows.saveFailed')
  }
}

async function startDiscovery(workflowId: string) {
  activeWorkflowIds.add(workflowId)
  actionMessage.value = ''
  try {
    await store.startDiscovery(workflowId)
    for (let attempt = 0; attempt < 60 && !disposed; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      await store.fetchWorkflows()
      const workflow = store.workflows.find((item) => item.id === workflowId)
      if (!workflow || workflow.status !== 'running') {
        actionMessage.value = workflow?.status === 'completed'
          ? t('workflows.completed')
          : workflow?.failureReason || t('workflows.stopped')
        break
      }
    }
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : t('workflows.startFailed')
  } finally {
    activeWorkflowIds.delete(workflowId)
  }
}

function failureLabel(workflow: WorkflowRun): string {
  return workflow.failureCode
    ? t(`workflows.failure_${workflow.failureCode}`)
    : t('workflows.failure_unknown')
}

function openFailureDetails(workflow: WorkflowRun) {
  detailWorkflow.value = workflow
}

async function prepareDelete(workflow: WorkflowRun) {
  lifecycleBusy.value = true
  actionMessage.value = ''
  try {
    const impact = await autoflowApi.getWorkflowDeletionImpact(workflow.id)
    if (!impact.canDelete) {
      actionMessage.value = impact.revisionCount > 0
        ? t('workflows.hasRevisionHistory')
        : t('workflows.archiveRequired')
      if (canArchiveWorkflow(workflow.status)) {
        lifecycleTarget.value = workflow
        lifecycleMode.value = 'archive'
        deletionImpact.value = impact
      }
      return
    }
    lifecycleTarget.value = workflow
    lifecycleMode.value = 'delete'
    deletionImpact.value = impact
  } catch {
    actionMessage.value = t('workflows.impactFailed')
  } finally {
    lifecycleBusy.value = false
  }
}

function prepareArchive(workflow: WorkflowRun) {
  lifecycleTarget.value = workflow
  lifecycleMode.value = 'archive'
  deletionImpact.value = null
}

function closeLifecycleDialog() {
  if (lifecycleBusy.value) return
  lifecycleTarget.value = null
  lifecycleMode.value = null
  deletionImpact.value = null
}

async function confirmLifecycleAction() {
  if (!lifecycleTarget.value || !lifecycleMode.value || lifecycleBusy.value) return
  const target = lifecycleTarget.value
  const mode = lifecycleMode.value
  lifecycleBusy.value = true
  try {
    if (mode === 'delete') {
      const result = await store.deleteWorkflow(target.id)
      actionMessage.value = t('workflows.deleted', { count: result.preservedLeadCount })
    } else {
      await store.archiveWorkflow(target.id)
      actionMessage.value = t('workflows.archived')
    }
    lifecycleTarget.value = null
    lifecycleMode.value = null
    deletionImpact.value = null
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : t('workflows.lifecycleFailed')
  } finally {
    lifecycleBusy.value = false
  }
}
</script>

<template>
  <AppLayout>
    <div class="app-page">
      <PageHeader :eyebrow="t('workflows.eyebrow')" :title="title" :description="t('workflows.description')">
        <template v-if="reviseId" #actions>
          <ReturnButton fallback="/workflows" />
        </template>
      </PageHeader>

      <section v-if="create" class="panel max-w-4xl overflow-hidden">
        <div class="border-b px-5 py-4" style="border-color: var(--color-border)">
          <h2 class="panel-title">{{ reviseId ? t('workflows.reviseTitle') : t('workflows.createTitle') }}</h2>
          <p class="panel-description">{{ reviseId ? t('workflows.reviseDescription') : t('workflows.description') }}</p>
        </div>
        <form class="p-5" @submit.prevent="submitWorkflow">
          <div v-if="revisionSource" class="notice mb-5 border-sky-400 bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
            {{ t('workflows.revisingFrom', { name: revisionSource.name, revision: revisionSource.revisionNo }) }}
          </div>
          <div v-if="actionMessage" class="notice mb-5 border-red-400 bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-200">{{ actionMessage }}</div>
          <div class="grid gap-5 md:grid-cols-2">
            <label><span class="field-label">{{ t('workflows.name') }}</span><input v-model="form.name" class="input" :placeholder="t('workflows.namePlaceholder')" /></label>
            <fieldset><legend class="field-label">{{ t('workflows.seedType') }}</legend><div class="grid grid-cols-2 gap-2"><label class="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm font-semibold transition" :class="form.seedType === 'keyword' ? 'border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'"><input v-model="form.seedType" type="radio" value="keyword" class="sr-only" /><KeyRound class="h-4 w-4" />{{ t('workflows.keyword') }}</label><label class="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm font-semibold transition" :class="form.seedType === 'image' ? 'border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'"><input v-model="form.seedType" type="radio" value="image" class="sr-only" /><Image class="h-4 w-4" />{{ t('workflows.image') }}</label></div></fieldset>
            <label v-if="form.seedType === 'keyword'" class="md:col-span-2"><span class="field-label">{{ t('workflows.seedValue') }} <em class="font-normal not-italic text-red-500">*</em></span><input v-model="form.seedValue" class="input" :placeholder="t('workflows.seedPlaceholder')" required /><span class="field-help">{{ t('workflows.helperKeyword') }}</span></label>
            <div v-else class="md:col-span-2">
              <span class="field-label">{{ t('workflows.productImage') }} <em class="font-normal not-italic text-red-500">*</em></span>
              <input ref="imageInput" type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" @change="handleImageSelection" />
              <div
                class="flex min-h-44 cursor-pointer items-center justify-center rounded-md border border-dashed p-4 text-center transition focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                :class="imagePreviewUrl ? 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-[#11151a]' : 'border-slate-300 bg-white hover:border-orange-400 hover:bg-orange-50/40 dark:border-slate-700 dark:bg-[#171b21] dark:hover:border-orange-500'"
                role="button"
                tabindex="0"
                @click="openImagePicker"
                @keydown.enter.prevent="openImagePicker"
                @keydown.space.prevent="openImagePicker"
                @paste="handleImagePaste"
                @dragover.prevent
                @drop.prevent="handleImageDrop"
              >
                <div v-if="imagePreviewUrl" class="flex w-full flex-col items-center gap-3 sm:flex-row sm:text-left">
                  <img :src="imagePreviewUrl" :alt="t('workflows.imagePreview')" class="h-28 w-40 rounded-md border border-slate-200 bg-white object-contain dark:border-slate-700" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-semibold text-slate-950 dark:text-white">{{ imageUpload?.originalName || t('workflows.localImage') }}</p>
                    <p class="mt-1 text-xs text-slate-500">{{ isUploadingImage ? t('workflows.imageUploading') : imageUpload ? t('workflows.imageUploaded') : t('workflows.imageWaiting') }}</p>
                    <button type="button" class="btn btn-secondary mt-3" :disabled="isUploadingImage" @click.stop="openImagePicker"><Upload class="h-4 w-4" />{{ t('workflows.replaceImage') }}</button>
                  </div>
                  <button type="button" class="icon-btn self-start" :title="t('workflows.removeImage')" :disabled="isUploadingImage" @click.stop="removeImage"><Trash2 class="h-4 w-4" /></button>
                </div>
                <div v-else class="max-w-lg py-4">
                  <ImagePlus class="mx-auto h-8 w-8 text-orange-500" />
                  <p class="mt-3 text-sm font-semibold text-slate-950 dark:text-white">{{ t('workflows.imageDropTitle') }}</p>
                  <p class="mt-1 text-xs leading-5 text-slate-500">{{ t('workflows.imageDropHint') }}</p>
                </div>
              </div>
              <div v-if="isUploadingImage" class="mt-2 flex items-center gap-2 text-xs font-medium text-orange-700 dark:text-orange-300"><LoaderCircle class="h-4 w-4 animate-spin" />{{ t('workflows.imageUploading') }}</div>
              <p v-if="imageUploadError" class="mt-2 text-xs font-medium text-red-600 dark:text-red-400">{{ imageUploadError }}</p>
              <p v-else-if="imageUpload && !imageUpload.providerReady" class="notice mt-3 border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{{ t('workflows.imageProviderWarning') }}</p>
              <label class="mt-3 block"><span class="field-label">{{ t('workflows.imageUrlAlternative') }}</span><input v-model="form.seedValue" class="input" :placeholder="t('workflows.imagePastePlaceholder')" required @paste="handleImagePaste" /></label>
              <span class="field-help">{{ t('workflows.helperImage') }}</span>
            </div>
            <fieldset v-if="form.seedType === 'keyword'" class="md:col-span-2 rounded-md border p-4" style="border-color: var(--color-border)">
              <legend class="flex items-center gap-2 px-2 text-sm font-semibold text-slate-950 dark:text-white"><SearchCode class="h-4 w-4 text-orange-500" />{{ t('workflows.googleAdvanced') }}</legend>
              <div class="grid gap-2 sm:grid-cols-2">
                <label v-for="option in googleOptionFields" :key="option.key" class="flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-sm font-medium" style="border-color: var(--color-border)">
                  <span>{{ t(option.labelKey) }}</span>
                  <input v-model="form.searchOptions[option.key]" type="checkbox" class="h-4 w-4 accent-orange-600" />
                </label>
              </div>
              <div class="mt-3 rounded-md bg-slate-50 px-3 py-2 dark:bg-[#171b21]"><p class="text-[11px] font-semibold text-slate-500">{{ t('workflows.queryPreview') }}</p><code class="mt-1 block break-all text-xs leading-5 text-slate-700 dark:text-slate-300">{{ googleQueryPreview }}</code></div>
            </fieldset>
            <fieldset class="md:col-span-2">
              <legend class="field-label">{{ t('workflows.targetMarket') }}</legend>
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <label
                  v-for="market in targetMarkets"
                  :key="market.code"
                  class="relative flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border px-3 py-3 text-center transition focus-within:ring-2 focus-within:ring-orange-500/30"
                  :class="form.targetMarket === market.value ? 'border-orange-500 bg-orange-50 text-orange-800 shadow-sm dark:bg-orange-500/10 dark:text-orange-200' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#171b21] dark:text-slate-300 dark:hover:bg-[#20252d]'"
                >
                  <input v-model="form.targetMarket" type="radio" name="target-market" :value="market.value" class="sr-only" required />
                  <img :src="market.flagUrl" alt="" class="h-5 w-7 rounded-sm object-cover shadow-sm ring-1 ring-slate-200" aria-hidden="true" />
                  <strong class="text-sm leading-5">{{ market.code }}</strong>
                  <span class="text-[11px] leading-4">{{ t(market.labelKey) }}</span>
                </label>
              </div>
              <span class="field-help">{{ t('workflows.targetMarketHint') }}</span>
            </fieldset>
          </div>
          <div class="mt-7 flex flex-wrap justify-end gap-3 border-t pt-5" style="border-color: var(--color-border)">
            <RouterLink to="/workflows" class="btn btn-secondary">{{ t('common.cancel') }}</RouterLink>
            <button type="submit" class="btn btn-primary" :disabled="store.isLoading || isUploadingImage || !form.seedValue.trim()">
              <RefreshCw v-if="reviseId" class="h-4 w-4" />
              <Plus v-else class="h-4 w-4" />
              {{ reviseId ? t('workflows.reviseAndRun') : t('workflows.create') }}
            </button>
          </div>
        </form>
      </section>

      <section v-else class="panel overflow-hidden">
        <div v-if="store.workflows.length" class="flex items-center gap-3 border-b px-4 py-3" style="border-color: var(--color-border)">
          <div v-if="actionMessage" class="notice flex-1 border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200">{{ actionMessage }}</div>
          <span v-else class="flex-1" />
          <RouterLink to="/workflows/new" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-orange-600 text-white shadow-sm transition hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500/30" :title="t('nav.newWorkflow')" :aria-label="t('nav.newWorkflow')"><Plus class="h-4 w-4" /></RouterLink>
        </div>
        <div v-if="store.workflows.length" class="overflow-x-auto">
          <table class="data-table min-w-[1380px]">
            <thead><tr><th>{{ t('workflows.workflowId') }}</th><th>{{ t('workflows.name') }}</th><th>{{ t('workflows.createdDate') }}</th><th>{{ t('workflows.seed') }}</th><th>{{ t('common.market') }}</th><th>{{ t('workflows.stage') }}</th><th>{{ t('workflows.leads') }}</th><th>{{ t('workflows.progress') }}</th><th>{{ t('common.status') }}</th><th class="text-right">{{ t('common.actions') }}</th></tr></thead>
            <tbody>
              <tr v-for="workflow in store.workflows" :key="workflow.id">
                <td><span class="inline-flex min-w-12 items-center justify-center rounded bg-slate-100 px-2 py-1 text-xs font-bold tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-200">ID {{ workflow.displayId }}</span></td>
                <td>
                  <div class="flex items-center gap-2">
                    <p class="font-semibold text-slate-950 dark:text-white">{{ workflow.name }}</p>
                    <span v-if="workflow.revisionNo > 1" class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">R{{ workflow.revisionNo }}</span>
                  </div>
                  <button v-if="workflow.status === 'failed'" type="button" class="mt-1 flex max-w-72 items-center gap-1 text-left text-xs leading-5 text-red-600 hover:underline dark:text-red-400" @click="openFailureDetails(workflow)">
                    <CircleAlert class="h-3.5 w-3.5 shrink-0" />
                    <span>{{ failureLabel(workflow) }}</span>
                  </button>
                </td>
                <td class="whitespace-nowrap font-medium tabular-nums text-slate-600 dark:text-slate-300">{{ workflowCreatedDate(workflow.createdAt) }}</td>
                <td><span class="inline-flex items-center gap-1.5"><component :is="workflow.seedType === 'image' ? Image : KeyRound" class="h-3.5 w-3.5 text-slate-400" /><span class="max-w-52 truncate">{{ workflow.seedValue }}</span></span></td>
                <td><span class="inline-flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100"><img :src="resolveTargetMarket(workflow.targetMarket).flagUrl" alt="" class="h-4 w-6 rounded-[2px] object-cover shadow-sm ring-1 ring-black/10" aria-hidden="true" />{{ resolveTargetMarket(workflow.targetMarket).code }}</span></td>
                <td>{{ $te(`status.${workflow.currentStage}`) ? $t(`status.${workflow.currentStage}`) : workflow.currentStage }}</td>
                <td class="font-semibold tabular-nums">{{ workflow.leadCount }}</td>
                <td><div class="flex min-w-32 items-center gap-2"><div class="h-1.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-800"><div class="h-full rounded-full bg-orange-500" :style="{ width: `${workflow.progress}%` }" /></div><span class="text-xs tabular-nums text-slate-500">{{ workflow.progress }}%</span></div></td>
                <td><StatusBadge :status="workflow.status" /></td>
                <td class="min-w-72 text-right">
                  <div class="flex items-center justify-end gap-2">
                    <RouterLink :to="withReturnTo(`/workflows/${workflow.id}/sourcing`, route.fullPath)" class="icon-btn" :title="t('sourcing.open')">
                      <PackageSearch class="h-4 w-4" />
                    </RouterLink>
                    <RouterLink v-if="workflow.status === 'failed'" :to="withReturnTo(`/workflows/${workflow.id}/revise`, route.fullPath)" class="btn btn-primary">
                      <Pencil class="h-4 w-4" />{{ t('workflows.reviseAndRun') }}
                    </RouterLink>
                    <RouterLink v-else-if="workflow.status === 'completed' && canReviseWorkflow(workflow.status)" :to="withReturnTo(`/workflows/${workflow.id}/revise`, route.fullPath)" class="icon-btn" :title="t('workflows.copyAndRevise')">
                      <Pencil class="h-4 w-4" />
                    </RouterLink>
                    <button v-if="workflow.status === 'draft' || workflow.status === 'running' || (workflow.status === 'failed' && workflow.failureRetryable)" type="button" class="icon-btn" :title="workflow.status === 'failed' ? t('workflows.retry') : workflow.status === 'running' ? t('workflows.running') : t('workflows.start')" :disabled="workflow.status === 'running' || activeWorkflowIds.has(workflow.id)" @click="startDiscovery(workflow.id)">
                      <RefreshCw v-if="workflow.status !== 'draft'" class="h-4 w-4" :class="{ 'animate-spin': workflow.status === 'running' }" />
                      <Play v-else class="h-4 w-4" />
                    </button>
                    <button v-if="workflow.status === 'failed'" type="button" class="icon-btn" :title="t('workflows.failureDetails')" @click="openFailureDetails(workflow)"><Info class="h-4 w-4" /></button>
                    <button v-if="canDeleteWorkflow(workflow.status)" type="button" class="icon-btn hover:border-red-300 hover:text-red-600" :title="t('workflows.deleteWorkflow')" :disabled="lifecycleBusy" @click="prepareDelete(workflow)"><Trash2 class="h-4 w-4" /></button>
                    <button v-else-if="canArchiveWorkflow(workflow.status)" type="button" class="icon-btn" :title="t('workflows.archiveWorkflow')" @click="prepareArchive(workflow)"><Archive class="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-else :message="t('workflows.noWorkflows')"><RouterLink to="/workflows/new" class="btn btn-primary"><Plus class="h-4 w-4" />{{ t('nav.newWorkflow') }}</RouterLink></EmptyState>
      </section>

      <div v-if="detailWorkflow" class="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" :aria-label="t('workflows.failureDetails')" @click.self="detailWorkflow = null">
        <section class="w-full max-w-xl overflow-hidden rounded-md border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#15181d]">
          <div class="panel-header"><div><h2 class="panel-title">{{ t('workflows.failureDetails') }}</h2><p class="panel-description">{{ detailWorkflow.name }}</p></div><button class="icon-btn" :title="t('common.close')" @click="detailWorkflow = null"><X class="h-4 w-4" /></button></div>
          <div class="space-y-4 p-5">
            <div class="notice border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"><CircleAlert class="h-5 w-5 shrink-0" /><div><p class="font-semibold">{{ failureLabel(detailWorkflow) }}</p><p class="mt-1 text-sm">{{ t('workflows.failureGuidance') }}</p></div></div>
            <dl class="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt class="field-label">{{ t('workflows.failureProvider') }}</dt><dd class="font-medium">{{ detailWorkflow.failureProvider || t('common.unknown') }}</dd></div>
              <div><dt class="field-label">{{ t('workflows.stage') }}</dt><dd class="font-medium">{{ $te(`status.${detailWorkflow.currentStage}`) ? $t(`status.${detailWorkflow.currentStage}`) : detailWorkflow.currentStage }}</dd></div>
            </dl>
            <div><p class="field-label">{{ t('workflows.technicalDetails') }}</p><pre class="max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-slate-100 p-3 text-xs leading-5 text-slate-700 dark:bg-[#0e1115] dark:text-slate-300">{{ detailWorkflow.failureReason }}</pre></div>
            <div class="flex flex-wrap justify-end gap-2 border-t pt-4" style="border-color: var(--color-border)">
              <button class="btn btn-secondary" @click="startDiscovery(detailWorkflow.id); detailWorkflow = null"><RefreshCw class="h-4 w-4" />{{ t('workflows.retry') }}</button>
              <RouterLink :to="withReturnTo(`/workflows/${detailWorkflow.id}/revise`, route.fullPath)" class="btn btn-primary" @click="detailWorkflow = null"><Pencil class="h-4 w-4" />{{ t('workflows.reviseAndRun') }}</RouterLink>
            </div>
          </div>
        </section>
      </div>

      <div v-if="lifecycleTarget && lifecycleMode" class="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" :aria-label="lifecycleMode === 'delete' ? t('workflows.deleteWorkflow') : t('workflows.archiveWorkflow')" @click.self="closeLifecycleDialog">
        <section class="w-full max-w-lg overflow-hidden rounded-md border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#15181d]">
          <div class="panel-header"><div><h2 class="panel-title">{{ lifecycleMode === 'delete' ? t('workflows.deleteConfirmTitle') : t('workflows.archiveConfirmTitle') }}</h2><p class="panel-description">{{ lifecycleTarget.name }}</p></div><button class="icon-btn" :title="t('common.close')" :disabled="lifecycleBusy" @click="closeLifecycleDialog"><X class="h-4 w-4" /></button></div>
          <div class="space-y-4 p-5">
            <p class="text-sm leading-6 text-slate-700 dark:text-slate-300">{{ lifecycleMode === 'delete' ? t('workflows.deleteConfirmDescription') : t('workflows.archiveConfirmDescription') }}</p>
            <div v-if="lifecycleMode === 'delete'" class="notice border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
              <Info class="h-5 w-5 shrink-0" />
              <span>{{ t('workflows.preserveLeads', { count: deletionImpact?.preservedLeadCount || 0 }) }}</span>
            </div>
            <div class="flex justify-end gap-2 border-t pt-4" style="border-color: var(--color-border)">
              <button class="btn btn-secondary" :disabled="lifecycleBusy" @click="closeLifecycleDialog">{{ t('common.cancel') }}</button>
              <button class="btn" :class="lifecycleMode === 'delete' ? 'btn-danger' : 'btn-primary'" :disabled="lifecycleBusy" @click="confirmLifecycleAction">
                <LoaderCircle v-if="lifecycleBusy" class="h-4 w-4 animate-spin" />
                <Trash2 v-else-if="lifecycleMode === 'delete'" class="h-4 w-4" />
                <Archive v-else class="h-4 w-4" />
                {{ lifecycleMode === 'delete' ? t('workflows.confirmDelete') : t('workflows.confirmArchive') }}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  </AppLayout>
</template>
