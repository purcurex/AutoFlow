import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomUUID } from 'crypto'
import type { Request } from 'express'
import { mkdir, stat, writeFile } from 'fs/promises'
import { isAbsolute, join, relative, resolve } from 'path'

export const WORKFLOW_IMAGE_MAX_BYTES = 8 * 1024 * 1024

const extensionByType = {
  jpeg: '.jpg',
  png: '.png',
  webp: '.webp',
} as const

type SupportedImageType = keyof typeof extensionByType

export interface WorkflowSeedAsset {
  assetPath: string
  publicUrl: string
  providerReady: boolean
  originalName: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  size: number
  sha256: string
}

@Injectable()
export class WorkflowSeedAssetService {
  constructor(private readonly configService: ConfigService) {}

  async save(
    ownerUserId: string,
    file: Express.Multer.File | undefined,
    request: Request,
  ): Promise<WorkflowSeedAsset> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Select an image to upload.')
    }
    if (file.size > WORKFLOW_IMAGE_MAX_BYTES) {
      throw new BadRequestException('Image size cannot exceed 8 MB.')
    }

    const imageType = this.detectImageType(file.buffer)
    if (!imageType) {
      throw new BadRequestException('Only PNG, JPEG, and WebP images are supported.')
    }

    const publicBaseUrl = this.resolvePublicBaseUrl(request)
    const filename = `${randomUUID()}${extensionByType[imageType]}`
    const relativeDirectory = join('workflow-seeds', ownerUserId)
    const uploadDirectory = join(process.cwd(), 'uploads', relativeDirectory)
    await mkdir(uploadDirectory, { recursive: true })
    await writeFile(join(uploadDirectory, filename), file.buffer, { flag: 'wx' })

    const assetPath = `/uploads/workflow-seeds/${ownerUserId}/${filename}`
    return {
      assetPath,
      publicUrl: `${publicBaseUrl}${assetPath}`,
      providerReady: this.isPublicProviderUrl(publicBaseUrl),
      originalName: file.originalname || 'clipboard-image',
      mimeType: `image/${imageType}` as WorkflowSeedAsset['mimeType'],
      size: file.size,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
    }
  }

  /**
   * 校验工作流引用的本地图片确实位于当前用户的受控上传目录中。
   * 返回解析后的绝对路径，供后续1688图片解析器读取；任何越权路径均按非法请求拒绝。
   */
  async assertOwnedAsset(ownerUserId: string, assetPath: string): Promise<string> {
    const normalizedAssetPath = assetPath.replace(/\\/g, '/')
    const expectedPrefix = `/uploads/workflow-seeds/${ownerUserId}/`
    if (!normalizedAssetPath.startsWith(expectedPrefix)) {
      throw new BadRequestException('Workflow image asset does not belong to the current user.')
    }

    const ownedRoot = resolve(process.cwd(), 'uploads', 'workflow-seeds', ownerUserId)
    const absolutePath = resolve(process.cwd(), normalizedAssetPath.replace(/^\/+/, ''))
    const relativePath = relative(ownedRoot, absolutePath)
    if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new BadRequestException('Workflow image asset path is invalid.')
    }

    try {
      const fileStat = await stat(absolutePath)
      if (!fileStat.isFile()) throw new Error('Not a regular file')
    } catch {
      throw new BadRequestException('Workflow image asset is unavailable.')
    }
    return absolutePath
  }

  private resolvePublicBaseUrl(request: Request): string {
    const configured = this.configService.get<string>('PUBLIC_ASSET_BASE_URL')?.trim()
    if (configured) {
      try {
        const url = new URL(configured)
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol')
        return configured.replace(/\/$/, '')
      } catch {
        throw new ServiceUnavailableException('PUBLIC_ASSET_BASE_URL must be a valid HTTP(S) URL.')
      }
    }

    if (this.configService.get<string>('NODE_ENV') === 'production') {
      throw new ServiceUnavailableException(
        'PUBLIC_ASSET_BASE_URL is required before uploading workflow images in production.',
      )
    }

    return `${request.protocol}://${request.get('host') || 'localhost:3000'}`
  }

  private detectImageType(buffer: Buffer): SupportedImageType | null {
    if (
      buffer.length >= 8
      && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) return 'png'

    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'jpeg'
    }

    if (
      buffer.length >= 12
      && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) return 'webp'

    return null
  }

  private isPublicProviderUrl(baseUrl: string): boolean {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    if (hostname === 'localhost' || hostname === '::1' || hostname.endsWith('.local')) return false
    if (/^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname)) return false

    const private172 = hostname.match(/^172\.(\d{1,3})\./)
    return !private172 || Number(private172[1]) < 16 || Number(private172[1]) > 31
  }
}
