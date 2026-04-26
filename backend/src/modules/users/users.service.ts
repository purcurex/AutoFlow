import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import * as bcrypt from 'bcrypt'
import { User, UserRole } from './user.entity'

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async create(email: string, username: string, password: string, role: UserRole = UserRole.USER): Promise<User> {
    const hashedPassword = await bcrypt.hash(password, 10)
    const user = this.usersRepository.create({
      email,
      username,
      password: hashedPassword,
      role,
    })
    return this.usersRepository.save(user)
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find()
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } })
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } })
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { username } })
  }

  async findByRole(role: UserRole): Promise<User[]> {
    return this.usersRepository.find({ where: { role } })
  }

  async update(id: string, updateData: Partial<User>): Promise<User> {
    const user = await this.findById(id)
    if (!user) {
      throw new NotFoundException('用户不存在')
    }

    if (updateData.password) {
      updateData.password = await bcrypt.hash(updateData.password, 10)
    }

    Object.assign(user, updateData)
    return this.usersRepository.save(user)
  }

  async delete(id: string): Promise<void> {
    const user = await this.findById(id)
    if (!user) {
      throw new NotFoundException('用户不存在')
    }
    await this.usersRepository.remove(user)
  }

  async validatePassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, hashedPassword)
  }
}
