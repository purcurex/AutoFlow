import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import CountryPicker from '@/components/ui/CountryPicker.vue'
import { COUNTRIES, searchCountries } from '@/utils/countries'

describe('complete country picker',()=>{
 it('contains all 249 ISO regions, bundled flags and Chinese/code search',()=>{
  expect(COUNTRIES).toHaveLength(249)
  expect(new Set(COUNTRIES.map(c=>c.code)).size).toBe(249)
  expect(COUNTRIES.every(c=>c.flagUrl&&c.name)).toBe(true)
  expect(searchCountries(' us ').map(c=>c.code)).toEqual(['US'])
  expect(searchCountries('日本').map(c=>c.code)).toEqual(['JP'])
  expect(searchCountries('英国').map(c=>c.code)).toContain('GB')
  expect(searchCountries('不存在')).toEqual([])
 })
 it('selects a country by Chinese search and keeps a two-letter stored value',async()=>{
  const w=mount(CountryPicker,{props:{modelValue:'US'},attachTo:document.body})
  await w.get('[role="combobox"]').trigger('click');await flushPromises()
  const input=document.querySelector<HTMLInputElement>('[aria-label="搜索国家"]')!;input.value='日本';input.dispatchEvent(new Event('input',{bubbles:true}));await flushPromises()
  const button=document.querySelector<HTMLButtonElement>('[role="option"][aria-label="日本 JP"]')!;button.click();await flushPromises()
  expect(w.emitted('update:modelValue')?.[0]).toEqual(['JP']);w.unmount()
 })
 it('keeps selected non-shortcut countries visible and toggles without duplicates',async()=>{
  const w=mount(CountryPicker,{props:{multiple:true,selected:['JP','US']}})
  expect(w.text()).toContain('JP')
  await w.get('button[aria-label="日本 JP"]').trigger('click')
  expect(w.emitted('update:selected')?.[0]).toEqual([['US']]);w.unmount()
 })
})
