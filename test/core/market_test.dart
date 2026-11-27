import 'package:flutter_test/flutter_test.dart';
import 'package:magpie_dafeiyu/core/market.dart';

const _sha = '91b07eafe2b8e0d0c1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8';

String _entryJson({
  String id = 'douyin-scroll',
  String version = '0.5.1',
  String sha = _sha,
  int size = 121841,
  Object? permissions = const ['pet', 'bridge'],
  String kind = 'script',
  String manifest = 'plugins/douyin-scroll/plugin.json',
  String wasm = 'plugins/douyin-scroll/plugin.wasm',
}) {
  final permissionList =
      permissions is List ? '[${permissions.map((item) => '"$item"').join(', ')}]' : '[]';
  return '''
{
  "id": "$id",
  "version": "$version",
  "kind": "$kind",
  "name": "douyin-scroll",
  "description": "在抖音网页里滚动并挑选下一条公开视频。",
  "author": "CYoJkoY",
  "permissions": $permissionList,
  "size": $size,
  "sha256": "$sha",
  "manifest": "$manifest",
  "wasm": "$wasm",
  "labels": {"zh": "刷抖音"}
}''';
}

String _indexJson({String? second, String schemaVersion = '1'}) => '''
{
  "schemaVersion": $schemaVersion,
  "generatedAt": "2026-11-26T19:40:08Z",
  "plugins": [${_entryJson()}${second == null ? '' : ', $second'}]
}
''';

String _entryIndex(String entry) => '''
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-26T19:40:08Z",
  "plugins": [$entry]
}
''';

void main() {
  group('parseMarketIndex', () {
    test('accepts the published index shape', () {
      final result = parseMarketIndex(_indexJson());
      expect(result.ok, isTrue, reason: result.error);
      final index = result.index!;
      expect(index.plugins, hasLength(1));
      final entry = index.find('douyin-scroll')!;
      expect(entry.version, '0.5.1');
      expect(entry.displayName, '刷抖音');
      expect(entry.permissions, ['pet', 'bridge']);
      expect(entry.wasmPath, 'plugins/douyin-scroll/plugin.wasm');
      expect(index.find('missing'), isNull);
    });

    test('rejects malformed JSON', () {
      expect(parseMarketIndex('{').ok, isFalse);
      expect(parseMarketIndex('[]').ok, isFalse);
    });

    test('rejects an unknown schema version', () {
      final result = parseMarketIndex(_indexJson(schemaVersion: '2'));
      expect(result.ok, isFalse);
      expect(result.error, contains('2'));
    });

    test('rejects a duplicate id', () {
      final result = parseMarketIndex(_indexJson(second: _entryJson()));
      expect(result.ok, isFalse);
      expect(result.error, contains('douyin-scroll'));
    });

    test('rejects an uppercase or short sha256', () {
      expect(parseMarketIndex(_entryIndex(_entryJson(sha: _sha.toUpperCase()))).ok, isFalse);
      expect(parseMarketIndex(_entryIndex(_entryJson(sha: '91b07eaf'))).ok, isFalse);
    });

    test('rejects a path that escapes the repository', () {
      expect(parseMarketIndex(_entryIndex(_entryJson(wasm: '../plugin.wasm'))).ok, isFalse);
      expect(parseMarketIndex(_entryIndex(_entryJson(manifest: '/abs/plugin.json'))).ok, isFalse);
      expect(parseMarketIndex(_entryIndex(_entryJson(manifest: r'C:\plugin.json'))).ok, isFalse);
      expect(parseMarketIndex(_entryIndex(_entryJson(manifest: 'https://example.test/plugin.json'))).ok,
          isFalse);
    });

    test('rejects an unknown permission', () {
      expect(parseMarketIndex(_entryIndex(_entryJson(permissions: const ['pet', 'root']))).ok, isFalse);
      expect(parseMarketIndex(_entryIndex(_entryJson(permissions: const []))).ok, isFalse);
    });

    test('rejects a non script entry', () {
      expect(parseMarketIndex(_entryIndex(_entryJson(kind: 'appearance'))).ok, isFalse);
    });

    test('rejects a bad version and an oversized module', () {
      expect(parseMarketIndex(_entryIndex(_entryJson(version: 'v1'))).ok, isFalse);
      expect(parseMarketIndex(_entryIndex(_entryJson(size: maxMarketWasmBytes + 1))).ok, isFalse);
      expect(parseMarketIndex(_entryIndex(_entryJson(size: 0))).ok, isFalse);
    });
  });

  group('sanitizeMarketPath', () {
    test('accepts a plain repository path', () {
      expect(sanitizeMarketPath('plugins/douyin-scroll/plugin.wasm'), 'plugins/douyin-scroll/plugin.wasm');
    });

    test('rejects escapes, schemes and empty segments', () {
      for (final value in <Object?>[
        '../x',
        'a/../b',
        '/abs',
        r'C:\x',
        'https://x/y',
        'a//b',
        '',
        42,
      ]) {
        expect(sanitizeMarketPath(value), isNull, reason: '$value');
      }
    });
  });

  test('sha256Hex matches the well-known empty input vector', () {
    expect(sha256Hex(const []), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  group('provenance', () {
    test('round-trips a recorded install', () {
      const install = MarketInstall(
        version: '0.5.1',
        sha256: 'abababababababababababababababababababababababababababababababab',
        installedAt: 1764186000000,
      );
      final encoded = encodeMarketProvenance({'douyin-scroll': install});
      final decoded = parseMarketProvenance(encoded);
      expect(decoded['douyin-scroll']!.version, '0.5.1');
      expect(decoded['douyin-scroll']!.sha256, install.sha256);
      expect(decoded['douyin-scroll']!.installedAt, install.installedAt);
    });

    test('drops invalid entries instead of failing', () {
      final decoded = parseMarketProvenance('''
{
  "schemaVersion": 1,
  "installed": {
    "Bad Id": {"version": "1.0.0", "sha256": "abc"},
    "ok-plugin": {"version": "1.0.0", "sha256": "abc", "installedAt": 5},
    "no-record": 7
  }
}
''');
      expect(decoded.keys, ['ok-plugin']);
      expect(parseMarketProvenance('not json'), isEmpty);
    });
  });
}
