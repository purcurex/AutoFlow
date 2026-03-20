<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore, useNoteStore } from '@/stores'
import { shopifySearchApi, type ShopifyStore, type ShopifySearchResult, type DomainTraffic } from '@/api/shopify-search'
import { facebookAdsApi, type FacebookAd, type FacebookAdsSearchResult } from '@/api/facebook-ads'

const emit = defineEmits<{
  'toggle-sidebar': []
}>()

const router = useRouter()
const userStore = useUserStore()
const noteStore = useNoteStore()

const showUserMenu = ref(false)
const showShopifySearch = ref(false)
const isSearching = ref(false)
const searchResults = ref<ShopifyStore[]>([])
const searchError = ref('')
const searchMode = ref<'image' | 'keyword'>('image')
const keywordInput = ref('')
const imageUrlInput = ref('')
// 存储最近一次搜索的完整结果
const lastSearchResult = ref<ShopifySearchResult | null>(null)

// Facebook Ads搜索状态
const showFacebookAdsSearch = ref(false)
const isFacebookSearching = ref(false)
const facebookSearchResults = ref<FacebookAd[]>([])
const facebookSearchError = ref('')
const facebookKeywordInput = ref('')
const lastFacebookSearchResult = ref<FacebookAdsSearchResult | null>(null)

onMounted(async () => {
  // 获取用户信息以确保头像是最新的
  await userStore.fetchUser()
})

function handleLogout() {
  userStore.logout()
  router.push('/login')
}

function handleSearch() {
  // 搜索功能
}

function openShopifySearch() {
  showShopifySearch.value = true
  searchResults.value = []
  searchError.value = ''
  keywordInput.value = ''
  imageUrlInput.value = ''
  lastSearchResult.value = null
}

function closeShopifySearch() {
  showShopifySearch.value = false
  searchResults.value = []
  searchError.value = ''
  lastSearchResult.value = null
}

async function searchByKeyword() {
  if (!keywordInput.value.trim()) {
    searchError.value = '请输入搜索关键词'
    return
  }

  isSearching.value = true
  searchError.value = ''

  try {
    const result = await shopifySearchApi.searchByKeyword(keywordInput.value.trim())
    searchResults.value = result.stores
    lastSearchResult.value = result
    if (result.error) {
      searchError.value = result.error
    }
  } catch (error: unknown) {
    const err = error as { message?: string }
    searchError.value = err.message || '搜索失败，请重试'
  } finally {
    isSearching.value = false
  }
}

async function searchByImageUrl() {
  if (!imageUrlInput.value.trim()) {
    searchError.value = '请输入图片URL'
    return
  }

  isSearching.value = true
  searchError.value = ''

  try {
    const result = await shopifySearchApi.searchByImageUrl(imageUrlInput.value.trim())
    searchResults.value = result.stores
    lastSearchResult.value = result
    if (result.error) {
      searchError.value = result.error
    }
  } catch (error: unknown) {
    const err = error as { message?: string }
    searchError.value = err.message || '搜索失败，请重试'
  } finally {
    isSearching.value = false
  }
}

async function saveResultsToNote() {
  if (searchResults.value.length === 0 || !lastSearchResult.value) return

  try {
    // 创建新笔记并保存内容（使用富文本编辑器）
    const note = await noteStore.createNote({
      title: lastSearchResult.value.noteTitle || `Shopify店铺搜索结果 - ${new Date().toLocaleDateString('zh-CN')}`,
      content: lastSearchResult.value.noteContent,
      editorType: 'richtext',
    })

    // 关闭弹窗并跳转到笔记
    closeShopifySearch()
    noteStore.setCurrentNote(note)
    router.push('/')
  } catch (error: unknown) {
    const err = error as { message?: string }
    searchError.value = err.message || '保存失败，请重试'
  }
}

// Facebook Ads搜索函数
function openFacebookAdsSearch() {
  showFacebookAdsSearch.value = true
  facebookSearchResults.value = []
  facebookSearchError.value = ''
  facebookKeywordInput.value = ''
  lastFacebookSearchResult.value = null
}

function closeFacebookAdsSearch() {
  showFacebookAdsSearch.value = false
  facebookSearchResults.value = []
  facebookSearchError.value = ''
  lastFacebookSearchResult.value = null
}

async function searchFacebookAdsByKeyword() {
  if (!facebookKeywordInput.value.trim()) {
    facebookSearchError.value = '请输入搜索关键词'
    return
  }

  isFacebookSearching.value = true
  facebookSearchError.value = ''

  try {
    const result = await facebookAdsApi.searchByKeyword(facebookKeywordInput.value.trim())
    facebookSearchResults.value = result.ads
    lastFacebookSearchResult.value = result
    if (result.error) {
      facebookSearchError.value = result.error
    }
  } catch (error: unknown) {
    const err = error as { message?: string }
    facebookSearchError.value = err.message || '搜索失败，请重试'
  } finally {
    isFacebookSearching.value = false
  }
}

async function saveFacebookAdsToNote() {
  if (facebookSearchResults.value.length === 0 || !lastFacebookSearchResult.value) return

  try {
    const note = await noteStore.createNote({
      title: lastFacebookSearchResult.value.noteTitle || `Facebook Ads搜索结果 - ${new Date().toLocaleDateString('zh-CN')}`,
      content: lastFacebookSearchResult.value.noteContent,
      editorType: 'richtext',
    })

    closeFacebookAdsSearch()
    noteStore.setCurrentNote(note)
    router.push('/')
  } catch (error: unknown) {
    const err = error as { message?: string }
    facebookSearchError.value = err.message || '保存失败，请重试'
  }
}

// 格式化流量数据
function formatTraffic(traffic?: DomainTraffic): string {
  if (!traffic) return ''
  const parts: string[] = []

  if (traffic.monthlyVisits !== undefined && traffic.monthlyVisits > 0) {
    parts.push(`月访问 ${formatNumber(traffic.monthlyVisits)}`)
  }

  if (traffic.rank !== undefined && traffic.rank > 0) {
    parts.push(`排名 #${formatNumber(traffic.rank)}`)
  }

  return parts.join(' | ')
}

// 格式化数字
function formatNumber(num: number): string {
  if (num >= 1000000000) {
    return (num / 1000000000).toFixed(1) + 'B'
  }
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M'
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K'
  }
  return num.toString()
}
</script>

<template>
  <header class="h-14 border-b border-[var(--color-border)] bg-[var(--color-background)] flex items-center px-4">
    <!-- 左侧：菜单按钮 + Logo -->
    <div class="flex items-center gap-3 flex-shrink-0">
      <button
        @click="emit('toggle-sidebar')"
        class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <h1 class="text-lg font-semibold text-primary-600">NoteFlow</h1>
    </div>

    <!-- 中间：搜索框 -->
    <div class="flex-1 flex justify-center px-8">
      <div class="relative w-full max-w-md flex items-center gap-3">
        <!-- Shopify搜索按钮 -->
        <button
          @click="openShopifySearch"
          class="px-4 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 transition-colors flex items-center gap-2 text-white font-medium"
          title="搜索Shopify店铺"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 7v6m3-3H7" />
          </svg>
          <span>Shopify</span>
        </button>
        <!-- Facebook Ads搜索按钮 -->
        <button
          @click="openFacebookAdsSearch"
          class="px-4 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 transition-colors flex items-center gap-2 text-white font-medium"
          title="搜索Facebook Ads"
        >
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
          </svg>
          <span>Facebook Ads</span>
        </button>
        <div class="relative flex-1">
          <svg
            class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            v-model="noteStore.searchQuery"
            type="text"
            placeholder="搜索笔记..."
            class="input pl-10 text-sm w-full"
            @keyup.enter="handleSearch"
          />
        </div>
      </div>
    </div>

    <!-- 右侧：用户菜单（固定在最右侧） -->
    <div class="flex items-center flex-shrink-0 ml-auto">
      <div class="relative">
        <button
          @click="showUserMenu = !showUserMenu"
          class="flex items-center gap-2 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <div class="w-9 h-9 rounded-full bg-primary-500 flex items-center justify-center text-white text-sm font-medium overflow-hidden ring-2 ring-transparent hover:ring-primary-200 dark:hover:ring-primary-800 transition-all">
            <img
              v-if="userStore.avatarUrl"
              :src="userStore.avatarUrl"
              alt="头像"
              class="w-full h-full object-cover"
            />
            <span v-else>{{ (userStore.username || 'U').charAt(0).toUpperCase() }}</span>
          </div>
        </button>

        <!-- 下拉菜单 -->
        <div
          v-if="showUserMenu"
          class="absolute right-0 top-full mt-2 w-56 bg-[var(--color-background)] rounded-lg shadow-lg border border-[var(--color-border)] py-2 z-50"
        >
          <!-- 用户信息 -->
          <div class="px-4 py-3 border-b border-[var(--color-border)]">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-primary-500 flex items-center justify-center text-white font-medium overflow-hidden">
                <img
                  v-if="userStore.avatarUrl"
                  :src="userStore.avatarUrl"
                  alt="头像"
                  class="w-full h-full object-cover"
                />
                <span v-else>{{ (userStore.username || 'U').charAt(0).toUpperCase() }}</span>
              </div>
              <div>
                <div class="font-medium">{{ userStore.username }}</div>
                <div class="text-xs text-gray-500">{{ userStore.user?.email }}</div>
              </div>
            </div>
          </div>
          <RouterLink
            to="/settings"
            class="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
            @click="showUserMenu = false"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            设置
          </RouterLink>
          <hr class="my-1 border-[var(--color-border)]" />
          <button
            @click="handleLogout"
            class="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            退出登录
          </button>
        </div>
      </div>
    </div>
  </header>

  <!-- Shopify搜索弹窗 -->
  <Teleport to="body">
    <div
      v-if="showShopifySearch"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      @click.self="closeShopifySearch"
    >
      <div class="bg-white dark:bg-gray-800 rounded-xl p-6 w-[800px] max-w-[95vw] max-h-[85vh] overflow-auto shadow-xl">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">搜索Shopify店铺</h3>
          <button
            @click="closeShopifySearch"
            class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- 搜索模式切换 -->
        <div class="flex gap-2 mb-4">
          <button
            @click="searchMode = 'image'"
            class="flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors"
            :class="searchMode === 'image' ? 'bg-primary-500 text-white' : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'"
          >
            图片搜索
          </button>
          <button
            @click="searchMode = 'keyword'"
            class="flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors"
            :class="searchMode === 'keyword' ? 'bg-primary-500 text-white' : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'"
          >
            关键词搜索
          </button>
        </div>

        <!-- 图片搜索模式 -->
        <div v-if="searchMode === 'image'" class="space-y-4">
          <!-- 图片URL输入 -->
          <div>
            <label class="block text-sm font-medium mb-1">图片URL</label>
            <div class="flex gap-2">
              <input
                v-model="imageUrlInput"
                type="text"
                placeholder="输入图片URL地址"
                class="input flex-1"
                @keyup.enter="searchByImageUrl"
              />
              <button
                @click="searchByImageUrl"
                :disabled="isSearching || !imageUrlInput.trim()"
                class="btn btn-primary"
              >
                {{ isSearching ? '搜索中...' : '搜索' }}
              </button>
            </div>
          </div>
        </div>

        <!-- 关键词搜索模式 -->
        <div v-else class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">搜索关键词</label>
            <div class="flex gap-2">
              <input
                v-model="keywordInput"
                type="text"
                placeholder="输入产品关键词，如：时尚连衣裙"
                class="input flex-1"
                @keyup.enter="searchByKeyword"
              />
              <button
                @click="searchByKeyword"
                :disabled="isSearching || !keywordInput.trim()"
                class="btn btn-primary"
              >
                {{ isSearching ? '搜索中...' : '搜索' }}
              </button>
            </div>
          </div>
        </div>

        <!-- 错误提示 -->
        <div v-if="searchError" class="mt-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 rounded-lg text-sm">
          {{ searchError }}
        </div>

        <!-- 搜索结果 -->
        <div v-if="searchResults.length > 0" class="mt-6">
          <div class="flex items-center justify-between mb-3">
            <h4 class="font-medium">搜索结果 ({{ searchResults.length }})</h4>
            <button
              @click="saveResultsToNote"
              class="btn btn-primary text-sm gap-1"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              保存到笔记
            </button>
          </div>
          <ul class="space-y-2">
            <li
              v-for="(store, index) in searchResults"
              :key="store.url"
              class="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
            >
              <div class="flex items-start gap-3">
                <span class="flex-shrink-0 w-6 h-6 bg-primary-500 text-white rounded-full flex items-center justify-center text-xs font-medium">
                  {{ index + 1 }}
                </span>
                <div class="flex-1 min-w-0">
                  <a
                    :href="store.url"
                    target="_blank"
                    class="font-medium text-primary-600 hover:text-primary-700"
                  >
                    {{ store.name }}
                  </a>
                  <p v-if="store.description" class="text-sm text-gray-500 mt-1">{{ store.description }}</p>
                  <p v-if="store.traffic && formatTraffic(store.traffic)" class="text-sm text-primary-500 mt-1 font-medium">
                    {{ formatTraffic(store.traffic) }}
                  </p>
                  <p class="text-xs text-gray-400 mt-1 truncate">{{ store.url }}</p>
                </div>
              </div>
            </li>
          </ul>
        </div>

        <!-- 搜索中状态 -->
        <div v-else-if="isSearching" class="mt-6 text-center py-8">
          <svg class="w-8 h-8 mx-auto animate-spin text-primary-500" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p class="mt-2 text-gray-500">正在搜索...</p>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Facebook Ads搜索弹窗 -->
  <Teleport to="body">
    <div
      v-if="showFacebookAdsSearch"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      @click.self="closeFacebookAdsSearch"
    >
      <div class="bg-white dark:bg-gray-800 rounded-xl p-6 w-[800px] max-w-[95vw] max-h-[85vh] overflow-auto shadow-xl">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">搜索 Facebook Ads</h3>
          <button
            @click="closeFacebookAdsSearch"
            class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- 搜索输入 -->
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">搜索关键词</label>
            <div class="flex gap-2">
              <input
                v-model="facebookKeywordInput"
                type="text"
                placeholder="输入产品关键词"
                class="input flex-1"
                @keyup.enter="searchFacebookAdsByKeyword"
              />
              <button
                @click="searchFacebookAdsByKeyword"
                :disabled="isFacebookSearching || !facebookKeywordInput.trim()"
                class="btn btn-primary"
              >
                {{ isFacebookSearching ? '搜索中...' : '搜索' }}
              </button>
            </div>
          </div>
        </div>

        <!-- 错误提示 -->
        <div v-if="facebookSearchError" class="mt-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 rounded-lg text-sm">
          {{ facebookSearchError }}
        </div>

        <!-- 搜索结果 -->
        <div v-if="facebookSearchResults.length > 0" class="mt-6">
          <div class="flex items-center justify-between mb-3">
            <h4 class="font-medium">搜索结果 ({{ facebookSearchResults.length }})</h4>
            <button
              @click="saveFacebookAdsToNote"
              class="btn btn-primary text-sm gap-1"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              保存到笔记
            </button>
          </div>
          <ul class="space-y-2">
            <li
              v-for="(ad, index) in facebookSearchResults"
              :key="ad.url"
              class="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
            >
              <div class="flex items-start gap-3">
                <span class="flex-shrink-0 w-6 h-6 bg-primary-500 text-white rounded-full flex items-center justify-center text-xs font-medium">
                  {{ index + 1 }}
                </span>
                <div class="flex-1 min-w-0">
                  <a
                    :href="ad.url"
                    target="_blank"
                    class="font-medium text-primary-600 hover:text-primary-700"
                  >
                    {{ ad.name }}
                  </a>
                  <p v-if="ad.description" class="text-sm text-gray-500 mt-1">{{ ad.description }}</p>
                  <p class="text-xs text-gray-400 mt-1 truncate">{{ ad.url }}</p>
                </div>
              </div>
            </li>
          </ul>
        </div>

        <!-- 搜索中状态 -->
        <div v-else-if="isFacebookSearching" class="mt-6 text-center py-8">
          <svg class="w-8 h-8 mx-auto animate-spin text-primary-500" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p class="mt-2 text-gray-500">正在搜索...</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>
