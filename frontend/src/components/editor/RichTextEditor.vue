<script setup lang="ts">
import { watch, onMounted, onUnmounted, ref } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { Color } from '@tiptap/extension-color'
import { Highlight } from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import { Link } from '@tiptap/extension-link'
import { common, createLowlight } from 'lowlight'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// 自定义字体大小扩展
const FontSize = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null,
        parseHTML: element => element.style.fontSize?.replace(/['"]+/g, ''),
        renderHTML: attributes => {
          if (!attributes.fontSize) {
            return {}
          }
          return {
            style: `font-size: ${attributes.fontSize}`,
          }
        },
      },
    }
  },
})

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
    FontSize,
    Color,
    Highlight.configure({
      multicolor: true,
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {
        class: 'editor-link',
        target: '_blank',
        rel: 'noopener noreferrer',
      },
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

// 撤销和重做
function undo() {
  editor.value?.chain().focus().undo().run()
}

function redo() {
  editor.value?.chain().focus().redo().run()
}

// 格式刷功能
const isFormatPainterActive = ref(false)
const copiedFormat = ref<{
  bold?: boolean
  italic?: boolean
  strike?: boolean
  color?: string
  highlight?: string
  fontSize?: string
} | null>(null)

// 获取选中文本的格式
function getSelectionFormat(): typeof copiedFormat.value {
  if (!editor.value) return null

  const format: typeof copiedFormat.value = {}

  // 检查各种格式
  if (editor.value.isActive('bold')) {
    format.bold = true
  }
  if (editor.value.isActive('italic')) {
    format.italic = true
  }
  if (editor.value.isActive('strike')) {
    format.strike = true
  }

  // 获取文字颜色
  const color = editor.value.getAttributes('textStyle').color
  if (color) {
    format.color = color
  }

  // 获取高亮颜色
  const highlight = editor.value.getAttributes('highlight').color
  if (highlight) {
    format.highlight = highlight
  }

  // 获取字体大小
  const fontSize = editor.value.getAttributes('textStyle').fontSize
  if (fontSize) {
    format.fontSize = fontSize
  }

  // 如果没有任何格式，返回 null
  if (Object.keys(format).length === 0) {
    return null
  }

  return format
}

// 切换格式刷模式
function toggleFormatPainter() {
  if (isFormatPainterActive.value) {
    // 如果已激活，取消格式刷
    isFormatPainterActive.value = false
    copiedFormat.value = null
    return
  }

  if (!editor.value) return

  const { from, to } = editor.value.state.selection

  // 检查是否有选中文本
  if (from === to) {
    alert(t('editor.painterSelect'))
    return
  }

  // 获取选中文本的格式
  const format = getSelectionFormat()

  if (!format) {
    alert(t('editor.painterEmpty'))
    return
  }

  // 复制格式并激活格式刷
  copiedFormat.value = format
  isFormatPainterActive.value = true
}

// 应用格式（在鼠标释放时调用）
function applyFormatOnMouseUp() {
  if (!isFormatPainterActive.value || !copiedFormat.value || !editor.value) return

  const { from, to } = editor.value.state.selection

  // 检查是否有选中文本
  if (from === to) return

  const format = copiedFormat.value

  // 应用保存的格式到新选区
  const chain = editor.value.chain().focus()

  // 清除现有格式
  chain.unsetAllMarks()

  // 应用保存的格式
  if (format.bold) {
    chain.toggleBold()
  }
  if (format.italic) {
    chain.toggleItalic()
  }
  if (format.strike) {
    chain.toggleStrike()
  }
  if (format.color) {
    chain.setColor(format.color)
  }
  if (format.highlight) {
    chain.toggleHighlight({ color: format.highlight })
  }
  if (format.fontSize) {
    chain.setMark('textStyle', { fontSize: format.fontSize })
  }

  chain.run()

  // 保持格式刷激活状态，可以继续应用
}

// 监听键盘事件，Ctrl+Z 取消格式刷
function handleKeyDown(event: KeyboardEvent) {
  if (isFormatPainterActive.value && event.ctrlKey && event.key === 'z') {
    isFormatPainterActive.value = false
    copiedFormat.value = null
  }
}

// 关闭所有下拉菜单
function closeAllDropdowns() {
  showColorPicker.value = false
  showHighlightPicker.value = false
  showFontSizePicker.value = false
}

// 点击外部关闭下拉菜单
function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.dropdown-container')) {
    closeAllDropdowns()
  }
}

// 统一的生命周期钩子
onMounted(() => {
  editor.value?.commands.focus()
  document.addEventListener('click', handleClickOutside)
  // 监听鼠标释放事件，用于格式刷
  document.addEventListener('mouseup', applyFormatOnMouseUp)
  // 监听键盘事件，Ctrl+Z 取消格式刷
  document.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('mouseup', applyFormatOnMouseUp)
  document.removeEventListener('keydown', handleKeyDown)
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
  // 标题对应的字体大小
  const headingSizes: Record<number, string> = {
    1: '24px',
    2: '20px',
    3: '18px',
    4: '16px',
    5: '14px',
    6: '12px',
  }

  const chain = editor.value?.chain().focus()
  if (!chain) return

  // 切换标题
  chain.toggleHeading({ level })

  // 设置字体大小
  const fontSize = headingSizes[level]
  if (fontSize) {
    chain.setMark('textStyle', { fontSize })
  }

  chain.run()
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
  // 如果已有链接，取消链接
  if (editor.value?.isActive('link')) {
    editor.value.chain().focus().unsetLink().run()
    return
  }

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

// 清除字体大小
function unsetFontSize() {
  editor.value?.chain().focus().unsetMark('textStyle').run()
  showFontSizePicker.value = false
}
</script>

<template>
  <div
    class="editor-wrapper border border-[var(--color-border)] rounded-lg overflow-hidden"
    :class="{ 'format-painter-mode': isFormatPainterActive }"
  >
    <!-- 工具栏 -->
    <div class="editor-toolbar border-b border-[var(--color-border)] flex flex-wrap">
      <!-- 撤销/重做 -->
      <button
        @click="undo"
        class="editor-toolbar-btn"
        :disabled="!editor?.can().undo()"
        :title="`${t('editor.undo')} (Ctrl+Z)`"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
        </svg>
      </button>
      <button
        @click="redo"
        class="editor-toolbar-btn"
        :disabled="!editor?.can().redo()"
        :title="`${t('editor.redo')} (Ctrl+Shift+Z)`"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
        </svg>
      </button>
      <div class="w-px h-6 bg-[var(--color-border)] mx-1"></div>

      <!-- 格式刷 -->
      <button
        @click="toggleFormatPainter"
        class="editor-toolbar-btn format-painter-btn"
        :class="{ active: isFormatPainterActive }"
        :title="isFormatPainterActive ? t('editor.painterCancel') : t('editor.painter')"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <!-- 刷子柄 -->
          <path d="M18 2L22 6" />
          <rect x="14" y="4" width="7" height="4" rx="1" transform="rotate(45 14 4)" />
          <!-- 刷子头 -->
          <path d="M13 9L4 18C3 19 3 20.5 4 21.5C5 22.5 6.5 22.5 7.5 21.5L16.5 12.5" />
          <!-- 刷毛 -->
          <path d="M4.5 18.5L2 21" />
          <path d="M6 20L3.5 22.5" />
          <path d="M7.5 21.5L5 24" />
        </svg>
      </button>
      <div class="w-px h-6 bg-[var(--color-border)] mx-1"></div>

      <button
        @click="toggleBold"
        class="editor-toolbar-btn"
        :class="{ active: editor?.isActive('bold') }"
        :title="t('editor.bold')"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />
        </svg>
      </button>
      <button
        @click="toggleItalic"
        class="editor-toolbar-btn"
        :class="{ active: editor?.isActive('italic') }"
        :title="t('editor.italic')"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 4h4m-2 0v16m4 0h-4" />
        </svg>
      </button>
      <button
        @click="toggleStrike"
        class="editor-toolbar-btn"
        :class="{ active: editor?.isActive('strike') }"
        :title="t('editor.strike')"
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
        :title="t('editor.heading1')"
      >H1</button>
      <button
        @click="toggleHeading(2)"
        class="editor-toolbar-btn text-sm font-bold"
        :class="{ active: editor?.isActive('heading', { level: 2 }) }"
        :title="t('editor.heading2')"
      >H2</button>
      <button
        @click="toggleHeading(3)"
        class="editor-toolbar-btn text-sm font-bold"
        :class="{ active: editor?.isActive('heading', { level: 3 }) }"
        :title="t('editor.heading3')"
      >H3</button>
      <div class="w-px h-6 bg-[var(--color-border)] mx-1"></div>

      <!-- 字体大小 -->
      <div class="relative dropdown-container">
        <button
          @click.stop="showFontSizePicker = !showFontSizePicker; showColorPicker = false; showHighlightPicker = false"
          class="editor-toolbar-btn text-sm"
          :class="{ active: showFontSizePicker }"
          :title="t('editor.fontSize')"
        >
          Aa
        </button>
        <div v-if="showFontSizePicker" class="absolute left-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10 py-1 min-w-[80px]">
          <button
            @click="unsetFontSize"
            class="block w-full px-4 py-1 text-left hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap text-gray-500"
          >
            默认
          </button>
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
      <div class="relative dropdown-container">
        <button
          @click.stop="showColorPicker = !showColorPicker; showFontSizePicker = false; showHighlightPicker = false"
          class="editor-toolbar-btn"
          :class="{ active: showColorPicker }"
          :title="t('editor.textColor')"
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
      <div class="relative dropdown-container">
        <button
          @click.stop="showHighlightPicker = !showHighlightPicker; showColorPicker = false; showFontSizePicker = false"
          class="editor-toolbar-btn"
          :class="{ active: showHighlightPicker }"
          :title="t('editor.highlight')"
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
        :title="t('editor.bulletList')"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <button
        @click="toggleOrderedList"
        class="editor-toolbar-btn"
        :class="{ active: editor?.isActive('orderedList') }"
        :title="t('editor.orderedList')"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 20V4m10 16V4M4 8h6m4 0h6M4 16h6m4 0h6" />
        </svg>
      </button>
      <button
        @click="toggleCodeBlock"
        class="editor-toolbar-btn"
        :class="{ active: editor?.isActive('codeBlock') }"
        :title="t('editor.codeBlock')"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      </button>
      <button
        @click="toggleBlockquote"
        class="editor-toolbar-btn"
        :class="{ active: editor?.isActive('blockquote') }"
        :title="t('editor.quote')"
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
        :title="editor?.isActive('link') ? t('editor.removeLink') : t('editor.insertLink')"
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

/* 标题样式 */
.editor-content .ProseMirror h1 {
  font-size: 24px;
  font-weight: 700;
  color: #000;
  margin: 1em 0 0.5em;
}

.editor-content .ProseMirror h2 {
  font-size: 20px;
  font-weight: 700;
  color: #000;
  margin: 1em 0 0.5em;
}

.editor-content .ProseMirror h3 {
  font-size: 18px;
  font-weight: 700;
  color: #000;
  margin: 1em 0 0.5em;
}

.dark .editor-content .ProseMirror h1,
.dark .editor-content .ProseMirror h2,
.dark .editor-content .ProseMirror h3 {
  color: #fff;
}

/* 列表样式 */
.editor-content .ProseMirror ul,
.editor-content .ProseMirror ol {
  padding-left: 1.5rem;
  margin: 0.5em 0;
}

.editor-content .ProseMirror ul {
  list-style-type: disc;
}

.editor-content .ProseMirror ol {
  list-style-type: decimal;
}

.editor-content .ProseMirror li {
  margin: 0.25em 0;
}

.editor-content .ProseMirror li p {
  margin: 0;
}

/* 引用样式 */
.editor-content .ProseMirror blockquote {
  border-left: 4px solid #cbd5e1;
  padding-left: 1rem;
  margin: 1em 0;
  color: #64748b;
  font-style: italic;
}

.dark .editor-content .ProseMirror blockquote {
  border-left-color: #475569;
  color: #94a3b8;
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

/* 格式刷模式样式 */
.format-painter-mode {
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
}

.format-painter-mode .ProseMirror {
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%233b82f6' stroke-width='1.5'%3E%3Cpath d='M18 2L22 6'/%3E%3Crect x='14' y='4' width='7' height='4' rx='1' transform='rotate(45 14 4)'/%3E%3Cpath d='M13 9L4 18C3 19 3 20.5 4 21.5C5 22.5 6.5 22.5 7.5 21.5L16.5 12.5'/%3E%3Cpath d='M4.5 18.5L2 21'/%3E%3Cpath d='M6 20L3.5 22.5'/%3E%3Cpath d='M7.5 21.5L5 24'/%3E%3C/svg%3E") 2 18, auto !important;
}

.format-painter-btn.active {
  background-color: #3b82f6 !important;
  color: white !important;
  border-radius: 4px;
}

.format-painter-btn.active svg {
  stroke: white;
}
</style>
