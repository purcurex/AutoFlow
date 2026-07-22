import { ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { VerificationService } from './verification.service'

describe('VerificationService', () => {
  it('stores a hashed code and accepts it once in development', async () => {
    const service = new VerificationService(new ConfigService({ NODE_ENV: 'development' }))
    jest.spyOn(service, 'generateCode').mockReturnValue('123456')

    const response = await service.sendVerificationCode('Sales@AutoFlow.Local')

    expect(response.message).toContain('123456')
    expect(service.verifyCode('sales@autoflow.local', '123456').valid).toBe(true)
    expect(service.verifyCode('sales@autoflow.local', '123456').valid).toBe(false)
  })

  it('invalidates a code after five failed attempts', async () => {
    const service = new VerificationService(new ConfigService({ NODE_ENV: 'development' }))
    jest.spyOn(service, 'generateCode').mockReturnValue('123456')
    await service.sendVerificationCode('sales@autoflow.local')

    for (let attempt = 0; attempt < 5; attempt += 1) {
      service.verifyCode('sales@autoflow.local', '000000')
    }

    expect(service.verifyCode('sales@autoflow.local', '123456').valid).toBe(false)
  })

  it('fails closed when SMTP is missing in production', async () => {
    const service = new VerificationService(new ConfigService({ NODE_ENV: 'production' }))

    await expect(service.sendVerificationCode('sales@autoflow.local')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })
})
