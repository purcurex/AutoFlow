import axios from 'axios'
import { promises as dns } from 'dns'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import * as sharpModule from 'sharp'
import { WorkflowRunEntity } from '../autoflow/entities'
import {
  SourcingImageResolverService,
} from './sourcing-image-resolver.service'

type SharpFactory = (typeof import('sharp'))['sharp']
const sharp = (sharpModule as unknown as { default?: SharpFactory }).default
  ?? sharpModule as unknown as SharpFactory

jest.mock('axios')

describe('SourcingImageResolverService', () => {
  const ownerUserId = '11111111-1111-4111-8111-111111111111'
  const uploadRoot = join(process.cwd(), 'uploads', 'workflow-seeds', ownerUserId)
  const axiosGet = axios.get as jest.Mock
  const resolver = new SourcingImageResolverService()

  afterEach(async () => {
    jest.restoreAllMocks()
    axiosGet.mockReset()
    await rm(uploadRoot, { recursive: true, force: true })
  })

  function workflow(seedValue: string, fields: Partial<WorkflowRunEntity> = {}): WorkflowRunEntity {
    return {
      ownerUserId,
      seedType: 'image',
      seedValue,
      seedAssetPath: null,
      seedAssetMimeType: null,
      seedAssetSize: null,
      seedAssetSha256: null,
      ...fields,
    } as WorkflowRunEntity
  }

  it('reads an owned local PNG and returns a verified digest', async () => {
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
    }).png().toBuffer()
    await mkdir(uploadRoot, { recursive: true })
    await writeFile(join(uploadRoot, 'image.png'), bytes)

    const result = await resolver.resolve(workflow('http://localhost/image.png', {
      seedAssetPath: `/uploads/workflow-seeds/${ownerUserId}/image.png`,
      seedAssetMimeType: 'image/png',
      seedAssetSize: String(bytes.length),
    }))

    expect(result).toMatchObject({
      bytes,
      mimeType: 'image/png',
      byteLength: bytes.length,
      sourceType: 'local',
      sourceHost: null,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })

  it('rejects local directory escape and private remote addresses', async () => {
    await expect(resolver.resolve(workflow('https://example.test/image.png', {
      seedAssetPath: `/uploads/workflow-seeds/${ownerUserId}/../another-user/image.png`,
    }))).rejects.toMatchObject({ code: 'INVALID_IMAGE', retryable: false })

    await expect(resolver.resolve(workflow('https://127.0.0.1/image.png')))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST', retryable: false })
  })

  it('rejects HTTP, URL credentials, and non-standard ports', async () => {
    for (const url of [
      'http://example.test/image.png',
      'https://user:password@example.test/image.png',
      'https://example.test:8443/image.png',
    ]) {
      await expect(resolver.resolve(workflow(url))).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
        retryable: false,
      })
    }
  })

  it('revalidates redirects and refuses a redirect to an internal address', async () => {
    jest.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never)
    axiosGet.mockResolvedValue({
      status: 302,
      headers: { location: 'https://10.0.0.1/private.png' },
      data: Buffer.alloc(0),
    })

    await expect(resolver.resolve(workflow('https://example.test/image.png')))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST', retryable: false })
  })

  it('converts a valid remote WebP image to JPEG', async () => {
    const webp = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
    }).webp().toBuffer()
    jest.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never)
    axiosGet.mockResolvedValue({ status: 200, headers: {}, data: webp })

    const result = await resolver.resolve(workflow('https://example.test/image.webp'))

    expect(result.mimeType).toBe('image/jpeg')
    expect(result.bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    expect(result.sourceType).toBe('remote')
    expect(result.sourceHost).toBe('example.test')
  })

  it('classifies timeout and temporary provider failures as retryable', async () => {
    jest.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never)
    axiosGet.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }))
    await expect(resolver.resolve(workflow('https://example.test/image.png')))
      .rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', retryable: true })

    axiosGet.mockResolvedValueOnce({ status: 503, headers: {}, data: Buffer.alloc(0) })
    await expect(resolver.resolve(workflow('https://example.test/image.png')))
      .rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retryable: true })
  })
})
