#!/usr/bin/env node
/* ============================================================
   TRI-BRAND UI v2 · deploy-p0-2.mjs
   ------------------------------------------------------------
   P0-2 分发与接入，分三段执行，顺序不可颠倒：

     node scripts/deploy-p0-2.mjs a            # dry-run：推 shared/tri-ui.css
     node scripts/deploy-p0-2.mjs a --apply    # 实推
     node scripts/deploy-p0-2.mjs raw          # 等 raw CDN 收敛（失败退出 1）
     node scripts/deploy-p0-2.mjs b --apply    # 推 manifest.json（三站清单登记）
     node scripts/deploy-p0-2.mjs raw          # 再验 manifest 收敛
     三站 npm run sync:shared && sync:shared:check
     node scripts/deploy-p0-2.mjs c            # dry-run：106 页接入 + SW V + 共享 CSS
     node scripts/deploy-p0-2.mjs c --apply    # 实推三仓

   A→B 不能跳：三站 sync-shared.mjs 从 GitHub raw 拉文件，manifest 先登记
   而文件未上线会让三站 CI 门禁恒红（恒红门禁比没门禁更糟）。
   ============================================================ */
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pushChanges, repoState } from './gh.mjs';

const V2 = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GAME = 'C:/Game';
const CSS = readFileSync(join(V2, 'dist', 'tri-ui.css'));
const CSS_NAME = 'tri-ui.css';
const LINK = '<link rel="stylesheet" href="/shared/tri-ui.css?v=1">';
const RAW = 'https://raw.githubusercontent.com/eyetoolkit/fe-shared/main';
const SKIP = /^(dist|node_modules|vendor|legacy|boardduel-build|_audit|_backup|_eval|_tools|_md-old|_proto|_tmp|\.git|_build-verify)/i;

const step = process.argv[2];
const APPLY = process.argv.includes('--apply');
const SITES = [
  { repo: 'mathduel-web',   dir: join(GAME, 'mathduel-web'),   site: 'mathduel' },
  { repo: 'boardduel-web',  dir: join(GAME, 'boardduel-web'),  site: 'boardduel' },
  { repo: 'memoryduel-web', dir: join(GAME, 'memoryduel-web'), site: 'memoryduel' },
];

/* 基于远端 HTML 内容追加 link；幂等，无样式表的片段自动跳过 */
function attachTransform(base) {
  const html = base.toString('utf8');
  if (html.includes('tri-ui.css')) return null;
  const links = [...html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi)];
  if (!links.length) return null;
  const last = links[links.length - 1];
  const at = last.index + last[0].length;
  const nl = html.includes('\r\n') ? '\r\n' : '\n';
  return Buffer.from(html.slice(0, at) + nl + LINK + html.slice(at), 'utf8');
}

/* SW V 自动 +1：不硬编码当前版本，远端若已被他人升级也能正确递增 */
function bumpSw(base) {
  const s = base.toString('utf8');
  const m = s.match(/const V = '([a-z]+-v)(\d+)';/);
  if (!m) throw new Error('public/sw.js: 未找到 const V = \'<prefix>-v<N>\'; 格式');
  const next = `const V = '${m[1]}${Number(m[2]) + 1}';`;
  return Buffer.from(s.replace(m[0], next), 'utf8');
}

function manifestTransform(base) {
  const j = JSON.parse(base.toString('utf8'));
  for (const site of ['boardduel', 'memoryduel', 'mathduel']) {
    if (!Array.isArray(j[site])) throw new Error(`manifest 缺少 ${site} 清单`);
    if (!j[site].includes(CSS_NAME)) j[site].push(CSS_NAME);
  }
  return Buffer.from(JSON.stringify(j, null, 2) + '\n', 'utf8');
}

/* ---------------- A：推 shared/tri-ui.css ---------------- */
async function stepA() {
  console.log(`=== A · fe-shared/shared/${CSS_NAME} (${CSS.length} bytes) ===`);
  return pushChanges({
    repo: 'fe-shared',
    message: 'feat(shared): add tri-ui.css - unified tri-brand component layer v2',
    changes: [{ path: `shared/${CSS_NAME}`, content: CSS, localPath: join(GAME, 'fe-shared/shared', CSS_NAME) }],
    dryRun: !APPLY,
    writeLocal: APPLY,
  });
}

/* ---------------- B：manifest 登记 ---------------- */
async function stepB() {
  console.log('=== B · fe-shared/manifest.json 三站清单登记 ===');
  return pushChanges({
    repo: 'fe-shared',
    message: 'chore(shared): register tri-ui.css in boardduel/memoryduel/mathduel manifests',
    changes: [{ path: 'manifest.json', transform: manifestTransform, localPath: join(GAME, 'fe-shared/manifest.json') }],
    dryRun: !APPLY,
    writeLocal: APPLY,
  });
}

/* ---------------- CSS：可复现构建产物重分发 ----------------
   修复 build.mjs 里的墙钟时间戳后，产物字节变化，需把同一个文件
   重新推到 fe-shared 与三站 public/shared/（HTML link 不变，无需重接）。 */
async function stepCss() {
  console.log('=== CSS · 可复现产物重分发（fe-shared + 三站）===');
  const targets = [
    { repo: 'fe-shared', path: `shared/${CSS_NAME}`, local: join(GAME, 'fe-shared/shared', CSS_NAME) },
    ...SITES.map((s) => ({ repo: s.repo, path: `public/shared/${CSS_NAME}`, local: join(s.dir, 'public/shared', CSS_NAME) })),
  ];
  for (const t of targets) {
    await pushChanges({
      repo: t.repo,
      message: 'fix(brand): reproducible tri-ui.css build - drop wall-clock timestamp from artifact header',
      changes: [{ path: t.path, content: CSS, localPath: t.local }],
      dryRun: !APPLY,
      writeLocal: APPLY,
    });
  }
}

/* ---------------- raw 收敛验证 ---------------- */
async function stepRaw(scope = 'all') {
  console.log(`=== RAW · GitHub raw CDN 收敛验证 (scope=${scope}) ===`);
  const noCache = { headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }, signal: AbortSignal.timeout(20000) };
  const urls = [];
  if (scope === 'all' || scope === 'css') urls.push(`${RAW}/shared/${CSS_NAME}`);
  if (scope === 'all' || scope === 'manifest') urls.push(`${RAW}/manifest.json`);
  let ok = true;
  for (const u of urls) {
    try {
      const r = await fetch(u, noCache);
      const txt = await r.text();
      let pass;
      if (u.endsWith(CSS_NAME)) pass = r.ok && txt === CSS.toString('utf8');
      else {
        const j = JSON.parse(txt);
        pass = r.ok && ['boardduel', 'memoryduel', 'mathduel'].every((s) => j[s] && j[s].includes(CSS_NAME));
      }
      console.log(`  ${pass ? 'OK  ' : 'WAIT'} ${u} http=${r.status} bytes=${txt.length}`);
      if (!pass) ok = false;
    } catch (e) {
      console.log(`  FAIL ${u} -> ${e.message}`);
      ok = false;
    }
  }
  console.log(ok ? 'RAW 收敛 ✓' : 'RAW 尚未收敛（等 CDN 刷新后重跑 raw）');
  return ok;
}

/* ---------------- C：三站接入 ---------------- */
async function stepC() {
  console.log('=== C · 三站接入（HTML + public/shared/tri-ui.css + SW V）===');
  const results = [];
  for (const s of SITES) {
    const st = await repoState(s.repo);
    const html = [...st.map.keys()].filter((p) =>
      p.toLowerCase().endsWith('.html') && !p.split('/').some((seg) => SKIP.test(seg))
    );
    /* 只处理远端真实存在的、带样式表的页面；无样式表的构建片段由 transform 返回 null 跳过 */
    const changes = html.map((path) => ({ path, transform: attachTransform }));
    changes.push({
      path: `public/shared/${CSS_NAME}`, content: CSS,
      localPath: join(s.dir, 'public/shared', CSS_NAME),
    });
    changes.push({
      path: 'public/sw.js', transform: bumpSw,
      localPath: join(s.dir, 'public/sw.js'),
    });
    console.log(`--- ${s.repo}: 远端 HTML ${html.length} 个，候选变更 ${changes.length} 项 ---`);
    const r = await pushChanges({
      repo: s.repo,
      message: `feat(brand): load tri-ui.css across ${html.length} pages + bump SW cache version (P0-2)`,
      changes,
      dryRun: !APPLY,
      writeLocal: APPLY,
    });
    results.push(r);
  }
  return results;
}

let ok = true;
switch (step) {
  case 'a': await stepA(); break;
  case 'b': await stepB(); break;
  case 'c': await stepC(); break;
  case 'css': await stepCss(); break;
  case 'raw': {
    const arg = process.argv[3];
    ok = await stepRaw(arg && !arg.startsWith('--') ? arg : 'all');
    break;
  }
  default:
    console.error('用法: node scripts/deploy-p0-2.mjs <a|b|c|raw> [--apply]');
    process.exit(2);
}
if (!ok) process.exit(1);
