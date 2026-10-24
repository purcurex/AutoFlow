import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from '@/utils/copyText'

const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const command = Object.getOwnPropertyDescriptor(document, 'execCommand')
afterEach(() => {
  if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard); else Reflect.deleteProperty(navigator, 'clipboard')
  if (command) Object.defineProperty(document, 'execCommand', command); else Reflect.deleteProperty(document, 'execCommand')
  document.body.replaceChildren()
})
describe('order number clipboard compatibility', () => {
  it('copies on HTTP without the Clipboard API and removes the temporary field', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    const button = document.createElement('button'); document.body.appendChild(button); button.focus()
    const exec = vi.fn(() => {
      expect(document.querySelector('textarea')?.value).toBe('AF-12345')
      return true
    })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec })
    await copyText('AF-12345')
    expect(exec).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
    expect(document.activeElement).toBe(button)
  })
  it('reports failure if both clipboard paths fail, rather than claiming a successful copy', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false })
    await expect(copyText('AF-12345')).rejects.toThrow('Copy unavailable')
    expect(document.querySelector('textarea')).toBeNull()
  })
})
