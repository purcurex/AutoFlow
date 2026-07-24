export const WORKFLOW_IMAGE_MAX_BYTES = 8 * 1024 * 1024

const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

export type WorkflowImageValidationError = 'type' | 'size' | null

export function validateWorkflowImage(file: File): WorkflowImageValidationError {
  if (!supportedImageTypes.has(file.type)) return 'type'
  if (file.size > WORKFLOW_IMAGE_MAX_BYTES) return 'size'
  return null
}

export function getClipboardImage(clipboardData: DataTransfer | null): File | null {
  if (!clipboardData) return null

  for (const item of Array.from(clipboardData.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile()
  }

  return Array.from(clipboardData.files).find((file) => file.type.startsWith('image/')) || null
}
