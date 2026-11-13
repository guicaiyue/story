# 14 · 发布前检查清单 · storynook-0.1.1

> 目标：把 GitHub release 准备到「只差按发布按钮」。
> 准备时间：2026-11-11 · 分支 `feat/platform-v2` · HEAD `7b9d091`
> **本文档不代表已发布**：release 未建、tag 未 push、生产未动。
>
> 图例：`[x]` 已完成（有证据） · `[ ]` 待人工 · 🤖 agent 可做 · 👤 **必须人工在 GitHub 网页操作**

---

## 0.0 ⚠️ 2026-11-12 追加：这份 APK 已经不覆盖当前源码

`apps/app` 在 11-12 增加了**平板适配**（宽度分档 + 宽屏侧边导航 + 内容最大宽度居中 + 播放器双栏）：
`lib/theme/layout.dart`（新增）、`lib/screens/main_shell.dart`、`lib/widgets/common.dart`
（`StoryScaffold` 新增 `fullBleed`：主壳/播放器/启动页铺满，其余内容页收窄到 720/960 并居中），
`flutter analyze` 无问题、`flutter test` **87 通过**（新增 `test/tablet_layout_test.dart` 9 条）。

因此：

- `releases/storynook-0.1.1.apk`（11-11 12:10 出包）**不含平板适配**；
- 按这份清单发 0.1.1，装到平板上的仍是「放大的手机界面」；
- 建议：把平板适配并入 **0.1.2**（`pubspec.yaml` 升到 `0.1.2+3`）重新出包，0.1.1 保持现状或跳过。

下表 1–3 节的产物校验仍然有效，但它们校验的是**0.1.1 那个包**，与当前源码无关。

## 0. 一句话结论

APK 与校验文件**在位、自洽、与当前源码一致**；release notes 已写好；
本地 tag `v0.1.1` 已打（未 push）。
**从第 5 步开始全部是人工步骤**，其中第 5.1 / 5.2 必须在 GitHub 网页上完成。

---

## 1. 产物与校验

| # | 检查项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1.1 | APK 在位 | `[x]` 🤖 | `releases/storynook-0.1.1.apk`，51,201,583 字节 |
| 1.2 | sha256 文件在位 | `[x]` 🤖 | `releases/storynook-0.1.1.apk.sha256`（95 字节） |
| 1.3 | sha256 与 APK 匹配 | `[x]` 🤖 | `sha256sum -c` → `releases/storynook-0.1.1.apk: OK` |
| 1.4 | sha256 值 | `[x]` 🤖 | `1f36695a6251e39f165e3f0f201a7adc0f6ddf049566699702c424a5ada5e720` |
| 1.5 | sha256 文件格式可直接用 | `[x]` 🤖 | 含 `releases/storynook-0.1.1.apk` 相对路径 + 换行，`sha256sum` 兼容 |
| 1.6 | APK 与构建产物逐字节一致 | `[x]` 🤖 | 与 `apps/app/build/app/outputs/flutter-apk/app-release.apk` sha256 相同 |

## 2. APK 内容核验（拆包验，不看构建日志）

| # | 检查项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 2.1 | versionName / versionCode | `[x]` 🤖 | `0.1.1` / `2`（`aapt2 dump badging`，且与 `pubspec.yaml` 的 `0.1.1+2` 一致） |
| 2.2 | 包名 | `[x]` 🤖 | `com.storynook.app` |
| 2.3 | **联网权限** | `[x]` 🤖 | `android.permission.INTERNET` 在（0.1.0 只有 `ACCESS_NETWORK_STATE`） |
| 2.4 | **编入的 API 基址** | `[x]` 🤖 | 三个 ABI 的 `libapp.so` 均含 `https://api-story.xirizhi.cn`；`http://127.0.0.1` 出现 **0** 次 |
| 2.5 | ABI | `[x]` 🤖 | arm64-v8a、armeabi-v7a、x86_64 |
| 2.6 | 签名可用 | `[x]` 🤖 | APK Signature Scheme v2 通过 |
| 2.7 | 签名身份 | `[x]` ⚠️ | **debug 证书** `CN=Android Debug`，SHA-256 `5832fbe8…f636`（内测可接受，上架前必须换） |
| 2.8 | SDK 区间 | `[x]` 🤖 | minSdk 24 / targetSdk 36 / compileSdk 36 |

> ⚠️ 2.4 的判据说明：`libapp.so` 里有一处**裸** `127.0.0.1` 字符串，是 Flutter 引擎
> 自带的符号数据（`...blackMountainView...`），0.1.0 与 0.1.1 逐字节相同，与配置无关。
> **判据必须用带 scheme 的 `http://127.0.0.1`**：0.1.0 = 1 处，0.1.1 = 0 处。

## 3. 源码一致性

| # | 检查项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 3.1 | 构建输入未在出包后被改 | `[x]` 🤖 | APK 12:06:58 出包；`lib/` `android/app/` `pubspec.yaml` 最新 mtime 为 12:05:30（**早于**出包） |
| 3.2 | 测试全绿 | `[x]` 🤖 | `flutter test` → 78 passed（重跑于 2026-11-11 16:3x） |
| 3.3 | 静态检查 | `[x]` 🤖 | `flutter analyze` → No issues found! |
| 3.4 | 版本号三处一致 | `[x]` 🤖 | 文件名 `0.1.1` = `pubspec 0.1.1+2` = `versionName 0.1.1` |
| 3.5 | **workspace 中 release 相关文件均未提交** | ⚠️ **风险** | `git ls-tree HEAD apps/ releases/` 计数为 **0**；`releases/`、`apps/`、`docs/` 全是 untracked |

> ⚠️ **3.5 是本清单里最需要人决策的一项**：
> tag `v0.1.1` 指向 HEAD `7b9d091`，但**那个提交里没有 APK、也没有 App 源码**。
> 详见第 6 节「需要你拍板」。

## 4. 本地 tag

| # | 检查项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 4.1 | tag 名符合约定 | `[x]` 🤖 | `v0.1.1`（`v<semver>`，与 APK 文件名解耦） |
| 4.2 | 本地 tag 已打 | `[x]` 🤖 | `git tag -l v0.1.1` 可列出，指向 `7b9d091` |
| 4.3 | 远端无同名 tag | `[x]` 🤖 | `git ls-remote --tags origin` 为空 |
| 4.4 | **未 push** | `[x]` 🤖 | 本地 tag only，符合边界 |

## 5. 发布动作（全部为人工 —— 本节是「按按钮」的部分）

> 👤 **以下每一步都需要人在 GitHub 网页上操作，agent 不代劳、不推送。**

| # | 步骤 | 谁 | 说明 |
| --- | --- | --- | --- |
| 5.1 | **创建 tag / push tag** | 👤 | 网页建 release 时填 `v0.1.1`，GitHub 会自动建 tag；或本地 `git push origin v0.1.1`。**注意**：若先在网页建了 release，本地 tag 需删除重建或改用远端 tag |
| 5.2 | **创建 GitHub Release** | 👤 | `https://github.com/guicaiyue/story/releases/new` |
| 5.3 | 填标题 | 👤 | `小故事铺 0.1.1（内测）` |
| 5.4 | 选 tag | 👤 | `v0.1.1`（Target 选默认分支，见风险 6.1） |
| 5.5 | 粘贴 notes | 👤 | 整段复制 `docs/product/release-notes-0.1.1.md` 正文 |
| 5.6 | 上传资产 ×2 | 👤 | `releases/storynook-0.1.1.apk`、`releases/storynook-0.1.1.apk.sha256` |
| 5.7 | 预发布开关 | 👤 | 建议勾 **Set as a pre-release**（内测） |
| 5.8 | **点击 Publish release** | 👤 | ← **就是这一步** |

上传前确认（可在本机做）：

```bash
sha256sum -c releases/storynook-0.1.1.apk.sha256   # 期望 OK
```

## 6. 发布后验证（人工）

| # | 检查项 | 状态 |
| --- | --- | --- |
| 6.1 | release 页两个资产都在、体积对得上（APK 51,201,583 字节） | `[ ]` 👤 |
| 6.2 | 从 release 页**重新下载** APK，sha256 与本机一致 | `[ ]` 👤 |
| 6.3 | tag 在网页可见且指向预期提交 | `[ ]` 👤 |
| 6.4 | 真机安装并打开（见下方阻塞项） | `[ ]` 👤 |

---

## 7. 需要你拍板（发布前必须回答）

### Q1 · `feat/platform-v2` 上的 release 源码要不要先进 `main`？

| 选项 | 做法 | 代价 |
| --- | --- | --- |
| **A（推荐）** | 先把 `apps/`、`releases/`、`docs/` 等提交并合入 `main`，再在 `main` 的提交上打 tag 建 release | 一次较大的提交/合并；但 tag 与 APK 的对应关系可自证 |
| B | 直接在 `feat/platform-v2` 的 `7b9d091` 上建 release | 最快；但 tag 指向的树**不含** APK 与 App 源码，将来无法用 tag 重建这个包，审计链断裂 |
| C | 只把 `docs/product/release-notes-0.1.1.md` 与 `releases/` 提交，其余不动 | 折中；仍与 `main` 不一致 |

> **默认建议：A**。若你确认内测阶段不要求可重建性，选 B 也能发，
> 但请在 release notes 里显式写明「产物未入库」。

### Q2 · APK 用 debug 签名发布，接受吗？

> **已解决（2026-11-13）**：0.1.2 起改用正式 keystore（`CN=StoryNook`），
> 出包脚本 `apps/app/tool/build-release-apk.sh` 会在归档前校验证书 DN，回落 debug 直接失败。
> 本节保留为 0.1.1 的历史记录。

- 内测可接受（与 0.1.0 同签名，可覆盖升级）。
- 不接受的话，需要先建 release keystore 并重签/重构建 —— 那会**改变 sha256**，
  当前 notes 与校验值全部要重写。**默认建议：接受，内测后再换。**

### Q3 · `api-story.xirizhi.cn` 现在不通，是否仍发 release？

- 现状：DNS 解析到 `192.168.192.25`，TCP 连接超时；该 APK 装上后所有请求失败。
- **默认建议：可以发**，但必须在 release notes 顶部保留「需先完成生产部署」的提示
  （已在 notes 的安装说明里写明）；否则会收到「装了没用」的反馈。

### Q4 · 是否需要我在你授权后继续执行 5.1–5.8？

- agent 环境**没有** `gh`、`GH_TOKEN`、`~/.git-credentials`，**也不应该**替你按发布按钮。
- 若你希望自动化，需先提供凭据或安装 `gh` —— 这本身是一次授权，请明确说。

---

## 8. 明确未做（边界）

| 项 | 状态 |
| --- | --- |
| `git push`（含 push tag） | **未做** |
| 创建 GitHub release | **未做** |
| 生产库任何写入 | **未做**（本清单只读探测了 DNS/端口） |
| 生产 docker 部署 | **未做** |
| 修改 `apps/` 下任何源码 | **未做**（仅新增本文档与 release notes） |
| 建过程卡 | **未做** |

---

## 9. 本轮新增产物

| 文件 | 说明 |
| --- | --- |
| `docs/product/release-notes-0.1.1.md` | release notes 正文（可直接粘贴） |
| `docs/product/14-release-checklist-0.1.1.md` | 本文档 |
| 本地 tag `v0.1.1` | 指向 `7b9d091`，**未 push** |


审核记录：本卡为「发布前检查清单」交付物，按一次任务卡边界产出（不 push、不建 release、不碰生产库）。
