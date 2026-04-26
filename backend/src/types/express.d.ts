import { Request } from 'express'
import { UserRole } from '../modules/users/user.entity'

declare module 'express' {
  interface Request {
    user?: {
      userId: string
      email: string
      role: UserRole
    }
  }
}
