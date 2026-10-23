import { Injectable } from '@nestjs/common'
import axios, { AxiosError } from 'axios'
import { createHash } from 'crypto'
import { promises as dns } from 'dns'
import { readFile, stat } from 'fs/promises'
import { Agent as HttpAgent } from 'http'
import { Agent as HttpsAgent } from 'https'
import { isIP, type LookupFunction } from 'net'
import { isAbsolute, relative, resolve } from 'path'
import * as sharpModule from 'sharp'
import { WorkflowRunEntity } from '../autoflow/entities'

type SharpFactory = (typeof import('sharp'))['sharp']
const sharp = (sharpModule as unknown as { default?: SharpFactory }).default
  ?? sharpModule as unknown as SharpFactory

const MAX_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_PROVIDER_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_SOURCE_IMAGE_PIXELS = 40_000_000
const MAX_SOURCE_IMAGE_EDGE = 16_384
const MAX_REDIRECTS = 3
const REMOTE_TIMEOUT_MS = 10_000

export interface ResolvedSourcingImage {
  bytes: Buffer
  mimeType: 'image/jpeg' | 'image/png'
  byteLength: number
  sha256: string
  sourceType: 'local' | 'remote'
  sourceHost: string | null
}

export class SourcingImageException extends Error {
  constructor(
    readonly code:
      | 'INVALID_IMAGE'
      | 'INVALID_REQUEST'
      | 'PROVIDER_TIMEOUT'
      | 'PROVIDER_UNAVAILABLE',
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'SourcingImageException'
  }
}

interface RemoteImageBytes {
  bytes: Buffer
  sourceHost: string
  responseContentType: string | null
}

/**
 * 将工作流图片解析为1688可上传的JPEG/PNG字节。
 * 本地路径按用户目录隔离，远程URL在每次重定向前重新执行协议、DNS与公网地址校验。
 */
@Injectable()
export class SourcingImageResolverService {
  async resolve(workflow: WorkflowRunEntity): Promise<ResolvedSourcingImage> {
    if (workflow.seedType !== 'image') {
      throw this.invalidRequest('Only image workflows can resolve a sourcing image.')
    }

    if (workflow.seedAssetPath) {
      const bytes = await this.readOwnedLocalAsset(workflow)
      return this.normalizeImage(bytes, 'local', null, workflow.seedAssetMimeType)
    }

    const remote = await this.downloadRemoteImage(workflow.seedValue)
    return this.normalizeImage(
      remote.bytes,
      'remote',
      remote.sourceHost,
      remote.responseContentType,
    )
  }

  private async readOwnedLocalAsset(workflow: WorkflowRunEntity): Promise<Buffer> {
    const expectedPrefix = `/uploads/workflow-seeds/${workflow.ownerUserId}/`
    const normalizedPath = workflow.seedAssetPath!.replace(/\\/g, '/')
    if (!normalizedPath.startsWith(expectedPrefix)) {
      throw this.invalidImage('Workflow image asset does not belong to the current user.')
    }

    const ownedRoot = resolve(
      process.cwd(),
      'uploads',
      'workflow-seeds',
      workflow.ownerUserId,
    )
    const absolutePath = resolve(process.cwd(), normalizedPath.replace(/^\/+/, ''))
    const relativePath = relative(ownedRoot, absolutePath)
    if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw this.invalidImage('Workflow image asset path is invalid.')
    }

    try {
      const fileStat = await stat(absolutePath)
      if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > MAX_SOURCE_IMAGE_BYTES) {
        throw this.invalidImage('Workflow image must be a file no larger than 8 MB.')
      }
      if (workflow.seedAssetSize && BigInt(workflow.seedAssetSize) !== BigInt(fileStat.size)) {
        throw this.invalidImage('Workflow image size no longer matches its stored metadata.')
      }
      const bytes = await readFile(absolutePath)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (workflow.seedAssetSha256 && sha256 !== workflow.seedAssetSha256.toLowerCase()) {
        throw this.invalidImage('Workflow image content no longer matches its stored metadata.')
      }
      return bytes
    } catch (error) {
      if (error instanceof SourcingImageException) throw error
      throw this.invalidImage('Workflow image asset is unavailable.')
    }
  }

  private async downloadRemoteImage(seedValue: string): Promise<RemoteImageBytes> {
    const startedAt = Date.now()
    let currentUrl = this.parseRemoteUrl(seedValue)

    for (let redirectCount = 0; ; redirectCount += 1) {
      const remainingTimeoutMs = REMOTE_TIMEOUT_MS - (Date.now() - startedAt)
      if (remainingTimeoutMs <= 0) {
        throw new SourcingImageException(
          'PROVIDER_TIMEOUT',
          'Remote workflow image download timed out.',
          true,
        )
      }

      const address = await this.resolvePublicAddress(currentUrl.hostname)
      const lookup: LookupFunction = (_hostname, options, callback) => {
          // Node 20+ 的HTTPS客户端可能以 all=true 请求地址数组；返回单个字符串会触发 ERR_INVALID_IP_ADDRESS。
          if (typeof options === 'object' && options.all) {
            callback(null, [{ address: address.address, family: address.family }])
            return
          }
          callback(null, address.address, address.family)
      }
      const agentOptions = { lookup }
      const requestAgent = currentUrl.protocol === 'https:'
        ? { httpsAgent: new HttpsAgent(agentOptions) }
        : { httpAgent: new HttpAgent(agentOptions) }

      try {
        const response = await axios.get<ArrayBuffer>(currentUrl.toString(), {
          ...requestAgent,
          maxRedirects: 0,
          responseType: 'arraybuffer',
          timeout: remainingTimeoutMs,
          maxContentLength: MAX_SOURCE_IMAGE_BYTES,
          maxBodyLength: MAX_SOURCE_IMAGE_BYTES,
          validateStatus: () => true,
        })

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.location
          if (!location || redirectCount >= MAX_REDIRECTS) {
            throw this.invalidRequest('Remote workflow image exceeded the redirect limit.')
          }
          currentUrl = this.parseRemoteUrl(new URL(location, currentUrl).toString())
          continue
        }
        if (response.status >= 500) {
          throw new SourcingImageException(
            'PROVIDER_UNAVAILABLE',
            'Remote workflow image provider is temporarily unavailable.',
            true,
          )
        }
        if (response.status < 200 || response.status >= 300) {
          throw this.invalidRequest('Remote workflow image request was rejected.')
        }

        const contentLength = Number(response.headers['content-length'] || 0)
        if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_IMAGE_BYTES) {
          throw this.invalidImage('Remote workflow image exceeds 8 MB.')
        }
        const bytes = Buffer.from(response.data)
        if (!bytes.length || bytes.length > MAX_SOURCE_IMAGE_BYTES) {
          throw this.invalidImage('Remote workflow image must be no larger than 8 MB.')
        }
        const responseContentType = String(response.headers['content-type'] || '')
          .split(';', 1)[0]
          .trim()
          .toLowerCase() || null
        if (responseContentType && !['image/jpeg', 'image/png', 'image/webp'].includes(responseContentType)) {
          throw this.invalidImage('Remote workflow image content type is unsupported.')
        }
        return { bytes, sourceHost: currentUrl.hostname.toLowerCase(), responseContentType }
      } catch (error) {
        if (error instanceof SourcingImageException) throw error
        const axiosError = error as AxiosError
        if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
          throw new SourcingImageException(
            'PROVIDER_TIMEOUT',
            'Remote workflow image download timed out.',
            true,
          )
        }
        throw new SourcingImageException(
          'PROVIDER_UNAVAILABLE',
          'Remote workflow image provider is unavailable.',
          true,
        )
      }
    }
  }

  private parseRemoteUrl(rawUrl: string): URL {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      throw this.invalidRequest('Workflow image URL is invalid.')
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw this.invalidRequest('Workflow image URL must use HTTP or HTTPS.')
    }
    if (url.username || url.password) {
      throw this.invalidRequest('Workflow image URL cannot contain credentials.')
    }
    const standardPort = url.protocol === 'https:' ? '443' : '80'
    if (url.port && url.port !== standardPort) {
      throw this.invalidRequest('Workflow image URL must use the standard HTTP(S) port.')
    }
    return url
  }

  private async resolvePublicAddress(
    hostname: string,
  ): Promise<{ address: string; family: number }> {
    const directFamily = isIP(hostname)
    const addresses = directFamily
      ? [{ address: hostname, family: directFamily }]
      : await dns.lookup(hostname, { all: true, verbatim: true })
    if (!addresses.length || addresses.some((item) => !this.isPublicAddress(item.address))) {
      throw this.invalidRequest('Workflow image host must resolve only to public addresses.')
    }
    return addresses[0]
  }

  private isPublicAddress(address: string): boolean {
    const normalized = address.toLowerCase()
    if (normalized.includes(':')) {
      if (normalized.startsWith('::ffff:')) {
        return this.isPublicAddress(normalized.slice('::ffff:'.length))
      }
      return normalized !== '::'
        && normalized !== '::1'
        && !/^f[cd]/.test(normalized)
        && !/^fe[89ab]/.test(normalized)
        && !normalized.startsWith('ff')
        && !normalized.startsWith('2001:db8')
    }

    const octets = normalized.split('.').map(Number)
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      return false
    }
    const [first, second, third] = octets
    if (first === 0 || first === 10 || first === 127 || first >= 224) return false
    if (first === 100 && second >= 64 && second <= 127) return false
    if (first === 169 && second === 254) return false
    if (first === 172 && second >= 16 && second <= 31) return false
    if (first === 192 && second === 168) return false
    if (first === 192 && second === 0 && [0, 2].includes(third)) return false
    if (first === 198 && [18, 19, 51].includes(second)) return false
    if (first === 203 && second === 0 && third === 113) return false
    return true
  }

  private async normalizeImage(
    inputBytes: Buffer,
    sourceType: 'local' | 'remote',
    sourceHost: string | null,
    declaredMimeType: string | null,
  ): Promise<ResolvedSourcingImage> {
    const detectedMimeType = this.detectMimeType(inputBytes)
    if (!detectedMimeType) throw this.invalidImage('Workflow image bytes are not JPEG, PNG, or WebP.')
    if (declaredMimeType && declaredMimeType !== detectedMimeType) {
      throw this.invalidImage('Workflow image content type does not match its bytes.')
    }

    try {
      const metadata = await sharp(inputBytes, {
        failOn: 'error',
        limitInputPixels: MAX_SOURCE_IMAGE_PIXELS,
      }).metadata()
      if (
        !metadata.width
        || !metadata.height
        || metadata.width > MAX_SOURCE_IMAGE_EDGE
        || metadata.height > MAX_SOURCE_IMAGE_EDGE
        || metadata.width * metadata.height > MAX_SOURCE_IMAGE_PIXELS
      ) throw new Error('Unsafe image dimensions')
    } catch {
      throw this.invalidImage('Workflow image cannot be decoded.')
    }

    let bytes = inputBytes
    let outputMimeType: 'image/jpeg' | 'image/png' = detectedMimeType === 'image/png'
      ? 'image/png'
      : 'image/jpeg'
    if (detectedMimeType === 'image/webp' || inputBytes.length > MAX_PROVIDER_IMAGE_BYTES) {
      bytes = await sharp(inputBytes, {
        failOn: 'error',
        limitInputPixels: MAX_SOURCE_IMAGE_PIXELS,
      })
        .rotate()
        .resize({ width: 4_096, height: 4_096, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer()
      outputMimeType = 'image/jpeg'
    }
    if (bytes.length > MAX_PROVIDER_IMAGE_BYTES) {
      bytes = await sharp(inputBytes, {
        failOn: 'error',
        limitInputPixels: MAX_SOURCE_IMAGE_PIXELS,
      })
        .rotate()
        .resize({ width: 2_048, height: 2_048, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75, mozjpeg: true })
        .toBuffer()
      outputMimeType = 'image/jpeg'
    }
    if (bytes.length > MAX_PROVIDER_IMAGE_BYTES) {
      throw this.invalidImage('Normalized workflow image exceeds the 1688 upload limit.')
    }
    return {
      bytes,
      mimeType: outputMimeType,
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sourceType,
      sourceHost,
    }
  }

  private detectMimeType(bytes: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )) return 'image/png'
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg'
    }
    if (
      bytes.length >= 12
      && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    ) return 'image/webp'
    return null
  }

  private invalidRequest(message: string): SourcingImageException {
    return new SourcingImageException('INVALID_REQUEST', message, false)
  }

  private invalidImage(message: string): SourcingImageException {
    return new SourcingImageException('INVALID_IMAGE', message, false)
  }
}
