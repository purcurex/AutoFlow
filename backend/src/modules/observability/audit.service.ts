import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { AuditEventEntity } from './audit-event.entity'

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditEventEntity)
    private readonly repository: Repository<AuditEventEntity>,
  ) {}

  record(event: Omit<AuditEventEntity, 'id' | 'actor' | 'createdAt'>): Promise<AuditEventEntity> {
    return this.repository.save(this.repository.create(event))
  }

  listForActor(actorUserId: string): Promise<AuditEventEntity[]> {
    return this.repository.find({
      where: { actorUserId },
      order: { createdAt: 'DESC' },
      take: 100,
    })
  }
}
