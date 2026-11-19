import { MigrationInterface, QueryRunner } from 'typeorm'

export class LocalOpportunities1795061000000 implements MigrationInterface {
  name='LocalOpportunities1795061000000'
  async up(queryRunner:QueryRunner):Promise<void> {
    await queryRunner.query(`CREATE TABLE local_opportunities (
      id uuid PRIMARY KEY, number varchar(48) NOT NULL UNIQUE,
      owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      source_lead_id uuid NULL REFERENCES leads(id) ON DELETE RESTRICT,
      status varchar(16) NOT NULL DEFAULT 'draft' CHECK (status='draft'),
      customer_name varchar(160) NOT NULL CHECK (length(btrim(customer_name))>0),
      stage varchar(64) NULL CHECK (stage IN ('a_a_intentional_cooperation','f_non-viable_lead','a_Place_an_order','b_related_stores','c_registration_platform','d_business_opportunity_conflict','e_terminate_cooperation')),
      daily_volume varchar(16) NULL CHECK (daily_volume IN ('ten','twenty','fifty','more')),
      monthly_amount numeric(18,2) NULL CHECK (monthly_amount>=0 AND monthly_amount<>'NaN'::numeric), currency varchar(3) NOT NULL DEFAULT 'USD' CHECK (currency='USD'),
      main_products varchar(4000) NOT NULL DEFAULT '', country varchar(2) NOT NULL DEFAULT '' CHECK (country='' OR country~'^[A-Z]{2}$'), city varchar(120) NOT NULL DEFAULT '',
      business_scope varchar(4000) NOT NULL DEFAULT '', whatsapp varchar(120) NOT NULL DEFAULT '', store_url varchar(1000) NOT NULL DEFAULT '' CHECK(store_url='' OR store_url~*'^https?://'),
      registered_on date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Shanghai')::date), last_followed_on date NULL,
      current_follow_up varchar(8000) NOT NULL DEFAULT '', next_follow_up_plan varchar(8000) NOT NULL DEFAULT '', problem_feedback varchar(8000) NOT NULL DEFAULT '',
      version integer NOT NULL DEFAULT 1 CHECK (version>=1),
      created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz NULL, deleted_by uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT chk_local_opportunities_deletion CHECK ((deleted_at IS NULL)=(deleted_by IS NULL))
    )`)
    await queryRunner.query('CREATE UNIQUE INDEX uq_local_opportunities_active_lead ON local_opportunities(source_lead_id) WHERE deleted_at IS NULL AND source_lead_id IS NOT NULL')
    await queryRunner.query('CREATE INDEX idx_local_opportunities_owner_date ON local_opportunities(owner_user_id,registered_on DESC,created_at DESC) WHERE deleted_at IS NULL')
    await queryRunner.query(`CREATE TABLE local_opportunity_follow_ups (
      id uuid PRIMARY KEY, opportunity_id uuid NOT NULL REFERENCES local_opportunities(id) ON DELETE RESTRICT,
      followed_on date NOT NULL,
      stage varchar(64) NOT NULL CHECK (stage IN ('a_a_intentional_cooperation','f_non-viable_lead','a_Place_an_order','b_related_stores','c_registration_platform','d_business_opportunity_conflict','e_terminate_cooperation')),
      daily_volume varchar(16) NOT NULL CHECK (daily_volume IN ('ten','twenty','fifty','more')),
      monthly_amount numeric(18,2) NOT NULL CHECK (monthly_amount>=0 AND monthly_amount<>'NaN'::numeric),
      current_follow_up varchar(8000) NOT NULL CHECK (length(btrim(current_follow_up))>0),
      next_follow_up_plan varchar(8000) NOT NULL CHECK (length(btrim(next_follow_up_plan))>0), problem_feedback varchar(8000) NOT NULL DEFAULT '',
      created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now()
    )`)
    await queryRunner.query('CREATE INDEX idx_local_opportunity_follow_ups_parent_date ON local_opportunity_follow_ups(opportunity_id,followed_on DESC,created_at DESC)')
  }
  async down(queryRunner:QueryRunner):Promise<void> {
    await queryRunner.query('DROP TABLE local_opportunity_follow_ups')
    await queryRunner.query('DROP TABLE local_opportunities')
  }
}
