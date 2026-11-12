/* Reproduce immutable Scheme A migration artifacts from the approved dictionary.
 * Run from work-app: node backend/src/database/workbench-schema.generate.cjs
 * Deliberately accepts only the dictionary's limited SQL grammar, never arbitrary SQL.
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const source = path.resolve(__dirname, '../../../docs/designs/workbench-database/schema-design.json')
const raw = fs.readFileSync(source, 'utf8')
const schema = JSON.parse(raw)
const sha256 = crypto.createHash('sha256').update(raw).digest('hex')
const tables = schema.tables
const identifier = value => {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error(`Invalid identifier: ${value}`)
  return '"' + value + '"'
}
const literal = value => "'" + String(value).replaceAll("'", "''") + "'"
const qualified = table => '"public".' + identifier(table)
const constraintName = (kind, table, suffix) => {
  const value = `${kind}_${table}_${suffix}`
  return value.length <= 63 ? value : value.slice(0, 50) + '_' + crypto.createHash('sha256').update(value).digest('hex').slice(0, 12)
}
const names = list => list.map(identifier).join(', ')
const allowedTypes = /^(uuid|text|jsonb|integer|bigint|timestamptz|boolean|smallint|varchar\(\d+\)|numeric\(\d+,\d+\))$/
function defaultSql(field) {
  if (field.default === null) return ''
  if (field.default === 'now()' && field.type === 'timestamptz') return ' DEFAULT now()'
  if (typeof field.default === 'number' || typeof field.default === 'boolean') return ' DEFAULT ' + String(field.default)
  if (field.type === 'jsonb') return ' DEFAULT ' + literal(JSON.stringify(JSON.parse(field.default))) + '::jsonb'
  return ' DEFAULT ' + literal(field.default)
}
// Source dictionaries use unquoted state labels in predicates. Handle each supported
// form explicitly so pseudo SQL such as state=active never reaches PostgreSQL.
function predicateSql(value) {
  return value.split(/\s+AND\s+/).map(clause => {
    let match = /^([a-z_]+) IS (NOT )?NULL$/.exec(clause)
    if (match) return `${identifier(match[1])} IS ${match[2] || ''}NULL`
    match = /^([a-z_]+)\s*(=|<>)\s*([a-z_]+)$/.exec(clause)
    if (match) return `${identifier(match[1])} ${match[2]} ${literal(match[3])}`
    match = /^([a-z_]+) IN \(([a-z_,]+)\)$/.exec(clause)
    if (match) return `${identifier(match[1])} IN (${match[2].split(',').map(literal).join(', ')})`
    throw new Error(`Unsupported index predicate: ${clause}`)
  }).join(' AND ')
}
function expressionSql(value) {
  let match = /^([a-z_]+)( DESC NULLS LAST)?$/.exec(value)
  if (match) return identifier(match[1]) + (match[2] || '')
  match = /^COALESCE\(([a-z_]+)(::text)?,''\)$/.exec(value)
  if (match) return `(COALESCE(${identifier(match[1])}${match[2] || ''}, ''))`
  throw new Error(`Unsupported index expression: ${value}`)
}
function indexSql(specification) {
  let nesting = 0, end = -1
  if (specification[0] !== '(') throw new Error(`Unsupported index: ${specification}`)
  for (let i = 0; i < specification.length; i++) {
    if (specification[i] === '(') nesting++
    if (specification[i] === ')' && --nesting === 0) { end = i; break }
  }
  if (end === -1) throw new Error(`Unbalanced index: ${specification}`)
  const expressions = specification.slice(1, end), tail = specification.slice(end + 1)
  if (tail && !tail.startsWith(' WHERE ')) throw new Error(`Unsupported index tail: ${tail}`)
  // COALESCE has a comma; split at top-level commas only.
  const parts = []; let current = ''; let depth = 0
  for (const char of expressions) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (char === ',' && depth === 0) { parts.push(current); current = '' } else current += char
  }
  parts.push(current)
  return '(' + parts.map(expressionSql).join(', ') + ')' + (tail ? ' WHERE ' + predicateSql(tail.slice(7)) : '')
}
function checksFor(table) {
  const checks = []
  for (const field of table.fields) {
    const first = (field.rule || '').split('；')[0].replace(/^选项：/, '').trim()
    if (/^[a-z_]+(?:\s*,\s*[a-z_]+)+$/.test(first)) {
      checks.push([field.name, `${identifier(field.name)} IN (${first.split(',').map(value => literal(value.trim())).join(', ')})`])
    }
    const fixed = /^CHECK entity_code = ([a-z_]+)$/.exec(field.rule || '')
    if (fixed) checks.push([field.name, `${identifier(field.name)} = ${literal(fixed[1])}`])
    if (field.type === 'jsonb' && field.default !== null) {
      const shape = Array.isArray(JSON.parse(field.default)) ? 'array' : 'object'
      checks.push([field.name + '_shape', `jsonb_typeof(${identifier(field.name)}) = ${literal(shape)}`])
    }
  }
  if (table.name === 'hz_fop_document_relations') checks.push(['grain_endpoints', `
    ("relation_grain" = 'document' AND "from_line_id" IS NULL AND "to_line_id" IS NULL)
    OR ("relation_grain" = 'document_line' AND "from_line_id" IS NULL AND "to_line_id" IS NOT NULL)
    OR ("relation_grain" = 'line_document' AND "from_line_id" IS NOT NULL AND "to_line_id" IS NULL)
    OR ("relation_grain" = 'line_line' AND "from_line_id" IS NOT NULL AND "to_line_id" IS NOT NULL)`])
  if (table.name === 'hz_fop_order_flags') checks.push(['normalized_value', `
    ("flag_type" = 'interception' AND "normalized_value" IN ('intercepted', 'released', 'unknown'))
    OR ("flag_type" = 'cancellation' AND "normalized_value" IN ('requested', 'cancelled', 'none', 'unknown'))`])
  return checks
}

if (tables.length !== 61 || tables.reduce((count, table) => count + table.fields.length, 0) !== 948
  || tables.reduce((count, table) => count + table.foreign_keys.length, 0) !== 252) throw new Error('Approved schema counts changed; review required')
const up = [], down = [], foreignKeyDrops = []
for (const table of tables) {
  const definitions = table.fields.map(field => {
    if (!allowedTypes.test(field.type)) throw new Error(`Unsupported type: ${field.type}`)
    return '  ' + identifier(field.name) + ' ' + field.type + (field.nullable ? '' : ' NOT NULL') + defaultSql(field)
  })
  definitions.push(`  CONSTRAINT ${identifier(constraintName('pk', table.name, table.primary_key.join('_')))} PRIMARY KEY (${names(table.primary_key)})`)
  for (const [name, expression] of checksFor(table)) definitions.push(`  CONSTRAINT ${identifier(constraintName('ck', table.name, name))} CHECK (${expression})`)
  up.push(`CREATE TABLE ${qualified(table.name)} (\n${definitions.join(',\n')}\n);`)
  const comment = [table.label, table.purpose, ...(table.rules || [])].filter(Boolean).join('；')
  up.push(`COMMENT ON TABLE ${qualified(table.name)} IS ${literal(comment)};`)
  for (const field of table.fields) up.push(`COMMENT ON COLUMN ${qualified(table.name)}.${identifier(field.name)} IS ${literal([field.label, `来源：${field.source}`, field.rule, `证据：${field.evidence_level}`].filter(Boolean).join('；'))};`)
}
// All tables and unique targets exist before adding the 252 FKs (including cycles).
for (const table of tables) {
  let number = 0
  for (const spec of new Set(table.unique)) up.push(`CREATE UNIQUE INDEX ${identifier(constraintName('uq', table.name, String(++number)))} ON ${qualified(table.name)} ${indexSql(spec)};`)
  number = 0
  for (const spec of new Set(table.indexes)) up.push(`CREATE INDEX ${identifier(constraintName('ix', table.name, String(++number)))} ON ${qualified(table.name)} ${indexSql(spec)};`)
}
for (const table of tables) {
  let number = 0
  for (const fk of table.foreign_keys) {
    if (!['RESTRICT', 'NO ACTION', 'CASCADE', 'SET NULL'].includes(fk.on_delete)) throw new Error('Unsupported FK action')
    const name = constraintName('fk', table.name, String(++number))
    up.push(`ALTER TABLE ${qualified(table.name)} ADD CONSTRAINT ${identifier(name)} FOREIGN KEY (${names(fk.columns)}) REFERENCES ${qualified(fk.target_table)} (${names(fk.target_columns)}) ON DELETE ${fk.on_delete}${fk.deferrable ? ' DEFERRABLE INITIALLY IMMEDIATE' : ' NOT DEFERRABLE'};`)
    foreignKeyDrops.push(`ALTER TABLE ${qualified(table.name)} DROP CONSTRAINT ${identifier(name)};`)
  }
}
down.push(...foreignKeyDrops.reverse())
for (const table of [...tables].reverse()) down.push(`DROP TABLE ${qualified(table.name)};`)
const header = `// Generated from approved Scheme A V1.2, source SHA256 ${sha256}.\n// Reproduce with: node backend/src/database/workbench-schema.generate.cjs\n`
// Later migrations extend ingestion metadata without changing the immutable V1.2 DDL.
const migratedColumns = {
  hz_fop_fulfillment_orders: ['custom_channel_id', 'custom_channel_name'],
  hz_fop_stock_orders: ['procurement_paid_at'],
  hz_fop_purchase_orders: ['paid_at'],
  hz_fop_order_packages: ['tracking_number'],
  hz_fop_procurement_line_details: ['sales_order_number'],
}
const metadataTables = [...tables, { name: 'hz_fop_workbench_receipt_notices', fields: ['document_id','source_version','owner_employee_ids','ownership_verified_at','shipment_state','carrier_name','quantity','inbound_quantity','lines','published_at'].map(name => ({ name })), primary_key: ['document_id'] }, { name:'hz_fop_bootstrap_pages',fields:['id','connection_id','company_id','dataset_id','batch_id','stream_id','snapshot_id','page_index','after_cursor','end_cursor','complete','groups','payload_hash','state','collected_at','applied_at'].map(name=>({name})),primary_key:['id'] }]
const metadata = `${header}export const WORKBENCH_SCHEMA_SHA256 = ${JSON.stringify(sha256)}\n\nexport const WORKBENCH_TABLE_COLUMNS: Readonly<Record<string, readonly string[]>> = Object.freeze({\n${metadataTables.map(table => `  ${JSON.stringify(table.name)}: Object.freeze(${JSON.stringify([...(migratedColumns[table.name] || []), ...table.fields.map(field => field.name)])}),`).join('\n')}\n})\n\nexport const WORKBENCH_PRIMARY_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({\n${metadataTables.map(table => `  ${JSON.stringify(table.name)}: Object.freeze(${JSON.stringify(table.primary_key)}),`).join('\n')}\n})\n`
fs.writeFileSync(path.join(__dirname, 'workbench-schema.ts'), metadata)
fs.writeFileSync(path.join(__dirname, 'workbench-schema.sql.ts'), `${header}export const WORKBENCH_UP_SQL = ${JSON.stringify(up, null, 2)}.join('\\n\\n')\n\nexport const WORKBENCH_DOWN_SQL = ${JSON.stringify(down, null, 2)}.join('\\n')\n`)
console.log(JSON.stringify({ tables: tables.length, columns: 948, foreignKeys: 252, sha256, statements: up.length }))
