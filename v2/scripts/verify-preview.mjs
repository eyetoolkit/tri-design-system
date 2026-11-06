#!/usr/bin/env node
/* TRI-BRAND UI v2 · 组件层真浏览器渲染验证
 * playwright-core + Edge；root 指向 tri-design-system 以便 preview 取 ../src/fonts/
 * 1440 / 390 / 320 × 亮暗，0 横向溢出 / 0 异常 / 令牌翻面 / 交互件
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import pw from 'file:///C:/Game/node-workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const ROOT = path.resolve('C:/Game/tri-design-system');
const OUT = path.resolve('C:/Game/_brand-ui-20261106');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.woff2': 'font/woff2', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'v2/preview.html';
  const full = path.resolve(ROOT, rel);
  if (!full.toLowerCase().startsWith(ROOT.toLowerCase())) { res.writeHead(403); return res.end('forbidden'); }
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});

const report = { cases: [], failures: [], consoleErrors: [], pageErrors: [], httpErrors: [] };

async function measure(page, label) {
  const r = await page.evaluate(() => {
    const de = document.documentElement;
    const cs = getComputedStyle(de);
    const over = de.scrollWidth - window.innerWidth;
    const clipped = el => {
      let p = el.parentElement;
      while (p && p !== de) {
        if (/hidden|auto|scroll|clip/.test(getComputedStyle(p).overflowX)) return true;
        p = p.parentElement;
      }
      return false;
    };
    const offenders = [];
    if (over > 1) document.querySelectorAll('body *').forEach(el => {
      const b = el.getBoundingClientRect();
      if (b.right > window.innerWidth + 2 && b.width > 0 && !clipped(el))
        offenders.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 50), right: Math.round(b.right), txt: (el.innerText || '').slice(0, 24) });
    });
    return {
      innerWidth: window.innerWidth, scrollWidth: de.scrollWidth, overflow: over,
      offenders: offenders.slice(0, 5),
      theme: de.getAttribute('data-theme'),
      brand: cs.getPropertyValue('--tb-brand').trim(),
      ink: cs.getPropertyValue('--tb-ink').trim(),
      paper: cs.getPropertyValue('--tb-paper').trim(),
      tap: cs.getPropertyValue('--tb-tap').trim(),
      scopeBg: getComputedStyle(document.querySelector('.tb-scope')).backgroundColor,
      heroH: Math.round(document.querySelector('.tb-hero-band').getBoundingClientRect().height),
      viewportH: window.innerHeight,
      components: {
        btn: document.querySelectorAll('.tb-btn').length,
        card: document.querySelectorAll('.tb-card').length,
        arena: document.querySelectorAll('.tb-arena').length,
        header: document.querySelectorAll('.tb-header').length
      }
    };
  });
  const c = { label, ...r };
  report.cases.push(c);
  if (r.overflow > 1) report.failures.push(`${label}: 横向溢出 ${r.overflow}px ${JSON.stringify(r.offenders)}`);
  if (r.tap !== '44px') report.failures.push(`${label}: --tb-tap=${r.tap}`);
  if (!r.brand || !r.ink) report.failures.push(`${label}: 令牌未加载`);
  /* 2026-11-06 拍板：Hero 独立深带 <=40% 视口，所有断点 / 主题都要守 */
  const heroRatio = r.heroH / r.viewportH;
  if (heroRatio > 0.40) report.failures.push(`${label}: Hero 深带占比 ${(heroRatio * 100).toFixed(1)}% 超出 40% 上限`);
  return c;
}

(async () => {
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/v2/preview.html`;
  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });

  for (const vp of [{ w: 1440, h: 900, n: 'desktop' }, { w: 390, h: 844, n: 'mobile' }, { w: 320, h: 720, n: 'narrow' }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(`[${vp.n}] ${m.text()}`); });
    page.on('pageerror', e => report.pageErrors.push(`[${vp.n}] ${e}`));
    page.on('response', r => { if (r.status() >= 400) report.httpErrors.push(`[${vp.n}] ${r.status()} ${r.url()}`); });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);

    const light = await measure(page, `${vp.n}-light`);
    if (light.brand !== '#4F46E5' || light.ink !== '#F4F5F9') report.failures.push(`${vp.n}-light: 亮色令牌错误 ${light.brand} / ${light.ink}`);
    if (vp.n === 'desktop') {
      report.fonts = await page.evaluate(() => ({ sora: document.fonts.check('400 14px Sora'), sg: document.fonts.check('700 14px "Space Grotesk"') }));
      await page.screenshot({ path: path.join(OUT, 'v2-preview-desktop-light.png') });
    }

    await page.click('#themeBtn');
    await page.waitForTimeout(180);
    const dark = await measure(page, `${vp.n}-dark`);
    if (dark.brand !== '#818CF8' || dark.ink !== '#12131F') report.failures.push(`${vp.n}-dark: 暗色令牌错误 ${dark.brand} / ${dark.ink}`);
    if (vp.n === 'desktop') await page.screenshot({ path: path.join(OUT, 'v2-preview-desktop-dark.png') });
    if (vp.n === 'mobile') await page.screenshot({ path: path.join(OUT, 'v2-preview-mobile-light.png') });

    if (vp.n === 'mobile') {
      await page.click('#toastBtn');
      const toast = await page.evaluate(() => document.getElementById('toast').getAttribute('data-open'));
      await page.click('#modalBtn');
      const modal = await page.evaluate(() => document.getElementById('veil').getAttribute('data-open'));
      await page.keyboard.press('Escape');
      const closed = await page.evaluate(() => document.getElementById('veil').getAttribute('data-open'));
      report.interactions = { toast, modal, closed };
      if (toast !== 'true' || modal !== 'true' || closed !== 'false') report.failures.push(`交互件异常 ${JSON.stringify(report.interactions)}`);
    }
    await ctx.close();
  }

  if (report.consoleErrors.length) report.failures.push(`console error ${report.consoleErrors.length}`);
  if (report.pageErrors.length) report.failures.push(`page error ${report.pageErrors.length}`);
  if (report.httpErrors.length) report.failures.push(`HTTP >=400 ${report.httpErrors.length}: ${report.httpErrors.join(' | ')}`);

  await browser.close();
  server.close();
  report.summary = { cases: report.cases.length, failures: report.failures.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, httpErrors: report.httpErrors.length };
  fs.writeFileSync(path.join(OUT, 'v2-verify-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary));
  if (report.failures.length) { console.log('FAILURES:\n' + report.failures.join('\n')); process.exitCode = 1; }
})().catch(e => { console.error('FATAL', e); try { server.close(); } catch (_) {} process.exit(1); });
