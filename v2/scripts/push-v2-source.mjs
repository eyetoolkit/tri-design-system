#!/usr/bin/env node
/* ============================================================
   TRI-BRAND UI v2 · push-v2-source.mjs
   ------------------------------------------------------------
   把重建后的 v2/ 源码层推到 eyetoolkit/tri-design-system 远端。

   为什么不 git add -A / git push：
     - 本环境 github.com git 协议不通，只能走 Git Data API
     - 该仓有 5 项他人未提交 WIP（package.json / tokens.css /
       i18n/index.ts / README.md / tokens-mono.css），覆盖式提交会吞掉
     - v2/ 是纯新增目录，按远端 tree 增量推最安全

   排除：临时报告与截图，只推源码、产物、文档、脚本、单测。
   ============================================================ */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pushChanges } from './gh.mjs';

const V2 = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const EXCLUDE = /^(attach-report|.*\.report\.json|.*\.png|.*\.log)$/i;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      walk(p, out);
    } else if (e.isFile() && !EXCLUDE.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(V2).sort();
const changes = files.map((f) => ({
  path: 'v2/' + relative(V2, f).replace(/\\/g, '/'),
  content: readFileSync(f),
}));
console.log(`push-v2-source · ${APPLY ? 'apply' : 'dry-run'} · ${changes.length} 个文件`);
for (const c of changes) console.log('  ' + c.path);

const r = await pushChanges({
  repo: 'tri-design-system',
  message: 'feat(v2): rebuild shared brand component layer - tokens from fe-shared, --tb-* isolation, P0-2 deploy tooling',
  changes,
  dryRun: !APPLY,
});
console.log(APPLY && r.commit ? `tri-design-system main -> ${r.commit.slice(0, 9)} ✓` : 'dry-run 完成，未推送');
