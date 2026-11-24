import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;

import 'package:magpie_dafeiyu/core/magpie.dart';

void main() {
  group('resolvePort', () {
    test('defaults to 3425 when the settings file is missing', () {
      final dir = Directory.systemTemp.createTempSync('magpie-port');
      addTearDown(() => dir.deleteSync(recursive: true));
      final settings = '${dir.path}/missing.json';
      expect(resolvePort(settingsFile: settings), 3425);
    });

    test('reads a valid port and rejects an invalid one', () {
      final dir = Directory.systemTemp.createTempSync('magpie-port');
      addTearDown(() => dir.deleteSync(recursive: true));
      final settings = File('${dir.path}/settings.json');

      settings.writeAsStringSync(jsonEncode({'port': 4567}));
      expect(resolvePort(settingsFile: settings.path), 4567);

      settings.writeAsStringSync(jsonEncode({'port': 99999}));
      expect(resolvePort(settingsFile: settings.path), 3425);

      settings.writeAsStringSync('not json');
      expect(resolvePort(settingsFile: settings.path), 3425);
    });

    test('honours XDG_CONFIG_HOME', () {
      final dir = Directory.systemTemp.createTempSync('magpie-xdg');
      addTearDown(() => dir.deleteSync(recursive: true));
      expect(
        magpieSettingsPath(env: {'XDG_CONFIG_HOME': dir.path}, home: '/home/me'),
        p.join(dir.path, 'magpie', 'settings.json'),
      );
    });
  });

  test('resolveKey accepts a printable key and otherwise uses the default', () {
    expect(resolveKey(env: {'MAGPIE_API_KEY': 'my-secret-key'}), 'my-secret-key');
    expect(resolveKey(env: {'MAGPIE_API_KEY': 'short'}), 'magpie-dafeiyu');
    expect(resolveKey(env: {'MAGPIE_API_KEY': 'has space in it'}), 'magpie-dafeiyu');
  });

  group('chooseActivity', () {
    test('maps request counts to thinking, waiting and working', () {
      expect(
        chooseActivity({'object': 'concurrency', 'requests': 2, 'waiting': 0, 'tools': 0}).state,
        'thinking',
      );
      expect(
        chooseActivity({'object': 'concurrency', 'requests': 0, 'waiting': 1, 'tools': 0}).state,
        'waiting',
      );
      expect(
        chooseActivity({'object': 'concurrency', 'requests': 0, 'waiting': 0, 'tools': 1}).state,
        'working',
      );
      expect(
        chooseActivity({'object': 'concurrency', 'requests': 0, 'waiting': 0, 'tools': 0}).state,
        'idle',
      );
    });

    test('rejects malformed payloads', () {
      expect(chooseActivity({'object': 'nope'}).available, isFalse);
      expect(
        chooseActivity({'object': 'concurrency', 'requests': -1, 'waiting': 0, 'tools': 0}).available,
        isFalse,
      );
    });
  });

  test('activeAccountsForRoute hashes unfinished attempts', () {
    final route = {
      'done': false,
      'order': [
        {'id': 1, 'provider': 'cursor', 'who': 'alice'},
        {'id': 2, 'provider': 'cursor', 'who': 'bob'},
      ],
      'tries': [
        {'id': 2, 'done': false},
        {'id': 1, 'done': true},
      ],
    };
    final ids = activeAccountsForRoute(route);
    expect(ids.length, 1);
    expect(ids.single, accountKey('cursor', 'bob'));
    expect(activeAccountsForRoute({'done': true}), isEmpty);
  });

  group('normalizeCards', () {
    test('builds subscription windows and balance accounts', () {
      final now = DateTime.utc(2026, 11, 24, 10).millisecondsSinceEpoch;
      final quota = normalizeCards({
        'data': [
          {
            'provider': 'cursor',
            'user': 'alice',
            'name': 'Cursor',
            'plan': 'Pro',
            'windows': [
              {'name': 'Cursor Models', 'used': 62.5, 'resetsAt': '2026-12-01T00:00:00Z'},
            ],
            'readAt': '2026-11-24T09:59:00Z',
          },
          {
            'provider': 'deepseek',
            'user': 'bob',
            'name': 'DeepSeek',
            'plan': '余额',
            'kind': 'balance',
            'balance': '¥ 12.40',
            'readAt': '2026-11-24T09:59:00Z',
          },
        ],
      }, now: now);
      expect(quota.ok, isTrue);
      expect(quota.windows.single.remaining, 37.5);
      expect(quota.windows.single.label, 'Cursor · Pro #1 · Cursor Models');
      final balance = quota.accounts.firstWhere((account) => account.kind == 'balance');
      expect(balance.balance, '¥ 12.40');
      expect(quota.accounts.first.kind, 'subscription');
    });

    test('drops invalid balances and reports an empty quota', () {
      final quota = normalizeCards({
        'data': [
          {'provider': 'x', 'user': 'y', 'kind': 'balance', 'balance': 'lots'},
        ],
      });
      expect(quota.ok, isFalse);
      expect(quota.error, isNotNull);
    });

    test('marks readings older than ten minutes as stale', () {
      final now = DateTime.utc(2026, 11, 24, 10).millisecondsSinceEpoch;
      final quota = normalizeCards({
        'data': [
          {
            'provider': 'p',
            'user': 'u',
            'windows': [
              {'name': 'M', 'used': 10},
            ],
            'readAt': '2026-11-24T09:40:00Z',
          },
        ],
      }, now: now);
      expect(quota.windows.single.stale, isTrue);
    });
  });
}
