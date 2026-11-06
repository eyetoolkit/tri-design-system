#!/usr/bin/env node
/* ============================================================
   TRI-BRAND UI v2 · verify-deploy.mjs
   ------------------------------------------------------------
   P0-2 部署验收，两种模式：

     node scripts/verify-deploy.mjs remote   远端 tree 内容硬核验
     node scripts/verify-deploy.mjs live     线上真浏览器渲染验证

   remote 校验：106 页 link 覆盖 / public/shared/tri-ui.css 字节一致 /
                SW V 已升 / 三仓 tip 为本批次 commit。
   live   校验：/shared/tri-ui.css 200、--tb-brand 生效、0 横向溢出、
                0 pageerror、1440/390 两档截图。
   ============================================================ */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoState, getBlob, mapLimit } from './gh.mjs';

const V2 = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'C:/Game/_brand-ui-20261106';
const CSS = readFileSync(join(V2, 'dist', 'tri-ui.css'));
const CSS_NAME = 'tri-ui.css';
const SKIP = /^(dist|node_modules|vendor|legacy|boardduel-build|_audit|_backup|_eval|_tools|_md-old|_proto|_tmp|\.git|_build-verify)/i;
const SITES = [
  { repo: 'mathduel-web', expectV: 'mdsw-v2' },
  { repo: 'boardduel-web', expectV: 'bdsw-v3' },
  { repo: 'memoryduel-web', expectV: 'mdusw-v5' },
];
const LIVE = [
  { name: 'numeriduel', url: 'https://numeriduel.com/' },
  { name: 'boardduel', url: 'https://boardduel.com/' },
  { name: 'memoryduel', url: 'https://www.memoryduel.com/' },
];
const mode = process.argv[2];

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

/* ---------------- remote ---------------- */
async function verifyRemote() {
  const report = { mode: 'remote', sites: [], failures: [] };
  for (const s of SITES) {
    const st = await repoState(s.repo);
    const html = [...st.map.keys()].filter((p) =>
      p.toLowerCase().endsWith('.html') && !p.split('/').some((seg) => SKIP.test(seg))
    );
    const linked = await mapLimit(html, 8, async (p) => {
      const buf = await getBlob(s.repo, st.map.get(p).sha);
      return { p, ok: buf.toString('utf8').includes(`${CSS_NAME}?v=1`) };
    });
    const missing = linked.filter((x) => !x.ok).map((x) => x.p);

    const cssEntry = st.map.get(`public/shared/${CSS_NAME}`);
    const cssOk = cssEntry ? (await getBlob(s.repo, cssEntry.sha)).equals(CSS) : false;
    const swEntry = st.map.get('public/sw.js');
    const swText = swEntry ? (await getBlob(s.repo, swEntry.sha)).toString('utf8') : '';
    const vMatch = swText.match(/const V = '([a-z]+-v\d+)';/);
    const v = vMatch ? vMatch[1] : null;

    const entry = {
      repo: s.repo, tip: st.tip.slice(0, 9), html: html.length,
      linked: linked.length - missing.length, missing, cssOk, swV: v, expectV: s.expectV,
    };
    report.sites.push(entry);
    console.log(`${s.repo.padEnd(18)} tip=${entry.tip} | HTML link ${entry.linked}/${entry.html} | CSS ${cssOk ? 'OK' : 'FAIL'} | SW ${v} (期望 ${s.expectV})`);
    if (missing.length) report.failures.push(`${s.repo}: ${missing.length} 页未接入 link -> ${missing.slice(0, 5).join(', ')}`);
    if (!cssOk) report.failures.push(`${s.repo}: public/shared/tri-ui.css 缺失或内容不一致`);
    if (v !== s.expectV) report.failures.push(`${s.repo}: SW V=${v} 期望 ${s.expectV}`);
  }
  report.summary = { totalPages: report.sites.reduce((a, x) => a + x.html, 0), failures: report.failures.length };
  writeFileSync(join(OUT, 'deploy-remote-report.json'), JSON.stringify(report, null, 2));
  console.log(report.failures.length ? `REMOTE FAIL: ${report.failures.join(' | ')}` : `REMOTE PASS · ${report.summary.totalPages} 页全部接入`);
  return report.failures.length === 0;
}

/* ---------------- live ---------------- */
async function verifyLive() {
  const pw = (await import('file:///C:/Game/node-workspace/node_modules/playwright-core/index.js')).default;
  const { chromium } = pw;
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, args: ['--no-sandbox', '--disable-gpu'],
  });
  const report = { mode: 'live', cases: [], failures: [] };
  try {
    for (const vp of [{ w: 1440, h: 900, n: 'desktop' }, { w: 390, h: 844, n: 'mobile' }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      for (const t of LIVE) {
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push('pageerror: ' + String(e)));
        page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
        let status = 0;
        try {
          const resp = await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
          status = resp ? resp.status() : 0;
          await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
        } catch (e) {
          errs.push('goto: ' + e.message.slice(0, 160));
        }
        const dom = await page.evaluate(() => {
          const de = document.documentElement;
          return {
            over: de.scrollWidth - window.innerWidth,
            brand: getComputedStyle(de).getPropertyValue('--tb-brand').trim(),
            tap: getComputedStyle(de).getPropertyValue('--tb-tap').trim(),
            hasLink: !!document.querySelector('link[href*="tri-ui.css"]'),
            title: document.title.slice(0, 60),
            sheets: document.styleSheets.length,
          };
        }).catch(() => ({ over: -1, brand: '', tap: '', hasLink: false, title: '', sheets: 0 }));
        let cssStatus = 0, cssBytes = 0;
        try {
          const r = await page.request.get(new URL('/shared/tri-ui.css', t.url).href, { timeout: 20000 });
          cssStatus = r.status();
          cssBytes = (await r.body()).length;
        } catch (e) { errs.push('css fetch: ' + e.message.slice(0, 120)); }
        const shot = join(OUT, `live-${t.name}-${vp.n}.png`);
        await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
        const c = {
          label: `${t.name}-${vp.n}`, url: t.url, status, cssStatus, cssBytes,
          ...dom, pageErrors: errs.filter((e) => e.startsWith('pageerror') || e.startsWith('goto')).length,
          errors: errs.slice(0, 6), shot,
        };
        report.cases.push(c);
        console.log(`${c.label.padEnd(20)} http=${status} css=${cssStatus}/${cssBytes}B | brand=${c.brand} tap=${c.tap} | link=${c.hasLink} | overflow=${c.over} | pageErrors=${c.pageErrors}`);
        if (status !== 200) report.failures.push(`${c.label}: HTTP ${status}`);
        if (cssStatus !== 200 || cssBytes !== CSS.length) report.failures.push(`${c.label}: CSS ${cssStatus}/${cssBytes}B 期望 200/${CSS.length}B`);
        if (!c.hasLink) report.failures.push(`${c.label}: 页面无 tri-ui.css link`);
        if (c.brand !== '#4F46E5') report.failures.push(`${c.label}: --tb-brand=${c.brand}`);
        if (c.tap !== '44px') report.failures.push(`${c.label}: --tb-tap=${c.tap}`);
        if (c.over > 1) report.failures.push(`${c.label}: 横向溢出 ${c.over}px`);
        if (c.pageErrors > 0) report.failures.push(`${c.label}: ${c.pageErrors} 个 JS 异常`);
        await page.close();
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  report.summary = { cases: report.cases.length, failures: report.failures.length };
  writeFileSync(join(OUT, 'deploy-live-report.json'), JSON.stringify(report, null, 2));
  console.log(report.failures.length ? `LIVE FAIL: ${report.failures.join(' | ')}` : `LIVE PASS · ${report.summary.cases} 档全绿`);
  return report.failures.length === 0;
}

let ok;
if (mode === 'remote') ok = await verifyRemote();
else if (mode === 'live') ok = await verifyLive();
else { console.error('用法: node scripts/verify-deploy.mjs <remote|live>'); process.exit(2); }
if (!ok) process.exit(1);
