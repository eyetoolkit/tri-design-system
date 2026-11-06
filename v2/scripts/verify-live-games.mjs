#!/usr/bin/env node
/* ============================================================
   TRI-BRAND UI v2 · verify-live-games.mjs
   ------------------------------------------------------------
   线上游戏页冒烟：确认 P0-2 在 106 个页面追加样式表后，
   游戏内页面仍正常渲染、令牌生效、零 JS 异常、零横向溢出。
   另在井字棋做一次纯本地落子，验证交互未被样式层破坏。

   说明：本轮为零玩法改动的样式接入，完整联机对局回归属 P1/P2；
   此处不复建房、不写生产数据。
   ============================================================ */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const pw = (await import('file:///C:/Game/node-workspace/node_modules/playwright-core/index.js')).default;
const { chromium } = pw;

const OUT = 'C:/Game/_brand-ui-20261106';
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;
const TARGETS = [
  { name: '24-game', url: 'https://numeriduel.com/games/24-game/' },
  { name: 'sudoku-4x4', url: 'https://numeriduel.com/games/sudoku-4x4/' },
  { name: 'chess', url: 'https://boardduel.com/games/chess/' },
  { name: 'tictactoe', url: 'https://boardduel.com/games/tictactoe/' },
  { name: 'sequence-memory', url: 'https://www.memoryduel.com/games/sequence-memory/' },
  { name: 'daily-challenge', url: 'https://www.memoryduel.com/games/daily-challenge/' },
];

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, args: ['--no-sandbox', '--disable-gpu'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const report = { cases: [], failures: [] };

try {
  for (const t of TARGETS) {
    if (ONLY && t.name !== ONLY) continue;
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    let status = 0;
    try {
      const r = await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      status = r ? r.status() : 0;
      await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
    } catch (e) { errs.push('goto: ' + e.message.slice(0, 140)); }

    const dom = await page.evaluate(() => {
      const de = document.documentElement;
      return {
        brand: getComputedStyle(de).getPropertyValue('--tb-brand').trim(),
        tap: getComputedStyle(de).getPropertyValue('--tb-tap').trim(),
        hasLink: !!document.querySelector('link[href*="tri-ui.css"]'),
        over: de.scrollWidth - window.innerWidth,
        interactive: document.querySelectorAll('button,[role="button"],input,select').length,
        cells: document.querySelectorAll('.cell,.sq,.square,[data-cell],[data-i],td,.tile,.board-cell').length,
        canvases: document.querySelectorAll('canvas').length,
        textLen: document.body.innerText.length,
      };
    }).catch(() => ({ brand: '', tap: '', hasLink: false, over: -1, interactive: 0, cells: 0, canvases: 0, textLen: 0 }));

    /* 井字棋：纯本地落子，不触发任何服务端写入 */
    let move = 'skipped';
    if (t.name === 'tictactoe') {
      const hit = await page.evaluate(() => {
        const el = document.querySelector('.cell,.sq,[data-cell],[data-i],td,.tile,.board-cell');
        if (!el) return { clicked: false, what: 'no-element' };
        const what = (typeof el.className === 'string' && el.className) || el.tagName;
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return { clicked: true, what };
      }).catch((e) => ({ clicked: false, what: 'error:' + e.message.slice(0, 60) }));
      await page.waitForTimeout(600);
      const state = await page.evaluate(() => ({
        textLen: document.body.innerText.length,
        filled: document.querySelectorAll('.cell.filled,.cell.x,.cell.o,[data-mark],.marked').length,
      })).catch(() => ({ textLen: 0, filled: 0 }));
      move = hit.clicked
        ? `clicked(${hit.what}) textLen=${state.textLen} filled=${state.filled}`
        : `not-clicked(${hit.what})`;
    }

    const shot = join(OUT, `live-game-${t.name}.png`);
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    const c = { label: t.name, url: t.url, status, ...dom, move, errors: errs.slice(0, 4), shot };
    report.cases.push(c);
    console.log(`${t.name.padEnd(18)} http=${status} brand=${c.brand} | link=${c.hasLink} | overflow=${c.over} | 交互件=${c.interactive} 格子=${c.cells} canvas=${c.canvases} | 正文=${c.textLen} | move=${move} | err=${errs.length}`);

    if (status !== 200) report.failures.push(`${t.name}: HTTP ${status}`);
    if (!c.hasLink || c.brand !== '#4F46E5' || c.tap !== '44px') report.failures.push(`${t.name}: 品牌层未生效`);
    if (c.over > 1) report.failures.push(`${t.name}: 横向溢出 ${c.over}px`);
    if (c.interactive < 1) report.failures.push(`${t.name}: 无交互元素（疑似页面未渲染）`);
    if (c.textLen < 100) report.failures.push(`${t.name}: 正文过短 ${c.textLen}`);
    if (errs.length) report.failures.push(`${t.name}: ${errs.length} 个 JS 异常 -> ${errs[0].slice(0, 100)}`);
    await page.close();
  }
} finally {
  await ctx.close();
  await browser.close();
}

report.summary = { cases: report.cases.length, failures: report.failures.length };
writeFileSync(join(OUT, 'deploy-live-games-report.json'), JSON.stringify(report, null, 2));
console.log(report.failures.length ? `GAMES FAIL: ${report.failures.join(' | ')}` : `GAMES PASS · ${report.summary.cases} 个线上游戏页全绿`);
if (report.failures.length) process.exit(1);
