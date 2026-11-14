/// 数据模型 —— 字段与 apps/server 的公开接口一一对应
/// （02-architecture §4.1；真实响应形状已于 2026-11-09 核对）。
library;

/// 故事列表项。`/api/stories`、`/api/home` 的 tonight/featured 都用这个形状。
class Story {
  const Story({
    required this.id,
    required this.title,
    this.excerpt,
    this.categoryId,
    this.categoryName,
    this.ageBand = '3-6',
    this.tags = const [],
    this.durationSec = 0,
    this.coverUrl,
    this.audioUrl,
    this.featured = false,
    this.length,
  });

  final int id;
  final String title;
  final String? excerpt;
  final int? categoryId;
  final String? categoryName;

  /// 3-6 | 6-9 | 9+（00-research 原则 2：分龄优先于分类）。
  final String ageBand;
  final List<String> tags;

  /// 播放时长（秒）。M1 中多为 0 —— 音频尚走 TTS 合成。
  final int durationSec;
  final String? coverUrl;
  final String? audioUrl;
  final bool featured;

  /// 正文字数（不是时长）。
  final int? length;

  Story copyWith({String? audioUrl}) => Story(
        id: id,
        title: title,
        excerpt: excerpt,
        categoryId: categoryId,
        categoryName: categoryName,
        ageBand: ageBand,
        tags: tags,
        durationSec: durationSec,
        coverUrl: coverUrl,
        audioUrl: audioUrl ?? this.audioUrl,
        featured: featured,
        length: length,
      );

  factory Story.fromJson(Map<String, dynamic> json) => Story(
        id: (json['id'] as num).toInt(),
        title: json['title'] as String? ?? '',
        excerpt: json['excerpt'] as String?,
        categoryId: (json['categoryId'] as num?)?.toInt(),
        categoryName: json['categoryName'] as String?,
        ageBand: json['ageBand'] as String? ?? '3-6',
        tags: (json['tags'] as List?)?.map((e) => e.toString()).toList() ?? const [],
        durationSec: (json['durationSec'] as num?)?.toInt() ?? 0,
        coverUrl: json['coverUrl'] as String?,
        audioUrl: json['audioUrl'] as String?,
        featured: json['featured'] as bool? ?? false,
        length: (json['length'] as num?)?.toInt(),
      );

  /// 服务端返回的 audioUrl 是**相对路径**（`/api/stories/:id/audio`），
  /// 因为同一份数据要给不同 host 用。播放器需要绝对地址，这里补全。
  String? absoluteAudioUrl(String baseUrl) {
    final raw = audioUrl;
    if (raw == null || raw.isEmpty) return null;
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    final base = baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl;
    return raw.startsWith('/') ? '$base$raw' : '$base/$raw';
  }

  /// 时长的展示文案。0 表示尚未合成音频。
  String get durationLabel {
    if (durationSec <= 0) return '音频生成中';
    final m = durationSec ~/ 60;
    final s = durationSec % 60;
    return s == 0 ? '$m 分钟' : '$m 分 $s 秒';
  }
}

/// `/api/stories/:id` 额外返回正文。
class StoryDetail {
  const StoryDetail({required this.story, required this.content});

  final Story story;
  final String content;

  factory StoryDetail.fromJson(Map<String, dynamic> json) => StoryDetail(
        story: Story.fromJson(json),
        content: json['content'] as String? ?? '',
      );

  /// 按空行切段，供正文逐段渲染。
  List<String> get paragraphs =>
      content.split('\n').map((p) => p.trim()).where((p) => p.isNotEmpty).toList();
}

class Category {
  const Category({required this.id, required this.name, this.storyCount = 0});

  final int id;
  final String name;
  final int storyCount;

  factory Category.fromJson(Map<String, dynamic> json) => Category(
        id: (json['id'] as num).toInt(),
        name: json['name'] as String? ?? '',
        storyCount: (json['storyCount'] as num?)?.toInt() ?? 0,
      );
}

/// 继续听条目（/api/progress 与 /api/home 的 continueListening）。
class ProgressEntry {
  const ProgressEntry({
    required this.storyId,
    required this.positionSec,
    this.story,
  });

  final int storyId;
  final int positionSec;
  final Story? story;

  factory ProgressEntry.fromJson(Map<String, dynamic> json) {
    final rawStory = json['story'];
    return ProgressEntry(
      storyId: (json['storyId'] as num?)?.toInt() ?? 0,
      positionSec: (json['positionSec'] as num?)?.toInt() ?? 0,
      story: rawStory is Map<String, dynamic> ? Story.fromJson(rawStory) : null,
    );
  }
}

/// `/api/home` 聚合响应。
class HomeData {
  const HomeData({
    this.tonight,
    this.featured = const [],
    this.categories = const [],
    this.continueListening = const [],
  });

  final Story? tonight;
  final List<Story> featured;
  final List<Category> categories;
  final List<ProgressEntry> continueListening;

  factory HomeData.fromJson(Map<String, dynamic> json) => HomeData(
        tonight: json['tonight'] is Map<String, dynamic>
            ? Story.fromJson(json['tonight'] as Map<String, dynamic>)
            : null,
        featured: (json['featured'] as List?)
                ?.whereType<Map<String, dynamic>>()
                .map(Story.fromJson)
                .toList() ??
            const [],
        categories: (json['categories'] as List?)
                ?.whereType<Map<String, dynamic>>()
                .map(Category.fromJson)
                .toList() ??
            const [],
        continueListening: (json['continueListening'] as List?)
                ?.whereType<Map<String, dynamic>>()
                .map(ProgressEntry.fromJson)
                .toList() ??
            const [],
      );
}

/// 家长设置，对应服务端 `app.setting`（02-architecture §3.3）。
///
/// 字段名与 `GET/PUT /api/settings` 一一对应：
/// `{ dailyLimitMin, sleepTimerMin, ageFilter, parentGate }`。
/// 持久化在服务端，因此杀进程后不会丢（03-decisions D6 之后的需求）。
class RemoteSettings {
  const RemoteSettings({
    this.dailyLimitMin = 0,
    this.sleepTimerMin = 30,
    this.ageFilter = '3-6',
    this.parentGate = true,
  });

  /// 每日时长限制（分钟）。0 = 不限。
  final int dailyLimitMin;

  /// 默认定时停止（分钟）。0 = 不自动停止。
  final int sleepTimerMin;

  /// 内容年龄档：3-6 | 6-9 | 9+。
  final String ageFilter;

  /// 家长门开关。
  final bool parentGate;

  factory RemoteSettings.fromJson(Map<String, dynamic> json) => RemoteSettings(
        dailyLimitMin: (json['dailyLimitMin'] as num?)?.toInt() ?? 0,
        sleepTimerMin: (json['sleepTimerMin'] as num?)?.toInt() ?? 30,
        ageFilter: json['ageFilter'] as String? ?? '3-6',
        parentGate: json['parentGate'] as bool? ?? true,
      );

  /// PUT 是部分更新，这里发全量字段（值来自本地状态，因此等同于当前设置）。
  Map<String, dynamic> toJson() => {
        'dailyLimitMin': dailyLimitMin,
        'sleepTimerMin': sleepTimerMin,
        'ageFilter': ageFilter,
        'parentGate': parentGate,
      };
}

/// 分页包装。
class Paged<T> {
  const Paged({
    required this.items,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.totalPages,
  });

  final List<T> items;
  final int page;
  final int pageSize;
  final int total;
  final int totalPages;

  static Paged<Story> storiesFromJson(Map<String, dynamic> json) => Paged<Story>(
        items: (json['items'] as List?)
                ?.whereType<Map<String, dynamic>>()
                .map(Story.fromJson)
                .toList() ??
            const [],
        page: (json['page'] as num?)?.toInt() ?? 1,
        pageSize: (json['pageSize'] as num?)?.toInt() ?? 20,
        total: (json['total'] as num?)?.toInt() ?? 0,
        totalPages: (json['totalPages'] as num?)?.toInt() ?? 1,
      );
}
