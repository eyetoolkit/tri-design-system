#!/usr/bin/env node
/* ============================================================
   TRI-BRAND UI v2 · gh.mjs
   ------------------------------------------------------------
   远端 tree 精确增量推送（GitHub Git Data API）。

   为什么不用 git push / push-tree-fast：
     本环境 github.com git 协议间歇不通，且各仓本地 origin/main 缓存
     落后真实远端 tip 若干提交。以本地 worktree 或本地 HEAD tree 为基
     推送，会把别人线上的新提交整段回滚。

   本工具铁律：
     1. parent 恒为「实时查询到的远端 main tip」
     2. tree 用 base_tree = 远端 tip 的 tree，只叠加本次变更项
     3. 待改文件的基准内容一律 GET 远端 blob，绝不读本地文件
     4. ref 更新 force:false，远端若在此期间前进则直接失败（不覆盖）
   ============================================================ */
import https from 'node:https';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'eyetoolkit';
if (!TOKEN) throw new Error('GH_TOKEN required');

function api(path, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com', path, method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'tri-brand-ui-p0-2',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data ? JSON.parse(data) : null);
        } else {
          reject(new Error(`${method} ${path} -> HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** 实时远端状态：tip / treeSha / path→entry 映射 */
export async function repoState(repo, branch = 'main') {
  const ref = await api(`/repos/${OWNER}/${repo}/git/refs/heads/${branch}`);
  const tip = ref.object.sha;
  const commit = await api(`/repos/${OWNER}/${repo}/git/commits/${tip}`);
  const tree = await api(`/repos/${OWNER}/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated) throw new Error(`${repo}: 远端 tree 被截断，禁止推送`);
  const map = new Map();
  for (const e of tree.tree || []) if (e.type === 'blob') map.set(e.path, e);
  return { tip, treeSha: commit.tree.sha, map };
}

export async function getBlob(repo, sha) {
  const b = await api(`/repos/${OWNER}/${repo}/git/blobs/${sha}`);
  return Buffer.from(b.content, b.encoding === 'base64' ? 'base64' : 'utf8');
}

async function createBlob(repo, buf) {
  const b = await api(`/repos/${OWNER}/${repo}/git/blobs`, 'POST', {
    content: buf.toString('base64'), encoding: 'base64',
  });
  return b.sha;
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

/**
 * pushChanges
 * changes: [{ path, content?, transform?, mode?, localPath? }]
 *   content   : Buffer|string —— 新增/整体替换（不读远端）
 *   transform : (baseBuf, path) => Buffer|string|null —— 基于远端内容改；返回 null = 跳过
 *   localPath : 可选，把最终内容同步写回本地（仅门禁/预览用）
 */
export async function pushChanges({ repo, branch = 'main', message, changes, dryRun = false, writeLocal = false }) {
  const st = await repoState(repo, branch);
  console.log(`[${repo}] tip=${st.tip.slice(0, 9)} tree=${st.treeSha.slice(0, 9)} blobs=${st.map.size}`);

  const blobCache = new Map();
  const baseOf = async (entry) => {
    if (!blobCache.has(entry.sha)) blobCache.set(entry.sha, await getBlob(repo, entry.sha));
    return blobCache.get(entry.sha);
  };

  const resolved = await mapLimit(changes, 8, async (c) => {
    const old = st.map.get(c.path);
    let buf;
    if (c.content !== undefined) {
      buf = Buffer.isBuffer(c.content) ? c.content : Buffer.from(c.content, 'utf8');
    } else {
      if (!old) throw new Error(`${c.path}: 远端不存在且未提供 content`);
      const base = await baseOf(old);
      if (typeof c.transform !== 'function') throw new Error(`${c.path}: 缺少 transform`);
      buf = await c.transform(base, c.path);
    }
    if (buf === null || buf === undefined) return null;
    if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf, 'utf8');
    if (old && (await baseOf(old)).equals(buf)) return null; // 内容未变，不产生提交项

    const sha = dryRun ? '(dry-run)' : await createBlob(repo, buf);
    if (writeLocal && c.localPath) {
      mkdirSync(dirname(c.localPath), { recursive: true });
      writeFileSync(c.localPath, buf);
    }
    return { path: c.path, mode: c.mode || (old ? old.mode : '100644'), type: 'blob', sha, isNew: !old };
  });

  const items = resolved.filter(Boolean);
  const fresh = items.filter((x) => x.isNew).length;
  console.log(`[${repo}] 变更 ${items.length} 个文件（新增 ${fresh} / 修改 ${items.length - fresh}）${dryRun ? ' [DRY-RUN]' : ''}`);
  if (!items.length) { console.log(`[${repo}] 无变更，跳过推送`); return { repo, tip: st.tip, commit: null, items: 0 }; }
  if (dryRun) {
    for (const x of items.slice(0, 12)) console.log(`   ${x.isNew ? '+' : '~'} ${x.path}`);
    if (items.length > 12) console.log(`   ... 另有 ${items.length - 12} 个文件`);
    return { repo, tip: st.tip, commit: null, items: items.length };
  }

  const tree = await api(`/repos/${OWNER}/${repo}/git/trees`, 'POST', {
    base_tree: st.treeSha,
    tree: items.map(({ path, mode, type, sha }) => ({ path, mode, type, sha })),
  });
  const commit = await api(`/repos/${OWNER}/${repo}/git/commits`, 'POST', {
    message, tree: tree.sha, parents: [st.tip],
  });
  await api(`/repos/${OWNER}/${repo}/git/refs/heads/${branch}`, 'PATCH', { sha: commit.sha, force: false });
  console.log(`[${repo}] ${branch} -> ${commit.sha.slice(0, 9)} ✓ (tree ${tree.sha.slice(0, 9)})`);
  return { repo, tip: st.tip, commit: commit.sha, tree: tree.sha, items: items.length };
}
