import { afterEach, expect, it, vi } from 'vitest'
import { installTextTooltips } from '@/utils/textTooltips'
let dispose: (()=>void)|undefined
const flush = async()=>{await Promise.resolve();await Promise.resolve()}
const hover=(el:HTMLElement)=>el.dispatchEvent(new MouseEvent('pointerover',{bubbles:true}))
afterEach(()=>{dispose?.();dispose=undefined;document.body.innerHTML='';vi.useRealTimers()})
it('delays native titles for exactly one second, uses plain text, and cancels quick passes',async()=>{
 vi.useFakeTimers();document.body.innerHTML='<span title="完整长文本 &lt;img&gt;">截断文本</span>';dispose=installTextTooltips();const el=document.querySelector('span')!
 expect(el.getAttribute('title')).toBe('');hover(el);vi.advanceTimersByTime(999);expect(document.querySelector('[role=tooltip]')).toBeNull()
 vi.advanceTimersByTime(1);expect(document.querySelector('[role=tooltip]')?.textContent).toBe('完整长文本 <img>');expect(document.querySelector('[role=tooltip] img')).toBeNull()
 el.dispatchEvent(new MouseEvent('pointerout',{bubbles:true}));expect(document.querySelector('[role=tooltip]')).toBeNull()
 hover(el);vi.advanceTimersByTime(500);el.dispatchEvent(new MouseEvent('pointerout',{bubbles:true}));vi.advanceTimersByTime(1000);expect(document.querySelector('[role=tooltip]')).toBeNull()
})
it('handles late mounted dialogs, changed and removed titles, and restores attributes on teardown',async()=>{
 vi.useFakeTimers();dispose=installTextTooltips();const el=document.createElement('span');el.title='原始';document.body.appendChild(el);await flush()
 el.title='更新';await flush();hover(el);vi.advanceTimersByTime(1000);expect(document.querySelector('[role=tooltip]')?.textContent).toBe('更新')
 el.removeAttribute('title');await flush();expect(document.querySelector('[role=tooltip]')).toBeNull();hover(el);vi.advanceTimersByTime(1000);expect(document.querySelector('[role=tooltip]')).toBeNull()
 el.title='恢复';await flush();dispose();dispose=undefined;expect(el.title).toBe('恢复')
})
it('covers clipped text without titles, keyboard focus, nested movement and cleanup',async()=>{
 vi.useFakeTimers();document.body.innerHTML='<span style="overflow:hidden;text-overflow:ellipsis" aria-describedby="help">全文<b>内容</b></span>';const el=document.querySelector('span')!
 Object.defineProperties(el,{clientWidth:{value:20},scrollWidth:{value:100}});dispose=installTextTooltips()
 el.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));vi.advanceTimersByTime(1000);expect(document.querySelector('[role=tooltip]')?.textContent).toBe('全文内容')
 el.dispatchEvent(new MouseEvent('pointerout',{bubbles:true,relatedTarget:el.firstChild}));expect(document.querySelector('[role=tooltip]')).not.toBeNull()
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));expect(el.getAttribute('aria-describedby')).toBe('help')
 hover(el);window.dispatchEvent(new Event('scroll'));vi.advanceTimersByTime(1000);expect(document.querySelector('[role=tooltip]')).toBeNull()
 hover(el);el.remove();await flush();vi.advanceTimersByTime(1000);expect(document.querySelector('[role=tooltip]')).toBeNull()
})
it('does not duplicate picking-name or custom popovers and ignores untruncated labels',()=>{
 vi.useFakeTimers();document.body.innerHTML='<span data-picking-name-tooltip title="商品">商品</span><span class="info-tip" title="说明">说明</span><span id="plain">普通文本</span>';dispose=installTextTooltips()
 document.querySelectorAll('span').forEach(el=>{hover(el);vi.advanceTimersByTime(1000);expect(document.querySelector('[role=tooltip]')).toBeNull()})
})
it('keeps a single active tooltip and cancels on resize or blur',()=>{
 vi.useFakeTimers();document.body.innerHTML='<span title="甲详情">甲</span><span title="乙详情">乙</span>';dispose=installTextTooltips();const [a,b]=Array.from(document.querySelectorAll('span'))
 hover(a!);vi.advanceTimersByTime(1000);hover(b!);expect(document.querySelector('[role=tooltip]')).toBeNull();vi.advanceTimersByTime(1000);expect(document.querySelectorAll('[role=tooltip]')).toHaveLength(1)
 window.dispatchEvent(new Event('resize'));expect(document.querySelector('[role=tooltip]')).toBeNull();hover(a!);window.dispatchEvent(new Event('blur'));vi.advanceTimersByTime(1000);expect(document.querySelector('[role=tooltip]')).toBeNull()
})

it('preserves accessible names for icon-only controls when replacing native titles',async()=>{
 document.body.innerHTML='<button title="复制编号"><svg></svg></button><button aria-label="原标签" title="辅助提示"></button>';dispose=installTextTooltips();const [a,b]=Array.from(document.querySelectorAll('button'))
 expect(a!.getAttribute('aria-label')).toBe('复制编号');expect(b!.getAttribute('aria-label')).toBe('原标签')
 a!.title='复制链接';await flush();expect(a!.getAttribute('aria-label')).toBe('复制链接')
 dispose();dispose=undefined;expect(a!.getAttribute('aria-label')).toBeNull();expect(a!.title).toBe('复制链接')
})

it('suppresses duplicate headings and descriptions but preserves clipped reasons and action help',()=>{
 vi.useFakeTimers();document.body.innerHTML='<h2 title="备货清单">备货清单</h2><p title="完整说明">完整说明</p><span style="overflow:hidden" title="完整异常原因">完整异常原因</span><button title="复制订单编号">复制</button>'
 const reason=document.querySelector('span')!;Object.defineProperties(reason,{clientWidth:{value:40},scrollWidth:{value:120}})
 dispose=installTextTooltips()
 document.querySelectorAll('h2,p').forEach(el=>{hover(el as HTMLElement);vi.advanceTimersByTime(1000);expect(document.querySelector('[role=tooltip]')).toBeNull()})
 hover(reason);vi.advanceTimersByTime(1000);expect(document.querySelector('[role=tooltip]')?.textContent).toBe('完整异常原因')
 hover(document.querySelector('button')!);vi.advanceTimersByTime(1000);expect(document.querySelector('[role=tooltip]')?.textContent).toBe('复制订单编号')
})

it('never turns a clipped dashboard panel or chart SVG into a whole-panel tooltip',async()=>{
 vi.useFakeTimers();document.body.innerHTML='<section style="overflow:hidden"><h2>部门业绩</h2><label>收款日期<input></label><div role="img"><svg><text>一月 二月 三月 订单金额</text></svg></div><div id="blank"></div></section>'
 const panel=document.querySelector('section')!;Object.defineProperties(panel,{clientHeight:{value:100},scrollHeight:{value:300}})
 dispose=installTextTooltips()
 for(const el of [document.querySelector('text')!,document.querySelector('#blank')!,panel]){
  el.dispatchEvent(new MouseEvent('pointerover',{bubbles:true}));vi.advanceTimersByTime(1000)
  expect(document.querySelector('[role=tooltip]')).toBeNull()
 }
})
it('keeps clipped leaf text hints inside a panel without collecting sibling filters',()=>{
 vi.useFakeTimers();document.body.innerHTML='<section style="overflow:hidden"><h2>统计</h2><span style="overflow:hidden;text-overflow:ellipsis">需要完整显示的异常原因</span><button>查询</button></section>'
 const text=document.querySelector('span')!;Object.defineProperties(text,{clientWidth:{value:20},scrollWidth:{value:120}})
 dispose=installTextTooltips();hover(text);vi.advanceTimersByTime(1000)
 expect(document.querySelector('[role=tooltip]')?.textContent).toBe('需要完整显示的异常原因')
})
