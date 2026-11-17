/** Only local directory data supplies the display name; never use a source username as an alias. */
export function employeeDisplayName(name: string, englishName?: string | null): string {
  const local = name?.trim() ?? ''
  const suffix = local.match(/\s*[（(]([^()（）]+)[）)]\s*$/)
  const base = suffix ? local.slice(0, suffix.index).trim() : local
  const english = englishName?.trim() || suffix?.[1].trim()
  return english && base.toLowerCase() !== english.toLowerCase() ? `${base}（${english}）` : base
}
