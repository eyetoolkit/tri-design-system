#!/usr/bin/env node
/* 生成自包含组件预览（CSS 内联 + 字体 base64），供交付预览面板直接打开。
 * 用法：node scripts/build-standalone.mjs [输出路径]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const V2 = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONTS = resolve(V2, '../src/fonts');
const OUT = process.argv[2] || resolve(V2, '../../_brand-ui-20261106/v2-components-preview.html');

const css = readFileSync(join(V2, 'dist', 'tri-ui.css'), 'utf8');
const b64 = p => readFileSync(join(FONTS, p)).toString('base64');
const fontFace =
  `@font-face{font-family:'Sora';font-style:normal;font-weight:400 800;font-display:swap;src:url(data:font/woff2;base64,${b64('sora-latin.woff2')}) format('woff2')}\n` +
  `@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:400 700;font-display:swap;src:url(data:font/woff2;base64,${b64('space-grotesk-latin.woff2')}) format('woff2')}\n`;

let html = readFileSync(join(V2, 'preview.html'), 'utf8');
/* 去掉外部 @font-face 段与 <link>，改为内联 */
html = html.replace(/<style>\s*@font-face[\s\S]*?<\/style>/, `<style>\n${fontFace}</style>`);
html = html.replace(/<link rel="stylesheet" href="\.\/dist\/tri-ui\.css">/, `<style>\n${css}\n</style>`);
if (html.includes('./dist/tri-ui.css') || html.includes('../src/fonts/')) {
  console.error('build-standalone FAILED: 仍有外部相对资源引用');
  process.exit(1);
}
html = html.replace('<title>TRI-BRAND UI v2 · 组件层预览与验证</title>',
  '<title>TRI-BRAND UI v2 · 组件层预览（自包含交付版）</title>');
writeFileSync(OUT, html);
console.log(`standalone ok → ${OUT} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
