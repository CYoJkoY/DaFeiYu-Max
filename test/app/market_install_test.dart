import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:magpie_dafeiyu/app/market_client.dart';
import 'package:magpie_dafeiyu/core/market.dart';
import 'package:magpie_dafeiyu/core/settings.dart';
import 'package:path/path.dart' as p;

const _market = MarketSettings(repo: 'CYoJkoY/DaFeiYu-Max-Plugins', ref: 'main');

/// A tiny but real WebAssembly header, so the fixture bytes are not arbitrary.
const _moduleBytes = <int>[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef];

String _manifestJson({String id = 'douyin-scroll', String version = '0.5.1'}) => jsonEncode({
  'id': id,
  'version': version,
  'kind': 'script',
  'labels': {'zh': '刷抖音'},
  'script': {
    'entry': 'plugin.wasm',
    'permissions': ['pet', 'bridge'],
  },
});

MarketEntry _entry({
  String id = 'douyin-scroll',
  String version = '0.5.1',
  int? size,
  String? sha,
}) =>
    MarketEntry(
      id: id,
      version: version,
      name: 'douyin-scroll',
      description: '在抖音网页里滚动并挑选下一条公开视频。',
      author: 'CYoJkoY',
      permissions: const ['pet', 'bridge'],
      size: size ?? _moduleBytes.length,
      sha256: sha ?? sha256Hex(_moduleBytes),
      manifestPath: 'plugins/$id/plugin.json',
      wasmPath: 'plugins/$id/plugin.wasm',
      labels: const {'zh': '刷抖音'},
    );

/// Serves the fixture repository: one manifest plus one module.
http.Client _repo({
  String? manifest,
  List<int>? module,
  int status = 200,
  void Function(Uri url)? onRequest,
}) =>
    MockClient((request) async {
  onRequest?.call(request.url);
  final path = request.url.path;
  if (status != 200) return http.Response('nope', status);
  if (path.endsWith('plugin.json')) {
    return http.Response.bytes(utf8.encode(manifest ?? _manifestJson()), 200);
  }
  if (path.endsWith('plugin.wasm')) {
    return http.Response.bytes(module ?? _moduleBytes, 200);
  }
  if (path.endsWith('index.json')) {
    return http.Response.bytes(
      utf8.encode(jsonEncode({
        'schemaVersion': 1,
        'generatedAt': '2026-11-26T19:40:08Z',
        'plugins': [
          {
            'id': 'douyin-scroll',
            'version': '0.5.1',
            'kind': 'script',
            'name': 'douyin-scroll',
            'description': '在抖音网页里滚动并挑选下一条公开视频。',
            'author': 'CYoJkoY',
            'permissions': ['pet', 'bridge'],
            'size': _moduleBytes.length,
            'sha256': sha256Hex(_moduleBytes),
            'manifest': 'plugins/douyin-scroll/plugin.json',
            'wasm': 'plugins/douyin-scroll/plugin.wasm',
          },
        ],
      })),
      200,
    );
  }
  return http.Response('not found', 404);
});

void main() {
  late Directory root;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('dafeiyu-market-');
  });

  tearDown(() async {
    if (root.existsSync()) await root.delete(recursive: true);
  });

  group('refresh', () {
    test('reads the index from raw.githubusercontent.com', () async {
      Uri? seen;
      final client = MarketClient(client: _repo(onRequest: (url) => seen = url));
      final result = await client.refresh(_market);
      client.close();
      expect(result.ok, isTrue, reason: result.error);
      expect(result.index!.find('douyin-scroll')!.displayName, '刷抖音');
      expect(
        seen.toString(),
        'https://raw.githubusercontent.com/CYoJkoY/DaFeiYu-Max-Plugins/main/index.json',
      );
    });

    test('reports an HTTP failure instead of throwing', () async {
      final client = MarketClient(client: _repo(status: 404));
      final result = await client.refresh(_market);
      client.close();
      expect(result.ok, isFalse);
      expect(result.error, contains('404'));
    });
  });

  group('install', () {
    test('writes the manifest and module, then reports what it recorded', () async {
      final client = MarketClient(client: _repo(), now: () => 1764186000000);
      final result = await client.install(settings: _market, entry: _entry(), directory: root);
      client.close();

      expect(result.ok, isTrue, reason: result.error);
      expect(result.install!.version, '0.5.1');
      expect(result.install!.sha256, sha256Hex(_moduleBytes));
      expect(result.install!.installedAt, 1764186000000);

      final target = Directory(p.join(root.path, 'douyin-scroll'));
      expect(target.existsSync(), isTrue);
      final manifest = File(p.join(target.path, 'plugin.json')).readAsStringSync();
      expect(jsonDecode(manifest)['id'], 'douyin-scroll');
      expect(File(p.join(target.path, 'plugin.wasm')).readAsBytesSync(), _moduleBytes);
      expect(Directory(p.join(root.path, '.staging-douyin-scroll')).existsSync(), isFalse);
    });

    test('replaces an older install in one step', () async {
      final old = Directory(p.join(root.path, 'douyin-scroll'));
      await old.create(recursive: true);
      await File(p.join(old.path, 'stale.txt')).writeAsString('old');

      final client = MarketClient(client: _repo());
      final result = await client.install(settings: _market, entry: _entry(), directory: root);
      client.close();

      expect(result.ok, isTrue, reason: result.error);
      expect(File(p.join(old.path, 'stale.txt')).existsSync(), isFalse);
      expect(File(p.join(old.path, 'plugin.wasm')).existsSync(), isTrue);
    });

    test('refuses a module whose size disagrees with the index', () async {
      final client = MarketClient(client: _repo());
      final result = await client.install(
        settings: _market,
        entry: _entry(size: _moduleBytes.length + 1),
        directory: root,
      );
      client.close();

      expect(result.ok, isFalse);
      expect(result.error, contains('大小'));
      expect(File(p.join(root.path, 'douyin-scroll', 'plugin.wasm')).existsSync(), isFalse);
    });

    test('refuses a module whose SHA-256 disagrees with the index', () async {
      final client = MarketClient(client: _repo());
      final result = await client.install(
        settings: _market,
        entry: _entry(sha: sha256Hex(const <int>[1, 2, 3])),
        directory: root,
      );
      client.close();

      expect(result.ok, isFalse);
      expect(result.error, contains('SHA-256'));
      expect(File(p.join(root.path, 'douyin-scroll', 'plugin.wasm')).existsSync(), isFalse);
    });

    test('refuses a manifest whose version disagrees with the index', () async {
      final client = MarketClient(client: _repo(manifest: _manifestJson(version: '9.9.9')));
      final result = await client.install(settings: _market, entry: _entry(), directory: root);
      client.close();

      expect(result.ok, isFalse);
      expect(result.error, contains('版本'));
      expect(root.listSync(), isEmpty);
    });

    test('refuses a manifest that is not a script plugin', () async {
      final client = MarketClient(
        client: _repo(manifest: jsonEncode({'id': 'douyin-scroll', 'version': '0.5.1', 'kind': 'social'})),
      );
      final result = await client.install(settings: _market, entry: _entry(), directory: root);
      client.close();

      expect(result.ok, isFalse);
      expect(result.error, contains('脚本'));
      expect(root.listSync(), isEmpty);
    });
  });

  group('uninstall', () {
    test('removes an installed directory', () async {
      final client = MarketClient(client: _repo());
      await client.install(settings: _market, entry: _entry(), directory: root);
      final error = await client.uninstall(id: 'douyin-scroll', directory: root);
      client.close();

      expect(error, isNull);
      expect(Directory(p.join(root.path, 'douyin-scroll')).existsSync(), isFalse);
    });

    test('rejects an id that could escape the plugins directory', () async {
      final client = MarketClient(client: _repo());
      expect(await client.uninstall(id: '../etc', directory: root), isNotNull);
      expect(await client.uninstall(id: 'Douyin', directory: root), isNotNull);
      client.close();
    });
  });
}
