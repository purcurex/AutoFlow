import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { expect, it, vi } from 'vitest'
import EChart from '@/components/charts/EChart.vue'
import { useTheme } from '@/composables/useTheme'
const mock = vi.hoisted(() => ({ setOption: vi.fn(), dispose: vi.fn(), init: vi.fn(), getOption: vi.fn(() => ({ legend: [{ selected: { A: false } }], dataZoom: [] })) }))
vi.mock('echarts/core', () => ({ use: vi.fn(), init: mock.init.mockImplementation(() => ({ ...mock, on: vi.fn(), resize: vi.fn() })) }))
vi.mock('@/composables/useChartAccess', () => ({ useChartCapabilities: () => ({ canExport: false }) }))
it('recolors in place without recreating the chart and retains legend selection', async () => {
 vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
 const theme = useTheme(); theme.setTheme(false); theme.setPalette('blue')
 const wrapper = mount(EChart, { props: { label: 'test', option: { legend: {}, series: [{ type: 'bar', data: [12] }] } } })
 theme.setPalette('orange'); await nextTick()
 expect(mock.init).toHaveBeenCalledTimes(1)
 expect(mock.dispose).not.toHaveBeenCalled()
 let [option, flags] = mock.setOption.mock.calls.at(-1)!
 expect(flags.notMerge).toBe(false); expect(option.animation).toBe(false)
 expect(option.series[0].data).toEqual([12]); expect(option.legend[0].selected).toEqual({ A: false })
 theme.setTheme(true); await nextTick(); theme.setTheme(false); await nextTick()
 ;[option, flags] = mock.setOption.mock.calls.at(-1)!
 expect(option.darkMode).toBe(false); expect(flags.notMerge).toBe(false)
 expect(mock.init).toHaveBeenCalledTimes(1)
 wrapper.unmount(); vi.unstubAllGlobals()
})
