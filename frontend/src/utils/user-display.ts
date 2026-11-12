export function englishDisplayName(user?: { username?: string; email?: string } | null): string {
  const username = user?.username?.trim() || ''
  const candidate = /^[a-z][a-z .'-]*$/i.test(username) ? username : user?.email?.split('@')[0] || username.split('@')[0] || 'User'
  const name = candidate.toLowerCase()
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export const PET_AVATARS = [
  { id: 'ocean', zh: '云朵猫', en: 'Cloud cat' },
  { id: 'mint', zh: '元气柴犬', en: 'Shiba' },
  { id: 'iris', zh: '垂耳兔', en: 'Lop rabbit' },
  { id: 'rose', zh: '小狐狸', en: 'Fox' },
  { id: 'amber', zh: '奶油熊', en: 'Cream bear' },
  { id: 'slate', zh: '竹叶熊猫', en: 'Panda' },
].map(avatar => ({ ...avatar, url: `/avatars/preset-${avatar.id}.svg` }))

export const PORTRAIT_AVATARS = [
  { id: 'navy', zh: '藏蓝男士', en: 'Navy' },
  { id: 'graphite', zh: '岩灰男士', en: 'Graphite' },
  { id: 'cedar', zh: '山岚松影', en: 'Pine forest' },
  { id: 'ink', zh: '晴空行星', en: 'Sunny planet' },
  { id: 'summit', zh: '远山日出', en: 'Summit' },
  { id: 'sail', zh: '海上航帆', en: 'Sailing' },
].map(avatar => ({ ...avatar, url: `/avatars/preset-${avatar.id}.svg` }))

export const WOMEN_AVATARS = [
  { id: 'violet', zh: '紫韵女士', en: 'Violet' },
  { id: 'blush', zh: '柔光女士', en: 'Blush' },
  { id: 'peony', zh: '芍药花语', en: 'Peony' },
  { id: 'pearl', zh: '珍珠月光', en: 'Moonlight' },
  { id: 'butterfly', zh: '翩然蝶影', en: 'Butterfly' },
  { id: 'swan', zh: '湖畔天鹅', en: 'Swan' },
].map(avatar => ({ ...avatar, url: `/avatars/preset-${avatar.id}.svg` }))

export const PRESET_AVATARS = [...PET_AVATARS, ...PORTRAIT_AVATARS, ...WOMEN_AVATARS]
export const AVATAR_GROUPS = [
  { id: 'pets', zh: '宠物插画', en: 'Pet illustrations', avatars: PET_AVATARS },
  { id: 'portraits', zh: '简约男士', en: 'Classic style', avatars: PORTRAIT_AVATARS },
  { id: 'women', zh: '靓丽女士', en: 'Elegant style', avatars: WOMEN_AVATARS },
]

export function presetAvatarSrc(url: string): string {
  return `${import.meta.env.BASE_URL}${url.slice(1)}?v=avatars-6`
}

/** Stable per account; changing a display name never changes its default avatar. */
export function defaultAvatarUrl(user: { id?: string; email?: string }): string {
  const key = user.id || user.email?.trim().toLowerCase() || 'hyperzone'
  let hash = 0
  for (const char of key) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
  return PET_AVATARS[hash % PET_AVATARS.length]!.url
}
