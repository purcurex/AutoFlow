export function leadCustomerName(value: string): string {
  const name = value.trim()
  const withoutDotCom = name.replace(/\.com$/i, '')

  return withoutDotCom || name
}
