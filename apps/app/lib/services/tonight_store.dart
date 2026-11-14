import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/models.dart';

/// 「今晚的列表」的本地存储。
///
/// 为什么存本地而不是服务端：这是**设备上的一时之选**（今晚听哪几个），
/// 不是家庭档案的一部分；离线也要能用，所以不占服务端一次往返。
/// 存的是整条 Story 的最小字段，不存 id 再回查 —— 列表要在离线时也显示得出来。
class TonightStore {
  static const _key = 'tonight_list';

  Future<List<Story>> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null || raw.isEmpty) return const [];
    try {
      final list = jsonDecode(raw);
      if (list is! List) return const [];
      return [
        for (final item in list)
          if (item is Map<String, dynamic>) Story.fromJson(item),
      ];
    } on FormatException {
      // 存坏了就当没有：宁可丢一次列表，也不要在启动时崩。
      return const [];
    }
  }

  Future<void> save(List<Story> stories) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode([for (final s in stories) _toJson(s)]));
  }

  Map<String, dynamic> _toJson(Story s) => {
        'id': s.id,
        'title': s.title,
        'excerpt': s.excerpt,
        'categoryId': s.categoryId,
        'categoryName': s.categoryName,
        'ageBand': s.ageBand,
        'durationSec': s.durationSec,
        'coverUrl': s.coverUrl,
        'audioUrl': s.audioUrl,
        'featured': s.featured,
      };
}
