import type { MigrationInterface, QueryRunner } from 'typeorm'

/** Versioned policy change; do not edit the V1.2 creation migration. Does not enable FOP. */
export class WorkbenchDemandSyncPolicy1794402000000 implements MigrationInterface {
  name = 'WorkbenchDemandSyncPolicy1794402000000'
  async up(q: QueryRunner): Promise<void> {
    const policy = { timezone: 'Asia/Shanghai', calendar: 'daily', morning_at: '08:30',
      business_window: { start: '09:00', end: '18:30', end_inclusive: true, interval_minutes: 30 },
      off_hours: { interval_minutes: 120, anchor: '18:30', slots: ['20:30','22:30','00:30','02:30','04:30','06:30'] },
      scope: 'all_authorized_companies_and_resources_changes', sync_on_page_open: true,
      navigation: { after_local_load: true, min_interval_seconds: 60, coalesce_across_users: true, filters_trigger_sync: false },
      manual: { mode: 'incremental', include_membership_removals: true, capture_request_barrier: true }, status: 'configured_not_enabled' }
    const json = JSON.stringify(policy).replace(/'/g, "''")
    await q.query(`ALTER TABLE public.hz_fop_connections ALTER COLUMN sync_schedule SET DEFAULT '${json}'::jsonb`)
    await q.query(`UPDATE public.hz_fop_connections SET sync_schedule=sync_schedule || '${json}'::jsonb,updated_at=now()`)
    await q.query(`COMMENT ON COLUMN public.hz_fop_connections.sync_schedule IS 'V2.2策略：先查本地；进入/切换清单按需增量，60秒节流及跨用户合并；08:30、工作时段每30分钟、非工作时段每2小时兜底。配置不启用真实FOP，暂停规则优先。'`)
    await q.query('ALTER TABLE public.hz_fop_sync_runs DROP CONSTRAINT ck_hz_fop_sync_runs_trigger_type')
    await q.query("ALTER TABLE public.hz_fop_sync_runs ADD CONSTRAINT ck_hz_fop_sync_runs_trigger_type CHECK (trigger_type IN ('bootstrap','scheduled_morning','scheduled_business','scheduled_off_hours','manual','navigation','notification','reconcile','post_action'))")
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query("UPDATE public.hz_fop_sync_runs SET trigger_type='manual' WHERE trigger_type='navigation'")
    await q.query('ALTER TABLE public.hz_fop_sync_runs DROP CONSTRAINT ck_hz_fop_sync_runs_trigger_type')
    await q.query("ALTER TABLE public.hz_fop_sync_runs ADD CONSTRAINT ck_hz_fop_sync_runs_trigger_type CHECK (trigger_type IN ('bootstrap','scheduled_morning','scheduled_business','scheduled_off_hours','manual','notification','reconcile','post_action'))")
    // Restore the exact historical default, including comments, from the immutable schema snapshot.
    const { WORKBENCH_UP_SQL } = await import('../workbench-schema.sql')
    const old = WORKBENCH_UP_SQL.match(/"sync_schedule" jsonb NOT NULL DEFAULT ('[^\n]+')::jsonb/)![1]
    await q.query(`ALTER TABLE public.hz_fop_connections ALTER COLUMN sync_schedule SET DEFAULT ${old}::jsonb`)
    await q.query(`UPDATE public.hz_fop_connections SET sync_schedule=${old}::jsonb,updated_at=now()`)
    await q.query(WORKBENCH_UP_SQL.match(/COMMENT ON COLUMN "public"\."hz_fop_connections"\."sync_schedule" IS '[^\n]+';/)![0])
  }
}
