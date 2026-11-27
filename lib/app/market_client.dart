import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;

import '../core/market.dart';
import '../core/settings.dart';

/// Talks to the marketplace repository: read `index.json`, then download one
/// plugin's manifest and module and write them into the local plugin directory.
///
/// Nothing here trusts the network. The manifest must agree with the index, the
/// module must match the recorded byte size and SHA-256, and the files are
/// staged in a temporary directory before they replace anything on disk.
class MarketClient {
  MarketClient({http.Client? client, this.now = _defaultNow}) : _client = client ?? http.Client();

  final http.Client _client;
  final int Function() now;

  static int _defaultNow() => DateTime.now().millisecondsSinceEpoch;

  Future<MarketParseResult> refresh(MarketSettings settings) async {
    try {
      final response = await _client.get(_rawUrl(settings, 'index.json'));
      if (response.statusCode != 200) return MarketParseResult.failed('市场返回 HTTP ${response.statusCode}');
      if (response.bodyBytes.length > maxMarketIndexBytes) {
        return const MarketParseResult.failed('市场索引超过大小上限');
      }
      return parseMarketIndex(utf8.decode(response.bodyBytes));
    } catch (error) {
      return MarketParseResult.failed('无法连接插件市场：$error');
    }
  }

  /// Downloads, verifies and installs one entry. Returns the recorded install
  /// on success and a user-facing reason on failure.
  Future<MarketInstallResult> install({
    required MarketSettings settings,
    required MarketEntry entry,
    required Directory directory,
  }) async {
    try {
      final manifestResponse = await _client.get(_rawUrl(settings, entry.manifestPath));
      if (manifestResponse.statusCode != 200) {
        return MarketInstallResult.failed('插件清单返回 HTTP ${manifestResponse.statusCode}');
      }
      if (manifestResponse.bodyBytes.length > maxMarketManifestBytes) {
        return const MarketInstallResult.failed('插件清单超过大小上限');
      }
      final manifestText = utf8.decode(manifestResponse.bodyBytes);
      final manifest = jsonDecode(manifestText);
      if (manifest is! Map) return const MarketInstallResult.failed('插件清单不是 JSON 对象');
      if (manifest['id'] != entry.id) return const MarketInstallResult.failed('插件清单 id 与索引不一致');
      if (manifest['version'] != entry.version) return const MarketInstallResult.failed('插件清单版本与索引不一致');
      final script = manifest['script'];
      if (manifest['kind'] != 'script' || script is! Map) {
        return const MarketInstallResult.failed('插件清单不是脚本插件');
      }
      final entryFile = sanitizeMarketPath(script['entry']);
      if (entryFile == null || !entryFile.endsWith('.wasm')) {
        return const MarketInstallResult.failed('插件清单的模块名不合法');
      }

      final moduleResponse = await _client.get(_rawUrl(settings, entry.wasmPath));
      if (moduleResponse.statusCode != 200) {
        return MarketInstallResult.failed('插件模块返回 HTTP ${moduleResponse.statusCode}');
      }
      final bytes = moduleResponse.bodyBytes;
      if (bytes.length > maxMarketWasmBytes) return const MarketInstallResult.failed('插件模块超过大小上限');
      if (bytes.length != entry.size) return const MarketInstallResult.failed('插件模块大小与索引不一致');
      if (sha256Hex(bytes) != entry.sha256) return const MarketInstallResult.failed('插件模块校验失败（SHA-256 不匹配）');

      await _writePlugin(directory: directory, entry: entry, manifestText: manifestText, entryFile: entryFile, bytes: bytes);
      return MarketInstallResult.installed(
        MarketInstall(version: entry.version, sha256: entry.sha256, installedAt: now()),
      );
    } catch (error) {
      return MarketInstallResult.failed('安装失败：$error');
    }
  }

  /// Stages both files under `.staging-<id>/` and swaps the directory in, so a
  /// failed download never leaves a half-written plugin behind.
  Future<void> _writePlugin({
    required Directory directory,
    required MarketEntry entry,
    required String manifestText,
    required String entryFile,
    required List<int> bytes,
  }) async {
    final root = directory.absolute;
    await root.create(recursive: true);
    final target = p.join(root.path, entry.id);
    if (p.dirname(target) != root.path) throw const FileSystemException('插件路径越界');
    final staging = Directory(p.join(root.path, '.staging-${entry.id}'));
    if (staging.existsSync()) await staging.delete(recursive: true);
    await staging.create(recursive: true);
    await File(p.join(staging.path, 'plugin.json')).writeAsString(manifestText, flush: true);
    await File(p.join(staging.path, entryFile)).writeAsBytes(bytes, flush: true);
    final existing = Directory(target);
    if (existing.existsSync()) await existing.delete(recursive: true);
    await staging.rename(target);
  }

  /// Removes one locally installed plugin directory.
  Future<String?> uninstall({required String id, required Directory directory}) async {
    if (!RegExp(r'^[a-z0-9]+(?:-[a-z0-9]+)*$').hasMatch(id)) return '插件 id 不合法';
    final root = directory.absolute;
    final target = p.join(root.path, id);
    if (p.dirname(target) != root.path) return '插件路径越界';
    try {
      final directoryToRemove = Directory(target);
      if (directoryToRemove.existsSync()) await directoryToRemove.delete(recursive: true);
      return null;
    } catch (error) {
      return '卸载失败：$error';
    }
  }

  void close() => _client.close();

  Uri _rawUrl(MarketSettings settings, String path) =>
      Uri.parse('https://raw.githubusercontent.com/${settings.repo}/${settings.ref}/$path');
}

class MarketInstallResult {
  const MarketInstallResult.installed(MarketInstall this.install) : error = null;
  const MarketInstallResult.failed(String this.error) : install = null;

  final MarketInstall? install;
  final String? error;

  bool get ok => install != null;
}
