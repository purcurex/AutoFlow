import { ServiceUnavailableException } from '@nestjs/common'
import type { Alibaba1688NormalizedError } from './alibaba1688.types'

export class Alibaba1688Exception extends ServiceUnavailableException {
  readonly normalized: Alibaba1688NormalizedError

  constructor(normalized: Alibaba1688NormalizedError) {
    super(normalized)
    this.normalized = normalized
  }
}
