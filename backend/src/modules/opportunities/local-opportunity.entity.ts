import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm'
import { User } from '../users/user.entity'
import { LeadEntity } from '../autoflow/entities/lead.entity'

@Entity('local_opportunities')
@Index('uq_local_opportunities_active_lead',['sourceLeadId'],{unique:true,where:'deleted_at IS NULL AND source_lead_id IS NOT NULL'})
@Check('chk_local_opportunities_deletion','(deleted_at IS NULL)=(deleted_by IS NULL)')
@Check('chk_local_opportunities_status',"status='draft'")
@Check('chk_local_opportunities_amount',"monthly_amount>=0 AND monthly_amount<>'NaN'::numeric")
@Check('chk_local_opportunities_version','version>=1')
export class LocalOpportunityEntity {
  @PrimaryColumn('uuid') id:string
  @Column({type:'varchar',length:48,unique:true}) number:string
  @Column({name:'owner_user_id',type:'uuid'}) ownerUserId:string
  @Column({name:'source_lead_id',type:'uuid',nullable:true}) sourceLeadId:string|null
  @Column({type:'varchar',length:16,default:'draft'}) status:'draft'
  @Column({name:'customer_name',type:'varchar',length:160}) customerName:string
  @Column({type:'varchar',length:64,nullable:true}) stage:string|null
  @Column({name:'daily_volume',type:'varchar',length:16,nullable:true}) dailyVolume:string|null
  @Column({name:'monthly_amount',type:'numeric',precision:18,scale:2,nullable:true}) monthlyAmount:string|null
  @Column({type:'varchar',length:3,default:'USD'}) currency:'USD'
  @Column({name:'main_products',type:'varchar',length:4000,default:''}) mainProducts:string
  @Column({type:'varchar',length:2,default:''}) country:string
  @Column({type:'varchar',length:120,default:''}) city:string
  @Column({name:'business_scope',type:'varchar',length:4000,default:''}) businessScope:string
  @Column({type:'varchar',length:120,default:''}) whatsapp:string
  @Column({name:'store_url',type:'varchar',length:1000,default:''}) storeUrl:string
  @Column({name:'registered_on',type:'date',default:()=>"((now() AT TIME ZONE 'Asia/Shanghai')::date)"}) registeredOn:string
  @Column({name:'last_followed_on',type:'date',nullable:true}) lastFollowedOn:string|null
  @Column({name:'current_follow_up',type:'varchar',length:8000,default:''}) currentFollowUp:string
  @Column({name:'next_follow_up_plan',type:'varchar',length:8000,default:''}) nextFollowUpPlan:string
  @Column({name:'problem_feedback',type:'varchar',length:8000,default:''}) problemFeedback:string
  @Column({type:'integer',default:1}) version:number
  @Column({name:'created_by',type:'uuid'}) createdBy:string
  @Column({name:'updated_by',type:'uuid'}) updatedBy:string
  @CreateDateColumn({name:'created_at',type:'timestamptz'}) createdAt:Date
  @UpdateDateColumn({name:'updated_at',type:'timestamptz'}) updatedAt:Date
  @Column({name:'deleted_at',type:'timestamptz',nullable:true}) deletedAt:Date|null
  @Column({name:'deleted_by',type:'uuid',nullable:true}) deletedBy:string|null
  @ManyToOne(()=>User,{onDelete:'RESTRICT'}) @JoinColumn({name:'owner_user_id'}) owner:User
  @ManyToOne(()=>LeadEntity,{nullable:true,onDelete:'RESTRICT'}) @JoinColumn({name:'source_lead_id'}) sourceLead:LeadEntity|null
  @ManyToOne(()=>User,{onDelete:'RESTRICT'}) @JoinColumn({name:'created_by'}) creator:User
  @ManyToOne(()=>User,{onDelete:'RESTRICT'}) @JoinColumn({name:'updated_by'}) updater:User
  @ManyToOne(()=>User,{nullable:true,onDelete:'RESTRICT'}) @JoinColumn({name:'deleted_by'}) deleter:User|null
}
