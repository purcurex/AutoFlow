import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddOrganizationSandbox1784730000000 implements MigrationInterface {
  name = 'AddOrganizationSandbox1784730000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE organization_nodes (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_id uuid,
        name varchar(100) NOT NULL,
        kind varchar(12) NOT NULL,
        sort_order integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_organization_nodes_owner_id UNIQUE (id, owner_user_id),
        CONSTRAINT fk_organization_nodes_parent FOREIGN KEY (parent_id, owner_user_id) REFERENCES organization_nodes(id, owner_user_id),
        CONSTRAINT chk_organization_nodes_kind CHECK ((kind = 'organization' AND parent_id IS NULL) OR (kind = 'department' AND parent_id IS NOT NULL)),
        CONSTRAINT chk_organization_nodes_name CHECK (char_length(name) BETWEEN 1 AND 100 AND name !~ '^[[:space:]]|[[:space:]]$'),
        CONSTRAINT chk_organization_nodes_order CHECK (sort_order BETWEEN 0 AND 99999)
      )
    `)
    await queryRunner.query('CREATE UNIQUE INDEX uq_organization_nodes_root ON organization_nodes(owner_user_id) WHERE parent_id IS NULL')
    await queryRunner.query('CREATE INDEX idx_organization_nodes_owner_parent ON organization_nodes(owner_user_id, parent_id)')
    await queryRunner.query(`
      CREATE TABLE organization_employees (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        department_id uuid NOT NULL,
        name varchar(100) NOT NULL,
        code varchar(40) NOT NULL,
        email varchar(160) NOT NULL,
        workbench_roles text[] NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_organization_employees_owner_code UNIQUE (owner_user_id, code),
        CONSTRAINT fk_organization_employees_department FOREIGN KEY (department_id, owner_user_id) REFERENCES organization_nodes(id, owner_user_id),
        CONSTRAINT chk_organization_employees_roles CHECK (workbench_roles <@ ARRAY['sales','procurement','allocation','dispatch','warehouse']::text[] AND cardinality(workbench_roles) <= 5)
      )
    `)
    await queryRunner.query('CREATE INDEX idx_organization_employees_owner_department ON organization_employees(owner_user_id, department_id)')
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE organization_employees')
    await queryRunner.query('DROP TABLE organization_nodes')
  }
}
