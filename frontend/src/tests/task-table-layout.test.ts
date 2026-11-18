import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { distributeTaskColumns, vTaskTableLayout } from '@/directives/task-table-layout'
describe('task table width distribution', () => {
  it('fixes the first two columns and shares surplus equally, not proportionally', () => {
    const result = distributeTaskColumns([900, 900, 100, 150, 200], 1200)
    expect(result.slice(0, 2)).toEqual([196, 340])
    const extra = result.slice(2).map((width, index) => width - [100, 150, 200][index]!)
    expect(extra[0]).toBeCloseTo(extra[1]!)
    expect(extra[1]).toBeCloseTo(extra[2]!)
    expect(result.reduce((sum, width) => sum + width, 0)).toBeCloseTo(1200)
  })
  it('bounds long text and keeps readable widths when there is no surplus', () => {
    expect(distributeTaskColumns([20, 20, 5, 1000, 140], 500)).toEqual([196, 340, 88, 280, 140])
  })
  it('does not change column geometry when empty/loading rows become long business data', async () => {
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(700)
    // Model intrinsic table sizing: body content would enlarge the header if cloned.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const bodyLength = this.closest('table')?.querySelector('tbody')?.textContent?.length ?? 0
      return { x:0,y:0,top:0,left:0,right:0,bottom:0,height:40,width:90 + bodyLength } as DOMRect
    })
    const wrapper = mount(defineComponent({ props:['value'], directives:{ taskTableLayout:vTaskTableLayout }, template:'<div><table v-task-table-layout><thead><tr><th>单号</th><th>商品</th><th>客户</th></tr></thead><tbody><tr><td colspan="3">{{ value }}</td></tr></tbody></table></div>' }), { attachTo:document.body, props:{value:'正在查询…'} })
    try {
      const before = wrapper.findAll('col').map(col => col.attributes('style'))
      await wrapper.setProps({value:'A very long customer and product description '.repeat(20)})
      expect(wrapper.findAll('col').map(col => col.attributes('style'))).toEqual(before)
      await wrapper.setProps({value:''})
      expect(wrapper.findAll('col').map(col => col.attributes('style'))).toEqual(before)
      expect(before.every(Boolean)).toBe(true)
    } finally { wrapper.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals() }
  })
})
