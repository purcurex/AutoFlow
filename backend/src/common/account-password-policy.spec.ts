import { validateSync } from 'class-validator'
import { LoginDto, RegisterDto } from '../modules/auth/dto/auth.dto'
import { CreateEmployeeAccountDto, UpdateEmployeeAccountDto } from '../modules/organization/organization.dto'
import { validateEnvironment } from '../config/environment'

const accepted = ['abc123', 'ABC123', '12345a', 'abc12!', ' a123 ', 'a1' + 'x'.repeat(70), 'a1中' + 'x'.repeat(67)]
const rejected: unknown[] = ['', 'ab123', 'abcdefghijk', '123456789012', 'a1' + 'x'.repeat(71), 'a1中' + 'x'.repeat(68), null, 123456]

describe('account password policy at write boundaries', () => {
  for (const Dto of [RegisterDto, CreateEmployeeAccountDto, UpdateEmployeeAccountDto]) {
    const errors = (password: unknown) => validateSync(Object.assign(new Dto(), { password })).filter(error => error.property === 'password')
    it(`${Dto.name} accepts six characters with letters and digits, up to 72 UTF-8 bytes`, () => {
      for (const password of accepted) expect(errors(password)).toEqual([])
    })
    it(`${Dto.name} rejects missing letters/digits, short values and excess bytes`, () => {
      for (const password of rejected) expect(errors(password).length).toBeGreaterThan(0)
    })
  }
  it('applies the same policy to administrator bootstrap', () => {
    const config = (password: unknown) => ({ ENABLE_ADMIN_BOOTSTRAP: 'true', ADMIN_BOOTSTRAP_EMAIL: 'test@example.invalid', ADMIN_BOOTSTRAP_PASSWORD: password })
    for (const password of accepted) expect(() => validateEnvironment(config(password))).not.toThrow()
    for (const password of rejected) expect(() => validateEnvironment(config(password))).toThrow('ADMIN_BOOTSTRAP_PASSWORD')
  })
  it('allows an omitted reset password and preserves legacy login credentials', () => {
    expect(validateSync(new UpdateEmployeeAccountDto()).filter(error => error.property === 'password')).toEqual([])
    expect(validateSync(Object.assign(new LoginDto(), { email: 'test@example.invalid', password: 'legacy' }))).toEqual([])
  })
})
