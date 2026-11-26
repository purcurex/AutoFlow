import { expect, it } from 'vitest'
import palettes from '@/theme/palettes.json'
import css from '@/theme/palettes.css?raw'
import { applyChartTheme } from '@/utils/chartTheme'
import { taskStatusOptions } from '@/utils/workbench-status'
const contrast = (a:string,b:string) => {
 const luminance=(s:string)=>s.slice(1).match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i]!,0)
 const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)
}
it('provides eight complete themes with readable primary button labels',()=>{
 for(const [name,palette] of Object.entries(palettes)) for(const mode of ['light','dark'] as const){
  const values=palette[mode];expect(values).toHaveLength(5)
  expect(contrast(values[0]!,values[4]!)).toBeGreaterThanOrEqual(4.5)
  expect(css).toContain(`[data-palette="${name}"]${mode==='dark'?'.dark':':not(.dark)'}`)
 }
})
it('provides six distinct, readable exception colors in every theme',()=>{
 const mix=(ink:string,surface:string)=>'#'+[0,1,2].map(i=>Math.round(parseInt(ink.slice(1+i*2,3+i*2),16)*.09+parseInt(surface.slice(1+i*2,3+i*2),16)*.91).toString(16).padStart(2,'0')).join('')
 for(const [name,palette] of Object.entries(palettes)) for(const mode of ['light','dark'] as const){
  const colors=palette.exceptionTypes[mode]
  expect(Object.keys(colors).sort()).toEqual([...taskStatusOptions('exceptions')].sort())
  expect(new Set(Object.values(colors)).size).toBe(6)
  const selector=`:root[data-palette="${name}"]${mode==='dark'?'.dark':':not(.dark)'}`
  const block=css.slice(css.indexOf(selector)).split('}')[0]!
  const surface=block.match(/--color-surface: (#[0-9A-Fa-f]{6});/)![1]!
  for(const [type,ink] of Object.entries(colors)){
   expect(block).toContain(`--color-exception-${type}: ${ink};`)
   expect(contrast(ink,mix(ink,surface))).toBeGreaterThanOrEqual(4.5)
  }
 }
})
it('recolors standard chart series while preserving semantic colors and callbacks',()=>{
 const formatter=()=>'$12';const option={tooltip:{formatter},series:[{type:'bar',itemStyle:{color:'#5368be'},data:[12]},{type:'bar',itemStyle:{color:'#c25252'},data:[1]}]}
 const themed=applyChartTheme(option,false,'orange') as any
 expect(themed.series[0].itemStyle.color).toBe(palettes.orange.light[0])
 expect(themed.series[1].itemStyle.color).toBe('#c25252')
 expect(themed.tooltip.formatter).toBe(formatter)
 expect(option.series[0]!.itemStyle.color).toBe('#5368be')
})

it('keeps main text readable on both surfaces across all eight themes',()=>{
 for (const name of Object.keys(palettes)) for (const dark of [false,true]) {
  const selector=`:root[data-palette="${name}"]${dark?'.dark':':not(.dark)'}`
  const block=css.slice(css.indexOf(selector)).split('}')[0]!
  const token=(key:string)=>block.match(new RegExp(`--color-${key}: (#[0-9A-Fa-f]{6});`))![1]!
  expect(contrast(token('text'),token('surface'))).toBeGreaterThanOrEqual(4.5)
  expect(contrast(token('text'),token('surface-muted'))).toBeGreaterThanOrEqual(4.5)
 }
})

it.each(Object.keys(palettes) as (keyof typeof palettes)[])('uses matching default and explicit department bars for %s', palette=>{
 for(const dark of [false,true]){
  const option={series:[{type:'bar',data:[1]},{type:'bar',itemStyle:{color:'#5368be'},data:[2]}]}
  const result=applyChartTheme(option,dark,palette) as any
  expect(result.color[0]).toBe(result.series[1].itemStyle.color)
  expect(result.color[0]).toBe(palettes[palette][dark?'dark':'light'][0])
  expect(option).not.toHaveProperty('color')
  const explicit=applyChartTheme({...option,color:['#c25252']},dark,palette) as any
  expect(explicit.color).toEqual(['#c25252'])
 }
})

it('uses the shared detail token without changing total bars',()=>{
 for(const palette of Object.keys(palettes) as (keyof typeof palettes)[]) for(const dark of [false,true]) {
 const result=applyChartTheme({series:[{type:'bar',data:[{value:1,itemStyle:{color:'#5368be'}},{value:2,itemStyle:{color:'#37a3a3'}}]}]},dark,palette) as any
 expect(result.series[0].data[0].itemStyle.color).toBe(palettes[palette][dark?'dark':'light'][0])
 expect(result.series[0].data[1].itemStyle.color).toBe(palettes[palette].chartDetail[dark?'dark':'light'])
 }
})

it('keeps Wanb on the theme primary and Yuanfeihang distinct regardless of series order',()=>{
 for(const palette of Object.keys(palettes) as (keyof typeof palettes)[]) for(const dark of [false,true]) {
  const source={series:[{name:'原飞航',type:'bar',data:[1]},{name:'万邦',type:'bar',data:[2]}]}
  const result=applyChartTheme(source,dark,palette,true) as any
  expect(result.series[1].itemStyle.color).toBe(palettes[palette][dark?'dark':'light'][0])
  expect(result.series[0].itemStyle.color).toBe(palettes[palette].yuanfeihang[dark?'dark':'light'])
  expect(result.series[0].itemStyle.color).not.toBe(result.series[1].itemStyle.color)
  expect(result.series[0].lineStyle.color).toBe(result.series[0].itemStyle.color)
  const single=applyChartTheme({series:[source.series[0]!] },dark,palette,true) as any
  expect(single.series[0].itemStyle.color).toBe(result.series[0].itemStyle.color)
  expect(source.series[0]).not.toHaveProperty('itemStyle')
 }
})
