import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm'
import { User } from '../users/user.entity'
import { LocalOpportunityEntity } from './local-opportunity.entity'

@Entity('local_opportunity_follow_ups')
@Check('chk_local_opportunity_follow_up_amount',"monthly_amount>=0 AND monthly_amount<>'NaN'::numeric")
export class LocalOpportunityFollowUpEntity {
  @PrimaryColumn('uuid') id:string
  @Column({name:'opportunity_id',type:'uuid'}) opportunityId:string
  @Column({name:'followed_on',type:'date'}) followedOn:string
  @Column({type:'varchar',length:64}) stage:string
  @Column({name:'daily_volume',type:'varchar',length:16}) dailyVolume:string
  @Column({name:'monthly_amount',type:'numeric',precision:18,scale:2}) monthlyAmount:string
  @Column({name:'current_follow_up',type:'varchar',length:8000}) currentFollowUp:string
  @Column({name:'next_follow_up_plan',type:'varchar',length:8000}) nextFollowUpPlan:string
  @Column({name:'problem_feedback',type:'varchar',length:8000,default:''}) problemFeedback:string
  @Column({name:'created_by',type:'uuid'}) createdBy:string
  @CreateDateColumn({name:'created_at',type:'timestamptz'}) createdAt:Date
  @ManyToOne(()=>LocalOpportunityEntity,{onDelete:'RESTRICT'}) @JoinColumn({name:'opportunity_id'}) opportunity:LocalOpportunityEntity
  @ManyToOne(()=>User,{onDelete:'RESTRICT'}) @JoinColumn({name:'created_by'}) creator:User
}
