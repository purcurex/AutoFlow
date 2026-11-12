import { validate } from 'class-validator'
import { UpdateProfileDto } from './update-profile.dto'

it('accepts the new portrait presets while continuing to reject unknown preset paths', async () => {
  for (const avatarUrl of ['/avatars/preset-navy.svg', '/avatars/preset-graphite.svg', '/avatars/preset-cedar.svg', '/avatars/preset-ink.svg', '/avatars/preset-ocean.svg', '/avatars/preset-summit.svg', '/avatars/preset-sail.svg', '/avatars/preset-violet.svg', '/avatars/preset-blush.svg', '/avatars/preset-peony.svg', '/avatars/preset-pearl.svg', '/avatars/preset-butterfly.svg', '/avatars/preset-swan.svg']) {
    expect(await validate(Object.assign(new UpdateProfileDto(), { avatarUrl }))).toHaveLength(0)
  }
  expect(await validate(Object.assign(new UpdateProfileDto(), { avatarUrl: '/avatars/preset-unknown.svg' }))).not.toHaveLength(0)
})


it('only accepts the two explicit display modes and rejects null', async () => {
  for (const dataDisplayScope of ['department', 'self']) expect(await validate(Object.assign(new UpdateProfileDto(), { dataDisplayScope }))).toHaveLength(0)
  for (const dataDisplayScope of [null, 'all', '', 1]) expect(await validate(Object.assign(new UpdateProfileDto(), { dataDisplayScope }))).not.toHaveLength(0)
})
