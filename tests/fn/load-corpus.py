# يحمّل مكتبة النصوص (data/corpus/) إلى qt_laws وqt_law_articles على Postgres المحلي، على دفعات، كما تفعل أداة النشر
import json, os, subprocess, sys, pathlib, hashlib
root = pathlib.Path(__file__).resolve().parent.parent.parent
corpus = root / 'data' / 'corpus'
idx = json.loads((corpus / 'index.json').read_text(encoding='utf-8'))
stamp = hashlib.sha256((corpus / 'index.json').read_bytes()).hexdigest()[:12]
cmd = ['psql', '-h', os.environ.get('QT_PG_HOST', '/var/lib/postgresql'), '-p', os.environ.get('QT_PG_PORT', '5439'), '-U', 'postgres',
       '-d', 'qt', '-At', '-v', 'ON_ERROR_STOP=1']
only = set(filter(None, (sys.argv[1] if len(sys.argv) > 1 else '').split(',')))


def q(sql):
    r = subprocess.run(cmd, input=sql, capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stderr[:400])
    return r.stdout.strip().split('\n')[-1]


n = 0
for law in idx['laws']:
    if only and law['slug'] not in only:
        continue
    items = json.loads((corpus / f"{law['slug']}.json").read_text(encoding='utf-8'))['items']
    for i, it in enumerate(items):
        it['ord'] = i
    meta = json.dumps(law, ensure_ascii=False)
    for k in range(0, len(items), 300):
        body = json.dumps(items[k:k + 300], ensure_ascii=False)
        assert '$qtc$' not in body and '$qtc$' not in meta
        n += int(q(f"select public.qt_law_load($qtc${meta}$qtc$::jsonb, $qtc${body}$qtc$::jsonb, '{stamp}');"))
print(f'qt_law_articles: {n} · prune: {q(f"select public.qt_law_prune(\'{stamp}\');") if not only else "-"}')
