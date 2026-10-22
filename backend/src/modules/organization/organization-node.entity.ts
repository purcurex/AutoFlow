import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm'
import { User } from '../users/user.entity'

@Entity('organization_nodes')
@Unique('uq_organization_nodes_owner_id', ['id', 'ownerUserId'])
@Index('uq_organization_nodes_root', ['ownerUserId'], { unique: true, where: 'parent_id IS NULL' })
@Index('idx_organization_nodes_owner_parent', ['ownerUserId', 'parentId'])
@Check('chk_organization_nodes_kind', "(kind = 'organization' AND parent_id IS NULL) OR (kind = 'department' AND parent_id IS NOT NULL)")
@Check('chk_organization_nodes_name', "char_length(name) BETWEEN 1 AND 100 AND name !~ '^[[:space:]]|[[:space:]]$'")
@Check('chk_organization_nodes_order', 'sort_order BETWEEN 0 AND 99999')
export class OrganizationNodeEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column({ name: 'owner_user_id', type: 'uuid' }) ownerUserId: string
  @Column({ name: 'parent_id', type: 'uuid', nullable: true }) parentId: string | null
  @Column({ type: 'varchar', length: 100 }) name: string
  @Column({ type: 'varchar', length: 12 }) kind: 'organization' | 'department'
  @Column({ name: 'sort_order', type: 'integer', default: 0 }) sortOrder: number
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_user_id' }) owner: User

  @ManyToOne(() => OrganizationNodeEntity)
  @JoinColumn([{ name: 'parent_id', referencedColumnName: 'id' }, { name: 'owner_user_id', referencedColumnName: 'ownerUserId' }])
  parent: OrganizationNodeEntity | null
}
