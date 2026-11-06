/* TRI-BRAND UI v2 · 令牌契约单测
 * 运行：node --test tests/tokens.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const V2 = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const run = (script, args = []) => execFileSync(node, [join(V2, 'scripts', script), ...args], { encoding: 'utf8' });

test('构建产物存在且可通过令牌守卫', () => {
  const out = run('build.mjs');
  assert.match(out, /build ok/);
  assert.match(out, /0 undefined/);
  assert.ok(existsSync(join(V2, 'dist', 'tri-ui.css')), 'dist/tri-ui.css 应生成');
  assert.ok(existsSync(join(V2, 'tokens.css')), 'tokens.css 应生成');
  const check = run('check-tokens.mjs');
  assert.match(check, /check-tokens PASS/);
});

test('亮色品牌令牌与 fe-shared 真相源逐值一致', () => {
  const src = readFileSync(resolve(V2, '../../fe-shared/shared/tokens.css'), 'utf8');
  const dist = readFileSync(join(V2, 'dist', 'tri-ui.css'), 'utf8');
  const get = (css, re, name) => {
    const block = css.match(re)[1];
    const m = block.match(new RegExp('--' + name + '\\s*:\\s*([^;]+);'));
    return m && m[1].trim();
  };
  const rootRe = /:root\s*\{([\s\S]*?)\}/;
  const pairs = [
    ['brand-600', 'brand-600'], ['brand-700', 'brand-700'],
    ['ink', 'ink'], ['paper', 'paper'], ['ember', 'ember'],
    ['success', 'success'], ['danger', 'danger'],
  ];
  for (const [srcName, outName] of pairs) {
    assert.equal(
      get(dist, rootRe, `tb-${outName}`),
      get(src, rootRe, srcName),
      `--tb-${outName} 必须等于 fe-shared --${srcName}`
    );
  }
});

test('暗色令牌正确翻面且引用已命名空间化', () => {
  const dist = readFileSync(join(V2, 'dist', 'tri-ui.css'), 'utf8');
  const dark = dist.match(/html\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)[1];
  assert.match(dark, /--tb-brand:\s*#818CF8/);
  assert.match(dark, /--tb-ink:\s*#12131F/);
  assert.match(dark, /--tb-paper:\s*#E8EAF4/);
  const root = dist.match(/:root\s*\{([\s\S]*?)\}/)[1];
  assert.match(root, /--tb-brand:\s*var\(--tb-brand-600\)/, 'var() 引用必须同步改名');
  assert.match(root, /--tb-mono:\s*var\(--tb-font-mono\)/, '字体别名必须指向命名空间变量');
});

test('产物不含非命名空间的自定义属性定义', () => {
  const dist = readFileSync(join(V2, 'dist', 'tri-ui.css'), 'utf8');
  const blocks = [...dist.matchAll(/:root\s*\{([\s\S]*?)\}|html\[data-theme="dark"\]\s*\{([\s\S]*?)\}/g)];
  for (const b of blocks) {
    const defs = [...(b[1] || b[2]).matchAll(/--([A-Za-z0-9-]+)\s*:/g)].map(m => m[1]);
    for (const d of defs) assert.ok(d.startsWith('tb-'), `越界变量 --${d}`);
  }
});

test('组件层关键类与命名空间齐备', () => {
  const dist = readFileSync(join(V2, 'dist', 'tri-ui.css'), 'utf8');
  for (const cls of ['.tb-btn--primary', '.tb-card', '.tb-input', '.tb-header', '.tb-hero-band', '.tb-sidebar', '.tb-playerbar', '.tb-timer', '.tb-result-card']) {
    assert.ok(dist.includes(cls), `缺少组件 ${cls}`);
  }
  assert.match(dist, /--tb-tap:\s*44px/);
  assert.match(dist, /prefers-reduced-motion/);
  assert.match(dist, /\.tb-btn:focus-visible/);
});

test('篡改产物会被守卫拦下', () => {
  const p = join(V2, 'dist', 'tri-ui.css');
  const original = readFileSync(p, 'utf8');
  try {
    const tampered = original.replace('--tb-brand-600: #4F46E5;', '--tb-brand-600: #000000;');
    assert.notEqual(tampered, original, '测试前提：产物里应能找到该声明');
    writeFileSync(p, tampered);
    assert.throws(() => run('check-tokens.mjs'), /Command failed/, '值漂移必须让守卫 exit 1');
  } finally {
    writeFileSync(p, original);
    run('build.mjs'); // 恢复为干净产物
  }
});
