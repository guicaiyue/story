# 小故事铺 0.1.1（内测）

> 用途：GitHub release 的 notes 正文（可直接整段粘贴）。
> Tag：`v0.1.1` · 资产：`storynook-0.1.1.apk` + `storynook-0.1.1.apk.sha256`
> 准备日期：2026-11-11（本地准备完成，**尚未发布**）

0.1.1 是 0.1.0 之后的**修复版**：0.1.0 的 APK 装上去完全不可用，
本轮修掉两个各自独立、都会导致「装上连不上」的缺陷，并统一版本号。

---

## 版本亮点

### 1. 修掉「本机地址被静默编进发布包」（0.1.0 缺陷 #1）

- **0.1.0**：`kApiBaseUrl` 写成
  `String.fromEnvironment('API_BASE_URL', defaultValue: 'http://127.0.0.1:3000')`。
  `defaultValue` 是常量，不传 `--dart-define` 时它直接进包 → 真机上 `127.0.0.1`
  指向手机自己，装上去连不上任何服务端。
- **0.1.1**：基址**只有一处**定义（`apps/app/lib/config/app_config.dart`），
  默认值即正式域名，本机地址必须显式开 `ALLOW_LOCAL_API_FALLBACK=true` 才可能生效。
- 本版实际编入的基址：**`https://api-story.xirizhi.cn`**
  （对三个 ABI 的 `libapp.so` 逐一核验，`http://127.0.0.1` 出现 **0** 次）。

### 2. release 包补上联网权限（0.1.0 缺陷 #2）

- Flutter 模板只在 `src/debug` / `src/profile` 声明 `INTERNET`（给 hot reload 用），
  **release 构建不合并**。
- **0.1.0** 实测权限只有 `ACCESS_NETWORK_STATE` → 就算基址填对也连不上。
- **0.1.1** 已在 `android/app/src/main/AndroidManifest.xml` 声明；
  实测 release 包含 `android.permission.INTERNET`。

### 3. 版本号三处统一

`pubspec.yaml` 由 `1.0.0+1` 改为 `0.1.1+2`，使 APK 文件名 / `pubspec` /
`versionName` 一致：**versionName `0.1.1`，versionCode `2`**。

### 功能范围（沿用 0.1.0，未新增功能）

- 9 屏：启动 / 首页 / 分类 / 故事详情 / 播放器 / 我的 / 家长门 / 家长中心 / 夜间播放器。
- 首页按年龄档推荐（3-6 / 6-9 / 9+），9+ 内容不进儿童端。
- 音频由服务端按需 TTS 合成（edge-tts 音色 `zh-CN-YunxiNeural`，语速 -10%），
  支持拖动与续播；正文与时长以服务端为准。
- 收藏、播放进度、家长设置（时长限制 / 年龄档 / 睡眠定时）。

---

## 安装说明

1. 下载 `storynook-0.1.1.apk`。
2. Android 设置里允许「安装未知来源应用」（本版**未上架**应用商店）。
3. 点击安装并打开；无需注册（游客身份）。

**环境要求**

| 项 | 值 |
| --- | --- |
| 系统 | Android 7.0（API 24）及以上 |
| 架构 | arm64-v8a、armeabi-v7a、x86_64（含 x86_64，便于模拟器） |
| 包名 | `com.storynook.app` |

**覆盖安装**：与 0.1.0 同包名、同签名（debug keystore），可直接覆盖升级。

> ⚠️ **前置条件（重要）**：本 APK 的 API 基址在**编译期固定**为
> `https://api-story.xirizhi.cn`，不可运行时修改。该域名当前**没有任何服务在监听**
> （DNS 解析到 `192.168.192.25`，TCP 连接超时）。需要先完成「生产 docker 部署」
> 把服务起起来并挂上反代，否则装上后所有请求都会失败。
> 这是上线顺序里的下一项，不是本版本的缺陷。

---

## 校验（sha256）

```
1f36695a6251e39f165e3f0f201a7adc0f6ddf049566699702c424a5ada5e720  storynook-0.1.1.apk
```

- 文件大小：**51,201,583 字节**（约 48.8 MiB）
- 随包附带 `storynook-0.1.1.apk.sha256`（`sha256sum` 兼容格式，内含
  `releases/storynook-0.1.1.apk` 相对路径）

验证方式：

```bash
# Linux（在与 sha256 文件同级的目录，即仓库根的 releases/ 下）
sha256sum -c storynook-0.1.1.apk.sha256

# 没有 sha256 文件时（macOS / 手工比对）
shasum -a 256 storynook-0.1.1.apk
```

期望输出：`releases/storynook-0.1.1.apk: OK`，摘要等于上面的
`1f36695a…a5e720`。

---

## 已知问题

### A. 发布相关（会影响可用性，请先读）

1. **API 域名当前不通** —— `https://api-story.xirizhi.cn` 无服务监听（连接超时）。
   必须先完成生产 docker 部署，本 APK 才能真正连上数据。
2. **使用 Android debug 签名** —— 证书 `C=US, O=Android, CN=Android Debug`，
   SHA-256 `5832fbe8fc83e32f67dc3e6d5fd60e17364cedf0f17334c004a9f5dcdf31f636`
   （与 0.1.0 同一把）。内测可接受；**上架应用商店前必须换 release keystore
   并妥善保管**，否则将来无法覆盖升级。
3. **未做真机安装验证** —— 工作区无 Android 设备、无 `/dev/kvm` 装不了模拟器。
   产物级证据齐全（基址 / 权限 / 版本号 / 签名 / ABI / sha256），
   但「装到真机点一遍」这一步需人工补。

### B. 功能与数据（沿用 0.1.0，非本版引入）

4. **游客登录未接入启动流程** —— `ApiClient.registerDevice()` 已就绪但启动时不调用；
   真机上「继续听 / 收藏 / 播放进度」会因缺 token 返回 **401**。
   需先定 D6 游客升级规则。
5. **家长设置未落库** —— 时长限制 / 年龄档 / 夜间模式只存在内存，杀进程即丢
   （服务端 `app.setting` 表已建、读写端点未做）。
6. **每日时长限制未真正生效** —— 设置项可改，但「到点阻止播放」的拦截逻辑未做。
7. **场景 → 歌单为空** —— 服务端没有「场景」字段，首页三个场景卡目前只按年龄档跳转。
8. **播放报告只有计数** —— 服务端无按天/周聚合端点，家长中心只展示可核验的计数，不画图表。
9. **音频首次播放需实时合成** —— 约 3–10 秒才出声；无 `audioUrl` 时进入「模拟播放」。
10. **封面图 `cover_url` 全空** —— 按 Q2 决策先占位，后续从 Vercel `/images/` 同步。

---

## 附：本版产物级验证记录

| 项 | 值 |
| --- | --- |
| 包名 | `com.storynook.app` |
| versionName / versionCode | `0.1.1` / `2` |
| minSdk / targetSdk / compileSdk | 24 / 36 / 36 |
| ABI | arm64-v8a、armeabi-v7a、x86_64 |
| 权限 | `android.permission.INTERNET`、`ACCESS_NETWORK_STATE` |
| 编入基址 | `https://api-story.xirizhi.cn`（`http://127.0.0.1` 出现 0 次） |
| 签名 | APK Signature Scheme v2 通过；debug 证书 SHA-256 `5832fbe8…f636` |
| sha256 | `1f36695a6251e39f165e3f0f201a7adc0f6ddf049566699702c424a5ada5e720` |
| 代码检查 | `flutter analyze` → No issues found! |
| 单元测试 | `flutter test` → **78 passed** |

构建命令（可复现）：

```bash
cd apps/app
flutter analyze && flutter test
flutter build apk --release --dart-define=API_BASE_URL=https://api-story.xirizhi.cn
```

> 复现说明：`--dart-define` 未进 APK 元数据，也**不参与构建缓存失效判断**；
> 「这个包到底指向哪」的唯一可信判据是直接读 `libapp.so` 里的基址字符串，
> 不要看构建日志或 `aapt` 输出。
