import 'package:flutter_test/flutter_test.dart';

import 'package:magpie_dafeiyu/core/quota_display.dart';
import 'package:magpie_dafeiyu/core/types.dart';

const _now = 1_800_000_000_000;

Activity _activity({List<String> ids = const []}) => Activity(
      state: 'thinking',
      label: '',
      available: true,
      activeCount: ids.length,
      observedAt: _now,
      activeAccountIds: ids,
    );

QuotaAccount _account({
  required String id,
  String kind = 'subscription',
  String? balance,
  int? readAt,
}) =>
    QuotaAccount(
      accountId: id,
      key: id,
      provider: 'p',
      icon: '',
      name: 'n',
      plan: 'plan',
      label: 'n · plan',
      kind: kind,
      balance: balance,
      readAt: readAt ?? _now,
    );

QuotaWindow _window(String accountId, {double remaining = 42, int? readAt, int? resetsAt}) => QuotaWindow(
      accountId: accountId,
      key: '$accountId|w',
      provider: 'p',
      icon: '',
      name: 'n',
      plan: 'plan',
      windowName: 'Cursor Models',
      label: 'n · plan · Cursor Models',
      used: 100 - remaining,
      remaining: remaining,
      readAt: readAt ?? _now,
      resetsAt: resetsAt,
      stale: false,
    );

void main() {
  test('active account ids expire after ten seconds', () {
    final fresh = Activity(
      state: 'thinking',
      label: '',
      available: true,
      activeCount: 1,
      observedAt: _now,
      activeAccountIds: ['a'],
    );
    expect(activeAccountIds(fresh, _now + 1000), ['a']);
    expect(activeAccountIds(fresh, _now + 11000), isEmpty);
  });

  test('subscription badges show the lowest remaining window', () {
    final quota = Quota(
      ok: true,
      windows: [_window('a', remaining: 80), _window('a', remaining: 12)],
      accounts: [_account(id: 'a')],
    );
    final badge = accountPercentages(quota, _activity(), now: _now).single;
    expect(badge.text, '12%');
    expect(badge.available, isTrue);
    expect(badge.active, isFalse);
  });

  test('balance badges fall back to a placeholder when unreadable', () {
    final quota = Quota(
      ok: true,
      windows: const [],
      accounts: [_account(id: 'b', kind: 'balance', balance: null)],
    );
    expect(accountPercentages(quota, null, now: _now).single.text, '余额待刷新');
  });

  test('quota entries flag the active account', () {
    final quota = Quota(
      ok: true,
      windows: [_window('a')],
      accounts: [_account(id: 'a')],
    );
    final entry = quotaEntries(quota, _activity(ids: ['a']), now: _now).single;
    expect(entry.active, isTrue);
    expect(entry.percent, 42);
    expect(entry.kind, 'subscription');
  });

  test('compact labels use aliases and clip by code point', () {
    expect(compactQuotaLabel(windowName: 'Cursor Models'), '模型');
    expect(compactQuotaLabel(windowName: '7 days'), '7天');
    expect(compactQuotaLabel(kind: 'balance'), '余额');
    expect(compactQuotaLabel(windowName: '额度名称很长很长很长'), '额度名称很');
    expect(compactQuotaLabel(), '额度');
  });
}
