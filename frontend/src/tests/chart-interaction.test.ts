import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import EChart from '@/components/charts/EChart.vue'

const state = vi.hoisted(() => ({
  options: {} as Record<string, any>, handlers: {} as Record<string, (event: any) => void>,
  chart: { setOption: vi.fn(), getOption: vi.fn(), dispatchAction: vi.fn(), on: vi.fn(), resize: vi.fn(), dispose: vi.fn() },
}))
vi.mock('echarts/core', () => ({ init: () => state.chart, use: vi.fn() }))
describe('chart horizontal navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    state.chart.setOption.mockImplementation(option => { state.options = option })
    state.chart.getOption.mockImplementation(() => state.options)
    state.chart.on.mockImplementation((name, callback) => { state.handlers[name] = callback })
  })
  afterEach(() => vi.unstubAllGlobals())
  const option = () => ({ dataZoom: [{ type: 'inside', start: 50, end: 100 }, { type: 'slider', start: 50, end: 100 }] })
  it('keeps the slider window while disabling wheel, plot dragging and brush zoom on every render', async () => {
    const wrapper = mount(EChart, { props: { option: option(), label: 'Trend' } })
    expect(state.options.dataZoom).toEqual([{ type: 'slider', start: 50, end: 100, brushSelect: false, zoomLock: true }])
    await wrapper.setProps({ option: option() })
    expect(state.options.dataZoom).toHaveLength(1)
    expect(state.options.dataZoom[0].zoomLock).toBe(true)
    wrapper.unmount()
  })
  it('rejects click-to-jump but accepts slider dragging, keeping linked charts in sync', async () => {
    const wrapper = mount(EChart, { props: { option: option(), label: 'Trend' } })
    wrapper.element.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 100 }))
    state.options.dataZoom = [{ type: 'slider', start: 0, end: 50 }]
    state.handlers.datazoom!({ start: 0, end: 50 })
    expect(wrapper.emitted('zoom')).toBeUndefined()
    expect(state.chart.dispatchAction).toHaveBeenLastCalledWith({ type: 'dataZoom', batch: [{ dataZoomIndex: 0, start: 50, end: 100 }] }, { silent: true })
    wrapper.element.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 100 }))
    window.dispatchEvent(new MouseEvent('pointermove', { buttons: 1, clientX: 140, clientY: 100 }))
    state.handlers.datazoom!({ start: 0, end: 50 })
    expect(wrapper.emitted('zoom')).toEqual([[{ start: 0, end: 50 }]])
    wrapper.unmount()
  })
  it('removes image and data exports when export capability is denied and updates on revocation', async () => {
    const option = { toolbox: { feature: { saveAsImage: { type: 'svg' }, dataView: { readOnly: true }, restore: {} } } }
    const wrapper = mount(EChart, { props: { option, label: 'Authorized chart', canExport: true } })
    expect(state.options.toolbox.feature).toHaveProperty('saveAsImage')
    await wrapper.setProps({ canExport: false })
    expect(state.options.toolbox.feature).not.toHaveProperty('saveAsImage')
    expect(state.options.toolbox.feature).not.toHaveProperty('dataView')
    expect(state.options.toolbox.feature).toHaveProperty('restore')
    wrapper.unmount()
  })

})
