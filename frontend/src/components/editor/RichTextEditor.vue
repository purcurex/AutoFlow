<script setup lang="ts">
import { watch, onMounted, ref } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { Color } from '@tiptap/extension-color'
import { Highlight } from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import { common, createLowlight } from 'lowlight'

const props = defineProps<{
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const lowlight = createLowlight(common)

const editor = useEditor({
  content: props.modelValue,
  extensions: [
    StarterKit.configure({
      codeBlock: false,
    }),
    Placeholder.configure({
      placeholder: props.placeholder || '开始写点什么...',
    }),
    CodeBlockLowlight.configure({
      lowlight,
    }),
    TextStyle,
    Color,
    Highlight.configure({
      multicolor: true,
    }),
  ],
  onUpdate: ({ editor }) => {
    emit('update:modelValue', editor.getHTML())
  },
})

watch(() => props.modelValue, (value) => {
  if (editor.value && editor.value.getHTML() !== value) {
    editor.value.commands.setContent(value, { emitUpdate: false })
  }
})

onMounted(() => {
  editor.value?.commands.focus()
})

function toggleBold() {
  editor.value?.chain().focus().toggleBold().run()
}

function toggleItalic() {
  editor.value?.chain().focus().toggleItalic().run()
}

function toggleStrike() {
  editor.value?.chain().focus().toggleStrike().run()
}

function toggleHeading(level: 1 | 2 | 3 | 4 | 5 | 6) {
  editor.value?.chain().focus().toggleHeading({ level }).run()
}

function toggleBulletList() {
  editor.value?.chain().focus().toggleBulletList().run()
}

function toggleOrderedList() {
  editor.value?.chain().focus().toggleOrderedList().run()
}

function toggleCodeBlock() {
  editor.value?.chain().focus().toggleCodeBlock().run()
}

function toggleBlockquote() {
  editor.value?.chain().focus().toggleBlockquote().run()
}

function setLink() {
  const url = window.prompt('输入链接地址')
  if (url) {
    editor.value?.chain().focus().setLink({ href: url }).run()
  }
}

// 颜色选择
const showColorPicker = ref(false)
const colors = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#000000', // black
  '#6b7280', // gray
]

function setColor(color: string) {
  editor.value?.chain().focus().setColor(color).run()
  showColorPicker.value = false
}

// 高亮颜色
const showHighlightPicker = ref(false)
const highlightColors = [
  '#fef08a', // yellow
  '#bbf7d0', // green
  '#bfdbfe', // blue
  '#fecaca', // red
  '#e9d5ff', // purple
  '#fed7aa', // orange
]

function setHighlight(color: string) {
  editor.value?.chain().focus().toggleHighlight({ color }).run()
  showHighlightPicker.value = false
}

// 字体大小
const showFontSizePicker = ref(false)
const fontSizes = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px']

function setFontSize(size: string) {
  editor.value?.chain().focus().setMark('textStyle', { fontSize: size }).run()
  showFontSizePicker.value = false
}
</script>

<template>
  <div class="editor-wrapper border border-[var(--color-border)] rounded-lg overflow-hidden">
    <!-- 工具栏 -->
    <div class="editor-toolbar border-b border-[var(--color-border)] flex flex-wrap">
      <button
        @click="toggleBold"
        class="editor-toolbar-btn"
        :class="{ active: editor?.isActive('bold') }"
        title="加粗"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />
        </svg>
      </button>
      <button
        @click="toggleItalic"
        class="editor-toolbar-btn"
        :class="{ active: editor?.isActive('italic') }"
        title="斜体"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 4h4m-2 0v16m4 0h-4" />
        </svg>
      </button>
      <button
        @click="toggleStrike"
        class="editor-toolbar-btn"
        :class="{ active: editor?.isActive('strike') }"
        title="删除线"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9.5c0-2.485-2.239-4.5-5-4.5S7 7.015 7 9.5c0 1.379.655 2.61 1.685 3.5H4m16 0h-4.685c1.03-.89 1.685-2.121 1.685-3.5M7 14.5c0 2.485 2.239 4.5 5 4.5s5-2.015 5-4.5" />
        </svg>
      </button>
      <div class="w-px h-6 bg-[var(--color-border)] mx-1"></div>
      <button
        @click="toggleHeading(1)"
        class="editor-toolbar-btn text-sm font-bold"
        :class="{ active: editor?.isActive('heading', { level: 1 }) }"
        title="标题1"
      >H1</button>
      <button
        @click="toggleHeading(2)"
        class="editor-toolbar-btn text-sm font-bold"
        :class="{ active: editor?.isActive('heading', { level: 2 }) }"
        title="标题2"
      >H2</button>
      <button
        @click="toggleHeading(3)"
        class="editor-toolbar-btn text-sm font-bold"
        :class="{ active: editor?.isActive('heading', { level: 3 }) }"
        title="标题3"
      >H3</button>
      <div class="w-px h-6 bg-[var(--color-border)] mx-1"></div>

      <!-- 字体大小 -->
      <div class="relative">
        <button
          @click="showFontSizePicker = !showFontSizePicker"
          class="editor-toolbar-btn text-sm"
          title="字体大小"
        >
          Aa
        </button>
        <div v-if="showFontSizePicker" class="absolute left-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10 py-1 min-w-[80px]">
          <button
            v-for="size in fontSizes"
            :key="size"
            @click="setFontSize(size)"
            class="block w-full px-4 py-1 text-left hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
            :style="{ fontSize: size }"
          >
            {{ size }}
          </button>
        </div>
      </div>

      <!-- 文字颜色 -->
      <div class="relative">
        <button
          @click="showColorPicker = !showColorPicker"
          class="editor-toolbar-btn"
          title="文字颜色"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M11 2L5.5 16h2.25l1.12-3h6.25l1.13 3h2.25L13 2h-2zm-1.38 9L12 4.67 14.38 11H9.62z"/>
          </svg>
        </button>
        <div v-if="showColorPicker" class="absolute left-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10 p-2">
          <div class="grid grid-cols-5 gap-1">
            <button
              v-for="color in colors"
              :key="color"
              @click="setColor(color)"
              class="w-6 h-6 rounded border border-gray-300"
              :style="{ backgroundColor: color }"
            ></button>
          </div>
        </div>
      </div>

      <!-- 高亮颜色 -->
      <div class="relative">
        <button
          @click="showHighlightPicker = !showHighlightPicker"
          class="editor-toolbar-btn"
          title="高亮颜色"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M15.243 4.515l-6.738 6.737-.707 2.121-1.04 1.041 2.828 2.829 1.04-1.041 2.122-.707 6.737-6.738-4.242-4.242zm6.364 3.535a1 1 0 010 1.414l-7.778 7.778-2.122.707-1.414 1.414a1 1 0 01-1.414 0l-4.243-4.243a1 1 0 010-1.414l1.414-1.414.707-2.121 7.778-7.778a1 1 0 011.414 0l5.657 5.657z"/>
          </svg>
        </button>
        <div v-if="showHighlightPicker" class="absolute left-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10 p-2">
          <div class="grid grid-cols-3 gap-1">
            <button
              v-for="color in highlightColors"
              :key="color"
              @click="setHighlight(color)"
              class="w-8 h-6 rounded border border-gray-300"
              :style="{ backgroundColor: color }"
            ></button>
          </div>
        </div>
      </div>

      <div class="w-px h-6 bg-[var(--color-border)] mx-1"></div>
      <button
        @click="toggleBulletList"
        class="editor-toolbar-btn"
        :class="{ active: editor?.isActive('bulletList') }"
        title="无序列表"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <button
        @click="toggleOrderedList"
        class="editor-toolbar-btn"
        :class="{ active: editor?.isActive('orderedList') }"
        title="有序列表"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 20V4m10 16V4M4 8h6m4 0h6M4 16h6m4 0h6" />
        </svg>
      </button>
      <button
        @click="toggleCodeBlock"
        class="editor-toolbar-btn"
        :class="{ active: editor?.isActive('codeBlock') }"
        title="代码块"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      </button>
      <button
        @click="toggleBlockquote"
        class="editor-toolbar-btn"
        :class="{ active: editor?.isActive('blockquote') }"
        title="引用"
      >
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z" />
        </svg>
      </button>
      <div class="w-px h-6 bg-[var(--color-border)] mx-1"></div>
      <button
        @click="setLink"
        class="editor-toolbar-btn"
        :class="{ active: editor?.isActive('link') }"
        title="插入链接"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      </button>
    </div>

    <!-- 编辑区域 -->
    <EditorContent
      :editor="editor"
      class="editor-content editor-container prose prose-slate dark:prose-invert max-w-none"
    />
  </div>
</template>

<style>
.editor-content .ProseMirror {
  outline: none;
  min-height: 400px;
}

.editor-content .ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  float: left;
  color: var(--color-text-secondary);
  pointer-events: none;
  height: 0;
}

.editor-content .ProseMirror pre {
  background: #1e293b;
  border-radius: 0.5rem;
  padding: 1rem;
  overflow-x: auto;
}

.editor-content .ProseMirror code {
  background: #f1f5f9;
  border-radius: 0.25rem;
  padding: 0.125rem 0.25rem;
}

.dark .editor-content .ProseMirror code {
  background: #334155;
}

.editor-content .ProseMirror mark {
  border-radius: 2px;
  padding: 0 2px;
}

/* 店铺链接颜色 */
.editor-content .ProseMirror a {
  color: #0088CC;
  font-weight: 600;
  text-decoration: underline;
}

.editor-content .ProseMirror a:hover {
  color: #006699;
}

.dark .editor-content .ProseMirror a {
  color: #4da6ff;
}

.dark .editor-content .ProseMirror a:hover {
  color: #80bfff;
}
</style>
