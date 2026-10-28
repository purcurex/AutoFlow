<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { LockKeyhole, Plus, Power, Save, Trash2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { aiApi, type AiPromptCatalog, type AiPromptModuleKey } from '@/api/ai'

const { t } = useI18n()
const catalog = ref<AiPromptCatalog | null>(null)
const moduleKey = ref<AiPromptModuleKey>('outreach_base')
const templateId = ref('')
const draftName = ref('')
const draftContent = ref('')
const creating = ref(false)
const busy = ref(false)
const message = ref('')

const currentModule = computed(() => catalog.value?.modules.find((item) => item.moduleKey === moduleKey.value) || null)
const currentTemplate = computed(() => currentModule.value?.templates.find((item) => item.id === templateId.value) || null)
const canEdit = computed(() => creating.value || !!currentTemplate.value && !currentTemplate.value.isSystem)
const canSave = computed(() => canEdit.value && draftName.value.trim().length >= 2 && draftContent.value.trim().length >= 10)

onMounted(load)

async function load(preferredId?: string) {
  catalog.value = await aiApi.getPromptModules()
  const current = catalog.value.modules.find((item) => item.moduleKey === moduleKey.value) || catalog.value.modules[0]
  moduleKey.value = current.moduleKey
  selectTemplate(preferredId || current.activeTemplateId)
}

function selectTemplate(id: string) {
  templateId.value = id
  creating.value = false
  const template = currentModule.value?.templates.find((item) => item.id === id)
  draftName.value = template?.name || ''
  draftContent.value = template?.content || ''
  message.value = ''
}

function selectTemplateFromEvent(event: Event) {
  selectTemplate((event.target as HTMLSelectElement).value)
}

function formatVariable(variable: string) {
  return `{{${variable}}}`
}

function changeModule() {
  const current = currentModule.value
  if (current) selectTemplate(current.activeTemplateId)
}

function createNew() {
  creating.value = true
  templateId.value = ''
  draftName.value = ''
  draftContent.value = currentModule.value?.templates.find((item) => item.id === currentModule.value?.activeTemplateId)?.content || ''
  message.value = ''
}

async function save() {
  if (!canSave.value || busy.value) return
  busy.value = true
  try {
    if (creating.value) {
      const created = await aiApi.createPromptTemplate({ moduleKey: moduleKey.value, name: draftName.value.trim(), content: draftContent.value.trim() })
      await load(created.id)
    } else {
      await aiApi.updatePromptTemplate(templateId.value, { name: draftName.value.trim(), content: draftContent.value.trim() })
      await load(templateId.value)
    }
    message.value = t('settings.promptSaved')
  } catch (error) {
    message.value = (error as { message?: string }).message || t('settings.promptFailed')
  } finally { busy.value = false }
}

async function activate() {
  if (!templateId.value || busy.value) return
  busy.value = true
  try { await aiApi.activatePromptTemplate(moduleKey.value, templateId.value); await load(templateId.value); message.value = t('settings.promptActivated') }
  catch (error) { message.value = (error as { message?: string }).message || t('settings.promptFailed') }
  finally { busy.value = false }
}

async function remove() {
  if (!currentTemplate.value || currentTemplate.value.isSystem || busy.value) return
  busy.value = true
  try { await aiApi.deletePromptTemplate(currentTemplate.value.id); await load(); message.value = t('settings.promptDeleted') }
  catch (error) { message.value = (error as { message?: string }).message || t('settings.promptFailed') }
  finally { busy.value = false }
}
</script>

<template>
  <section class="panel overflow-hidden">
    <div class="panel-header"><div><h2 class="panel-title">{{ t('settings.promptTemplates') }}</h2></div><button class="btn btn-secondary" @click="createNew"><Plus class="h-4 w-4" />{{ t('settings.newPrompt') }}</button></div>
    <div v-if="catalog" class="grid gap-5 p-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div class="space-y-4">
        <label><span class="field-label">{{ t('settings.promptModule') }}</span><select v-model="moduleKey" class="input" @change="changeModule"><option v-for="item in catalog.modules" :key="item.moduleKey" :value="item.moduleKey">{{ t(`settings.promptModule_${item.moduleKey}`) }}</option></select></label>
        <label><span class="field-label">{{ t('settings.promptTemplate') }}</span><select :value="templateId" class="input" @change="selectTemplateFromEvent"><option v-for="item in currentModule?.templates" :key="item.id" :value="item.id">{{ item.name }}{{ item.isActive ? ` - ${t('settings.activePrompt')}` : '' }}</option></select></label>
        <div class="flex flex-wrap gap-1.5"><code v-for="variable in catalog.variables" :key="variable" class="rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-600 dark:bg-[#171b21] dark:text-slate-300">{{ formatVariable(variable) }}</code></div>
      </div>
      <div class="space-y-4">
        <label><span class="field-label">{{ t('settings.promptName') }}</span><input v-model="draftName" class="input" :disabled="!canEdit" maxlength="80" /></label>
        <label><span class="field-label">{{ t('settings.promptContent') }}</span><textarea v-model="draftContent" class="input min-h-64 resize-y font-mono text-sm leading-6" :disabled="!canEdit" maxlength="5000" /></label>
        <div class="flex flex-wrap items-center gap-2"><button class="btn btn-primary" :disabled="!canSave || busy" @click="save"><Save class="h-4 w-4" />{{ t('common.save') }}</button><button v-if="!creating && currentTemplate && !currentTemplate.isActive" class="btn btn-secondary" :disabled="busy" @click="activate"><Power class="h-4 w-4" />{{ t('settings.activatePrompt') }}</button><button v-if="currentTemplate?.isSystem" class="btn btn-ghost" disabled><LockKeyhole class="h-4 w-4" />{{ t('settings.systemPrompt') }}</button><button v-if="currentTemplate && !currentTemplate.isSystem" class="btn btn-danger" :disabled="busy" @click="remove"><Trash2 class="h-4 w-4" />{{ t('common.delete') }}</button><span v-if="message" class="text-sm text-slate-600 dark:text-slate-300">{{ message }}</span></div>
      </div>
    </div>
  </section>
</template>
