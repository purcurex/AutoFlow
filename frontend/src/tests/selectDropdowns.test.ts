import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { installSelectDropdowns } from '@/utils/selectDropdowns'

let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); document.body.innerHTML = '' })
describe('global downward selects', () => {
  it('keeps a modal form menu inside the dialog top layer and preserves selection', async () => {
    const dialog = document.createElement('dialog'); dialog.open = true
    dialog.innerHTML = '<form><select aria-label="所属部门"><option value="one">HyperZone / 业务一部</option><option value="two">HyperZone / 业务二部</option></select></form>'
    document.body.append(dialog)
    dispose = installSelectDropdowns(dialog.querySelector('form')!)
    const select = dialog.querySelector('select')!
    select.click()
    expect(dialog.querySelector('[role=listbox]')).not.toBeNull()
    const change = vi.fn(); select.addEventListener('change', change)
    ;(dialog.querySelector('[role=option][data-index="1"]') as HTMLElement).click()
    await flushPromises()
    expect(select.value).toBe('two'); expect(change).toHaveBeenCalledOnce()
    expect(dialog.querySelector('[role=listbox]')).toBeNull()
  })
  it('preserves native numeric v-model and change events with keyboard selection and disabled options', async () => {
    const wrapper = mount({ data: () => ({ value: 10, changes: 0 }), template: '<label>数量<select v-model.number="value" @change="changes++"><option :value="10">十个</option><option :value="15" disabled>不可选</option><option :value="20">二十个 · 完整的选项名称</option></select><output>{{ value }} / {{ typeof value }} / {{ changes }}</output></label>' }, { attachTo: document.body })
    dispose = installSelectDropdowns(wrapper.element)
    const select = wrapper.find('select')
    await select.trigger('click')
    expect(document.querySelector('[role=listbox]')).not.toBeNull()
    expect(select.attributes('aria-expanded')).toBe('true')
    await select.trigger('keydown', { key: 'ArrowDown' })
    await select.trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('output').text()).toBe('20 / number / 1')
    expect(document.querySelector('[role=listbox]')).toBeNull()
    wrapper.unmount()
  })
  it('enhances dynamically inserted selects and closes on Escape, outside click and removal', async () => {
    const root = document.createElement('div'); document.body.append(root)
    dispose = installSelectDropdowns(root)
    root.innerHTML = '<select aria-label="部门"><option>营销中心</option><option>业务一部</option></select>'
    await flushPromises()
    const select = root.querySelector('select')!
    select.click(); expect(document.querySelector('[role=listbox]')).not.toBeNull()
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.querySelector('[role=listbox]')).toBeNull()
    select.click(); document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(document.querySelector('[role=listbox]')).toBeNull()
    select.click(); select.remove(); await flushPromises()
    expect(document.querySelector('[role=listbox]')).toBeNull()
  })
  it('opens below the trigger, cancels the native mouse menu and reacts to disabled controls', async () => {
    const root = document.createElement('div'); root.innerHTML = '<select><option>营销中心</option><option>业务一部</option></select>'; document.body.append(root)
    const select = root.querySelector('select')!
    vi.spyOn(select, 'getBoundingClientRect').mockReturnValue({ top: 120, bottom: 154, left: 300, right: 430, width: 130, height: 34 } as DOMRect)
    dispose = installSelectDropdowns(root)
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    select.dispatchEvent(down); expect(down.defaultPrevented).toBe(true)
    select.click()
    expect((document.querySelector('[role=listbox]') as HTMLElement).style.top).toBe('160px')
    expect((document.querySelector('[role=listbox]') as HTMLElement).style.minWidth).toBe('130px')
    select.disabled = true; await flushPromises()
    expect(document.querySelector('[role=listbox]')).toBeNull()
    select.click(); expect(document.querySelector('[role=listbox]')).toBeNull()
  })
})
