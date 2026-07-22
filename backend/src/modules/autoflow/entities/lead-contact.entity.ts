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
import type { ContactVerificationStatus } from '../../discovery/discovery.types'

@Entity('lead_contacts')
@Unique('uq_lead_contacts_lead_type_value', ['leadId', 'type', 'value'])
@Index('idx_lead_contacts_lead_id', ['leadId'])
@Index('idx_lead_contacts_verified', ['verified'])
@Index('idx_lead_contacts_verification_status', ['verificationStatus'])
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

  @Column({ name: 'source_url', type: 'varchar', length: 1000, nullable: true })
  sourceUrl: string | null

  @Column({ name: 'source_type', type: 'varchar', length: 80, default: 'manual' })
  sourceType: string

  @Column({ name: 'verification_status', type: 'varchar', length: 24, default: 'unverified' })
  verificationStatus: ContactVerificationStatus

  @Column({ type: 'integer', default: 0 })
  confidence: number

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  evidence: Record<string, unknown>

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
