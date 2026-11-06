#!/usr/bin/env node
/* ============================================================
   TRI-BRAND UI v2 · attach.mjs
   ------------------------------------------------------------
   扫描三站源 HTML，输出 tri-ui.css 接入清单。
   默认 dry-run（只读、不写）；--apply 才在每个 HTML 的最后一个
   stylesheet link 之后追加一行 <link>。

   为什么追加在最后：v2 用 --tb-* / .tb-* 命名空间隔离，与存量
   皮肤零冲突，追加不会改变任何现有层叠结果。未来若取消隔离，
   再按「共享令牌 → 共享组件 → 站点皮肤」重排。

   时序硬约束：必须先跑 publish-shared.mjs 并推送 fe-shared，
   三站 public/shared/tri-ui.css 到位后才能执行 --apply。
   ============================================================ */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { resolve, join, relative, extname } from 'node:path';

const GAME = 'C:/Game';
const SITES = [
  { site: 'mathduel',   dir: join(GAME, 'mathduel-web') },
  { site: 'boardduel',  dir: join(GAME, 'boardduel-web') },
  { site: 'memoryduel', dir: join(GAME, 'memoryduel-web') },
];
/* boardduel-build/sections/*.html 是无 <head> 的 <div> 构建片段（未跟踪），不是独立页面 */
const SKIP = /^(dist|node_modules|vendor|legacy|boardduel-build|_audit|_backup|_eval|_tools|_md-old|_proto|_tmp|\.git|_build-verify)/i;
const LINK = '<link rel="stylesheet" href="/shared/tri-ui.css?v=1">';
const APPLY = process.argv.includes('--apply');

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP.test(e.name)) continue;
      walk(p, out);
    } else if (e.isFile() && extname(e.name).toLowerCase() === '.html') {
      out.push(p);
    }
  }
  return out;
}

const report = { mode: APPLY ? 'apply' : 'dry-run', link: LINK, sites: [], totals: { files: 0, pending: 0, attached: 0, noStylesheet: 0 } };

for (const s of SITES) {
  const files = walk(s.dir);
  const entry = { site: s.site, files: files.length, pending: [], attached: 0, noStylesheet: [] };
  for (const f of files) {
    let html;
    try { html = readFileSync(f, 'utf8'); } catch { continue; }
    if (html.includes('tri-ui.css')) { entry.attached++; report.totals.attached++; continue; }
    const links = [...html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi)];
    const rel = relative(GAME, f).replace(/\\/g, '/');
    if (!links.length) { entry.noStylesheet.push(rel); report.totals.noStylesheet++; continue; }
    entry.pending.push(rel);
    report.totals.pending++;
    if (APPLY) {
      const last = links[links.length - 1];
      const at = last.index + last[0].length;
      writeFileSync(f, html.slice(0, at) + '\n' + LINK + html.slice(at));
    }
  }
  entry.pendingCount = entry.pending.length;
  delete entry.pending; // 报告只留数量与样例，避免刷屏
  report.sites.push(entry);
  report.totals.files += files.length;
}

console.log(`attach · ${report.mode}`);
for (const s of report.sites) {
  console.log(`  ${s.site.padEnd(11)} html=${String(s.files).padStart(3)}  待接入=${String(s.pendingCount).padStart(3)}  已接入=${String(s.attached).padStart(3)}  无样式表=${s.noStylesheet.length}`);
  if (s.noStylesheet.length) console.log(`    无样式表样例: ${s.noStylesheet.slice(0, 3).join(', ')}`);
}
console.log(`  合计 html=${report.totals.files} 待接入=${report.totals.pending} 已接入=${report.totals.attached}`);
if (!APPLY) console.log('  dry-run：未写入任何文件。执行 --apply 前须先完成 fe-shared 推送 + 三站 sync:shared。');
writeFileSync(resolve(GAME, 'tri-design-system/v2/dist/attach-report.json'), JSON.stringify(report, null, 2));
