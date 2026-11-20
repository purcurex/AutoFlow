import {describe,it,expect} from 'vitest'
import {scrollOuterPage} from '@/utils/pageWheel'
describe('list scroll ownership',()=>{
 it('scrolls the dashboard panels when the wheel is over the fixed cards',()=>{
 const outer=document.createElement('main'),cards=document.createElement('section'),panels=document.createElement('section')
 panels.setAttribute('data-page-scroll-target','');outer.append(cards,panels)
 outer.addEventListener('wheel',event=>scrollOuterPage(event,outer),{capture:true})
 cards.dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true}))
 expect(panels.scrollTop).toBe(120);expect(outer.scrollTop).toBe(0)
 })
 it('uses the panel viewport height for page-sized wheel events without intercepting zoom',()=>{
 const outer=document.createElement('main'),panels=document.createElement('section');panels.setAttribute('data-page-scroll-target','');outer.append(panels)
 Object.defineProperty(panels,'clientHeight',{value:400});Object.defineProperty(outer,'clientHeight',{value:700})
 outer.addEventListener('wheel',event=>scrollOuterPage(event,outer),{capture:true})
 panels.dispatchEvent(new WheelEvent('wheel',{deltaY:1,deltaMode:2,bubbles:true,cancelable:true}))
 expect(panels.scrollTop).toBe(400);expect(outer.scrollTop).toBe(0)
 const zoom=new WheelEvent('wheel',{deltaY:100,ctrlKey:true,bubbles:true,cancelable:true});panels.dispatchEvent(zoom)
 expect(zoom.defaultPrevented).toBe(false);expect(panels.scrollTop).toBe(400)
 })
 it('leaves wheel events within fixed workbench lists to native scrolling',()=>{
 const outer=document.createElement('main'),list=document.createElement('div'),cell=document.createElement('span');list.className='workbench-scroll-viewport';list.append(cell);outer.append(list)
 outer.addEventListener('wheel',e=>scrollOuterPage(e,outer),{capture:true})
 const event=new WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true});cell.dispatchEvent(event)
 expect(event.defaultPrevented).toBe(false);expect(outer.scrollTop).toBe(0)
 })
 it('retains existing outer-page wheel behavior outside lists',()=>{
 const outer=document.createElement('main');outer.addEventListener('wheel',e=>scrollOuterPage(e,outer));const e=new WheelEvent('wheel',{deltaY:100,cancelable:true});outer.dispatchEvent(e);expect(e.defaultPrevented).toBe(true);expect(outer.scrollTop).toBe(100)
 })
})
