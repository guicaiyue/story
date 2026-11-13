# 设计原型与复核

这里放三份可交互的 HTML 原型（不是最终视觉稿），以及把它们渲成 PNG 的脚本。
**改完原型一定要重新出图看一遍**——2026-11-12 连续三轮复核，抓到的全是「只在渲染时才看得见」的问题：

| 原型 | 屏/视图 | 当时抓到的 |
| --- | --- | --- |
| `android-app/index.html` | 9 屏 | 吸顶标题栏下移 52px 压住首行内容（3 屏受影响）、程序化聚焦画出一圈焦点框 |
| `android-app/tablet.html` | 2 屏 | 第 4 张故事卡被裁掉、内容宽度边界线被 `overflow:hidden` 裁掉 |
| `admin-web/index.html` | 7 视图 | 程序化聚焦画出一圈焦点框 |

## 目录

```
docs/design/
  android-app/index.html     手机 9 屏原型（390×844，hash 路由）
  android-app/tablet.html    平板布局草案（1280×800，两屏：首页 / 夜间播放器）
  admin-web/index.html       运营后台 7 视图（1440×900，左侧导航切换）
  screenshots/               出图产物（脚本生成，可按需重跑）
    phone/  tablet/  admin/   ← 脚本产物目录
    *.png                    历史人工截图，保留
```

## 出图：一条命令

```bash
./scripts/design-shots.sh                 # 全部（phone 9 + tablet 1 + admin 7 = 17 张）
./scripts/design-shots.sh phone,admin     # 只渲指定分组
OUT=/tmp/shots ./scripts/design-shots.sh  # 换个输出目录
```

产物：`docs/design/screenshots/<分组>/<名字>.png`。

依赖：本机有 docker 且拉过 `browserless/chrome`（镜像自带 puppeteer + chrome），**不需要图形浏览器**。

## 加一个新原型

1. 把 HTML 放到 `docs/design/<你的原型>/index.html`；
2. 在 `scripts/design-shots.cjs` 的 `GROUPS` 里加一项：
   ```js
   myproj: {
     html: 'myproj/index.html',
     viewport: { width: 1440, height: 900 },
     fullPage: true,                       // 需要整页就加
     shots: [{ name: 'home' }, { name: 'detail', hash: '#/detail' }],  // hash 路由就写 hash
   }
   ```
3. `./scripts/design-shots.sh myproj`。

后台那种「登录后点导航」的原型，用 `login`（执行一段 JS 提交登录）和 `clicks`（每张图前点哪个选择器）。

## 四个已经踩过的坑（脚本里都处理了，改脚本时别踩回去）

| 坑 | 现象 | 处理 |
| --- | --- | --- |
| 容器里 chrome 不是 root | `EACCES: permission denied, mkdir '/out/...'` | 产物写临时目录（`chmod 777`）再复制回来，不直接写仓库 |
| ESM 的 `import` 不认 `NODE_PATH` | `Cannot find package 'puppeteer'` | 脚本用 **CommonJS**（`.cjs`），靠 `require` 找 puppeteer |
| 同一个 page 连续改 hash | 上一屏的滚动/过渡状态带过来，看起来像 CSS 坏了（分类屏「芯片被裁」的假象就是这么来的） | 每屏重新 `goto`，并在截图前把滚动位置清零 |
| 列表/详情有懒加载或过渡 | 截到空白或半截 | 每次导航后等 500ms 再截 |

## 复核清单（人工看图时按这个顺序）

1. **顶部**：状态栏/标题栏有没有压住第一行内容；
2. **标题**：有没有不该出现的焦点框、描边；
3. **横向溢出**：最后一张卡片是否被裁；
4. **底部**：内容是否被导航/操作条盖住（能滚动就不算错）；
5. **文字**：有没有重叠、截断、占位符 `—` 没填；
6. **对齐**：卡片间距、栅格列数是否与断点一致。

## 与实现的对应

- 手机/平板断点：`apps/app/lib/theme/layout.dart`（600 / 900）、`main_shell.dart`（≥900 侧边导航）、
  `common.dart`（`StoryScaffold.fullBleed`）；
- 后台响应式：`apps/admin/src/styles.css`（1080 / 900 两个断点）。
