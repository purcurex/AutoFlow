import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm'
import { LEAD_CONTACT_TYPES, type LeadContactType } from '../autoflow.types'
import { LeadEntity } from './lead.entity'

@Entity('lead_contacts')
@Unique('uq_lead_contacts_lead_type_value', ['leadId', 'type', 'value'])
@Index('idx_lead_contacts_lead_id', ['leadId'])
@Index('idx_lead_contacts_verified', ['verified'])
export class LeadContactEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId: string

  @Column({ type: 'enum', enum: LEAD_CONTACT_TYPES, enumName: 'autoflow_lead_contact_type_enum' })
  type: LeadContactType

  @Column({ length: 500 })
  value: string

  @Column({ type: 'varchar', length: 80, nullable: true })
  label: string | null

  @Column({ default: false })
  verified: boolean

  @Column({ name: 'is_primary', default: false })
  isPrimary: boolean

  @ManyToOne(() => LeadEntity, (lead) => lead.contacts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lead_id', foreignKeyConstraintName: 'fk_lead_contacts_lead' })
  lead: LeadEntity

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
