import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkCalendar from '@/components/WorkCalendar.vue'

describe('work calendar clock', () => {
  afterEach(() => vi.useRealTimers())
  it('refreshes work status at opening time and resynchronizes after returning to the page', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-22T12:59:59Z'))
    const wrapper = mount(WorkCalendar, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
    const us = wrapper.find('[data-region="US"]')
    expect(us.find('.local-clock').text()).toBe('08:59:59')
    expect(us.find('[role="status"]').text()).toBe('休息中')
    await vi.advanceTimersByTimeAsync(1000)
    expect(us.find('.local-clock').text()).toBe('09:00:00')
    expect(us.find('[role="status"]').text()).toBe('工作中')
    vi.setSystemTime(new Date('2026-10-24T14:00:00Z'))
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()
    expect(us.find('.local-clock').text()).toBe('10:00:00')
    expect(us.find('[role="status"]').text()).toBe('周末休息')
    expect(wrapper.find('.beijing-clock time').text()).toBe('22:00:00')
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
