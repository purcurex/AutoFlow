/** Read only the committed classification. Never run source diagnostics from a list request. */
export function persistedExceptionDisplaySql(alias='hz_fop_collected_orders'):string {
 return `(${alias}.display || jsonb_build_object('exception',CASE WHEN ${alias}.is_exception THEN jsonb_build_object('type',${alias}.exception_type,'reason',${alias}.exception_reason,'code',${alias}.exception_code,'hours',NULL) ELSE NULL END))`
}
