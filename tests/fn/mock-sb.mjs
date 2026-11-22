// بديل supabase-js لدالة النبض: ينفذ الطلبات على Postgres المحلي بدور service_role
import { execFileSync } from 'node:child_process';
const PSQL = ['-h', process.env.QT_PG_HOST || '/var/lib/postgresql', '-p', process.env.QT_PG_PORT || '5439', '-U', 'postgres', '-d', 'qt', '-At', '-v', 'ON_ERROR_STOP=1', '-q', '-c'];
export const sql = q => execFileSync('psql', PSQL.concat(['set role service_role; ' + q]), { encoding: 'utf8' }).trim();
const lit = v => v == null ? 'null' : `$q$${String(v)}$q$`;
export function createClient(url, key) {
  globalThis.__sbKey = key;
  return {
    rpc: async (fn, args) => ({ data: JSON.parse(sql(`select to_jsonb(public.${fn}(${Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(', ')}))`)), error: null }),
    from: (t) => ({
      insert: (row) => ({ select: () => ({ single: async () => {
        const cols = Object.keys(row), vals = cols.map(c => lit(row[c]));
        return { data: JSON.parse(sql(`insert into public.${t}(${cols}) values (${vals}) returning jsonb_build_object('id', id, 'created_at', created_at)`)), error: null }; } }) }),
      update: (row) => ({ eq: async (c, v) => { sql(`update public.${t} set ${Object.entries(row).map(([k, x]) => `${k} = ${typeof x === 'boolean' ? x : lit(x)}`).join(', ')} where ${c} = ${lit(v)}`); return { data: null, error: null }; } }),
      select: (cols, o) => o && o.head
        ? Promise.resolve({ count: +sql(`select count(*) from public.${t}`), error: null })
        : { order: () => ({ limit: async (n) => ({ data: JSON.parse(sql(`select coalesce(jsonb_agg(x order by id desc), '[]') from (select ${cols} from public.${t} order by id desc limit ${n}) x`)), error: null }) }) },
    }),
  };
}
