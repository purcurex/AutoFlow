<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Save, Star, Trash2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useNoteStore } from '@/stores'
import { AppLayout } from '@/components/layout'
import { RichTextEditor } from '@/components/editor'
import { ReturnButton } from '@/components/ui'

const route = useRoute()
const router = useRouter()
const noteStore = useNoteStore()
const { t, locale } = useI18n()
const title = ref(''); const content = ref(''); const isSaving = ref(false); const lastSaved = ref<Date | null>(null); const hasChanges = ref(false); const isLoading = ref(true)
onMounted(async () => { isLoading.value = true; try { await noteStore.fetchNote(route.params.id as string); if (noteStore.currentNote) { title.value = noteStore.currentNote.title; content.value = noteStore.currentNote.content } } catch { router.push('/') } finally { isLoading.value = false } })
function onContentChange() { hasChanges.value = true }
async function saveNote() { if (!noteStore.currentNote || !hasChanges.value) return; isSaving.value = true; try { await noteStore.updateNote(noteStore.currentNote.id, { title: title.value, content: content.value }); lastSaved.value = new Date(); hasChanges.value = false } catch { alert(t('legacy.saveFailed')) } finally { isSaving.value = false } }
async function toggleFavorite() { if (noteStore.currentNote) await noteStore.updateNote(noteStore.currentNote.id, { isFavorite: !noteStore.currentNote.isFavorite }) }
async function deleteNote() { if (noteStore.currentNote && confirm(t('legacy.deleteConfirm'))) { await noteStore.deleteNote(noteStore.currentNote.id); router.push('/') } }
function formatLastSaved() { return lastSaved.value ? t('legacy.savedAt', { time: lastSaved.value.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' }) }) : '' }
</script>

<template>
  <AppLayout>
    <div v-if="isLoading" class="empty-state h-full">{{ t('common.loading') }}</div>
    <div v-else-if="noteStore.currentNote" class="flex h-full flex-col">
      <div class="flex flex-col gap-3 border-b bg-white p-4 dark:bg-[#111419] sm:flex-row sm:items-center sm:justify-between" style="border-color: var(--color-border)"><div class="flex min-w-0 flex-1 items-center gap-2"><ReturnButton fallback="/" compact /><input v-model="title" type="text" :placeholder="t('legacy.titlePlaceholder')" class="min-w-0 flex-1 bg-transparent text-lg font-bold outline-none" @input="onContentChange" /></div><div class="flex items-center justify-end gap-2"><span v-if="isSaving" class="text-xs text-slate-400">{{ t('legacy.saving') }}</span><span v-else-if="hasChanges" class="text-xs font-medium text-amber-600">{{ t('legacy.unsaved') }}</span><span v-else-if="lastSaved" class="text-xs text-emerald-600">{{ formatLastSaved() }}</span><button class="btn btn-primary" :disabled="isSaving || !hasChanges" @click="saveNote"><Save class="h-4 w-4" />{{ t('legacy.save') }}</button><button class="icon-btn" :class="{ 'text-amber-500': noteStore.currentNote?.isFavorite }" @click="toggleFavorite"><Star class="h-4 w-4" :fill="noteStore.currentNote?.isFavorite ? 'currentColor' : 'none'" /></button><button class="icon-btn text-red-500" @click="deleteNote"><Trash2 class="h-4 w-4" /></button></div></div>
      <div class="flex-1 overflow-auto p-4"><RichTextEditor v-model="content" :placeholder="t('legacy.editorPlaceholder')" @update:model-value="onContentChange" /></div>
    </div>
    <div v-else class="empty-state h-full"><p>{{ t('legacy.notFound') }}</p><button class="btn btn-primary" @click="router.push('/')">{{ t('legacy.backHome') }}</button></div>
  </AppLayout>
</template>
