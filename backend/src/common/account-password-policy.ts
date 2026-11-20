import { ValidateBy } from 'class-validator'

export const ACCOUNT_PASSWORD_MESSAGE = '密码至少6位，包含字母和数字，UTF-8长度不超过72字节'

/** Password creation/reset only. Do not apply complexity rules to existing logins. */
export function isValidAccountPassword(value: unknown): value is string {
  return typeof value === 'string' && Array.from(value).length >= 6
    && /[A-Za-z]/.test(value) && /[0-9]/.test(value)
    && Buffer.byteLength(value, 'utf8') <= 72
}

export function IsAccountPassword(): PropertyDecorator {
  return ValidateBy({ name: 'accountPassword', validator: { validate: isValidAccountPassword } }, { message: ACCOUNT_PASSWORD_MESSAGE })
}
