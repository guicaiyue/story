/// 应用环境配置 —— **全 App 唯一**定义「后端在哪」的地方。
///
/// 抽出来的原因（08-launch-plan §1.9 记录的发布事故）：
/// 0.1.0 的 APK 里 `libapp.so` 提取出的基址是 `http://127.0.0.1:3000`，
/// 也就是编译时默认值被带进了发布包，**真机上指向手机自己**，装上去连不上
/// 任何服务端。所以基址不允许再散落在各处、也不允许「默认回落到本机」——
/// 发布构建必须落到正式域名。
///
/// 覆盖方式（编译期，不需要改代码）：
/// ```bash
/// # 正式发布（§8 Q1 拍板：内测用 *.xirizhi.cn 现成证书）
/// flutter build apk --release --dart-define=API_BASE_URL=https://api-story.xirizhi.cn
///
/// # 本地联调（必须显式指定，不会自己回落）
/// flutter run --dart-define=API_BASE_URL=http://192.168.1.4:13300
/// ```
library;

/// 正式 API 地址（内测环境）。
///
/// 08-launch-plan §8 Q1：内测用 `*.xirizhi.cn`（现成通配证书，今天可用），
/// 公开前再迁 `api.storynook.cn`。
const String kProdApiBaseUrl = 'https://api-story.xirizhi.cn';

/// 本机联调地址。**只允许在显式开启 [kAllowLocalApiFallback] 时使用**，
/// 发布构建里永远不该出现。
const String kLocalApiBaseUrl = 'http://127.0.0.1:13300';

/// 编译期注入基址的环境变量名。
const String kApiBaseUrlEnvName = 'API_BASE_URL';

/// 是否允许「没传 API_BASE_URL 时回落到本机地址」。
///
/// 默认 **false**。因为 `String.fromEnvironment` 的 `defaultValue` 是常量，
/// 一旦写成 `http://127.0.0.1:3000` 就会静默进入发布包 —— 0.1.0 的 APK
/// 就是这么坏的。这里改为「默认即正式域名」，本机地址要显式打开：
/// ```bash
/// flutter run --dart-define=ALLOW_LOCAL_API_FALLBACK=true
/// ```
const bool kAllowLocalApiFallback =
    bool.fromEnvironment('ALLOW_LOCAL_API_FALLBACK', defaultValue: false);

/// 编译期传入的基址（没传时为空串）。
const String _envApiBaseUrl =
    String.fromEnvironment(kApiBaseUrlEnvName, defaultValue: '');

/// App 实际使用的 API 基址（**const**，编译期定死，运行时不可改）。
///
/// 优先级：`--dart-define=API_BASE_URL` → 本机回落（仅显式开启）→ 正式域名。
const String kApiBaseUrl = _envApiBaseUrl != ''
    ? _envApiBaseUrl
    : (kAllowLocalApiFallback ? kLocalApiBaseUrl : kProdApiBaseUrl);

/// 去掉尾部的 `/`，避免拼出 `https://host//api/...`。
String normalizeApiBaseUrl(String raw) {
  final trimmed = raw.trim();
  if (trimmed.isEmpty) return trimmed;
  return trimmed.endsWith('/')
      ? trimmed.substring(0, trimmed.length - 1)
      : trimmed;
}
