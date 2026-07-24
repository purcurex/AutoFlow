import { describe, expect, it } from 'vitest'
import {
  WORKFLOW_IMAGE_MAX_BYTES,
  getClipboardImage,
  validateWorkflowImage,
} from '@/utils/workflowImage'

describe('workflow image input', () => {
  it('accepts supported screenshot formats', () => {
    expect(validateWorkflowImage(new File(['png'], 'capture.png', { type: 'image/png' }))).toBeNull()
    expect(validateWorkflowImage(new File(['jpg'], 'capture.jpg', { type: 'image/jpeg' }))).toBeNull()
    expect(validateWorkflowImage(new File(['webp'], 'capture.webp', { type: 'image/webp' }))).toBeNull()
  })

  it('rejects unsupported and oversized files', () => {
    expect(validateWorkflowImage(new File(['gif'], 'capture.gif', { type: 'image/gif' }))).toBe('type')
    const oversized = new File([new Uint8Array(WORKFLOW_IMAGE_MAX_BYTES + 1)], 'large.png', {
      type: 'image/png',
    })
    expect(validateWorkflowImage(oversized)).toBe('size')
  })

  it('finds an image in clipboard data', () => {
    const image = new File(['image'], 'clipboard.png', { type: 'image/png' })
    const clipboard = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
      files: [],
    } as unknown as DataTransfer

    expect(getClipboardImage(clipboard)).toBe(image)
  })
})
