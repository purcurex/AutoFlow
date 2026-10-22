import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { User } from '../users/user.entity'
import { OrganizationNodeEntity } from './organization-node.entity'
import { OrganizationEmployeeEntity } from './organization-employee.entity'
import { OrganizationController } from './organization.controller'
import { OrganizationService } from './organization.service'

@Module({
  imports: [TypeOrmModule.forFeature([User, OrganizationNodeEntity, OrganizationEmployeeEntity])],
  controllers: [OrganizationController],
  providers: [OrganizationService],
  exports: [OrganizationService],
})
export class OrganizationModule {}
