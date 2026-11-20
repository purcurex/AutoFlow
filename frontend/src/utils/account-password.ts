/** Matches the API/bootstrap policy; never use this to reject an existing login. */
export function isValidAccountPassword(value: unknown): value is string {
  return typeof value === 'string' && Array.from(value).length >= 6
    && /[A-Za-z]/.test(value) && /[0-9]/.test(value)
    && new TextEncoder().encode(value).length <= 72
}
