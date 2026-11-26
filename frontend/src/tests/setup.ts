// jsdom has no layout engine or ResizeObserver. Tests that need resize
// notifications can replace this default with a controllable observer double.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
