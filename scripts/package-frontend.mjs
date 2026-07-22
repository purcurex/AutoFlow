import { access, cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'frontend', 'dist')
const target = join(root, 'backend', 'dist', 'public')

await access(join(source, 'index.html'))
await rm(target, { recursive: true, force: true })
await mkdir(dirname(target), { recursive: true })
await cp(source, target, { recursive: true })

console.log(`Packaged frontend assets into ${target}`)
