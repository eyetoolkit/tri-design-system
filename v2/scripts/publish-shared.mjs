#!/usr/bin/env node
/* ============================================================
   TRI-BRAND UI v2 · publish-shared.mjs
   ------------------------------------------------------------
   把构建产物放进 fe-shared 分发通道。默认 dry-run。

   ⚠ 时序铁律（顺序不可颠倒）：
     1. node scripts/publish-shared.mjs --apply   写 fe-shared/shared/tri-ui.css
     2. 推送 fe-shared 到 GitHub（唯一入口 git push origin main）
     3. 等 raw CDN 收敛，确认 raw.githubusercontent.com 能取到新文件
     4. 才把 "tri-ui.css" 加进 fe-shared/manifest.json 的三站清单
     5. 三站各跑 npm run sync:shared，再跑 sync:shared:check
     6. 最后才执行 attach.mjs --apply

   为什么 3→4 不能跳：三站 sync-shared.mjs 从 GitHub raw 拉文件，
   本地改 manifest 不会被 CI 看到；先加清单会让三站门禁恒红
   （恒红门禁比没门禁更糟）。本脚本刻意不自动改 manifest。
   ============================================================ */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const V2 = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(V2, 'dist', 'tri-ui.css');
const DEST = resolve(V2, '../../fe-shared/shared/tri-ui.css');
const APPLY = process.argv.includes('--apply');

if (!existsSync(SRC)) {
  console.error('publish-shared FAILED: 缺少 dist/tri-ui.css，先跑 node scripts/build.mjs');
  process.exit(1);
}
const css = readFileSync(SRC);
const same = existsSync(DEST) && readFileSync(DEST).equals(css);

console.log(`publish-shared · ${APPLY ? 'apply' : 'dry-run'}`);
console.log(`  src : ${SRC} (${css.length} bytes)`);
console.log(`  dest: ${DEST}`);
console.log(`  状态: ${same ? '目标已一致，无需写入' : APPLY ? '写入' : '待写入'}`);

if (APPLY && !same) {
  writeFileSync(DEST, css);
  console.log('  已写入 fe-shared/shared/tri-ui.css');
}

console.log('\n下一步（本脚本不自动执行）：');
console.log('  1. cd fe-shared && git add shared/tri-ui.css && git commit && git push origin main');
console.log('  2. 等 raw CDN 收敛：curl -I https://raw.githubusercontent.com/eyetoolkit/fe-shared/main/shared/tri-ui.css');
console.log('  3. 再把 "tri-ui.css" 加进 manifest.json 的 boardduel / memoryduel / mathduel 三份清单');
console.log('  4. 三站各跑 npm run sync:shared && npm run sync:shared:check');
console.log('  5. node scripts/attach.mjs --apply');
console.log('\n⚠ 改 /shared/ 内容后，三站 SW CACHE_VERSION 必须升版本，否则老用户命中 SWR 旧缓存。');
