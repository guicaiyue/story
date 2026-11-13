# 17 · 平板适配（0.1.2 候选改动）

日期：2026-11-12　状态：**已随 0.1.2 发布上线**（2026-11-13，唯一 tag `v0.1.2`）。
`apps/app` 已移出仓库，源码归档在 NAS `backup/src/story-app-0.1.2-src.tar.gz`；
本文路径与测试数字是当时的记录。

## 1. 为什么做

产品目标是「安卓 App（支持平板）」，但 0.1.1 的实现里：

```
grep -E "MediaQuery|LayoutBuilder|breakpoint|tablet" apps/app/lib   →  0 处
```

平板上的实际观感 = 放大的手机：底部导航横跨 1100px、正文一行横跨整块屏幕。
这是「声明与实现不符」，不是优化项。

## 2. ⚠️ 一个必须先说清的前提

**设计稿只有手机版**：`docs/design/android-app/index.html` 里没有 tablet / landscape / wide
的任何屏。所以下面的断点、侧边导航、内容宽度，**是我按通用 Android 规范补的，不是设计交付物**。
请产品负责人确认或推翻，确认后我再补对应的平板设计稿（可以让 OpenDesign 出一版）。

## 3. 实现（四个文件）

| 文件 | 改动 |
| --- | --- |
| `lib/theme/layout.dart`（新增） | `compact <600 / medium 600–899 / expanded ≥900`；内容最大宽度 `∞ / 720 / 960`；`usesSideNav()`；`cardWidthOf()` |
| `lib/screens/main_shell.dart` | ≥900 时导航从底部挪到**左侧**（`Key('side-nav')`），否则底部（`Key('bottom-nav')`） |
| `lib/widgets/common.dart` | `StoryScaffold` 新增 `fullBleed`：主壳 / 播放器 / 启动页铺满；其余内容页收窄居中 |
| `lib/screens/home_screen.dart` | 分类卡与横向故事卡宽度随档位放大（150/170/190、200/220/240） |
| `lib/screens/player_screen.dart` | ≥900 时**左栏（封面 + 今晚的列表）右栏（控制）**（`Key('player-wide')`）；窄屏单栏且不显示列表（`Key('player-narrow')`） |
| `lib/screens/player_screen.dart` | 播放列表 `_queuePane`（`Key('player-playlist')`）：当前集高亮，点其它集切播（复用自动续播的 `_playStory`），每行 ✕ 可移出（`Key('queue-remove-<id>')`） |

### 一个踩过的坑（记下来免得再犯）

最初想复用已有的 `padded` 当「要不要收窄」的开关，结果几乎不生效——**除启动页和播放器外，
所有页面都是 `padded: false`**（它们自己管留白）。测试直接照出来了：树里找不到任何有限
`maxWidth` 的约束。改成独立的 `fullBleed` 才对：**收窄管可读性，留白管边距，是两件事。**

## 4. 验证

```
flutter analyze → No issues found!
flutter test    → 85 passed（原 78 + 新增 7）
flutter build apk --release → 见 §5
```

`test/tablet_layout_test.dart` 7 条：

| 用例 | 断言 |
| --- | --- |
| 宽度分档 | 390/599→compact，600/899→medium，900/1280→expanded |
| 卡片宽度随档位 | 150/170/190；只给 compact 时其它档位回落 |
| 内容最大宽度 + 导航形态 | `∞/720/960`；只有 expanded 用侧边导航 |
| 手机 400×800 | 有 `bottom-nav`，无 `side-nav` |
| 平板 1100×800 | 有 `side-nav`，无 `bottom-nav` |
| 平板内容页 | 树里存在 `maxWidth == 960` 的约束 |
| 平板点侧边「分类」 | 能切页 |
| 播放器 1100 宽 | 出现 `player-wide` 双栏，且没有 `player-narrow` |
| 播放器 400 宽 | 出现 `player-narrow` 单栏，且没有 `player-wide` |

## 5. 出包与版本

已经用改动后的源码成功出过一次包（验证 AOT 编译没问题）：

```
flutter build apk --release  →  34.5s
build/app/outputs/flutter-apk/app-release.apk
  51,267,119 字节   sha256 3bc065c5…   versionName 0.1.1  versionCode 2
```

对比已发布的那个包（**没动过**）：

```
releases/storynook-0.1.1.apk
  51,201,583 字节   sha256 1f36695a…
```

⚠️ **两个包的 versionName/versionCode 完全一样（0.1.1 / 2），内容却不同。**
Android 不会把同版本号的包覆盖安装，用户装上新包会被系统当成「同版本已安装」而拒绝升级；
后台统计也分不清谁是谁。

所以：**发这个包之前必须先升版号**（`pubspec.yaml` → `0.1.2+3`）重新出一次。
升不升、什么时候升，由产品负责人决定——版本号是产品口径，不是我该擅自动的。
构建产物留在 `build/` 里（gitignored），`releases/` 未改动。

## 6. 平板布局草案（2026-11-12 补）

为了让「工程口径」变成能看的东西，出了一版**平板布局草案**：

- 源文件：`docs/design/android-app/tablet.html`（1280×800，用 App 真实色板 `StoryPalette.day/night`）
- 截图：`docs/design/screenshots/tablet-layout.png`

两屏：**首页**（左侧导航 + 内容收窄 960 居中，两条虚线即 960 边界）与**夜间播放器**（左列表右播放）。
它是**结构草案**，不是最终视觉稿，用来确认三件事：导航位置、内容宽度、播放器双栏。

出草案时顺手修掉两个真问题：故事卡用固定 240px 宽时第 4 张被裁掉（改等分四列）；
960 边界线被 `overflow:hidden` 裁掉（改成内容区内的左右虚线）。

## 7. 还没做的（等确认）

1. 平板设计稿的**视觉定稿**（草案已出，等你确认口径后用 OpenDesign 出正式稿）；
2. 首页 hero 在宽屏下的比例（目前跟着内容宽度收窄到 960）；
3. 播放列表的排序用 ↑↓ 按钮而不是拖动，理由是亲子场景下拖动一行小字既不准也别扭（44px 触控区更稳，读屏也友好）；代价是整列从「同年龄档推荐」被收进用户自己的列表后，该年龄档的新推荐不会再自动补进来。
