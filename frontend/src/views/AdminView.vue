<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DOMPurify from 'dompurify'
import { Eye, FileText, Search, Trash2, Users } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { AppLayout } from '@/components/layout'
import { EmptyState, PageHeader } from '@/components/ui'
import { notesApi, type AdminNote } from '@/api/notes'

const { t, locale } = useI18n()
const notes = ref<AdminNote[]>([])
const searchQuery = ref('')
const showDeleteDialog = ref(false)
const noteToDelete = ref<AdminNote | null>(null)
const showViewDialog = ref(false)
const viewingNote = ref<AdminNote | null>(null)
const sortField = ref<string>('createdAt')
const sortOrder = ref<'asc' | 'desc'>('desc')
const uniqueUsers = computed(() => new Set(notes.value.map(n => n.userId)).size)
const sanitizedViewingContent = computed(() => DOMPurify.sanitize(viewingNote.value?.content || ''))
const filteredNotes = computed(() => { const query = searchQuery.value.toLowerCase(); return query ? notes.value.filter(note => note.title?.toLowerCase().includes(query) || note.user?.username?.toLowerCase().includes(query)) : notes.value })
const filteredAndSortedNotes = computed(() => [...filteredNotes.value].sort((a, b) => {
  const values = (note: AdminNote) => ({ title: note.title || '', author: note.user?.username || '', email: note.user?.email || '', createdAt: new Date(note.createdAt || 0).getTime(), updatedAt: new Date(note.updatedAt || 0).getTime() })
  const valueA = values(a)[sortField.value as keyof ReturnType<typeof values>]
  const valueB = values(b)[sortField.value as keyof ReturnType<typeof values>]
  const comparison = typeof valueA === 'string' && typeof valueB === 'string' ? valueA.localeCompare(valueB, locale.value) : Number(valueA) - Number(valueB)
  return sortOrder.value === 'asc' ? comparison : -comparison
}))
function sortBy(field: string) { if (sortField.value === field) sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'; else { sortField.value = field; sortOrder.value = 'asc' } }
function formatDate(dateStr?: string) { return dateStr ? new Date(dateStr).toLocaleString(locale.value) : '-' }
function viewNote(note: AdminNote) { viewingNote.value = note; showViewDialog.value = true }
function confirmDelete(note: AdminNote) { noteToDelete.value = note; showDeleteDialog.value = true }
async function deleteNote() { if (!noteToDelete.value) return; try { await notesApi.adminDelete(noteToDelete.value.id); notes.value = notes.value.filter(n => n.id !== noteToDelete.value!.id); showDeleteDialog.value = false; noteToDelete.value = null } catch { alert(t('admin.deleteFailed')) } }
async function fetchNotes() { try { notes.value = await notesApi.adminGetAll() } catch { notes.value = [] } }
onMounted(fetchNotes)
</script>

<template>
  <AppLayout>
    <div class="app-page">
      <PageHeader :eyebrow="t('admin.eyebrow')" :title="t('admin.title')" :description="t('admin.description')" />
      <div class="mb-5 grid gap-3 sm:grid-cols-2 lg:max-w-2xl"><article class="metric-card"><p class="metric-label">{{ t('admin.records') }}</p><p class="metric-value">{{ notes.length }}</p><span class="metric-icon"><FileText class="h-4 w-4" /></span></article><article class="metric-card"><p class="metric-label">{{ t('admin.users') }}</p><p class="metric-value">{{ uniqueUsers }}</p><span class="metric-icon"><Users class="h-4 w-4" /></span></article></div>
      <section class="panel overflow-hidden">
        <div class="panel-header"><div><h2 class="panel-title">{{ t('admin.allRecords') }}</h2></div><label class="relative w-full sm:w-80"><Search class="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><input v-model="searchQuery" type="search" class="input pl-10" :placeholder="t('admin.searchPlaceholder')" /></label></div>
        <div v-if="filteredAndSortedNotes.length" class="overflow-x-auto"><table class="data-table"><thead><tr><th v-for="column in [{ key:'title',label:t('admin.titleCol')},{key:'author',label:t('admin.author')},{key:'email',label:t('admin.email')},{key:'createdAt',label:t('admin.created')},{key:'updatedAt',label:t('admin.updated')}]" :key="column.key" class="cursor-pointer select-none" @click="sortBy(column.key)">{{ column.label }} <span v-if="sortField === column.key" class="text-orange-500">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span></th><th>{{ t('common.actions') }}</th></tr></thead><tbody><tr v-for="note in filteredAndSortedNotes" :key="note.id"><td class="max-w-xs truncate font-semibold text-slate-950 dark:text-white">{{ note.title || t('admin.untitled') }}</td><td>{{ note.user?.username || '-' }}</td><td>{{ note.user?.email || '-' }}</td><td class="whitespace-nowrap text-xs">{{ formatDate(note.createdAt) }}</td><td class="whitespace-nowrap text-xs">{{ formatDate(note.updatedAt) }}</td><td><div class="flex gap-2"><button class="btn btn-secondary bg-blue-100 px-3" @click="viewNote(note)"><Eye class="h-4 w-4" />{{ t('common.view') }}</button><button class="icon-btn text-red-500" :title="t('common.delete')" @click="confirmDelete(note)"><Trash2 class="h-4 w-4" /></button></div></td></tr></tbody></table></div>
        <EmptyState v-else :message="t('admin.noRecords')" />
      </section>

      <div v-if="showDeleteDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div class="panel w-full max-w-md p-6"><h3 class="text-lg font-bold text-slate-950 dark:text-white">{{ t('admin.confirmDelete') }}</h3><p class="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{{ t('admin.deleteMessage', { title: noteToDelete?.title || t('admin.untitled') }) }}</p><div class="mt-6 flex justify-end gap-3"><button class="btn btn-secondary" @click="showDeleteDialog = false">{{ t('common.cancel') }}</button><button class="btn btn-danger" @click="deleteNote"><Trash2 class="h-4 w-4" />{{ t('common.delete') }}</button></div></div></div>
      <div v-if="showViewDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div class="panel max-h-[85vh] w-full max-w-3xl overflow-y-auto p-6"><h3 class="text-lg font-bold text-slate-950 dark:text-white">{{ viewingNote?.title || t('admin.untitled') }}</h3><p class="mt-1 text-xs text-slate-500">{{ t('admin.previewAuthor', { author: viewingNote?.user?.username || '-', time: formatDate(viewingNote?.createdAt) }) }}</p><div class="mt-5 rounded-md border bg-slate-50 p-4 text-sm leading-7 text-slate-700 dark:bg-[#171b21] dark:text-slate-300" style="border-color: var(--color-border)" v-html="sanitizedViewingContent" /><div class="mt-5 flex justify-end"><button class="btn btn-secondary" @click="showViewDialog = false">{{ t('common.close') }}</button></div></div></div>
    </div>
  </AppLayout>
</template>
