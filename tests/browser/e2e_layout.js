// v8.3 — التطبيق على كل المقاسات: من غطاء الهاتف القابل للطي (280px) إلى الحاسوب، أفقياً وعمودياً، وبخط النظام المكبَّر،
// دون شبكة خارجية: لا تمرير أفقي ولا عنصر يخرج عن الشاشة في الشاشات الرئيسية، والإحصاءات مقروءة في أضيق شاشة،
// والردهة عمود واحد في الوسط على الشاشات العريضة، والخطان المضمَّنان محمَّلان، وأيقونات التثبيت في البيان.
// يحتاج python3 build.py أولاً، ويخدم dist/app بنفسه (لا منفذ ثابت).
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), APP = path.join(ROOT, 'dist', 'app');
const errs = [];
const ok = (c, m) => { if (!c) { errs.push('FAIL: ' + m); console.log('✗', m); } else console.log('✓', m); };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.woff': 'font/woff',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(APP, p); if (!f.startsWith(APP) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });

const VP = [['fold', 280, 653], ['se', 320, 568], ['phone', 390, 844], ['landscape', 844, 390], ['tablet', 768, 1024],
  ['ipadpro', 1024, 1366], ['desktop', 1440, 900]];
// العناصر الخارجة عن الشاشة، عدا ما داخل حاوية تمرير أو قص (شريط الأدوات وبطاقات الفروع يُسحبان أفقياً)،
// وعدا الزخارف المقصودة: خلفية الزليج الثابتة وهالة الفقاعة العائمة
const OVER = () => { const W = document.documentElement.clientWidth, bad = [];
  if (document.documentElement.scrollWidth > W + 1) bad.push('scrollX:' + document.documentElement.scrollWidth);
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.closest('.bg') || el.closest('.tfr')) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    let p = el.parentElement, clipped = false;
    while (p && p !== document.body) { if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) { clipped = true; break; } p = p.parentElement; }
    if (clipped) continue;
    if (r.right > W + 1.5 || r.left < -1.5) bad.push((el.id ? '#' + el.id : typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : el.tagName) + `[${Math.round(r.left)},${Math.round(r.right)}]`);
  }
  return [...new Set(bad)].slice(0, 6); };

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL0 = `http://127.0.0.1:${srv.address().port}/index.html`;
  const browser = await chromium.launch();
  for (const big of [false, true]) {
    for (const [name, w, h] of VP) {
      if (big && w > 430) continue;                  // الخط المكبَّر (إعداد النظام 130٪) على الهواتف
      const tag = `${name} ${w}×${h}${big ? ' بخط النظام 130٪' : ''}`;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 1200, hasTouch: w < 1200,
        locale: 'ar-MA', serviceWorkers: 'block' });
      await ctx.route(u => !/^http:\/\/127\.0\.0\.1/.test(u.href), r => r.abort());
      const page = await ctx.newPage();
      page.on('pageerror', e => errs.push(tag + ' pageerror: ' + e.message));
      if (big) await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style'); st.textContent = 'html{text-size-adjust:130%;-webkit-text-size-adjust:130%}'; document.head.appendChild(st); }));
      await page.goto(URL0);
      const bad = {};
      const check = async k => { await page.waitForTimeout(250); const o = await page.evaluate(OVER); if (o.length) bad[k] = o; };
      await page.waitForSelector('#alias'); await check('الدخول');
      await page.fill('#alias', 'ليلى'); await page.click('#enter');
      const c = await page.waitForSelector('#tgate #tgC', { timeout: 8000 }).catch(() => null);
      if (c) { await check('البنود'); await c.check(); await page.click('#tgY'); await page.waitForSelector('#tgate', { state: 'detached', timeout: 4000 }).catch(() => null); }
      const b = await page.waitForSelector('#onbs', { timeout: 2500 }).catch(() => null); if (b) await b.click();
      await page.waitForSelector('#lobby:not(.hidden)', { timeout: 8000 });
      const x = await page.$('#rcx'); if (x) await x.click().catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await check('الردهة');
      const L = await page.evaluate(() => { const st = document.querySelector('.hstats').getBoundingClientRect(), hero = document.querySelector('.hero').getBoundingClientRect();
        return { stats: st.width, heroL: hero.left, heroR: innerWidth - hero.right }; });
      ok(L.stats >= 100, `${tag}: إحصاءات الردهة مقروءة (عرضها ${Math.round(L.stats)}px)`);
      if (w >= 1024) ok(L.heroL > 100 && Math.abs(L.heroL - L.heroR) < 24, `${tag}: الردهة عمود في الوسط (هامشان ${Math.round(L.heroL)} و${Math.round(L.heroR)})`);
      await page.evaluate(() => openQuiz('obligations')); await page.waitForSelector('#opts .opt'); await check('السؤال');
      const lastOpt = await page.evaluate(() => { const o = [...document.querySelectorAll('#opts .opt')].pop().getBoundingClientRect(); return { l: o.left, r: o.right }; });
      ok(lastOpt.l >= 0 && lastOpt.r <= w, `${tag}: الخيارات داخل الشاشة`);
      await page.click('#opts .opt[data-i="0"]'); await page.click('#go'); await check('التصحيح');
      await page.click('#qx').catch(() => {}); await page.waitForTimeout(200);
      await page.evaluate(() => openTexts()); await page.waitForSelector('#txv .li[data-law]'); await check('النصوص');
      await page.click('#txv .li[data-law="registry_fees"]'); await page.waitForTimeout(500); await check('قانون');
      await page.keyboard.press('Escape'); await page.waitForTimeout(150); await page.keyboard.press('Escape').catch(() => {});
      await page.evaluate(() => openSettings()); await check('الإعدادات');
      ok(!Object.keys(bad).length, `${tag}: لا تمرير أفقي ولا عنصر خارج الشاشة` + (Object.keys(bad).length ? ' — ' + JSON.stringify(bad) : ''));
      if (name === 'phone' && !big) {
        const F = await page.evaluate(async () => { await document.fonts.ready;
          return { naskh: document.fonts.check('16px "Noto Naskh Arabic"', 'قانون'), messiri: document.fonts.check('16px "El Messiri"', 'قانون'),
            loaded: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '')),
            body: getComputedStyle(document.body).fontFamily, h: getComputedStyle(document.querySelector('.sheet h2') || document.body).fontFamily }; });
        ok(F.loaded.includes('Noto Naskh Arabic') && F.loaded.includes('El Messiri'), `الخطان المضمَّنان محمَّلان من الحزمة نفسها (${F.loaded.join('، ')})`);
        ok(/^"?Noto Naskh Arabic/.test(F.body) && /^"?El Messiri/.test(F.h), 'النسخ للمتن والمسيري للعناوين');
        const man = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
        ok(man.icons.some(i => i.purpose === 'maskable' && i.sizes === '512x512') && man.icons.some(i => i.sizes === '192x192'),
          'البيان: أيقونة 192 و512 وأيقونة قابلة للقص (maskable)');
        const heads = await page.evaluate(() => [...document.querySelectorAll('link[rel="apple-touch-icon"],link[rel="preload"][as="font"]')].map(l => l.getAttribute('href')));
        ok(heads.includes('icon-180.png') && heads.includes('fonts/qt-naskh.woff'), 'أيقونة iPhone (180) وتحميل الخط المسبق في رأس الصفحة');
      }
      await ctx.close();
    }
  }
  await browser.close(); srv.close();
  console.log(errs.length ? `\n${errs.length} أخطاء:\n` + errs.join('\n') : '\n✓ المقاسات كلها: لا أخطاء');
  process.exit(errs.length ? 1 : 0);
})();
