import { UserRole } from '../modules/users/user.entity'

declare module 'express' {
  interface Request {
    user?: {
      userId: string
      email: string
      role: UserRole
      businessRole?: import('../modules/users/business-scope').BusinessRole
    }
  }
}
