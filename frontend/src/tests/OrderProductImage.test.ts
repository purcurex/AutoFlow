import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it } from 'vitest'
import OrderProductImage from '@/components/autoflow/OrderProductImage.vue'

const mounted: ReturnType<typeof mount>[] = []
function render(src: string | null = '/product.svg') {
  const wrapper = mount(OrderProductImage, { props: { src, name: 'Canvas bag' }, attachTo: document.body, global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN' })] } })
  mounted.push(wrapper)
  return wrapper
}
afterEach(() => { mounted.splice(0).forEach(w => w.unmount()); document.body.innerHTML = '' })
describe('static order image preview', () => {
  it('opens on hover outside the table and closes when leaving or scrolling', async () => {
    const wrapper = render()
    await wrapper.get('button').trigger('pointerenter', { pointerType: 'mouse' })
    expect(document.querySelector('.product-image-preview img')?.getAttribute('src')).toBe('/product.svg')
    expect(wrapper.find('.product-image-preview').exists()).toBe(false)
    await wrapper.get('button').trigger('pointerleave')
    expect(document.querySelector('.product-image-preview')).toBeNull()
    await wrapper.get('button').trigger('pointerenter', { pointerType: 'mouse' })
    window.dispatchEvent(new Event('scroll')); await wrapper.vm.$nextTick()
    expect(document.querySelector('.product-image-preview')).toBeNull()
  })
  it('supports keyboard/click, Escape and image errors without stale previews', async () => {
    const wrapper = render()
    await wrapper.get('button').trigger('click')
    expect(document.querySelector('.product-image-preview')).not.toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await wrapper.vm.$nextTick()
    expect(document.querySelector('.product-image-preview')).toBeNull()
    await wrapper.get('button').trigger('click')
    await wrapper.get('img').trigger('error')
    expect(document.querySelector('.product-image-preview')).toBeNull()
    expect(wrapper.find('button').exists()).toBe(false)
    await wrapper.setProps({ src: '/other.svg' })
    expect(wrapper.get('img').attributes('src')).toBe('/other.svg')
  })
  it('does not offer zoom for absent images', () => { expect(render(null).find('button').exists()).toBe(false) })
  it('shows only the current image when hovering another product after pinning one', async () => {
    const first = render('/first.svg'), second = render('/second.svg')
    await first.get('button').trigger('click')
    await second.get('button').trigger('pointerenter', { pointerType: 'mouse' })
    expect(document.querySelectorAll('.product-image-preview')).toHaveLength(1)
    expect(document.querySelector('.product-image-preview img')?.getAttribute('src')).toBe('/second.svg')
  })
  it('clamps the full image at the bottom-right edge without panning', async () => {
    const wrapper = render()
    const other = render('/second.svg')
    const button = wrapper.get('button').element
    button.getBoundingClientRect = () => ({ left: innerWidth - 44, right: innerWidth - 2, top: innerHeight - 44, bottom: innerHeight - 2, width: 42, height: 42, x: 0, y: 0, toJSON() {} })
    button.dispatchEvent(new MouseEvent('pointerenter', { clientX: innerWidth - 2, clientY: innerHeight - 2 }))
    await wrapper.vm.$nextTick()
    const preview = document.querySelector<HTMLElement>('.product-image-preview')!
    expect(parseFloat(preview.style.left)).toBeGreaterThanOrEqual(12)
    expect(parseFloat(preview.style.left) + parseFloat(preview.style.width)).toBeLessThanOrEqual(innerWidth - 12)
    expect(parseFloat(preview.style.top) + parseFloat(preview.style.width)).toBeLessThanOrEqual(innerHeight)
    const originalStyle = preview.getAttribute('style')
    const imageStyle = preview.querySelector('img')?.getAttribute('style')
    expect(imageStyle || '').not.toContain('transform')
    expect(wrapper.find('.zoom-indicator').exists()).toBe(false)
    expect(wrapper.find('.zoom-lens').exists()).toBe(false)
    button.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, clientY: 0 }))
    await wrapper.vm.$nextTick()
    expect(preview.getAttribute('style')).toBe(originalStyle)
    expect(preview.querySelector('img')?.getAttribute('style')).toBe(imageStyle)
    await wrapper.get('button').trigger('pointerleave')
    await other.get('button').trigger('click')
    expect(document.querySelector('.product-image-preview img')?.getAttribute('src')).toBe('/second.svg')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); await wrapper.vm.$nextTick()
    expect(document.querySelector('.product-image-preview')).toBeNull()
  })
})
