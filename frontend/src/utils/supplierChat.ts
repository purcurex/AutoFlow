/** No message payload, arbitrary site, or caller-chosen recipient may be launched. */
export function openSupplierChat(raw: string, account: string): void {
  const url = new URL(raw)
  const entries = [...url.searchParams.entries()]
  if (!account || account.length > 128 || [...account].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || url.protocol !== 'aliim:' || url.pathname !== 'sendmsg' || url.host || url.hash
    || entries.length !== 1 || entries[0]?.[0] !== 'touid' || entries[0]?.[1] !== `cnalichn${account}`) throw new Error('无法确认旺旺联系地址，请刷新后重试。')
  window.location.assign(raw)
}
