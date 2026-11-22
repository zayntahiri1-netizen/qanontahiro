// الموقع: يعرض البيانات المبنية، ويتصل بالخدمات الحية (بدائل في بيئة الاختبار)، ويعمل كاملاً دونها
const { chromium } = require('playwright');
const path = require('path'), os = require('os'), fs = require('fs');
const OUT = process.env.QT_SHOTS || path.join(os.tmpdir(), 'qt-shots'); fs.mkdirSync(OUT, { recursive: true });
const SITE_URL = (process.env.QT_SITE_URL || 'http://localhost:8766').replace(/\/+$/, '');
const errs = [];
const ok = (c, m) => { if (!c) { errs.push('FAIL: ' + m); console.log('✗', m); } else console.log('✓', m); };
const MOCK_AB = `window.Ably={ Realtime:class{ constructor(o){ this.cbs=[]; const s=this; window.__abInst=this;
  this.connection={ on(){}, close(){}, connect(){} };
  this.channels={ get:(n)=>({ subscribe:async(cb)=>{ s.cbs.push(cb); } }) }; } } };
window.__ablyPush=(name,data)=>{ const a=window.__abInst; if(a) a.cbs.forEach(cb=>cb({ name, data })); };`;
const BOARD = [{ alias:'سلمى', seed:123456, points:1840, answered:120, week_points:310 },
               { alias:'يوسف', seed:987654, points:1210, answered:96, week_points:420 },
               { alias:'Imane', seed:55555, points:640, answered:51, week_points:0 }];
async function run(live) {
  const browser = await chromium.launch();
  for (const [name, vp] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 860 }]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'ar-MA', deviceScaleFactor: 1, colorScheme: name === 'desktop' && live ? 'light' : 'dark' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    if (live) {
      await ctx.route(/supabase\.co\/rest\/v1\/rpc\/(\w+)/, async r => {
        const fn = r.request().url().match(/rpc\/(\w+)/)[1], body = JSON.parse(r.request().postData() || '{}');
        const h = r.request().headers();
        if (!h.apikey || !/^sb_publishable_/.test(h.apikey)) return r.fulfill({ status: 401, body: '{}' });
        const data = fn === 'qt_board' ? (body.p_kind === 'week' ? BOARD.filter(x => x.week_points).sort((a, b) => b.week_points - a.week_points) : BOARD)
                   : fn === 'qt_hall' ? { w: [{ alias: 'سلمى', seed: 123456, points: 500 }, { alias: 'يوسف', seed: 987654, points: 420 }], m: [] }
                   : fn === 'qt_daily_stats' ? { n: 41, ok: 17 } : fn === 'qt_announce_last' ? { id: 3, ar: 'صدر عدد جديد من الجريدة الرسمية.', url: '' } : null;
        r.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      });
      await ctx.route(/ps\.pndsn\.com\/v2\/presence/, r => r.fulfill({ contentType: 'application/json', body: '{"status":200,"occupancy":14}' }));
      await ctx.route(/cdn\.ably\.com|npm\/ably@2/, r => r.fulfill({ contentType: 'application/javascript', body: MOCK_AB }));
    } else {
      await ctx.route(/supabase\.co|pndsn\.com|ably/, r => r.abort());
    }
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::|ERR_|Failed to load resource/.test(m.text())) errs.push(name + ' console: ' + m.text()); });
    await page.goto(SITE_URL + '/');
    await page.waitForSelector('#dq .stem');
    ok(await page.$$eval('#dq .opt', x => x.length) === 4, `${name}${live ? '' : ' (دون اتصال)'}: سؤال اليوم بخياراته الأربعة`);
    ok(await page.$$eval('#ros polygon.pf', x => x.length) === 13, `${name}: وردة البنك بثلاث عشرة بتلة`);
    ok(await page.$$eval('#tl .tli', x => x.length) === 6, `${name}: ستة تعديلات في خط المستجدات`);
    ok(await page.$$eval('#brs .brow', x => x.length) === 13, `${name}: الفروع الثلاثة عشر بأعدادها`);
    if (live) {
      await page.waitForSelector('#bb table');
      ok(await page.$$eval('#bb tbody tr', x => x.length) === 3, `${name}: لوحة المتنافسين من Supabase`);
      await page.waitForSelector('#onl:not(.hidden)');
      ok(/14/.test(await page.textContent('#onl')), `${name}: «يتدربون الآن» من حضور PubNub`);
      ok(/أجاب 41 اليوم/.test(await page.textContent('#dchip')), `${name}: نبض سؤال اليوم`);
      ok(/الجريدة الرسمية/.test(await page.textContent('#annc')), `${name}: آخر إعلان`);
      await page.waitForSelector('#hall:not(.hidden)', { timeout: 4000 }).catch(() => null);
      ok(/أبطال الأسبوع الماضي/.test(await page.textContent('#hall')) && await page.$$eval('#hall .medal', x => x.length) === 2, `${name}: أبطال الأسبوع الماضي`);
      ok(await page.$$eval('.tabs button', x => x.length) === 3, `${name}: ألواح الأسبوع والشهر وكل الأوقات`);
      await page.waitForFunction(() => window.__abInst && window.__abInst.cbs.length > 0, null, { timeout: 5000 }).catch(() => null);
      await page.evaluate(() => window.__ablyPush && window.__ablyPush('daily', { day: (d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'))(new Date()), n: 42, ok: 18 }));
      ok(/أجاب 42 اليوم/.test(await page.textContent('#dchip')), `${name}: النبض يتحدث حياً عبر Ably`);
      await page.click('.tabs button[data-v="wk"]');
      await page.waitForFunction(() => document.querySelectorAll('#bb tbody tr').length === 2);
      ok(/يوسف/.test(await page.textContent('#bb tbody tr:first-child')), `${name}: الترتيب الأسبوعي`);
      await page.click('.tabs button[data-v="all"]');
    } else {
      await page.waitForSelector('#bb .empty');
      ok(/تعذّر/.test(await page.textContent('#bb')), `${name} (دون اتصال): اللوحة تعتذر بأدب والصفحة كاملة`);
    }
    if (name === 'mobile') {
      await page.click('#dq .opt[data-i="0"]');
      await page.click('#dgo');
      await page.waitForSelector('#dv .verdict');
      ok(await page.$$eval('#dq .opt.ok', x => x.length) >= 0 && !!(await page.$('#dv .src')), `${name}: الجواب يكشف التعليل والمرجع`);
      await page.reload(); await page.waitForSelector('#dv .verdict');
      ok(true, `${name}: جواب اليوم محفوظ بعد إعادة التحميل`);
    }
    const sw = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    ok(sw, `${name}: لا تمرير أفقي`);
    await page.screenshot({ path: `${OUT}/site-${name}${live ? '' : '-offline'}.png`, fullPage: true });
    if (name === 'mobile' && live) {
      await page.goto(SITE_URL + '/privacy.html'); await page.waitForSelector('h1');
      ok(/09.08/.test(await page.textContent('main')), 'سياسة الخصوصية تحيل على القانون 09.08');
      ok(!/@gmail\.com/.test(await page.content()), 'لا بريد شخصي منشور في الصفحات العامة');
      await page.screenshot({ path: `${OUT}/site-privacy.png`, fullPage: false });
      await page.goto(SITE_URL + '/admin.html'); await page.waitForSelector('#send');
      ok(/noindex/.test(await page.content()), 'لوحة المؤلف خارج الفهرسة');
    }
    await ctx.close();
  }
  await browser.close();
}
(async () => {
  await run(true);
  await run(false);
  console.log('\n' + (errs.length ? errs.join('\n') : 'لا أخطاء في الصفحات ولا في وحدة التحكم'));
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
