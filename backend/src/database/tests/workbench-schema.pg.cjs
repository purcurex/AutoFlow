/* Run from work-app: node backend/src/database/tests/workbench-schema.pg.cjs
 * Migration execution is restricted to a disposable hz_ddl_validation_<id> DB.
 * Catalog assertions catch missing/incorrect columns, defaults, keys and comments;
 * write probes (rolled back) catch broken tenant isolation and state constraints.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { Client } = require('pg')

const root = path.resolve(__dirname, '../../../..')
const design = JSON.parse(fs.readFileSync(path.join(root, 'docs/designs/workbench-database/schema-design.json'), 'utf8'))
const database = process.env.WORKBENCH_VALIDATION_DATABASE || 'hz_ddl_validation_1794392169018'
assert.match(database, /^hz_ddl_validation_\d+$/, 'Refuse to write to a business database')
const connectionOptions = {
  host: '127.0.0.1', port: 55432, user: 'autoflow_demo', database,
  password: fs.readFileSync(path.join(root, '.runtime/local-demo/database-password'), 'utf8').trim(),
}
const client = new Client(connectionOptions)

async function expectSqlState(statement, values, code) {
  await client.query('SAVEPOINT expected_rejection')
  let observed
  try { await client.query(statement, values); await client.query('SET CONSTRAINTS ALL IMMEDIATE') }
  catch (error) { observed = error.code }
  await client.query('ROLLBACK TO SAVEPOINT expected_rejection')
  assert.equal(observed, code, `Expected SQLSTATE ${code}: ${statement}`)
}

async function validateCatalog() {
  const tableNames = design.tables.map(table => table.name)
  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1)", [tableNames])
  assert.equal(tables.rowCount, 61, 'All 61 approved Scheme A tables must exist')
  let columnCount = 0
  let fkCount = 0
  let uniqueCount = 0
  let indexCount = 0
  for (const table of design.tables) {
    const columns = await client.query(`SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull AS not_null, pg_get_expr(d.adbin,d.adrelid) AS default_sql,
      col_description(a.attrelid,a.attnum) AS comment
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [table.name])
    assert.equal(columns.rowCount, table.fields.length, `${table.name}: exact column count`)
    columnCount += columns.rowCount
    for (let i = 0; i < table.fields.length; i++) {
      const field = table.fields[i], actual = columns.rows[i]
      assert.equal(actual.attname, field.name, `${table.name}: field order/name`)
      const type = field.type.replace(/^varchar/, 'character varying').replace('timestamptz', 'timestamp with time zone')
      assert.equal(actual.type, type, `${table.name}.${field.name}: type/precision`)
      assert.equal(actual.not_null, !field.nullable, `${table.name}.${field.name}: nullability`)
      assert.ok(actual.comment?.includes(field.label), `${table.name}.${field.name}: Chinese dictionary comment`)
      if (field.default === null) assert.equal(actual.default_sql, null, `${table.name}.${field.name}: preserve unknown defaults`)
      else if (field.default === 'now()') assert.match(actual.default_sql, /^now\(\)$/, `${table.name}.${field.name}: transaction timestamp default`)
      else {
        assert.ok(actual.default_sql, `${table.name}.${field.name}: missing default`)
        const value = field.type === 'jsonb' ? JSON.parse(field.default) : field.default
        const expected = field.type === 'jsonb' ? JSON.stringify(value) : value
        const equality = await client.query(`SELECT (${actual.default_sql}) IS NOT DISTINCT FROM $1::${field.type} AS matches`, [expected])
        assert.equal(equality.rows[0].matches, true, `${table.name}.${field.name}: default value`)
      }
    }
    const constraints = (await client.query(`SELECT con.contype, con.condeferrable, con.condeferred,
      con.confdeltype, target.relname AS target, pg_get_expr(con.conbin,con.conrelid) AS check_sql,
      ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(num,ord)
        JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.num ORDER BY k.ord) AS columns,
      ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(num,ord)
        JOIN pg_attribute a ON a.attrelid=con.confrelid AND a.attnum=k.num ORDER BY k.ord) AS target_columns
      FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_class target ON target.oid=con.confrelid
      WHERE n.nspname='public' AND c.relname=$1`, [table.name])).rows
    assert.deepEqual(constraints.filter(c => c.contype === 'p').map(c => c.columns), [table.primary_key], `${table.name}: PK`)
    // Assertions come from the approved dictionary, independently of the generator.
    for (const field of table.fields) {
      const firstClause = (field.rule || '').split('；')[0].replace(/^选项：/, '').trim()
      const enumValues = /^[a-z_]+(?:\s*,\s*[a-z_]+)+$/.test(firstClause) ? firstClause.split(',').map(value => value.trim()) : []
      const fixed = /^CHECK entity_code = ([a-z_]+)$/.exec(field.rule || '')
      if (!enumValues.length && !fixed) continue
      const check = constraints.find(c => c.contype === 'c' && JSON.stringify(c.columns) === JSON.stringify([field.name]))
      assert.ok(check, `${table.name}.${field.name}: enum/fixed-entity CHECK`)
      for (const value of [...(fixed ? [fixed[1]] : enumValues), '__invalid_value__']) {
        const result = await client.query(`SELECT ${check.check_sql} AS valid FROM (SELECT $1::${field.type} AS "${field.name}") candidate`, [value])
        assert.equal(result.rows[0].valid, value !== '__invalid_value__', `${table.name}.${field.name}: ${value}`)
      }
    }
    const actualFks = constraints.filter(c => c.contype === 'f')
    assert.equal(actualFks.length, table.foreign_keys.length, `${table.name}: FK count`)
    fkCount += actualFks.length
    for (const expected of table.foreign_keys) {
      const actual = actualFks.find(c => JSON.stringify(c.columns) === JSON.stringify(expected.columns)
        && c.target === expected.target_table && JSON.stringify(c.target_columns) === JSON.stringify(expected.target_columns))
      assert.ok(actual, `${table.name}: missing FK ${expected.columns} -> ${expected.target_table}.${expected.target_columns}`)
      assert.equal(actual.condeferrable, expected.deferrable, `${table.name}: FK deferrability`)
      assert.equal(actual.condeferred, false, `${table.name}: FK initially immediate`)
      assert.equal(actual.confdeltype, { RESTRICT: 'r', CASCADE: 'c', 'SET NULL': 'n', 'NO ACTION': 'a' }[expected.on_delete], `${table.name}: delete rule`)
    }
    const indexes = (await client.query(`SELECT i.indisunique, i.indisprimary, pg_get_indexdef(i.indexrelid) AS definition,
      pg_get_expr(i.indpred,i.indrelid) AS predicate FROM pg_index i WHERE i.indrelid=$1::regclass`, [`public.${table.name}`])).rows
    const uniques = [...new Set(table.unique)]
    assert.equal(indexes.filter(i => i.indisunique && !i.indisprimary).length, uniques.length, `${table.name}: deduplicated unique indexes`)
    assert.equal(indexes.filter(i => !i.indisunique).length, [...new Set(table.indexes)].length, `${table.name}: query indexes`)
    const canonicalIndex = definition => definition.toLowerCase()
      .replace(/::(?:character varying|text)(?:\[\])?/g, '')
      .replace(/[\s"'()]/g, '').replace(/=anyarray\[([^\]]*)\]/g, 'in$1')
    for (const [specs, unique] of [[uniques, true], [[...new Set(table.indexes)], false]]) {
      const actual = indexes.filter(index => !index.indisprimary && index.indisunique === unique)
        .map(index => canonicalIndex(index.definition.split(' USING btree ')[1])).sort()
      assert.deepEqual(actual, specs.map(canonicalIndex).sort(), `${table.name}: exact index keys, expressions, sort/null order and predicates`)
    }
    uniqueCount += uniques.length
    indexCount += table.indexes.length
    const comment = (await client.query('SELECT obj_description($1::regclass) AS comment', [`public.${table.name}`])).rows[0].comment
    assert.ok(comment?.includes(table.label), `${table.name}: table comment`)
  }
  assert.equal(columnCount, 948, 'Approved field count')
  assert.equal(fkCount, 252, 'Approved FK count')
  return { tables: 61, columns: columnCount, foreignKeys: fkCount, uniqueIndexes: uniqueCount, queryIndexes: indexCount }
}

async function validateBehavior() {
  await client.query('BEGIN')
  try {
    await client.query("SET LOCAL search_path = ''")
    const chart = { chartId: 'order_volume', visibility: 'inherit', dataScope: 'none', summaryMode: 'none', summaryDepartments: [], details: 'inherit', export: 'inherit' }
    for (const [value, expected] of [
      [[], true], [{}, false], [[{ chartId: 'sales', dataScope: 'bogus' }], false],
      [[chart], true], [[{ ...chart, dataScope: 'self' }], true], [[{ ...chart, summaryMode: 'selected' }], false],
    ]) {
      const result = await client.query('SELECT public.autoflow_valid_chart_permissions($1::jsonb) AS valid', [JSON.stringify(value)])
      assert.equal(result.rows[0].valid, expected, 'Chart validator works under pg_restore empty search_path')
    }
    await client.query('SET LOCAL search_path = public')
    const user = (await client.query('SELECT id FROM users ORDER BY id LIMIT 1')).rows[0]
    assert.ok(user, 'Restored validation database must contain a local account')
    const connection = randomUUID(), company = randomUUID(), company2 = randomUUID(), dataset = randomUUID(), dataset2 = randomUUID()
    await client.query(`INSERT INTO hz_fop_connections (id,workspace_owner_id,name,environment,tenant_id,base_url,credential_ref)
      VALUES ($1,$2,'DDL validation','test','validation','https://example.invalid','validation-only')`, [connection,user.id])
    await expectSqlState('UPDATE hz_fop_connections SET environment=$1 WHERE id=$2', ['staging',connection], '23514')
    for (const [id, source] of [[company,'one'],[company2,'two']])
      await client.query('INSERT INTO hz_fop_companies (id,connection_id,source_company_id,company_number,name) VALUES ($1,$2,$3,$3,$3)', [id,connection,source])
    for (const [id, companyId] of [[dataset,company],[dataset2,company2]])
      await client.query('INSERT INTO hz_fop_datasets (id,connection_id,company_id) VALUES ($1,$2,$3)', [id,connection,companyId])
    await expectSqlState('UPDATE hz_fop_companies SET active_dataset_id=$1 WHERE id=$2', [dataset2,company], '23503')
    await client.query("UPDATE hz_fop_datasets SET state='active' WHERE id=$1", [dataset])
    await expectSqlState(`INSERT INTO hz_fop_datasets (id,connection_id,company_id,state) VALUES ($1,$2,$3,'active')`, [randomUUID(),connection,company], '23505')
    await client.query(`INSERT INTO hz_fop_datasets (id,connection_id,company_id,state) VALUES ($1,$2,$3,'retired')`, [randomUUID(),connection,company])
    const document = randomUUID(), document2 = randomUUID(), line = randomUUID(), line2 = randomUUID()
    for (const [id, source] of [[document,'a'],[document2,'b']])
      await client.query(`INSERT INTO hz_fop_source_documents (id,connection_id,company_id,dataset_id,entity_code,source_id,source_version)
        VALUES ($1,$2,$3,$4,'hzkj_orders',$5,$6)`, [id,connection,company,dataset,source,'999999999999999999999999999999'])
    assert.equal((await client.query('SELECT source_version FROM hz_fop_source_documents WHERE id=$1',[document])).rows[0].source_version,
      '999999999999999999999999999999', '30-digit source versions round-trip as exact strings')
    await client.query('INSERT INTO hz_fop_fulfillment_orders (document_id,company_id,dataset_id) VALUES ($1,$2,$3)',[document,company,dataset])
    await expectSqlState('UPDATE hz_fop_fulfillment_orders SET entity_code=$1 WHERE document_id=$2',['hzkj_stock_order_new',document],'23514')
    for (const [id, parent] of [[line,document],[line2,document2]])
      await client.query(`INSERT INTO hz_fop_source_lines (id,connection_id,company_id,dataset_id,document_id,entry_entity,source_entry_id)
        VALUES ($1,$2,$3,$4,$5,'entry','1')`,[id,connection,company,dataset,parent])
    const relation = [randomUUID(),connection,company,dataset,document,document2,line,line2,document]
    await client.query(`INSERT INTO hz_fop_document_relations (id,connection_id,company_id,dataset_id,from_document_id,to_document_id,
      from_line_id,to_line_id,holder_document_id,relation_type,relation_grain) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'demand_purchase','line_line')`,relation)
    await expectSqlState("UPDATE hz_fop_document_relations SET relation_grain='document' WHERE id=$1",[relation[0]],'23514')
    await expectSqlState('UPDATE hz_fop_document_relations SET from_line_id=$1 WHERE id=$2',[line2,relation[0]],'23503')
    const platformRow = [randomUUID(),connection,company,dataset,document]
    await client.query(`INSERT INTO hz_fop_platform_orders (id,connection_id,company_id,dataset_id,purchase_document_id,platform_code,external_order_id)
      VALUES ($1,$2,$3,$4,$5,'1688','same-order')`, platformRow)
    await expectSqlState(`INSERT INTO hz_fop_platform_orders (id,connection_id,company_id,dataset_id,purchase_document_id,platform_code,external_order_id,external_suborder_id)
      VALUES ($1,$2,$3,$4,$5,'1688','same-order','')`,[randomUUID(),...platformRow.slice(1)],'23505')
    const flag = [randomUUID(),connection,company,dataset,document]
    await client.query(`INSERT INTO hz_fop_order_flags (id,connection_id,company_id,dataset_id,order_document_id,flag_type,normalized_value)
      VALUES ($1,$2,$3,$4,$5,'interception','unknown')`,flag)
    await expectSqlState("UPDATE hz_fop_order_flags SET normalized_value='cancelled' WHERE id=$1",[flag[0]],'23514')
    await expectSqlState("UPDATE hz_fop_connections SET capabilities='[]'::jsonb WHERE id=$1",[connection],'23514')
    await expectSqlState('DELETE FROM hz_fop_connections WHERE id=$1', [connection], '23503')
  } finally { await client.query('ROLLBACK') }
}

async function main() {
  await client.connect()
  try {
    if (process.argv.includes('--migrate') || process.argv.includes('--round-trip')) {
      process.env.TS_NODE_PROJECT = path.join(root, 'backend/tsconfig.json')
      require('ts-node/register/transpile-only')
      const { DataSource } = require('typeorm')
      const migrations = [
        require('../migrations/1794393000000-QualifyChartPermissionValidator').QualifyChartPermissionValidator1794393000000,
        require('../migrations/1794393001000-AddWorkbenchSchemeA').AddWorkbenchSchemeA1794393001000,
      ]
      const source = new DataSource({ ...connectionOptions, type: 'postgres', username: 'autoflow_demo',
        entities: [], migrations, migrationsTableName: 'typeorm_migrations', synchronize: false })
      await source.initialize()
      try {
        if (process.argv.includes('--migrate')) await source.runMigrations({ transaction: 'all' })
        if (process.argv.includes('--round-trip')) {
          const runner = source.createQueryRunner()
          await runner.connect()
          await runner.startTransaction()
          try {
            const before = (await runner.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'hz_fop_%'"))[0].count
            await new migrations[1]().down(runner)
            const after = await runner.query("SELECT count(*) FILTER (WHERE tablename LIKE 'hz_fop_%')::int AS hz, count(*) FILTER (WHERE tablename NOT LIKE 'hz_fop_%')::int AS other FROM pg_tables WHERE schemaname='public'")
            assert.equal(after[0].hz, 0, 'Rollback removes all Scheme A tables')
            assert.equal(after[0].other, before, 'Rollback preserves every pre-existing table')
            await new migrations[0]().down(runner)
            await new migrations[0]().up(runner)
            await new migrations[1]().up(runner)
            assert.equal((await runner.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'hz_fop_%'"))[0].count, 61,
              'Reapply recreates all Scheme A tables')
          } finally { await runner.rollbackTransaction(); await runner.release() }
        }
      } finally { await source.destroy() }
    }
    const summary = await validateCatalog()
    await validateBehavior()
    console.log(JSON.stringify({ database, status: 'passed', ...summary, behavior: 'empty-search-path, enum, active-dataset-uniqueness, cross-company-isolation, fixed-entity, 30-digit-version, relation-grain-and-endpoints, null-coalesced-uniqueness, flag-semantics, JSON-shape, restrict-delete; probes rolled back' }))
  } finally { await client.end() }
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
