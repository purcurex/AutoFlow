import { Alibaba1688Exception } from '../alibaba1688'
import { SourcingImageException } from './sourcing-image-resolver.service'
import type {
  SourcingExecutionErrorCode,
  SourcingExecutionFailure,
} from './sourcing.types'

const SAFE_MESSAGES: Record<SourcingExecutionErrorCode, string> = {
  NOT_CONFIGURED: 'Alibaba 1688 is not configured.',
  AUTHENTICATION_FAILED: 'Alibaba 1688 authorization is invalid or expired.',
  PERMISSION_DENIED: 'Alibaba 1688 API permission is unavailable.',
  RATE_LIMITED: 'Alibaba 1688 request limit was reached.',
  PROVIDER_TIMEOUT: 'Alibaba 1688 request timed out.',
  PROVIDER_UNAVAILABLE: 'Alibaba 1688 provider is temporarily unavailable.',
  INVALID_IMAGE: 'The sourcing image is invalid or unavailable.',
  INVALID_REQUEST: 'The sourcing request is invalid.',
  INVALID_RESPONSE: 'Alibaba 1688 returned an invalid response.',
}

/** 将适配器、图片解析器及结构化执行错误归一化为固定且脱敏的重试决策。 */
export function normalizeSourcingExecutionError(error: unknown): SourcingExecutionFailure {
  if (error instanceof SourcingImageException) {
    return failure(error.code, error.retryable)
  }
  if (error instanceof Alibaba1688Exception) {
    const code = mapAlibabaCode(error.normalized.code)
    return failure(code, error.normalized.retryable)
  }
  if (isStructuredFailure(error)) {
    return failure(error.code, error.retryable, error.retryAfterMs)
  }
  return failure('INVALID_RESPONSE', false)
}

function mapAlibabaCode(code: Alibaba1688Exception['normalized']['code']): SourcingExecutionErrorCode {
  if (code === 'TIMEOUT') return 'PROVIDER_TIMEOUT'
  if (code === 'NETWORK_ERROR') return 'PROVIDER_UNAVAILABLE'
  if (code === 'PROVIDER_REJECTED') return 'INVALID_RESPONSE'
  return code
}

function failure(
  code: SourcingExecutionErrorCode,
  retryable: boolean,
  retryAfterMs: number | null = null,
): SourcingExecutionFailure {
  return { code, message: SAFE_MESSAGES[code], retryable, retryAfterMs }
}

function isStructuredFailure(error: unknown): error is {
  code: SourcingExecutionErrorCode
  retryable: boolean
  retryAfterMs?: number | null
} {
  if (!error || typeof error !== 'object') return false
  const candidate = error as Record<string, unknown>
  return typeof candidate.code === 'string'
    && Object.prototype.hasOwnProperty.call(SAFE_MESSAGES, candidate.code)
    && typeof candidate.retryable === 'boolean'
}
