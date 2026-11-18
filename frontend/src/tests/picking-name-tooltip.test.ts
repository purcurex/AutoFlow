import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { vPickingNameTooltip } from '@/directives/picking-name-tooltip'
const wrappers: ReturnType<typeof mount>[] = []
function setup(name = '中文配货完整名称') {
  const wrapper = mount(defineComponent({ props: { name: String }, directives: { pickingNameTooltip: vPickingNameTooltip }, template: '<span v-picking-name-tooltip="name">{{name}}</span>' }), { props: { name }, attachTo: document.body })
  Object.defineProperties(wrapper.element, { clientWidth: { value: 80, configurable: true }, scrollWidth: { value: 200, configurable: true } })
  ;(wrapper.element as HTMLElement).style.overflow = 'hidden'
  wrappers.push(wrapper); return wrapper
}
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.useRealTimers() })
describe('Chinese picking name tooltip', () => {
  it('waits 1 second, displays plain full text, and closes on leave', async () => {
    vi.useFakeTimers(); const wrapper = setup('<完整名称>')
    await wrapper.trigger('pointerenter'); vi.advanceTimersByTime(999)
    expect(document.querySelector('[role=tooltip]')).toBeNull()
    vi.advanceTimersByTime(1)
    expect(document.querySelector('[role=tooltip]')?.textContent).toBe('<完整名称>')
    expect(wrapper.attributes('aria-describedby')).toBeTruthy()
    await wrapper.trigger('pointerleave'); expect(document.querySelector('[role=tooltip]')).toBeNull()
    expect(wrapper.attributes('aria-describedby')).toBeUndefined()
  })
  it('cancels early departures and data updates without stale popups', async () => {
    vi.useFakeTimers(); const wrapper = setup()
    await wrapper.trigger('pointerenter'); vi.advanceTimersByTime(500); await wrapper.trigger('pointerleave'); vi.advanceTimersByTime(1000)
    expect(document.querySelector('[role=tooltip]')).toBeNull()
    await wrapper.trigger('focus'); await wrapper.setProps({ name: '更新名称' }); vi.advanceTimersByTime(1000)
    expect(document.querySelector('[role=tooltip]')).toBeNull()
    await wrapper.trigger('focus'); vi.advanceTimersByTime(1000)
    expect(document.querySelector('[role=tooltip]')?.textContent).toBe('更新名称')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.querySelector('[role=tooltip]')).toBeNull()
  })
  it('ignores missing names, keeps one popup, and cleans up on scrolling and unmount', async () => {
    vi.useFakeTimers(); const empty = setup(''), first = setup('甲'), second = setup('乙')
    await empty.trigger('pointerenter'); vi.advanceTimersByTime(2000); expect(document.querySelector('[role=tooltip]')).toBeNull()
    await first.trigger('pointerenter'); vi.advanceTimersByTime(1000)
    await second.trigger('pointerenter'); expect(document.querySelector('[role=tooltip]')).toBeNull()
    vi.advanceTimersByTime(1000); expect(document.querySelectorAll('[role=tooltip]')).toHaveLength(1)
    window.dispatchEvent(new Event('scroll')); expect(document.querySelector('[role=tooltip]')).toBeNull()
    await second.trigger('pointerenter'); second.unmount(); vi.advanceTimersByTime(2000)
    expect(document.querySelector('[role=tooltip]')).toBeNull()
  })
})

it('does not repeat fully visible picking names', async () => {
  vi.useFakeTimers(); const wrapper = setup('短名称')
  Object.defineProperty(wrapper.element, 'scrollWidth', { value: 80 })
  await wrapper.trigger('pointerenter'); vi.advanceTimersByTime(1000)
  expect(document.querySelector('[role=tooltip]')).toBeNull()
})
