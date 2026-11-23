import 'package:flutter_test/flutter_test.dart';
import 'package:story_app/models/models.dart';
import 'package:story_app/state/app_state.dart';

import 'helpers.dart';

/// 外部端「补充账号信息」：`GET /api/me`、`PUT /api/me`、`POST /api/me/bind-phone`。
///
/// 这一组锁的是三个具体行为：
///   1. 游客账号（phone = null）与已绑定账号在界面上怎么区分；
///   2. 昵称为空时不发请求（服务端会 400，没必要往返一次）；
///   3. 绑定成功后本地账号状态立刻更新，不用重启 App。
void main() {
  group('AccountInfo', () {
    test('游客账号：phone 为空，展示名回落「游客」', () {
      final account = AccountInfo.fromJson({'id': 'a1', 'phone': null, 'nickname': '游客'});

      expect(account.isGuest, isTrue);
      expect(account.maskedPhone, '');
      expect(account.hasFamily, isFalse);
      expect(account.displayName, '游客');
    });

    test('绑定后：手机号脱敏，家庭行被识别', () {
      final account = AccountInfo.fromJson({
        'id': 'a1',
        'phone': '13900000004',
        'nickname': '小明妈妈',
        'children': [
          {'id': 'c1', 'nickname': '小明', 'ageBand': '3-6'},
        ],
        'family': {'id': 'f1', 'name': '我的家'},
      });

      expect(account.isGuest, isFalse);
      expect(account.maskedPhone, '139****0004');
      expect(account.hasFamily, isTrue);
      expect(account.childCount, 1);
      expect(account.displayName, '小明妈妈');
    });

    test('昵称为空时展示名回落「家长」而不是空白', () {
      final account = AccountInfo.fromJson({'id': 'a1', 'phone': '13900000004', 'nickname': '  '});
      expect(account.displayName, '家长');
    });
  });

  group('补账号信息', () {
    test('改昵称成功后本地账号立即更新', () async {
      final api = apiWith({
        '/api/me': okEnvelope({'id': 'a1', 'phone': null, 'nickname': '游客'}),
      });
      final state = AppState(api: api);
      await state.loadAccount();
      expect(state.account?.displayName, '游客');

      final api2 = apiWith({
        '/api/me': okEnvelope({'id': 'a1', 'phone': null, 'nickname': '小明妈妈'}),
      });
      final state2 = AppState(api: api2);
      final err = await state2.updateNickname('  小明妈妈  ');

      expect(err, isNull);
      expect(state2.account?.displayName, '小明妈妈', reason: '两端空格必须被 trim 掉');
    });

    test('昵称为空时直接返回错误文案，不发请求', () async {
      final seen = <String>[];
      final api = apiWith({
        '/api/me': okEnvelope({'id': 'a1', 'phone': null, 'nickname': '游客'}),
      }, seen: seen);
      final state = AppState(api: api);

      final err = await state.updateNickname('   ');

      expect(err, '昵称不能为空');
      expect(seen, isEmpty, reason: '空的昵称服务端会 400，本地就该挡住');
    });

    test('绑定失败时把服务端文案透出来（409 手机号被占用）', () async {
      final api = apiWith({
        '/api/me/bind-phone': errEnvelope(
          '该手机号已绑定其他账号，请改用手机号登录',
          code: 'CONFLICT',
        ),
      });
      final state = AppState(api: api);

      final err = await state.bindPhone(phone: '13900000004', code: '123456');

      expect(err, '该手机号已绑定其他账号，请改用手机号登录');
      expect(state.account, isNull, reason: '失败不能把本地状态改坏');
    });

    test('收藏列表能把本地集合补上（冷启动心形不再永远空心）', () async {
      final api = apiWith({
        '/api/favorites': okEnvelope([
          {'storyId': 3, 'positionSec': 0, 'story': storyJson(id: 3)},
          {'storyId': 8, 'positionSec': 0, 'story': storyJson(id: 8)},
        ]),
      });
      final state = AppState(api: api);

      await state.syncFavorites();

      expect(state.isFavorite(3), isTrue);
      expect(state.isFavorite(8), isTrue);
      expect(state.isFavorite(9), isFalse);
    });
  });
}
