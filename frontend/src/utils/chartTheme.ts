import palettes from '@/theme/palettes.json'
import type { EChartsCoreOption } from 'echarts/core'

type ComponentOption = Record<string, any>

function mapComponents(value: any, transform: (item: ComponentOption) => ComponentOption) {
  return Array.isArray(value) ? value.map(transform) : transform(value)
}

/** Resolve shared chart colors and chrome without changing data, callbacks or caller-owned options. */
export function applyChartTheme(option: EChartsCoreOption, dark: boolean, palette: keyof typeof palettes = 'blue', logistics = false): EChartsCoreOption {
  const tokens = palettes[palette][dark ? 'dark' : 'light']
  const detail = palettes[palette].chartDetail[dark ? 'dark' : 'light']
  // Replace only the standard comparison hues; semantic categories retain their colors.
  const recolor = (value: any): any => {
    if (typeof value === 'string') {
      if (value.toLowerCase() === '#37a3a3') return detail
      if (['#5364b8','#5465bc','#5873d4','#5566c2','#5470c6','#5368be'].includes(value.toLowerCase())) return tokens[0]
      if (['#91a8d6','#91a7d5','#91a7d6'].includes(value.toLowerCase())) return dark ? tokens[2] : '#' + tokens[0].slice(1).match(/../g)!.map(h => Math.round(parseInt(h,16)*.45+255*.55).toString(16).padStart(2,'0')).join('')
      return value
    }
    if (Array.isArray(value)) return value.map(recolor)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, recolor(item)]))
    return value
  }
  option = recolor({ ...option, color: option.color ?? [tokens[0], '#37a3a3', '#c89c4d', '#8f9db1', '#b77f99'] })
  if (logistics) {
    const reserved = [tokens[0], palettes[palette].yuanfeihang[dark ? 'dark' : 'light']]
    const colors = palettes[palette].logisticsSeries[dark ? 'dark' : 'light'].filter(color => !reserved.includes(color))
    let colorIndex = 0
    const carrierColor = (series: ComponentOption) => {
      const identity = `${series.id ?? ''} ${series.name ?? ''}`
      const color = /原飞航|yuan\s*fei\s*hang|yfhex|\bYFH\b/i.test(identity)
        ? palettes[palette].yuanfeihang[dark ? 'dark' : 'light']
        : /万邦|wanb(?:ang)?|\bWB\b/i.test(identity) ? tokens[0] : colors[colorIndex++ % colors.length]
      return color ? { ...series, itemStyle: { ...series.itemStyle, color }, lineStyle: { ...series.lineStyle, color } } : series
    }
    option = { ...option, color: palettes[palette].logisticsSeries[dark ? 'dark' : 'light'],
      ...(option.series ? { series: mapComponents(option.series, carrierColor) } : {}) }
  }
  const themed: EChartsCoreOption = { ...option, backgroundColor: dark ? '#18222E' : '#FFFFFF', darkMode: dark }
  const axis = (item: ComponentOption) => ({
    ...item,
    axisLabel: { ...item.axisLabel, color: dark ? '#a9b9cf' : '#65798E' },
    nameTextStyle: { ...item.nameTextStyle, color: dark ? '#a9b9cf' : '#65798E' },
    axisLine: { ...item.axisLine, lineStyle: { ...item.axisLine?.lineStyle, color: dark ? '#40506a' : '#BCCBDA' } },
    axisTick: { ...item.axisTick, lineStyle: { ...item.axisTick?.lineStyle, color: dark ? '#40506a' : '#BCCBDA' } },
    splitLine: { ...item.splitLine, lineStyle: { ...item.splitLine?.lineStyle, color: dark ? '#2a374a' : '#DCE4ED' } },
    axisPointer: { ...item.axisPointer, lineStyle: { ...item.axisPointer?.lineStyle, color: dark ? '#849bc2' : '#65798E' }, shadowStyle: { ...item.axisPointer?.shadowStyle, color: dark ? '#a9b9cf0d' : '#2434480d' } },
  })
  for (const key of ['xAxis', 'yAxis']) {
    if (option[key]) themed[key] = mapComponents(option[key], axis)
  }
  if (option.legend) themed.legend = mapComponents(option.legend, item => ({
    ...item, textStyle: { ...item.textStyle, color: dark ? '#b9c7db' : '#65798E' },
    inactiveColor: dark ? '#536277' : '#A0ADBA', pageIconColor: dark ? '#a9b9cf' : '#65798E', pageIconInactiveColor: dark ? '#40506a' : '#BCCBDA',
    pageTextStyle: { ...item.pageTextStyle, color: dark ? '#a9b9cf' : '#65798E' },
  }))
  if (option.tooltip) themed.tooltip = mapComponents(option.tooltip, item => ({
    ...item, backgroundColor: dark ? '#1c2839' : '#FFFFFF', borderColor: dark ? '#40506a' : '#BCCBDA',
    textStyle: { ...item.textStyle, color: dark ? '#e4edf8' : '#243448' },
    extraCssText: `${item.extraCssText ?? ''};box-shadow:0 12px 32px ${dark ? '#00000040' : '#24344818'};`,
  }))
  if (option.toolbox) themed.toolbox = mapComponents(option.toolbox, item => ({
    ...item, iconStyle: { ...item.iconStyle, borderColor: dark ? '#a4b5d3' : '#65798E' },
    emphasis: { ...item.emphasis, iconStyle: { ...item.emphasis?.iconStyle, borderColor: dark ? '#d6e1ff' : '#243448' } },
  }))
  if (option.dataZoom) themed.dataZoom = mapComponents(option.dataZoom, item => ({
    ...item, backgroundColor: dark ? '#101926' : '#F5F7FA', borderColor: dark ? '#34445b' : '#DCE4ED', fillerColor: dark ? '#8fa9e329' : '#8fa9e329',
    textStyle: { ...item.textStyle, color: dark ? '#b9c7db' : '#65798E' },
    handleStyle: { ...item.handleStyle, color: dark ? '#aabde8' : '#879CC2', borderColor: dark ? '#aabde8' : '#879CC2' },
    moveHandleStyle: { ...item.moveHandleStyle, color: dark ? '#6e84af' : '#65798E' },
    dataBackground: {
      ...item.dataBackground,
      lineStyle: { ...item.dataBackground?.lineStyle, color: dark ? '#597297' : '#879CC2' },
      areaStyle: { ...item.dataBackground?.areaStyle, color: dark ? '#59729726' : '#879CC226' },
    },
    selectedDataBackground: {
      ...item.selectedDataBackground,
      lineStyle: { ...item.selectedDataBackground?.lineStyle, color: dark ? '#aabde8' : '#879CC2' },
      areaStyle: { ...item.selectedDataBackground?.areaStyle, color: dark ? '#8fa9e333' : '#8fa9e333' },
    },
  }))
  return themed
}
