import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request } from 'express'
import { access, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { WorkflowSeedAssetService } from './workflow-seed-asset.service'

describe('WorkflowSeedAssetService', () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const uploadDirectory = join(process.cwd(), 'uploads', 'workflow-seeds', userId)

  afterEach(async () => {
    await rm(uploadDirectory, { recursive: true, force: true })
  })

  function request(host = '127.0.0.1:3000'): Request {
    return {
      protocol: 'http',
      get: jest.fn().mockReturnValue(host),
    } as unknown as Request
  }

  function imageFile(buffer: Buffer, mimetype = 'image/png'): Express.Multer.File {
    return {
      buffer,
      mimetype,
      originalname: 'product-screenshot.png',
      size: buffer.length,
    } as Express.Multer.File
  }

  it('stores a validated image and returns a provider-ready public URL', async () => {
    const config = new ConfigService({ PUBLIC_ASSET_BASE_URL: 'https://assets.example.com/' })
    const service = new WorkflowSeedAssetService(config)
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])

    const result = await service.save(userId, imageFile(png), request())

    expect(result.publicUrl).toMatch(
      /^https:\/\/assets\.example\.com\/uploads\/workflow-seeds\/.*\.png$/,
    )
    expect(result.providerReady).toBe(true)
    await expect(access(join(process.cwd(), result.assetPath))).resolves.toBeUndefined()
    await expect(readFile(join(process.cwd(), result.assetPath))).resolves.toEqual(png)
  })

  it('marks a development localhost upload as unavailable to external providers', async () => {
    const service = new WorkflowSeedAssetService(new ConfigService({ NODE_ENV: 'development' }))
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0])

    const result = await service.save(userId, imageFile(jpeg, 'image/jpeg'), request())

    expect(result.publicUrl).toContain('http://127.0.0.1:3000/uploads/workflow-seeds/')
    expect(result.providerReady).toBe(false)
  })

  it('rejects a file whose bytes are not a supported image', async () => {
    const service = new WorkflowSeedAssetService(new ConfigService({ NODE_ENV: 'development' }))

    await expect(
      service.save(userId, imageFile(Buffer.from('not an image')), request()),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('requires a public asset origin in production', async () => {
    const service = new WorkflowSeedAssetService(new ConfigService({ NODE_ENV: 'production' }))
    const webp = Buffer.from('RIFFxxxxWEBP', 'ascii')

    await expect(service.save(userId, imageFile(webp, 'image/webp'), request())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })
})
