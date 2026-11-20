import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installDashboardPanelSnap } from '@/utils/dashboard-panel-snap'

const cleanups: Array<() => void> = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
})
afterEach(() => { cleanups.splice(0).forEach(stop => stop()); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals() })

function setup() {
  const root = document.createElement('main'), cards = document.createElement('section'), viewport = document.createElement('section')
  root.append(cards, viewport); document.body.append(root)
  const positions = [{ top: 0, height: 300 }, { top: 322, height: 600 }, { top: 944, height: 900 }]
  cards.getBoundingClientRect = () => new DOMRect(0, 120, 1000, 160)
  viewport.getBoundingClientRect = () => new DOMRect(0, 296, 1000, 500)
  Object.defineProperties(viewport, { clientHeight: { value: 500 }, scrollHeight: { get: () => 2200 } })
  const panels = positions.map(position => {
    const panel = document.createElement('section'); panel.setAttribute('data-dashboard-panel', '')
    panel.getBoundingClientRect = () => new DOMRect(0, 296 + position.top - viewport.scrollTop, 1000, position.height)
    viewport.append(panel); return panel
  })
  const scrollTo = vi.fn((options?: ScrollToOptions | number, y?: number) => {
    viewport.scrollTop = typeof options === 'number' ? y ?? 0 : options?.top ?? viewport.scrollTop
    viewport.dispatchEvent(new Event('scroll'))
  })
  viewport.scrollTo = scrollTo
  cleanups.push(installDashboardPanelSnap(viewport, cards))
  const scroll = (top: number, user = true) => {
    if (user) cards.dispatchEvent(new WheelEvent('wheel', { deltaY: top - viewport.scrollTop || 1, bubbles: true }))
    viewport.scrollTop = top; viewport.dispatchEvent(new Event('scroll'))
  }
  return { root, cards, viewport, panels, positions, scrollTo, scroll }
}

describe('Dashboard panel proximity alignment', () => {
  it('aligns the preceding bottom to the fixed cards while retaining the next panel gap', () => {
    const view = setup(); view.scroll(300)
    vi.advanceTimersByTime(200)
    expect(view.scrollTo).toHaveBeenCalledWith({ top: 316, behavior: 'smooth' })
    expect(view.panels[0]!.getBoundingClientRect().bottom).toBe(view.cards.getBoundingClientRect().bottom)
    expect(view.panels[1]!.getBoundingClientRect().top - view.cards.getBoundingClientRect().bottom).toBe(22)
  })
  it('waits for the wheel gesture to settle instead of snapping on every step', () => {
    const view = setup(); view.scroll(280); vi.advanceTimersByTime(100)
    view.scroll(300); vi.advanceTimersByTime(100)
    expect(view.scrollTo).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100); expect(view.scrollTo).toHaveBeenCalledTimes(1)
  })
  it('allows free scrolling through the middle of a tall analysis panel', () => {
    const view = setup(); view.scroll(600); vi.advanceTimersByTime(250)
    expect(view.scrollTo).not.toHaveBeenCalled(); expect(view.viewport.scrollTop).toBe(600)
  })
  it('does not snap for data-driven or programmatic scroll changes', () => {
    const view = setup(); view.scroll(300, false); vi.advanceTimersByTime(250)
    expect(view.scrollTo).not.toHaveBeenCalled()
  })
  it('lets a small subsequent gesture leave the previous stop', () => {
    const view = setup(); view.scroll(300); vi.advanceTimersByTime(250)
    view.scroll(338); vi.advanceTimersByTime(250)
    expect(view.scrollTo).toHaveBeenCalledTimes(1); expect(view.viewport.scrollTop).toBe(338)
    view.scroll(700); vi.advanceTimersByTime(250)
    view.scroll(330); vi.advanceTimersByTime(250)
    expect(view.scrollTo).toHaveBeenCalledTimes(2)
  })
  it('uses the lower edge of a side-by-side row instead of its shorter card', () => {
    const view = setup(), second = document.createElement('section'); second.setAttribute('data-dashboard-panel', '')
    second.getBoundingClientRect = () => new DOMRect(500, 296 - view.viewport.scrollTop, 500, 350)
    view.viewport.prepend(second); view.positions[1]!.top = 372
    view.scroll(340); vi.advanceTimersByTime(250)
    expect(view.scrollTo).toHaveBeenCalledWith({ top: 366, behavior: 'smooth' })
  })
  it('cancels pending alignment when a filter or detail control is clicked', () => {
    const view = setup(), control = document.createElement('button'); view.panels[0]!.append(control)
    view.scroll(300); control.dispatchEvent(new Event('pointerdown', { bubbles: true })); vi.advanceTimersByTime(250)
    expect(view.scrollTo).not.toHaveBeenCalled()
  })
  it('respects reduced motion and cleans up pending work on unmount', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    const view = setup(); view.scroll(300); vi.advanceTimersByTime(250)
    expect(view.scrollTo).toHaveBeenCalledWith({ top: 316, behavior: 'instant' })
    view.scroll(920); cleanups.splice(0).forEach(stop => stop()); vi.advanceTimersByTime(250)
    expect(view.scrollTo).toHaveBeenCalledTimes(1)
  })
  it('supports keyboard paging but preserves explicit Home and End navigation', () => {
    const view = setup()
    view.viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }))
    view.scroll(300, false); vi.advanceTimersByTime(250)
    expect(view.scrollTo).toHaveBeenCalledTimes(1)
    view.viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    view.scroll(930, false); vi.advanceTimersByTime(250)
    expect(view.scrollTo).toHaveBeenCalledTimes(1)
  })
})
