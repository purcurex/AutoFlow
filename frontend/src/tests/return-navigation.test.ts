import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import ReturnButton from '@/components/ui/ReturnButton.vue'
import { i18n } from '@/i18n'
import { safeReturnPath, withReturnTo } from '@/composables/useReturnNavigation'

const EmptyView = { template: '<main />' }

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: EmptyView },
      { path: '/leads', component: EmptyView },
      { path: '/leads/:id', component: EmptyView },
    ],
  })
}

describe('detail return navigation', () => {
  it('accepts internal application paths and rejects unsafe return targets', () => {
    expect(safeReturnPath('/leads?status=qualified#top')).toBe('/leads?status=qualified#top')
    expect(safeReturnPath('//outside.example/path')).toBeNull()
    expect(safeReturnPath('/\\outside.example/path')).toBeNull()
    expect(safeReturnPath('/login?redirect=/leads')).toBeNull()
    expect(safeReturnPath(['/', '/leads'])).toBeNull()
  })

  it('adds the source page to detail locations', () => {
    expect(withReturnTo('/leads/lead-1', '/?panel=top-leads')).toEqual({
      path: '/leads/lead-1',
      query: { returnTo: '/?panel=top-leads' },
    })
  })

  it('returns to the validated source page', async () => {
    const router = createTestRouter()
    await router.push('/leads?status=qualified')
    await router.push(withReturnTo('/leads/lead-1', '/leads?status=qualified'))
    await router.isReady()

    const wrapper = mount(ReturnButton, {
      props: { fallback: '/' },
      global: {
        plugins: [router, i18n],
      },
    })

    await wrapper.get('[data-test="detail-return"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/leads?status=qualified')
  })

  it('uses the business fallback when the source is missing or unsafe', async () => {
    const router = createTestRouter()
    await router.push('/leads/lead-1?returnTo=//outside.example')
    await router.isReady()

    const wrapper = mount(ReturnButton, {
      props: { fallback: '/leads' },
      global: {
        plugins: [router, i18n],
      },
    })

    await wrapper.get('[data-test="detail-return"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/leads')
  })
})
