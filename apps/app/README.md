# 小故事铺 · 安卓 App（M3）

给中国家庭的睡前 20 分钟 —— 儿童端为主，家长端负责把关。

技术栈：**Flutter 3.47.9 / Dart 3.13.7**，包名 `com.storynook.app`。

> ⚠️ **只连 dev 库（03-decisions D7）**：开发与联调一律打 `story-dev-postgres`，
> 不碰生产库。

## 快速开始

前置：M1 服务端在 `:3000` 跑着，且指向 dev 库（见 `apps/server/README.md`）。

```bash
cd apps/app
flutter pub get

# 联调必须显式指定 dev 服务端地址
flutter run --dart-define=API_BASE_URL=http://192.168.1.4:13300
```

### baseUrl 怎么填

基址**只有一处**定义：`lib/config/app_config.dart`（`kApiBaseUrl`）。
它不再有「默认回落到本机」的行为 —— 旧的 `defaultValue: 'http://127.0.0.1:3000'`
会被静默编进发布包，正是 0.1.0 的 APK 在真机上连不上的原因（08-launch-plan §1.9）。

| 场景 | 值 |
| --- | --- |
| **正式发布（内置默认）** | `https://api-story.xirizhi.cn`，不传 `API_BASE_URL` 即用它 |
| Android 模拟器（宿主机就是开发机） | `http://10.0.2.2:13300` |
| 真机 · 同一局域网 | `http://<开发机内网IP>:13300`，例如 `http://192.168.1.4:13300`（dev API 端口是 13300，不是 3000） |
| 桌面/Web 调试 | 显式写地址；若确实要 `127.0.0.1`，加 `--dart-define=ALLOW_LOCAL_API_FALLBACK=true` |

`127.0.0.1` 在**模拟器/真机里指向手机自己**，连不到开发机 —— 这是最容易踩的一步。

### 发版（正式 APK）

```bash
flutter build apk --release --dart-define=API_BASE_URL=https://api-story.xirizhi.cn
# 产物：build/app/outputs/flutter-apk/app-release.apk（版本号取自 pubspec.yaml）
```

打完后**必须**验两件事，否则可能又出一个装上去不能用的包：

```bash
AAPT=$ANDROID_HOME/build-tools/35.0.0/aapt2
$AAPT dump badging <apk> | grep ^package        # versionName 应为 0.1.1
$AAPT dump permissions <apk> | grep INTERNET    # 必须有联网权限（见下）
```

> ⚠️ **联网权限**：`android.permission.INTERNET` 必须声明在
> `android/app/src/main/AndroidManifest.xml`。Flutter 模板只在 `src/debug` /
> `src/profile` 里声明它（给 hot reload 用），**release 构建不会合并** ——
> 缺失时 release 包所有请求直接失败（0.1.0 实测只有 `ACCESS_NETWORK_STATE`）。

## 校验与测试

```bash
flutter analyze          # 必须零 error（当前：No issues found!）
flutter test             # 58 个用例，不需要服务端
flutter test test_live/  # 5 个联调用例，需要服务端在跑
```

`test_live/` 刻意放在 `test/` 之外：它打真实接口，用来验证**模型字段名与
服务端响应真的对得上**（mock 的 fixture 是人手写的，服务端改字段名时
mock 测试仍会通过，这类问题只有联调测试能发现）。

## 如何出 APK

需要 **Android SDK**（当前容器未安装，因此 M3 不出 APK）：

```bash
# 1. 装 Android SDK（任选其一）
#    a) 装 Android Studio，自带 SDK
#    b) 只装命令行工具：https://developer.android.com/studio#command-tools
#       然后 sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
# 2. 让 Flutter 找到它
flutter config --android-sdk /path/to/android-sdk
flutter doctor            # 确认 Android toolchain 打勾
# 3. 出包
flutter build apk --release --dart-define=API_BASE_URL=https://api.example.com
# 产物：build/app/outputs/flutter-apk/app-release.apk
```

调试包（可直接装真机看效果）：`flutter build apk --debug`。
首次构建需要联网下载 Gradle 与依赖。

## 9 屏与实现位置

| # | 屏 | 文件 | 说明 |
| --- | --- | --- | --- |
| 1 | 启动 | `lib/screens/launch_screen.dart` | 品牌 + 进度条，1.4s 后进首页 |
| 2 | 首页 | `lib/screens/home_screen.dart` | 今晚听什么大卡片 / 继续听 / 场景 / 推荐分类 |
| 3 | 分类 | `lib/screens/category_screen.dart` | 年龄档 + 分类 + 时长筛选，服务端分页 |
| 4 | 故事详情 | `lib/screens/story_screen.dart` | 封面 / 元信息 / 正文 / 收藏 / 开始听 |
| 5 | 播放器 | `lib/screens/player_screen.dart` | 进度 / 15 秒进退 / 定时 / 收藏 / 自动下一集 |
| 6 | 我的 | `lib/screens/mine_screen.dart` | 继续听 / 收藏 / 最近听过 / 家长入口 |
| 7 | 家长门 | `lib/screens/parent_gate_screen.dart` | 两位数加法 + 大键盘（触控 ≥64） |
| 8 | 家长中心 | `lib/screens/parent_screen.dart` | 时长限制 / 年龄档 / 播放报告 / 退出 |
| 9 | 夜间播放器 | `player_screen.dart` + `nightMode: true` | 深靛 `#1E1B2E` 配色 |

## 接的真实接口

| 方法 | 路径 | 用在哪 |
| --- | --- | --- |
| GET | `/api/home` | 首页聚合（tonight / featured / categories / continueListening） |
| GET | `/api/stories` | 分类页（分页 / categoryId / ageBand / q） |
| GET | `/api/stories/:id` | 故事详情（含正文） |
| GET | `/api/stories/:id/audio` | TTS 合成音频（MP3，支持 Range，播放器 seek 依赖） |
| GET | `/api/categories` | 分类筛选与推荐分类 |
| PUT | `/api/progress/:storyId` | 播放进度（每 15 秒上报一次） |
| GET | `/api/progress` | 继续听、家长报告 |
| POST/DELETE | `/api/favorites/:storyId` | 收藏（乐观更新，失败回滚） |
| GET | `/api/favorites` | 我的 · 收藏、家长报告 |
| POST | `/api/plays` | start / pause / stop / complete 埋点 |

所有响应都走 `{ ok, data }` / `{ ok, error }` 封套，由 `lib/services/api_client.dart`
统一解包；失败转成带可读中文的 `ApiException`，页面展示错误态 + 重试，不白屏。

## 音频（M4）

音频不再依赖真实 mp3 文件：服务端按需 TTS 合成并缓存（edge-tts 音色
`zh-CN-YunxiNeural`，语速 -10%）。

```
服务端  GET /api/stories/:id/audio  ->  合成/读缓存 MP3  ->  回填 duration_sec
App     just_audio.setUrl(绝对地址)  ->  positionStream 驱动进度条
```

两个实现细节值得注意：

- **audioUrl 是相对路径**（`/api/stories/8/audio`），因为同一份数据要给不同
  host 用；`Story.absoluteAudioUrl(baseUrl)` 在客户端补成绝对地址，
  否则 just_audio 无法直接使用。
- **时长以服务端量出的为准**：服务端用 `music-metadata` 从合成出的 MP3 读出
  真实时长并写回 `story_main.duration_sec`，App 侧 `durationStream` 只作补充。
  正文字数（`length`）不是时长，两者在 02-architecture §3.1 已明确区分。

`PlayerService` 抽象保持不变：`JustAudioPlayerService` 是真实实现，
`FakePlayerService` 供测试。这样 widget 测试不需要平台通道，也不需要网络。

## 架构（最小方案）

```
lib/
├── main.dart                  # 依赖注入（ApiClient / PlayerService）
├── theme/tokens.dart          # 设计令牌 + 日/夜间配色
├── models/models.dart         # 与服务端字段一一对应的模型
├── services/
│   ├── api_client.dart        # 封套解析 + 全部接口
│   └── player_service.dart    # 播放器抽象（真实实现 + Fake）
├── state/app_state.dart       # Provider：夜间/家长设置/播放/收藏
├── widgets/common.dart        # 纸卡、按钮、空态/错误态
└── screens/                   # 9 屏
```

**状态管理**：`provider` + `ChangeNotifier`（`AppState`）。刻意保持小，
只放跨页面共享的东西；页面自己的加载/错误由 `FutureBuilder` 管。

**播放器抽象**：`PlayerService` 是接口，`JustAudioPlayerService` 是真实实现，
`FakePlayerService` 用于测试。抽出来的三个理由：

1. M1 的 2197 条故事 `audioUrl` **全为空**（走 TTS 实时合成，见 00-research P4），
   真实播放能力当前无从验证；
2. 测试要在没有平台通道的纯 Dart 环境跑，不能依赖 `just_audio` 的 MethodChannel；
3. 将来接 TTS / 下载缓存时只换实现，页面不动。

`audioUrl` 为 null 时播放器进入「模拟播放」（内部计时器），保证 **UI 与状态机
在没有音频资产时依然完整可用可测**。

## 视觉

令牌与设计稿 `docs/design/android-app/assets/css/app.css` 对齐（`lib/theme/tokens.dart`）：

| 用途 | 日间 | 夜间 |
| --- | --- | --- |
| 底色 | `#FBF7F0` | `#1E1B2E` |
| 卡片 | `#FFFDF9` | `#272341` |
| 正文 | `#3A3330` | `#F5F0E6` |
| 主色 | `#D98E5A` | `#E8A97A` |

圆角 20–28（`rXl 28 / rLg 22 / rMd 18 / rSm 14`）；
儿童端触控 `touchKid = 64`，家长门键盘每格 ≥64。
正文用 `accentInk (#8A4E26)` 而不是 `accent`，保证纸上对比度 ≥4.5:1。

## 开发中修掉的真实缺陷

1. **`InkWell` 缺少 `Material` 祖先** —— 页面根用了 `Container`，底部导航一渲染就抛
   `No Material widget found`。这是真机必崩的问题，被 widget 测试提前抓到
   （已改为 `Material` 作为根）。
2. **`PlayerScreen.dispose()` 里查 Provider** —— 退出播放器时抛
   `Looking up a deactivated widget's ancestor is unsafe`。已改为在 `initState`
   缓存 `ApiClient`/`AppState` 引用，dispose 期间只做取消订阅与释放。
3. **「最近听过」顺序错** —— 重听同一故事没有移到队首，列表停在旧顺序。已修。
4. **`FakePlayerService.load()` 丢弃传入时长** —— 导致测试与真实实现的时长语义不一致。已修。

## 未实现 / 需要决定的事

1. **真实音频播放未接线** —— `JustAudioPlayerService` 目前内置计时器模拟播放；
   接真实 just_audio（`AudioPlayer.setUrl` / `positionStream`）需要一条有
   `audioUrl` 的内容，或先接 TTS 合成。属 M3 之后范围。
2. **场景 → 歌单是空的** —— 服务端没有「场景」字段，首页三个场景卡目前只按年龄档
   跳转。真正的场景歌单需要运营配置（新表 + 后台上架入口）。
3. **播放报告只有计数** —— 服务端没有按天/按周聚合端点，所以家长中心只展示
   可核验的计数（在听 / 收藏），不画虚构图表。与后台 M2 的处理一致。
4. **家长设置未落库** —— `ParentSettings`（时长限制/年龄档/定时）目前只在
   `AppState` 内存里，杀掉进程会丢。持久化需要服务端 `app.setting` 的读写端点
   （表已建，接口未做）。
5. **每日时长限制未真正生效** —— 设置项已能改，但「到点阻止播放」的拦截逻辑
   还没做（需要与家长门、定时器联动）。
6. **游客登录未接入启动流程** —— `ApiClient.registerDevice()` 已就绪，但 App
   启动时没有调用；因此「继续听/收藏」在真机上会因缺 token 而返回 401。
   需要先定 **D6 游客升级规则**（03-decisions 未决），再决定启动即注册还是
   首次收藏时注册。
7. **夜间模式未持久化** —— 仅本次会话有效。

以上 1–7 都不是「忘了做」，而是依赖服务端接口或未决决策。
