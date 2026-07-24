import { computed } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'

const RETURN_ORIGIN = 'https://autoflow.local'
const GUEST_PATH = /^\/(?:login|register)(?:[/?#]|$)/

export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null
  if (value.includes('\\') || Array.from(value).some(character => character.charCodeAt(0) < 32)) return null

  try {
    const url = new URL(value, RETURN_ORIGIN)
    if (url.origin !== RETURN_ORIGIN || GUEST_PATH.test(url.pathname)) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

export function withReturnTo(path: string, returnTo: string): RouteLocationRaw {
  return {
    path,
    query: { returnTo },
  }
}

export function useReturnNavigation(fallback: string) {
  const route = useRoute()
  const router = useRouter()
  const safeFallback = safeReturnPath(fallback) || '/'

  const destination = computed(() => {
    const returnTo = safeReturnPath(route.query.returnTo)
    return returnTo && returnTo !== route.fullPath ? returnTo : safeFallback
  })

  async function goBack() {
    const historyBack = typeof window === 'undefined'
      ? null
      : safeReturnPath(window.history.state?.back)

    if (historyBack === destination.value) {
      router.back()
      return
    }

    await router.push(destination.value)
  }

  return {
    destination,
    goBack,
  }
}
