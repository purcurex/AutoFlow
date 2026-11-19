import { expect, it } from 'vitest'
import palettes from '@/theme/palettes.json'
import css from '@/theme/palettes.css?raw'
import { applyChartTheme } from '@/utils/chartTheme'
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
it('recolors standard chart series while preserving semantic colors and callbacks',()=>{
 const formatter=()=>'$12';const option={tooltip:{formatter},series:[{type:'bar',itemStyle:{color:'#5368be'},data:[12]},{type:'bar',itemStyle:{color:'#c25252'},data:[1]}]}
 const themed=applyChartTheme(option,false,'orange') as any
 expect(themed.series[0].itemStyle.color).toBe('#FFBE00')
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
