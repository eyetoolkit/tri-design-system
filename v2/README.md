# TRI-BRAND UI v2 · 三站统一品牌设计系统

> 2026-11-06 重建 · 刘哥拍板「共享组件层重建 `tri-design-system`」
> 本目录为**全新增**，不覆盖 `src/` 下任何未提交 WIP。

## 定位与架构

| 角色 | 归属 |
|---|---|
| 品牌令牌**唯一真相源** | `eyetoolkit/fe-shared` 的 `shared/tokens.css`（靛蓝 · 冷 · Sora，2026-10-23 拍板） |
| 设计系统**源码**（组件层 + 规范 + 构建/守卫） | 本目录 `tri-design-system/v2/` |
| **分发通道** | `fe-shared/shared/tri-ui.css` → `manifest.json` → 三站 `sync-shared.mjs` |
| **消费** | 三站 `public/shared/tri-ui.css`，各页 `<link>` 引入 |

```
fe-shared/shared/tokens.css  ──值──▶  v2/scripts/build.mjs
                                        │
                    base / components / chrome / game-ui
                                        │
                                        ▼
                              v2/dist/tri-ui.css  (--tb-* / .tb-*)
                                        │ publish-shared.mjs
                                        ▼
                              fe-shared/shared/tri-ui.css
                                        │ sync-shared.mjs
                                        ▼
                        三站 public/shared/tri-ui.css → <link>
```

**绝不手工维护第二套色值**：`v2/tokens.css` 与 `dist/tri-ui.css` 由构建脚本生成，令牌值逐项取自 fe-shared；`check-tokens.mjs` 守着这条线。

## 为什么必须命名空间隔离

| 风险 | 后果 | 隔离方式 |
|---|---|---|
| memoryduel 私有 `home.css` 的 `--ink`/`--paper` 与 fe-shared **语义相反** | 直接叠 `<link>` 按加载顺序互相覆盖，暗色翻车（11-05 已踩） | 全部令牌改 `--tb-*` |
| 三站各自定义 `.btn` / `.card` / `.site-header` | 共享层注入后大面积覆盖现有样式 | 全部组件改 `.tb-*` |
| 全局 reset / `user-select` | 污染三站存量交互 | v2 **不做全局 reset**，只作用于 `.tb-*` 与 `.tb-scope` |

因此 v2 产物**追加在现有 stylesheet 之后**即可，零层叠影响。未来若取消隔离，再按「共享令牌 → 共享组件 → 站点皮肤」重排。

## 样式层

| 文件 | 内容 |
|---|---|
| `base.css` | 排版尺度、焦点态、工具类和 reduced-motion（scoped） |
| `components.css` | 按钮 / 卡片 / chip / 表单 / tabs / skeleton / spinner / empty / toast / modal 全状态 |
| `chrome.css` | 64px 顶栏、1200px 容器、4→3→2→1 栅格、Hero 独立深带、180px 侧栏、房间卡、页脚 |
| `game-ui.css` | PlayerBar / Timer / MoveFeedback / ResultModal 四类游戏内通用件 |

## 锁定硬值

| 项 | 值 | 替换的漂移 |
|---|---|---|
| 顶栏高度 | 64px | 69 / 73 / 65px |
| 卡片圆角 | 18px | 24 / 18 / 20px |
| 主 CTA | `--tb-brand-600` #4F46E5 | 琥珀 vs 靛蓝混用 |
| 字标 | lowercase + 24px 方形标记 | `MemoryDuel` vs `memoryduel` |
| 侧栏 | 180px（<768px 折叠为 tabs） | 236 / 265px |
| Hero 深带 | **独立内容块 ≤40% 视口** | 11-05 实测 34.2% / 29.1%，已拍板 |
| 触摸目标 | 44px | 现存 21px 顶栏待修 |

Hero 深带必须是独立块、高度由标题三件套自然撑开；**不要**用固定 vh 高度带 + 内容跨深浅两区（字体加载 / 200% 缩放 / 移动换行时必出白字压浅底）。

## 无障碍（WCAG AA 默认门槛）

- 主 CTA 亮色 6.29:1、`--tb-brand-700` 白字 7.90:1、暗色主 CTA 6.28:1、琥珀配深字 7.69:1（11-05 真浏览器实测值）
- **`#F59E0B + 白字 = 2.31:1` 明令禁止**，琥珀一律配 `#1E1B39` 深字
- `--tb-mute2` 约 2.9:1，只允许 ≥24px 大字或图形，禁止作正文（对应 `.tb-deco`）
- 所有可交互元素 `min-height:44px`；`:focus-visible` 2px 品牌色 outline + 2px offset
- 错误态同时给红描边与「!」文字，不靠颜色单独表意
- `prefers-reduced-motion` 全量降级

## 命令

```bash
cd tri-design-system/v2
node scripts/build.mjs              # 生成 tokens.css + dist/tri-ui.css
node scripts/check-tokens.mjs       # 令牌逐值守卫（亮/暗 + 越界变量 + 漏引用）
node --test tests/tokens.test.mjs   # 单测
node scripts/attach.mjs             # 干跑：三站接入清单
node scripts/publish-shared.mjs     # 干跑：分发计划
node scripts/verify-preview.mjs     # 组件层真浏览器验证 + Hero 占比硬断言
node scripts/build-standalone.mjs   # 生成自包含预览（CSS 内联 + 字体 base64）

# —— P0-2 部署工具（需 GH_TOKEN；默认 dry-run，--apply 才写远端）——
node scripts/deploy-p0-2.mjs a --apply      # A：推 shared/tri-ui.css
node scripts/deploy-p0-2.mjs raw css        # 等 raw 收敛
node scripts/deploy-p0-2.mjs b --apply      # B：manifest 登记
node scripts/deploy-p0-2.mjs c --apply      # C：三站 106 页接入 + SW V
node scripts/deploy-p0-2.mjs css --apply    # 产物重分发（fe-shared + 三站）
node scripts/verify-deploy.mjs remote       # 远端 tree 硬核验
node scripts/verify-deploy.mjs live         # 线上真浏览器 3 站 × 2 档
node scripts/verify-live-games.mjs          # 线上游戏页冒烟 + 本地落子
node scripts/push-v2-source.mjs --apply    # 推 v2/ 源码到设计系统仓
```

仓库独立 clone 时可用 `FE_SHARED_TOKENS=<path>` 指定真相源。

**构建产物必须可复现**：`build.mjs` 不得写入时间戳、随机数等墙钟字段。分发通道与远端核验按字节比对，产物每次构建都变会造成假漂移（2026-11-06 已修）。

## 分发时序（顺序不可颠倒 · 2026-11-06 P0-2 已按此执行）

1. `node scripts/publish-shared.mjs --apply` → 写 `fe-shared/shared/tri-ui.css`
2. **推送 fe-shared**（唯一入口 `git push origin main`），等 GitHub raw CDN 收敛并实测可取
3. 才把 `"tri-ui.css"` 加进 `fe-shared/manifest.json` 的 boardduel / memoryduel / mathduel 三份清单
4. 三站各跑 `npm run sync:shared` + `npm run sync:shared:check`
5. `node scripts/attach.mjs --apply` → 各 HTML 追加 `<link>`
6. **升三站 SW `CACHE_VERSION`**（`/shared/` 是 SWR，不升则老用户拿旧文件）
7. `npm test` + `tsc --noEmit` + `vite build` + 真浏览器 1440/390 亮暗复验
8. 推送；必要时清 CF 边缘缓存；线上真实对局补验

> 第 2→3 步不能跳：三站 `sync-shared.mjs` 从 **GitHub raw** 拉文件，本地改 manifest 不会被 CI 看到，先加清单会让三站门禁恒红。`publish-shared.mjs` 刻意不自动改 manifest。

**部署通道例外**：常规唯一入口 `git push origin main`。但 2026-11-06 github.com git 协议全仓不通，且本地 `origin/main` 缓存全部落后真实远端 tip，故由 `gh.mjs` 走 Git Data API：parent 恒取实时远端 tip、`base_tree` 叠加变更、`force:false` 快进，待改文件基准一律 GET 远端 blob（绝不读本地旧 worktree）。见 `deploy-p0-2.mjs` 的 A/B/C/css 分段。

## 验收

| 项 | 标准 |
|---|---|
| 令牌 | `check-tokens.mjs` PASS，亮/暗逐值一致，0 越界变量，0 未定义引用 |
| 渲染 | 真浏览器 1440×900 / 390×844 / 320×720 × 亮暗，0 横向溢出 / 0 JS 异常 |
| 主题 | `--tb-brand` 亮 `#4F46E5` ↔ 暗 `#818CF8`；页底亮 `#F4F5F9` ↔ 暗 `#12131F` |
| 门禁 | `npm test` · `tsc --noEmit` · `sync:shared:check` 全绿 |
| 上线 | 常规唯一入口 `git push origin main`（git 协议不通时走 `gh.mjs` API 快进）；推后查 Actions 最终 conclusion + 远端 tree 内容比对（不只看 sha） |

## P0-2 状态（2026-11-06）

| 项 | 值 |
|---|---|
| 接入页面 | **106**（mathduel 23 / boardduel 50 / memoryduel 33），远端核验 106/106 有 link |
| 产物 | `dist/tri-ui.css` 27,031 B，MD5 `864da5d6bdbc2e2c5284b28c84c3316d`，四处字节一致 |
| SW 版本 | `mdsw-v2` / `bdsw-v3` / `mdusw-v5` |
| 最终远端 tip | fe-shared `2a533dd57` · mathduel `4a4dd681e` · boardduel `63a39bb2b` · memoryduel `decf90fa9` · tri-design-system `97d677701` |
| 线上验证 | 首页 3 站 × 2 档全绿；6 个游戏页全绿；CI 与 CF Pages 部署全部 success |

**P0 边界**：只完成「样式层接入与令牌可用」，chrome 骨架、首页模板、游戏内组件接线属于 P1/P2，三站存量结构（侧栏、双 CTA 等）本轮未改。

未来更新 `tri-ui.css` 内容时：HTML 固定 `?v=1` 而 CF 缓存键忽略 query → 需**文件名版本化或再次 purge**，并同步升三站 SW `V`。
