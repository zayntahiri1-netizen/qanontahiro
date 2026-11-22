// بديل supabase-js لدالة «المساعد»: الجلسات من جدول auth.users، والجداول والدوال على Postgres المحلي بدور service_role
import { execFileSync } from 'node:child_process';
const PSQL = ['-h', process.env.QT_PG_HOST || '/var/lib/postgresql', '-p', process.env.QT_PG_PORT || '5439', '-U', 'postgres', '-d', 'qt', '-At', '-v', 'ON_ERROR_STOP=1', '-q'];
export const sql = q => execFileSync('psql', PSQL, { input: 'set role service_role;\n' + q, encoding: 'utf8' }).trim();
export const sqlRaw = q => execFileSync('psql', PSQL, { input: q, encoding: 'utf8' }).trim();
const lit = v => v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : Array.isArray(v) && v.every(x => typeof x === 'string') && v.length ? `array[${v.map(x => `$q$${x}$q$`).join(',')}]::text[]`
  : typeof v === 'object' ? `$j$${JSON.stringify(v)}$j$::jsonb` : `$q$${String(v)}$q$`;
const TABLE_FNS = new Set(['qt_kb_search', 'qt_law_search', 'qt_law_get']);
export const USERS = new Map();      // رمز الجلسة ← { id, is_anonymous }
function builder(table) {
  const st = { op: 'select', cols: '*', where: [], one: false, row: null };
  const run = async () => {
    const w = st.where.length ? ' where ' + st.where.map(([c, v]) => `${c} = ${lit(v)}`).join(' and ') : '';
    if (st.op === 'select') {
      const out = sql(`select coalesce(jsonb_agg(x), '[]') from (select ${st.cols} from public.${table}${w}) x`);
      const rows = JSON.parse(out.split('\n').pop());
      return { data: st.one ? (rows[0] ?? null) : rows, error: null };
    }
    if (st.op === 'update') { sql(`update public.${table} set ${Object.entries(st.row).map(([k, v]) => `${k} = ${lit(v)}`).join(', ')}${w}`); return { data: null, error: null }; }
    const cols = Object.keys(st.row);
    const conflict = st.op === 'upsert' ? ` on conflict (key) do update set ${cols.map(c => `${c} = excluded.${c}`).join(', ')}` : '';
    sql(`insert into public.${table} (${cols}) values (${cols.map(c => lit(st.row[c]))})${conflict}`);
    return { data: null, error: null };
  };
  const b = {
    select(c) { st.cols = c || '*'; return b; }, eq(c, v) { st.where.push([c, v]); return b; },
    maybeSingle() { st.one = true; return run(); }, update(r) { st.op = 'update'; st.row = r; return b; },
    upsert(r) { st.op = 'upsert'; st.row = r; return run(); }, insert(r) { st.op = 'insert'; st.row = r; return run(); },
    then(res, rej) { return run().then(res, rej); },
  };
  return b;
}
export function createClient() {
  return {
    auth: { getUser: async jwt => ({ data: { user: USERS.get(jwt) ?? null }, error: null }) },
    from: builder,
    rpc: async (fn, args) => {
      const named = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(', ');
      const tbl = TABLE_FNS.has(fn);
      const out = sql(tbl ? `select coalesce(jsonb_agg(t), '[]') from public.${fn}(${named}) t` : fn === 'qt_ai_refund' ? `select public.${fn}(${named}); select 'null'` : `select to_jsonb(public.${fn}(${named}))`);
      return { data: JSON.parse(out.split('\n').pop()), error: null };
    },
  };
}
