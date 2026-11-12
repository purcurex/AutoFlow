import type { MigrationInterface, QueryRunner } from 'typeorm'

/** Local account removal only. Does not mutate the remote FOP personnel directory. */
export class RemoveDepartedRuth1794398400000 implements MigrationInterface {
  name = 'RemoveDepartedRuth1794398400000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const email = 'ruth@hzdrop.com'
    const accounts: { id: string; role: string }[] = await queryRunner.query(
      'SELECT id, role FROM public.users WHERE lower(email) = $1 FOR UPDATE', [email],
    )
    const employees: { id: string; name: string; account_id: string | null }[] = await queryRunner.query(
      'SELECT id, name, account_id FROM public.organization_employees WHERE lower(email) = $1 OR account_id = ANY($2::uuid[]) FOR UPDATE',
      [email, accounts.map(account => account.id)],
    )
    if (accounts.some(account => account.role === 'admin') || employees.some(employee =>
      !/^曹可滢(?:[（(]Ruth[）)])?$/i.test(employee.name.trim()) ||
      (employee.account_id && !accounts.some(account => account.id === employee.account_id)))) {
      throw new Error('Departed Ruth identity mismatch; no account data has been removed')
    }
    const accountIds = accounts.map(account => account.id)
    // Business FK restrictions remain in force: unexpected business ownership aborts the migration.
    await queryRunner.query('DELETE FROM public.hz_fop_employee_bindings WHERE local_account_id = ANY($1::uuid[])', [accountIds])
    await queryRunner.query('DELETE FROM public.notes WHERE user_id = ANY($1::uuid[])', [accountIds])
    await queryRunner.query('DELETE FROM public.folders WHERE user_id = ANY($1::uuid[])', [accountIds])
    await queryRunner.query('DELETE FROM public.organization_employees WHERE id = ANY($1::uuid[])', [employees.map(employee => employee.id)])
    await queryRunner.query('DELETE FROM public.users WHERE id = ANY($1::uuid[])', [accountIds])
  }

  async down(): Promise<void> {
    throw new Error('Account deletion is irreversible; restore an authorized database backup if required')
  }
}
