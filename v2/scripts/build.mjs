#!/usr/bin/env node
/* ============================================================
   TRI-BRAND UI v2 · build.mjs
   ------------------------------------------------------------
   从 fe-shared/shared/tokens.css 读取品牌令牌值，命名空间化为
   --tb-*，拼上组件层，产出两个文件：
     v2/tokens.css          令牌段（供阅读/校验）
     v2/dist/tri-ui.css     单文件产物（供分发）

   设计约束：
   - 绝不手工维护第二套色值。令牌值只来自 fe-shared。
   - 不复制 @font-face（字体由各站 /fonts/ 自托管提供）。
   - 不复制 iOS 手感层等全局规则（会污染三站存量皮肤）。
   - --tb-* 前缀 + .tb-* 类名，与三站私有变量/类名完全隔离。

   用法：node scripts/build.mjs
   可用 FE_SHARED_TOKENS 环境变量覆盖真相源路径（仓库独立 clone 时）。
   ============================================================ */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const V2 = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS_PATH = process.env.FE_SHARED_TOKENS || resolve(V2, '../../fe-shared/shared/tokens.css');
const LAYERS = ['base.css', 'components.css', 'chrome.css', 'game-ui.css'];

/* 组件层自有令牌：仅几何 / 动效 / 层级，不含品牌色板值。
   品牌色一律来自 fe-shared；此处只有中性阴影的 rgba，不参与品牌配色。 */
const EXTRA = `
  /* ── 组件层自有（几何 / 动效 / 层级，非品牌色） ── */
  --tb-s1: 4px;  --tb-s2: 8px;  --tb-s3: 12px; --tb-s4: 16px;
  --tb-s5: 20px; --tb-s6: 24px; --tb-s8: 32px; --tb-s10: 40px;
  --tb-s12: 48px; --tb-s16: 64px;
  --tb-tap: 44px;
  --tb-container: 1200px;
  --tb-e1: 0 1px 2px rgba(30,27,57,.05);
  --tb-e2: 0 2px 6px rgba(30,27,57,.06), 0 8px 24px rgba(30,27,57,.07);
  --tb-e3: 0 8px 20px rgba(30,27,57,.10), 0 24px 56px rgba(30,27,57,.13);
  --tb-dur-fast: 150ms;
  --tb-dur-base: 260ms;
  --tb-z-overlay: 300; --tb-z-modal: 400; --tb-z-toast: 500;
  /* 字体别名：fe-shared 的 --font-mono 映射为 --tb-font-mono */
  --tb-mono: var(--tb-font-mono);
`;

const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '');

function block(css, re, label) {
  const m = css.match(re);
  if (!m) throw new Error(`真相源缺少 ${label} 块：${TOKENS_PATH}`);
  return stripComments(m[1]);
}

function declarations(src) {
  const out = [];
  const re = /--([A-Za-z0-9-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(src))) out.push({ name: m[1], value: m[2].trim() });
  return out;
}

/* 值里的 var(--x) 必须同步改名，否则 --tb-brand 会指向不存在的 --brand-600 */
const nsValue = v => v.replace(/var\(\s*--([A-Za-z0-9-]+)\s*\)/g, (_, n) => `var(--tb-${n})`);

function render(decls, indent = '  ') {
  return decls.map(d => `${indent}--tb-${d.name}: ${nsValue(d.value)};`).join('\n');
}

function main() {
  if (!existsSync(TOKENS_PATH)) {
    throw new Error(`找不到 fe-shared 令牌真相源：${TOKENS_PATH}\n可用 FE_SHARED_TOKENS=<path> 指定。`);
  }
  const src = readFileSync(TOKENS_PATH, 'utf8');
  const light = declarations(block(src, /:root\s*\{([\s\S]*?)\}/, ':root'));
  const dark = declarations(block(src, /html\[data-theme="dark"\]\s*\{([\s\S]*?)\}/, 'html[data-theme="dark"]'));
  if (light.length < 30) throw new Error(`真相源 :root 令牌数异常（${light.length}），拒绝生成`);

  const tokens =
    `/* 本文件由 scripts/build.mjs 生成，请勿手改。\n` +
    ` * 真相源：fe-shared/shared/tokens.css\n` +
    ` * 命名空间：--tb-*（与三站私有变量隔离）\n` +
    ` * 构建：确定性输出（不含时间戳）\n` +
    ` */\n\n` +
    `:root {\n${render(light)}\n${EXTRA}}\n\n` +
    `html[data-theme="dark"] {\n${render(dark)}\n}\n`;

  /* 静态校验：所有 var(--tb-*) 引用都必须有定义，防止漏令牌 */
  const defined = new Set([...light, ...dark].map(d => `--tb-${d.name}`));
  const extraNames = [...EXTRA.matchAll(/--(tb-[A-Za-z0-9-]+)\s*:/g)].map(m => `--${m[1]}`);
  extraNames.forEach(n => defined.add(n));
  const used = new Set();
  let layerCss = '';
  for (const f of LAYERS) {
    const p = join(V2, f);
    if (!existsSync(p)) throw new Error(`缺少样式层：${p}`);
    layerCss += `\n/* ── ${f} ── */\n` + readFileSync(p, 'utf8');
  }
  for (const m of (tokens + layerCss).matchAll(/var\(\s*(--tb-[A-Za-z0-9-]+)\s*\)/g)) used.add(m[1]);
  const missing = [...used].filter(n => !defined.has(n));
  if (missing.length) throw new Error(`有未定义的 --tb-* 令牌引用：${missing.join(', ')}`);

  writeFileSync(join(V2, 'tokens.css'), tokens);
  const banner =
    `/* ============================================================\n` +
    ` * TRI-BRAND UI v2 · tri-ui.css  —  自动生成，请勿手改\n` +
    ` * 令牌真相源：fe-shared/shared/tokens.css（本文件不含第二套色值）\n` +
    ` * 命名空间：令牌 --tb-* / 组件 .tb-*（与三站存量皮肤零冲突）\n` +
    ` * 层次：tokens → base → components → chrome → game-ui\n` +
    ` * 构建：node scripts/build.mjs   校验：node scripts/check-tokens.mjs\n` +
    ` * ============================================================ */\n`;
  writeFileSync(join(V2, 'dist', 'tri-ui.css'), banner + tokens + layerCss);

  console.log(`build ok`);
  console.log(`  light tokens : ${light.length}`);
  console.log(`  dark tokens  : ${dark.length}`);
  console.log(`  extra tokens : ${extraNames.length}`);
  console.log(`  var() refs   : ${used.size} (0 undefined)`);
  console.log(`  output       : v2/dist/tri-ui.css`);
}

try { main(); } catch (e) { console.error(`build FAILED: ${e.message}`); process.exit(1); }
