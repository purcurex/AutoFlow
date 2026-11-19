import type { MigrationInterface, QueryRunner } from 'typeorm'
export class LeadRegistration1795060000000 implements MigrationInterface {
 name = 'LeadRegistration1795060000000'
 async up(q: QueryRunner) {
  await q.query(`ALTER TABLE leads ADD COLUMN lead_type varchar(24) NOT NULL DEFAULT 'automatic', ADD COLUMN registered_on date NOT NULL DEFAULT CURRENT_DATE, ADD COLUMN contacted_on date, ADD COLUMN city varchar(120) NOT NULL DEFAULT '', ADD COLUMN current_follow_up text NOT NULL DEFAULT '', ADD COLUMN next_follow_up_plan text NOT NULL DEFAULT '', ADD COLUMN registrar_user_id uuid REFERENCES users(id) ON DELETE RESTRICT, ADD CONSTRAINT chk_lead_type CHECK (lead_type IN ('manual','import','automatic'))`)
  await q.query(`UPDATE leads SET registered_on=(created_at AT TIME ZONE 'Asia/Shanghai')::date, registrar_user_id=owner_user_id`)
  await q.query(`CREATE INDEX idx_leads_owner_type_registered ON leads(owner_user_id,lead_type,registered_on DESC)`)
  await q.query(`CREATE FUNCTION hz_lead_origin_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.lead_type IS DISTINCT FROM OLD.lead_type OR NEW.registrar_user_id IS DISTINCT FROM OLD.registrar_user_id THEN RAISE EXCEPTION 'Lead origin is immutable'; END IF; RETURN NEW; END $$`)
  await q.query(`CREATE TRIGGER lead_origin_immutable BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION hz_lead_origin_immutable()`)
 }
 async down(q: QueryRunner) {
  await q.query('DROP TRIGGER lead_origin_immutable ON leads; DROP FUNCTION hz_lead_origin_immutable(); DROP INDEX idx_leads_owner_type_registered; ALTER TABLE leads DROP COLUMN lead_type, DROP COLUMN registered_on, DROP COLUMN contacted_on, DROP COLUMN city, DROP COLUMN current_follow_up, DROP COLUMN next_follow_up_plan, DROP COLUMN registrar_user_id')
 }
}
