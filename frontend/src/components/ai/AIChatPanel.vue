<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { aiApi } from '@/api'

interface Props {
  visible: boolean
  noteContent?: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:visible': [value: boolean]
  'insert-text': [text: string]
}>()

const messages = ref<Message[]>([])
const inputText = ref('')
const isLoading = ref(false)
const messagesContainer = ref<HTMLElement | null>(null)

const quickActions = [
  { action: 'continue' as const, label: 'Continue' },
  { action: 'polish' as const, label: 'Polish' },
  { action: 'summarize' as const, label: 'Summarize' },
]

watch(() => props.visible, (visible) => {
  if (visible && messages.value.length === 0) {
    messages.value.push({
      id: 'welcome',
      role: 'assistant',
      content: 'Hi, I can help draft, polish, summarize, or answer questions about the current note.',
    })
  }
})

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || isLoading.value) return

  messages.value.push({ id: Date.now().toString(), role: 'user', content: text })
  inputText.value = ''
  scrollToBottom()

  isLoading.value = true
  try {
    const response = await aiApi.askQuestion(text)
    messages.value.push({ id: `${Date.now()}-ai`, role: 'assistant', content: response.result })
  } catch (error) {
    console.error('AI request failed:', error)
    messages.value.push({ id: `${Date.now()}-error`, role: 'assistant', content: 'AI service is unavailable. Please try again later.' })
  } finally {
    isLoading.value = false
    scrollToBottom()
  }
}

async function handleQuickAction(action: 'continue' | 'polish' | 'summarize') {
  if (!props.noteContent || isLoading.value) return

  messages.value.push({ id: Date.now().toString(), role: 'user', content: `${action} current note` })
  isLoading.value = true
  try {
    const response = await aiApi.generate({ action, content: props.noteContent })
    messages.value.push({ id: `${Date.now()}-ai`, role: 'assistant', content: response.result })
  } catch (error) {
    console.error('AI request failed:', error)
    messages.value.push({ id: `${Date.now()}-error`, role: 'assistant', content: 'AI service is unavailable. Please try again later.' })
  } finally {
    isLoading.value = false
    scrollToBottom()
  }
}

function insertText(message: Message) {
  if (message.role === 'assistant' && message.content) {
    emit('insert-text', message.content)
  }
}

function closePanel() {
  emit('update:visible', false)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="visible"
        class="fixed right-4 top-16 z-50 flex max-h-[80vh] w-96 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <span class="font-semibold text-slate-900 dark:text-slate-100">AI assistant</span>
          <button class="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" @click="closePanel">
            <span class="sr-only">Close</span>
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div ref="messagesContainer" class="flex-1 space-y-3 overflow-y-auto p-4">
          <div
            v-for="message in messages"
            :key="message.id"
            class="flex"
            :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
          >
            <div
              class="max-w-[85%] rounded-lg px-3 py-2 text-sm leading-6"
              :class="message.role === 'user'
                ? 'bg-primary-600 text-white'
                : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'"
            >
              <p class="whitespace-pre-wrap">{{ message.content }}</p>
              <button
                v-if="message.role === 'assistant' && message.id !== 'welcome'"
                class="mt-2 text-xs font-medium text-primary-600 dark:text-primary-300"
                @click="insertText(message)"
              >
                Insert
              </button>
            </div>
          </div>
          <p v-if="isLoading" class="text-sm text-slate-500">Generating...</p>
        </div>

        <div class="border-t border-slate-200 p-3 dark:border-slate-700">
          <div class="mb-2 flex gap-2">
            <button
              v-for="action in quickActions"
              :key="action.action"
              class="flex-1 rounded border border-slate-200 px-2 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
              :disabled="!noteContent || isLoading"
              @click="handleQuickAction(action.action)"
            >
              {{ action.label }}
            </button>
          </div>
          <div class="flex items-end gap-2">
            <textarea
              v-model="inputText"
              class="input min-h-11 resize-none text-sm"
              rows="1"
              placeholder="Ask AI..."
              :disabled="isLoading"
              @keydown="handleKeydown"
            ></textarea>
            <button class="btn btn-primary px-3" :disabled="!inputText.trim() || isLoading" @click="sendMessage">Send</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
