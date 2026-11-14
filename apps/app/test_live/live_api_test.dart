import 'package:flutter_test/flutter_test.dart';
import 'package:story_app/services/api_client.dart';

/// 联调测试：打真实 dev 服务端（默认 http://127.0.0.1:3000）。
///
/// 放在 test_live/ 而不是 test/，因此 `flutter test`（只扫 test/）不会跑它，
/// 无需服务端也能全绿；联调时显式执行：
///   flutter test test_live/ --dart-define=API_BASE_URL=http://127.0.0.1:3000
///
/// 它验证的是「模型字段名与服务端真实响应是否对得上」——
/// 这是 mock 测试无法覆盖的部分（mock 的 fixture 是人写的，
/// 如果服务端改了字段名，mock 测试仍会通过）。
void main() {
  late ApiClient api;

  setUp(() {
    api = ApiClient(baseUrl: kApiBaseUrl);
  });

  tearDown(() => api.close());

  test('GET /api/home 返回真实聚合数据', () async {
    final home = await api.home();

    expect(home.categories, isNotEmpty, reason: '真实库有 15 个分类');
    expect(home.tonight, isNotNull, reason: '真实库有已上架故事');
    expect(home.tonight!.title, isNotEmpty);
    // 分龄字段必须是服务端定义的三个值之一。
    expect(['3-6', '6-9', '9+'], contains(home.tonight!.ageBand));
    // 分类计数应为非负整数。
    expect(home.categories.first.storyCount, greaterThanOrEqualTo(0));
  });

  test('GET /api/stories 支持分页与年龄档筛选', () async {
    final page = await api.stories(page: 1, pageSize: 5, ageBand: '3-6');

    expect(page.items.length, lessThanOrEqualTo(5));
    expect(page.total, greaterThan(1000), reason: 'dev 库有 2197 条');
    for (final s in page.items) {
      expect(s.ageBand, '3-6', reason: '年龄档筛选必须生效');
      expect(s.title, isNotEmpty);
    }
  });

  test('GET /api/stories/:id 返回正文（story_content 表的真实数据）', () async {
    final first = (await api.stories(page: 1, pageSize: 1)).items.first;
    final detail = await api.story(first.id);

    expect(detail.story.id, first.id);
    expect(detail.story.title, first.title);
    // 真实库的正文来自 public.story_content。
    expect(detail.content, isNotEmpty, reason: '详情接口应返回正文');
    expect(detail.paragraphs, isNotEmpty);
  });

  test('GET /api/categories 返回真实分类名', () async {
    final cats = await api.categories();
    expect(cats.length, 15, reason: '生产/dev 库均为 15 个分类');
    expect(cats.map((c) => c.name), contains('睡前故事'));
  });

  test('不存在的故事返回可读错误而不是崩溃', () async {
    await expectLater(
      api.story(99999999),
      throwsA(isA<ApiException>()),
    );
  });
}
