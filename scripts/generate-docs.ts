/**
 * Generates schema documentation FROM THE LIVE DATABASE, so it cannot drift
 * from what the migrations actually built:
 *
 *   docs/DATA_DICTIONARY.md              every table, column, type, constraint
 *   docs/diagrams/relational-schema.svg  crow's-foot diagram of all tables
 *   docs/diagrams/er-conceptual.svg      Chen ER diagram (hand-written DOT, re-rendered)
 *
 *   npm run docs:generate
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { Graphviz } from '@hpcc-js/wasm-graphviz';

interface Col {
  table_name: string; column_name: string; data_type: string; udt_name: string;
  is_nullable: string; column_default: string | null; is_generated: string;
  character_maximum_length: number | null; numeric_precision: number | null; numeric_scale: number | null;
  description: string | null;
}

const TABLES = ['users', 'assets', 'loans', 'emi_schedule', 'loan_prepayments', 'transactions',
  'net_worth_snapshots', 'credit_score_history', 'loan_products', 'categorization_rules', 'notifications'];

function typeOf(c: Col): string {
  if (c.data_type === 'USER-DEFINED') return c.udt_name;
  if (c.data_type === 'numeric') return `numeric(${c.numeric_precision},${c.numeric_scale})`;
  if (c.data_type === 'character') return `char(${c.character_maximum_length})`;
  if (c.data_type === 'timestamp with time zone') return 'timestamptz';
  return c.data_type;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const cols = (await db.query<Col>(`
    SELECT c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default,
           c.is_generated, c.character_maximum_length, c.numeric_precision, c.numeric_scale,
           col_description(format('%I', c.table_name)::regclass, c.ordinal_position) AS description
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = ANY($1)
     ORDER BY c.table_name, c.ordinal_position`, [TABLES])).rows;

  // Every constraint, straight from the catalogue, with its definition.
  const cons = (await db.query<{ table_name: string; name: string; type: string; def: string; cols: string[] }>(`
    SELECT rel.relname AS table_name, con.conname AS name, con.contype AS type,
           pg_get_constraintdef(con.oid) AS def,
           -- ::text[] matters: node-pg returns name[] as a raw string, and
           -- String.includes would then do substring matching.
           ARRAY(SELECT a.attname FROM unnest(con.conkey) k JOIN pg_attribute a
                   ON a.attrelid = con.conrelid AND a.attnum = k)::text[] AS cols
      FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = ANY($1) ORDER BY rel.relname, con.contype, con.conname`, [TABLES])).rows;

  const fks = (await db.query<{ src: string; src_col: string; dst: string; dst_col: string; on_delete: string }>(`
    SELECT tc.table_name AS src, kcu.column_name AS src_col, ccu.table_name AS dst, ccu.column_name AS dst_col,
           rc.delete_rule AS on_delete
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = ANY($1)`, [TABLES])).rows;

  const indexes = (await db.query<{ table_name: string; indexname: string; indexdef: string }>(`
    SELECT tablename AS table_name, indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = ANY($1) ORDER BY tablename, indexname`, [TABLES])).rows;

  const tableComments = Object.fromEntries((await db.query<{ t: string; d: string | null }>(`
    SELECT relname AS t, obj_description(oid) AS d FROM pg_class WHERE relname = ANY($1)`, [TABLES])).rows
    .map((r) => [r.t, r.d]));

  const objects = (await db.query<{ kind: string; name: string }>(`
    SELECT CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END AS kind, p.proname AS name
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND (p.proname LIKE 'fn\\_%' OR p.proname LIKE 'sp\\_%' OR p.proname LIKE 'trg\\_%')
    UNION ALL
    SELECT 'view', viewname FROM pg_views WHERE schemaname = 'public'
    UNION ALL
    SELECT 'trigger', DISTINCT_t.tgname FROM (
      SELECT DISTINCT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname = ANY($1)) DISTINCT_t
    ORDER BY 1, 2`, [TABLES])).rows;
  await db.end();

  const pk = (t: string, c: string) => cons.some((k) => k.table_name === t && k.type === 'p' && k.cols.includes(c));
  const fk = (t: string, c: string) => fks.find((f) => f.src === t && f.src_col === c);
  const uq = (t: string, c: string) => cons.some((k) => k.table_name === t && k.type === 'u' && k.cols.length === 1 && k.cols[0] === c);

  // ------------------------------------------------------ data dictionary
  const md: string[] = [
    '# WealthWise — data dictionary',
    '',
    '> Generated from the live PostgreSQL catalogue by `npm run docs:generate`. Do not edit by hand.',
    '',
    `**${TABLES.length} tables · ${objects.filter((o) => o.kind === 'view').length} views · `
      + `${objects.filter((o) => o.kind === 'function').length} functions · `
      + `${objects.filter((o) => o.kind === 'procedure').length} procedure · `
      + `${objects.filter((o) => o.kind === 'trigger').length} triggers · ${indexes.length} indexes**`,
    '',
    'Key: **PK** primary key · **FK** foreign key · **UQ** unique · **GEN** generated column',
    '',
  ];
  for (const t of TABLES) {
    md.push(`## \`${t}\``, '');
    if (tableComments[t]) md.push(`${tableComments[t]}`, '');
    md.push('| Column | Type | Null | Default | Key | Notes |', '|---|---|---|---|---|---|');
    for (const c of cols.filter((x) => x.table_name === t)) {
      const keys = [pk(t, c.column_name) && 'PK', fk(t, c.column_name) && `FK → \`${fk(t, c.column_name)!.dst}\``,
        uq(t, c.column_name) && 'UQ', c.is_generated === 'ALWAYS' && 'GEN'].filter(Boolean).join(' ');
      const def = c.column_default ? `\`${c.column_default.replace(/\|/g, '\\|').slice(0, 40)}\`` : '';
      const note = [c.description, fk(t, c.column_name) && `on delete ${fk(t, c.column_name)!.on_delete.toLowerCase()}`]
        .filter(Boolean).join('; ').replace(/\|/g, '\\|');
      md.push(`| \`${c.column_name}\` | ${typeOf(c)} | ${c.is_nullable === 'YES' ? 'yes' : 'no'} | ${def} | ${keys} | ${note} |`);
    }
    const checks = cons.filter((k) => k.table_name === t && (k.type === 'c' || (k.type === 'u' && k.cols.length > 1)));
    if (checks.length) {
      md.push('', '**Constraints**', '');
      for (const k of checks) md.push(`- \`${k.name}\` — \`${k.def.replace(/\|/g, '\\|')}\``);
    }
    const idx = indexes.filter((i) => i.table_name === t);
    if (idx.length) {
      md.push('', '**Indexes**', '');
      for (const i of idx) md.push(`- \`${i.indexname}\` — \`${i.indexdef.replace(/^CREATE (UNIQUE )?INDEX \S+ ON public\.\S+ /, '$1').replace(/\|/g, '\\|')}\``);
    }
    md.push('');
  }
  md.push('## Database objects', '', '| Kind | Name |', '|---|---|',
    ...objects.map((o) => `| ${o.kind} | \`${o.name}\` |`), '');
  writeFileSync('docs/DATA_DICTIONARY.md', md.join('\n'));
  console.log('wrote docs/DATA_DICTIONARY.md');

  // ------------------------------------------------- relational diagram
  // Record shapes, not HTML-like labels: the WASM Graphviz build has no HTML
  // label parser and silently renders those tables empty. Records still give
  // every column its own port, so each FK edge lands on the exact column.
  const rec = (v: string) => v.replace(/([{}|<>"\\])/g, '\\$1');
  const dot: string[] = [
    'digraph relational_schema {',
    '  graph [rankdir=LR, splines=spline, nodesep=0.45, ranksep=1.3, fontname="DejaVu Sans", bgcolor="white", pad=0.3];',
    // Courier: the WASM build has no real font metrics, but its built-in
    // Courier widths are exact for any monospace font, so no text overflows.
    '  node  [shape=record, fontname="Courier", fontsize=10, color="#3a3733", fontcolor="#3a3733",',
    '         style=filled, fillcolor="#fbf9f5"];',
    '  edge  [color="#6b655c", penwidth=1.1, arrowsize=0.9];',
  ];
  for (const t of TABLES) {
    const fields = cols.filter((c) => c.table_name === t).map((c) => {
      const tag = [pk(t, c.column_name) && 'PK', fk(t, c.column_name) && 'FK', uq(t, c.column_name) && 'UQ']
        .filter(Boolean).join(',');
      const req = c.is_nullable === 'NO' && !pk(t, c.column_name) ? ' NN' : '';
      return `<${c.column_name}> ${rec(c.column_name)} : ${rec(typeOf(c))}${req}${tag ? `  [${tag}]` : ''}\\l`;
    });
    // No outer braces: with rankdir=LR, top-level record fields stack vertically.
    dot.push(`  ${t} [label="${t.toUpperCase()}|${fields.join('|')}"];`);
  }
  // Crow's foot: many (crow + ring = zero or more) at the FK side; one at the
  // PK side — tee-tee when the FK is NOT NULL (mandatory), tee-ring when nullable.
  for (const f of fks) {
    const nullable = cols.find((c) => c.table_name === f.src && c.column_name === f.src_col)?.is_nullable === 'YES';
    dot.push(`  ${f.src}:${f.src_col} -> ${f.dst}:${f.dst_col} [dir=both, arrowtail=crowodot, arrowhead=${nullable ? 'teeodot' : 'teetee'}];`);
  }
  dot.push('}');
  writeFileSync('docs/diagrams/relational-schema.dot', dot.join('\n'));

  const gv = await Graphviz.load();
  writeFileSync('docs/diagrams/relational-schema.svg', gv.layout(dot.join('\n'), 'svg', 'dot'));
  writeFileSync('docs/diagrams/er-conceptual.svg',
    gv.layout(readFileSync('docs/diagrams/er-conceptual.dot', 'utf8'), 'svg', 'neato'));
  console.log('wrote docs/diagrams/*.svg');
}

main().catch((e) => { console.error(e); process.exit(1); });
