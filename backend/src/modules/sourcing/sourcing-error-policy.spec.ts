import { Alibaba1688Exception } from '../alibaba1688'
import { SourcingImageException } from './sourcing-image-resolver.service'
import { normalizeSourcingExecutionError } from './sourcing-error-policy'

describe('normalizeSourcingExecutionError', () => {
  it('does not retry authentication, permission, or invalid image failures', () => {
    const authentication = new Alibaba1688Exception({
      provider: 'alibaba_1688',
      code: 'AUTHENTICATION_FAILED',
      message: 'expired',
      retryable: false,
      httpStatus: 401,
      providerCode: 'INVALID_TOKEN',
      requestId: null,
    })
    expect(normalizeSourcingExecutionError(authentication)).toMatchObject({
      code: 'AUTHENTICATION_FAILED', retryable: false,
    })
    expect(normalizeSourcingExecutionError(
      new SourcingImageException('INVALID_IMAGE', 'invalid bytes', false),
    )).toMatchObject({ code: 'INVALID_IMAGE', retryable: false })
  })

  it('retries timeout, rate-limit, and temporary provider failures', () => {
    const timeout = new Alibaba1688Exception({
      provider: 'alibaba_1688',
      code: 'TIMEOUT',
      message: 'timeout',
      retryable: true,
      httpStatus: null,
      providerCode: null,
      requestId: null,
    })
    expect(normalizeSourcingExecutionError(timeout)).toMatchObject({
      code: 'PROVIDER_TIMEOUT', retryable: true,
    })
  })
})
