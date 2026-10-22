<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarClock, CalendarOff, CircleCheck, Moon, MoveRight } from 'lucide-vue-next'
import { getWorkCalendar } from '@/utils/workCalendar'

const { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const now = shallowRef(new Date())
const calendar = computed(() => getWorkCalendar(now.value))
const weekdays = computed(() => zh.value ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
const cursor = computed(() => (calendar.value.beijing.hour * 60 + calendar.value.beijing.minute + calendar.value.beijing.second / 60) / 1440 * 100)
const stateLabel = (status: string) => status === 'working' ? text('工作中', 'Working') : status === 'weekend' ? text('周末休息', 'Weekend') : text('休息中', 'Off hours')
const difference = (hours: number) => zh.value ? `比北京${hours > 0 ? '快' : '慢'} ${Math.abs(hours)} 小时` : `${Math.abs(hours)}h ${hours > 0 ? 'ahead of' : 'behind'} Beijing`
const syncClock = () => { now.value = new Date() }
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(syncClock, 1000)
  document.addEventListener('visibilitychange', syncClock)
  window.addEventListener('focus', syncClock)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  document.removeEventListener('visibilitychange', syncClock)
  window.removeEventListener('focus', syncClock)
})
</script>

<template>
  <article class="work-calendar-card" :aria-label="text('海外工作日历', 'Overseas work calendar')">
    <header class="calendar-heading">
      <h2><CalendarClock :size="16" aria-hidden="true" />{{ text('工作日历', 'Work calendar') }}</h2>
      <div class="beijing-clock" :title="text('使用电脑时间，每秒更新', 'Computer clock, updated every second')">
        <span>{{ text('北京', 'Beijing') }} <small>UTC+8</small></span>
        <time :datetime="now.toISOString()">{{ calendar.beijing.time }}</time>
        <span class="beijing-date">{{ calendar.beijing.shortDate }} {{ weekdays[calendar.beijing.weekday] }}</span>
      </div>
    </header>
    <div class="calendar-regions">
      <section v-for="region in calendar.regions" :key="region.code" class="calendar-region" :data-region="region.code" :style="{ '--region-color': region.color }">
        <div class="region-heading"><strong>{{ region.code }}</strong><span>{{ zh ? region.name : region.englishName }}</span></div>
        <div class="region-now">
          <time class="local-clock" :datetime="now.toISOString()">{{ region.local.time }}</time>
          <span class="work-state" :class="region.status" role="status"><component :is="region.status === 'working' ? CircleCheck : region.status === 'weekend' ? CalendarOff : Moon" :size="12" aria-hidden="true" />{{ stateLabel(region.status) }}</span>
        </div>
        <p class="region-date" :title="region.zone">{{ region.local.shortDate }} {{ weekdays[region.local.weekday] }}<span> · {{ difference(region.differenceHours) }}</span></p>
        <div class="work-hours">
          <div><span>{{ text('当地上班', 'Local hours') }}</span><strong>09:00–17:00</strong></div>
          <MoveRight class="conversion-arrow" :size="13" aria-hidden="true" />
          <div class="beijing-hours"><span>{{ text('对应北京', 'Beijing hours') }}</span><strong>{{ region.beijingStart }}–<small v-if="region.endDayOffset">{{ text('次日 ', 'next day ') }}</small>{{ region.beijingEnd }}</strong></div>
        </div>
        <div class="hours-track" role="img" :aria-label="`${text('北京时间工作窗口', 'Work window in Beijing time')} ${region.beijingStart}–${region.endDayOffset ? text('次日 ', 'next day ') : ''}${region.beijingEnd}`">
          <span v-for="segment in region.segments" :key="segment.start" class="work-segment" :style="{ left: `${segment.start / 24 * 100}%`, width: `${(segment.end - segment.start) / 24 * 100}%` }" />
          <span class="now-cursor" :style="{ left: `${cursor}%` }" :title="`${text('北京现在', 'Beijing now')} ${calendar.beijing.time}`" />
        </div>
        <div class="track-labels" aria-hidden="true"><span>00</span><span>12</span><span>24</span></div>
      </section>
    </div>
    <footer class="calendar-note"><span>{{ text('参考作息：当地周一至周五 09:00–17:00 · 不含公共假期', 'Reference: Mon–Fri 09:00–17:00 local · public holidays excluded') }}</span><span class="clock-note"><i aria-hidden="true" />{{ text('竖线为北京当前时间 · 自动换算夏令时', 'Line: Beijing now · daylight saving adjusts automatically') }}</span></footer>
  </article>
</template>

<style scoped>
.work-calendar-card { min-width: 0; border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden; background: var(--color-surface); color: var(--color-text, #243247); container-type: inline-size; }
.calendar-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 15px; background: linear-gradient(110deg, #eef3fc, #f0faf7); border-bottom: 1px solid var(--color-border); }
.calendar-heading h2 { display: flex; align-items: center; gap: 7px; color: #537ca4; font-size: 12px; font-weight: 650; white-space: nowrap; }
.beijing-clock { display: flex; align-items: baseline; justify-content: flex-end; flex-wrap: wrap; column-gap: 7px; row-gap: 3px; font-size: 10px; color: #74859a; font-variant-numeric: tabular-nums; }
.beijing-clock small { font-size: 9px; }.beijing-clock time { font-size: 15px; font-weight: 650; color: #3c646c; }.beijing-date { font-size: 9px; }
.calendar-regions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 13px 0 6px; }
.calendar-region { min-width: 0; padding: 0 14px; }.calendar-region + .calendar-region { border-left: 1px solid var(--color-border); }
.region-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 7px; }.region-heading strong { color: var(--region-color); font-size: 12px; letter-spacing: .04em; }.region-heading > span { color: #8190a4; font-size: 10px; }
.region-now { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px 8px; margin-top: 8px; }
.local-clock { font-size: 20px; line-height: 1.3; letter-spacing: -.03em; font-weight: 650; font-variant-numeric: tabular-nums; }
.work-state { display: inline-flex; align-items: center; gap: 4px; padding: 3px 5px; font-size: 9px; border-radius: 4px; line-height: 1.2; white-space: nowrap; }
.working { color: #258b75; background: #e9f7f1; }.off { color: #71819c; background: #f0f3f8; }.weekend { color: #a17b48; background: #faf4e9; }
.region-date { margin-top: 5px; color: #8a97a9; font-size: 9px; line-height: 1.5; font-variant-numeric: tabular-nums; }
.work-hours { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px; margin-top: 11px; padding-top: 9px; border-top: 1px dashed var(--color-border); font-variant-numeric: tabular-nums; }
.work-hours div { display: flex; flex-direction: column; gap: 3px; }.work-hours span { font-size: 9px; color: #8a97a9; }.work-hours strong { font-size: 11px; font-weight: 550; white-space: nowrap; }.work-hours strong small { font-size: 9px; font-weight: 400; }.beijing-hours strong { color: var(--region-color); }.conversion-arrow { color: #aebdce; flex-shrink: 0; }
.hours-track { position: relative; height: 5px; margin-top: 12px; background: #eef2f7; border-radius: 3px; }.work-segment { position: absolute; top: 0; bottom: 0; background: var(--region-color); opacity: .55; border-radius: 3px; }.now-cursor { position: absolute; top: -3px; width: 2px; height: 11px; background: #48596e; border-radius: 1px; transform: translateX(-1px); }
.track-labels { display: flex; justify-content: space-between; margin-top: 4px; color: #a1acbb; font-size: 8px; font-variant-numeric: tabular-nums; }
.calendar-note { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; padding: 9px 14px; font-size: 9px; line-height: 1.5; color: #8a97a9; }.clock-note { display: inline-flex; gap: 5px; align-items: center; }.clock-note i { width: 2px; height: 8px; background: #48596e; flex-shrink: 0; }
@container (max-width: 600px) {
  .calendar-region { padding: 0 10px; }.region-heading { display: block; }.region-heading > span { display: block; margin-top: 3px; }.region-now { align-items: flex-start; flex-direction: column; }.region-date span { display: block; }.work-hours { display: block; }.work-hours > div { flex-direction: row; flex-wrap: wrap; justify-content: space-between; gap: 3px; }.conversion-arrow { display: none; }.work-hours .beijing-hours { margin-top: 5px; }.calendar-note { font-size: 8px; }
}
@container (max-width: 400px) {
  .calendar-heading { align-items: flex-start; }.beijing-date { width: 100%; text-align: right; }.calendar-regions { grid-template-columns: 1fr; padding: 0; }.calendar-region { padding: 12px 15px; }.calendar-region + .calendar-region { border-left: 0; border-top: 1px solid var(--color-border); }.region-heading, .region-now { display: flex; flex-direction: row; }.region-heading > span { margin-top: 0; }.region-date span { display: inline; }.work-hours { display: flex; }.work-hours > div { flex-direction: column; }.work-hours .beijing-hours { margin: 0; }.conversion-arrow { display: block; }.calendar-note { padding: 10px 15px; }
}
:global(.dark) .calendar-heading { background: linear-gradient(110deg, #25334a, #243d3b); }:global(.dark) .calendar-heading h2 { color: #acc7e4; }:global(.dark) .beijing-clock time { color: #b7d6d1; }:global(.dark) .working { color: #7dd2b7; background: #26453b; }:global(.dark) .off { color: #afbed3; background: #2d394e; }:global(.dark) .weekend { color: #e5c289; background: #473e2e; }:global(.dark) .hours-track { background: #344054; }:global(.dark) .now-cursor, :global(.dark) .clock-note i { background: #c0cde0; }
</style>
