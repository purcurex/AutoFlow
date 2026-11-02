export function englishDisplayName(user?: { username?: string; email?: string } | null): string {
  const username = user?.username?.trim() || ''
  const candidate = /^[a-z][a-z .'-]*$/i.test(username) ? username : user?.email?.split('@')[0] || username.split('@')[0] || 'User'
  const name = candidate.toLowerCase()
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export const PRESET_AVATARS = [
  { id: 'ocean', zh: '海蓝', en: 'Ocean' },
  { id: 'mint', zh: '青绿', en: 'Mint' },
  { id: 'iris', zh: '鸢紫', en: 'Iris' },
  { id: 'rose', zh: '蔷薇', en: 'Rose' },
  { id: 'amber', zh: '暖橙', en: 'Amber' },
  { id: 'slate', zh: '雾灰', en: 'Slate' },
].map(avatar => ({ ...avatar, url: `/avatars/preset-${avatar.id}.svg` }))
