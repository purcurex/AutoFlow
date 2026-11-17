/** Collected reads use verified local directory bindings even while upstream sync is paused.
 * Offline proof is restricted to the selected account, employee, tenant, workspace and company.
 * An explicit disabled/conflicting binding is returned, so it cannot fall back to legacy identity.
 */
export const collectedOrganizationQuery = `SELECT e.id,e.department_id,e.account_id,e.name,
 e.directory_profile->>'englishName' AS english_name,e.archived_at,u.account_disabled,u.fop_tenant_id,u.fop_user_id,u.fop_binding_details,
 b.id AS binding_id,(b.enabled AND (
  (c.status='active' AND co.enabled AND coalesce(c.capabilities->>'offlineCollectedOnly','false')<>'true') OR
  (c.capabilities->>'offlineCollectedOnly'='true' AND b.evidence->>'source'='captured_employee_directory'
   AND b.evidence->>'workspaceOwnerId'=e.owner_user_id::text
   AND b.evidence->>'tenantId'=$2 AND b.evidence->>'companyId'=$3
   AND b.evidence->>'localEmployeeId'=e.id::text
   AND b.evidence->>'selectedFopUserId'=u.fop_user_id AND u.fop_tenant_id=$2)
 )) AS binding_enabled,b.state AS binding_state,b.employee_master_id,b.person_record_id,b.employee_number,b.directory_verified_at
 FROM organization_employees e LEFT JOIN users u ON u.id=e.account_id
 LEFT JOIN hz_fop_connections c ON c.workspace_owner_id=e.owner_user_id AND c.tenant_id=$2
  AND EXISTS(SELECT 1 FROM hz_fop_companies scoped WHERE scoped.connection_id=c.id AND scoped.source_company_id=$3)
 LEFT JOIN hz_fop_companies co ON co.connection_id=c.id AND co.source_company_id=$3
 LEFT JOIN hz_fop_employee_bindings b ON b.connection_id=c.id AND b.local_account_id=u.id
 WHERE e.owner_user_id=$1 ORDER BY e.id`
