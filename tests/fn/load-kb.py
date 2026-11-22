# يحمّل بنك الأسئلة المبني (dist/app/questions.json) إلى قاعدة المعرفة qt_kb على Postgres المحلي، على دفعات
import json, os, subprocess, sys
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
d = json.load(open(os.path.join(root, 'dist', 'app', 'questions.json'), encoding='utf-8'))
keep = ('id', 'branch', 'difficulty', 'type', 'stem', 'options', 'correct', 'explain', 'source', 'conf')
rows = [{k: q[k] for k in keep if k in q} for q in d['questions']]
cmd = ['psql', '-h', os.environ.get('QT_PG_HOST', '/var/lib/postgresql'), '-p', os.environ.get('QT_PG_PORT', '5439'), '-U', 'postgres', '-d', 'qt', '-At', '-v', 'ON_ERROR_STOP=1']
n = 0
for i in range(0, len(rows), 600):
    body = json.dumps(rows[i:i + 600], ensure_ascii=False)
    assert '$qtkb$' not in body
    r = subprocess.run(cmd, input=f"select public.qt_kb_load($qtkb${body}$qtkb$::jsonb, 'test');", capture_output=True, text=True)
    if r.returncode: sys.exit(r.stderr[:300])
    n += int(r.stdout.strip().split('\n')[-1])
print(f'qt_kb: {n}')
