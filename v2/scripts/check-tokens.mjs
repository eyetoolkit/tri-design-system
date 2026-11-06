#!/usr/bin/env node
/* ============================================================
   TRI-BRAND UI v2 · check-tokens.mjs（机器守卫，建议挂进 build-gate）
   ------------------------------------------------------------
   守住三条铁律：
     1. 产物 --tb-* 的亮/暗值与 fe-shared/shared/tokens.css 逐值一致
     2. 产物里不允许出现 --tb-* 之外的自定义属性定义（防手改注入）
     3. 组件层所有 var(--tb-*) 引用都有定义（防漏令牌）
   用法：node scripts/check-tokens.mjs   （不一致 exit 1）
   ============================================================ */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const V2 = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS_PATH = process.env.FE_SHARED_TOKENS || resolve(V2, '../../fe-shared/shared/tokens.css');
const DIST = join(V2, 'dist', 'tri-ui.css');

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
const grab = (css, re, label) => {
  const m = css.match(re);
  if (!m) throw new Error(`缺少 ${label} 块`);
  return strip(m[1]);
};
const decls = src => {
  const out = new Map();
  const re = /--([A-Za-z0-9-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(src))) out.set(`--${m[1]}`, m[2].trim());
  return out;
};
const ns = v => v.replace(/var\(\s*--([A-Za-z0-9-]+)\s*\)/g, (_, n) => `var(--tb-${n})`);
const normalize = s => s.replace(/\s+/g, ' ').trim();

function run() {
  const fails = [];
  if (!existsSync(TOKENS_PATH)) throw new Error(`找不到真相源：${TOKENS_PATH}`);
  if (!existsSync(DIST)) throw new Error(`找不到产物：${DIST}（先跑 node scripts/build.mjs）`);

  const src = readFileSync(TOKENS_PATH, 'utf8');
  const dist = readFileSync(DIST, 'utf8');

  const expLight = decls(grab(src, /:root\s*\{([\s\S]*?)\}/, '真相源 :root'));
  const expDark = decls(grab(src, /html\[data-theme="dark"\]\s*\{([\s\S]*?)\}/, '真相源 dark'));
  const gotLight = decls(grab(dist, /:root\s*\{([\s\S]*?)\}/, '产物 :root'));
  const gotDark = decls(grab(dist, /html\[data-theme="dark"\]\s*\{([\s\S]*?)\}/, '产物 dark'));
  const EXTRA_OK = /^--tb-(s\d+|tap|container|e[123]|dur-(fast|base)|z-(overlay|modal|toast)|mono)$/;

  /* 1. 亮色逐值比对 */
  for (const [name, val] of expLight) {
    const key = `--tb-${name.slice(2)}`;
    if (!gotLight.has(key)) { fails.push(`缺少亮色令牌 ${key}`); continue; }
    if (normalize(gotLight.get(key)) !== normalize(ns(val))) {
      fails.push(`亮色值漂移 ${key}: 期望「${normalize(ns(val))}」实得「${normalize(gotLight.get(key))}」`);
    }
  }
  /* 2. 暗色逐值比对 */
  for (const [name, val] of expDark) {
    const key = `--tb-${name.slice(2)}`;
    if (!gotDark.has(key)) { fails.push(`缺少暗色令牌 ${key}`); continue; }
    if (normalize(gotDark.get(key)) !== normalize(ns(val))) {
      fails.push(`暗色值漂移 ${key}: 期望「${normalize(ns(val))}」实得「${normalize(gotDark.get(key))}」`);
    }
  }
  /* 3. 产物不允许非 tb- 前缀的变量定义 */
  for (const name of [...gotLight.keys(), ...gotDark.keys()]) {
    if (!name.startsWith('--tb-')) fails.push(`产物出现非命名空间变量 ${name}（会污染三站皮肤）`);
  }
  /* 4. 允许的组件层自有令牌白名单；其余 tb-* 必须来自真相源 */
  const knownLight = new Set([...expLight.keys()].map(n => `--tb-${n.slice(2)}`));
  for (const name of gotLight.keys()) {
    if (!knownLight.has(name) && !EXTRA_OK.test(name)) fails.push(`产物出现来源不明的令牌 ${name}`);
  }
  /* 5. 所有 var(--tb-*) 引用有定义 */
  const defined = new Set([...gotLight.keys(), ...gotDark.keys()]);
  const used = new Set([...dist.matchAll(/var\(\s*(--tb-[A-Za-z0-9-]+)\s*\)/g)].map(m => m[1]));
  for (const n of used) if (!defined.has(n)) fails.push(`未定义的令牌引用 ${n}`);

  if (fails.length) {
    console.error(`check-tokens FAILED (${fails.length}):`);
    fails.forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log(`check-tokens PASS · 亮 ${expLight.size} / 暗 ${expDark.size} 逐值一致 · ${used.size} 个引用全部有定义 · 0 越界变量`);
}

try { run(); } catch (e) { console.error(`check-tokens FAILED: ${e.message}`); process.exit(1); }
