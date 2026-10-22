import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AppLayout from '@/components/layout/AppLayout.vue'
vi.mock('@/stores', () => ({ useUserStore: () => ({ isLoggedIn: false }) }))
vi.mock('@/components/layout/Sidebar.vue', () => ({ default: { template: '<aside />' } }))
vi.mock('@/components/layout/Header.vue', () => ({ default: { template: '<header />' } }))

describe('outer page wheel scrolling', () => {
  it('routes vertical wheel from nested tables to the outer page and leaves horizontal gestures alone', () => {
    const wrapper = mount(AppLayout, { slots: { default: '<div class="nested-table" />' } })
    const outer = wrapper.find('main').element as HTMLElement
    const inner = wrapper.find('.nested-table').element as HTMLElement
    outer.scrollTop = 30; inner.scrollTop = 10
    const childWheel = vi.fn(); inner.addEventListener('wheel', childWheel)
    const vertical = new WheelEvent('wheel', { deltaY: 75, bubbles: true, cancelable: true })
    inner.dispatchEvent(vertical)
    expect(outer.scrollTop).toBe(105)
    expect(inner.scrollTop).toBe(10)
    expect(vertical.defaultPrevented).toBe(true)
    expect(childWheel).not.toHaveBeenCalled()
    const horizontal = new WheelEvent('wheel', { deltaX: 50, deltaY: 2, bubbles: true, cancelable: true })
    inner.dispatchEvent(horizontal)
    expect(horizontal.defaultPrevented).toBe(false)
    expect(outer.scrollTop).toBe(105)
    wrapper.unmount()
  })
})
