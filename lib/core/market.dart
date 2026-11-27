/// The cloud plugin market, as published by `DaFeiYu-Max-Plugins`.
///
/// The market is an ordinary GitHub repository: "publishing" is a commit and
/// "browsing" is one `index.json` fetch from `raw.githubusercontent.com`. This
/// file only parses and validates that document - nothing here touches the
/// network or the disk, so the whole contract is unit-testable.
library;

import 'dart:convert';

import 'package:crypto/crypto.dart';

/// Bumping this constant is the only way the app accepts a new index shape.
const int marketSchemaVersion = 1;

/// Hard limits, mirroring the ones the plugin repository's schema declares.
const int maxMarketIndexBytes = 512 * 1024;
const int maxMarketManifestBytes = 64 * 1024;
const int maxMarketWasmBytes = 4 * 1024 * 1024;
const int maxMarketPlugins = 500;

const Set<String> marketPermissions = <String>{'pet', 'bridge', 'net'};

final RegExp _idPattern = RegExp(r'^[a-z0-9]+(?:-[a-z0-9]+)*$');
final RegExp _versionPattern = RegExp(r'^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$');
final RegExp _sha256Pattern = RegExp(r'^[a-f0-9]{64}$');
final RegExp _schemePattern = RegExp(r'^[a-zA-Z][a-zA-Z0-9+.-]*:');
final RegExp _segmentPattern = RegExp(r'^[A-Za-z0-9._-]+$');

/// One market entry: what the pet app may install, and how to verify it.
class MarketEntry {
  const MarketEntry({
    required this.id,
    required this.version,
    required this.name,
    required this.description,
    required this.author,
    required this.permissions,
    required this.size,
    required this.sha256,
    required this.manifestPath,
    required this.wasmPath,
    this.labels = const <String, String>{},
    this.tags = const <String>[],
    this.homepage,
  });

  final String id;
  final String version;
  final String name;
  final String description;
  final String author;
  final List<String> permissions;
  final int size;
  final String sha256;
  final String manifestPath;
  final String wasmPath;
  final Map<String, String> labels;
  final List<String> tags;
  final String? homepage;

  /// The Chinese label when the entry ships one, otherwise its market name.
  String get displayName {
    final zh = labels['zh'];
    return zh != null && zh.trim().isNotEmpty ? zh : name;
  }
}

class MarketIndex {
  const MarketIndex({required this.generatedAt, required this.plugins});

  final String generatedAt;
  final List<MarketEntry> plugins;

  MarketEntry? find(String id) {
    for (final entry in plugins) {
      if (entry.id == id) return entry;
    }
    return null;
  }
}

class MarketParseResult {
  const MarketParseResult.ok(MarketIndex this.index) : error = null;
  const MarketParseResult.failed(String this.error) : index = null;

  final MarketIndex? index;
  final String? error;

  bool get ok => index != null;
}

/// What the app recorded about a market install, so it can tell a market build
/// apart from a hand-copied local plugin and only update/remove what it owns.
class MarketInstall {
  const MarketInstall({required this.version, required this.sha256, required this.installedAt});

  final String version;
  final String sha256;
  final int installedAt;

  Map<String, Object?> toJson() => {'version': version, 'sha256': sha256, 'installedAt': installedAt};
}

/// Lowercase hex SHA-256 of a byte buffer.
String sha256Hex(List<int> bytes) => sha256.convert(bytes).toString();

/// A repository-relative path: no absolute paths, no `..`, no scheme, and
/// forward slashes only, so a crafted index can never reach outside the repo.
String? sanitizeMarketPath(Object? value) {
  if (value is! String) return null;
  final text = value.trim();
  if (text.isEmpty || text.length > 200) return null;
  if (text.contains('\\') || text.startsWith('/') || text.contains('..')) return null;
  if (_schemePattern.hasMatch(text)) return null;
  final segments = text.split('/');
  for (final segment in segments) {
    if (segment.isEmpty || !_segmentPattern.hasMatch(segment)) return null;
  }
  return text;
}

/// Parses `index.json`; one malformed entry rejects the whole document, so the
/// panel can never show a half-trusted market.
MarketParseResult parseMarketIndex(String text) {
  Object? decoded;
  try {
    decoded = jsonDecode(text);
  } catch (error) {
    return MarketParseResult.failed('市场索引不是合法 JSON：$error');
  }
  if (decoded is! Map) return const MarketParseResult.failed('市场索引不是 JSON 对象');
  if (decoded['schemaVersion'] != marketSchemaVersion) {
    return const MarketParseResult.failed('市场索引版本不是 $marketSchemaVersion');
  }
  final generatedAt = _text(decoded['generatedAt'], 40);
  if (generatedAt == null) return const MarketParseResult.failed('市场索引缺少 generatedAt');
  final rawPlugins = decoded['plugins'];
  if (rawPlugins is! List) return const MarketParseResult.failed('市场索引缺少 plugins 数组');
  if (rawPlugins.length > maxMarketPlugins) return const MarketParseResult.failed('市场索引条目过多');

  final plugins = <MarketEntry>[];
  final seen = <String>{};
  for (var index = 0; index < rawPlugins.length; index++) {
    final entry = parseMarketEntry(rawPlugins[index], index);
    if (entry == null) return MarketParseResult.failed(_entryError(rawPlugins[index], index));
    if (!seen.add(entry.id)) return MarketParseResult.failed('市场索引中 id 重复：${entry.id}');
    plugins.add(entry);
  }
  return MarketParseResult.ok(MarketIndex(generatedAt: generatedAt, plugins: plugins));
}

/// Validates one entry, returning `null` when anything is out of contract.
MarketEntry? parseMarketEntry(Object? value, [int index = 0]) {
  if (value is! Map) return null;
  final id = _text(value['id'], 64);
  if (id == null || !_idPattern.hasMatch(id)) return null;
  if (value['kind'] != 'script') return null;
  final version = _text(value['version'], 40);
  if (version == null || !_versionPattern.hasMatch(version)) return null;
  final name = _text(value['name'], 80);
  final description = _text(value['description'], 240);
  final author = _text(value['author'], 80);
  if (name == null || description == null || author == null) return null;
  final sha = _text(value['sha256'], 64);
  if (sha == null || !_sha256Pattern.hasMatch(sha)) return null;
  final size = value['size'];
  if (size is! int || size <= 0 || size > maxMarketWasmBytes) return null;
  final manifest = sanitizeMarketPath(value['manifest']);
  final wasm = sanitizeMarketPath(value['wasm']);
  if (manifest == null || wasm == null) return null;

  final rawPermissions = value['permissions'];
  if (rawPermissions is! List || rawPermissions.isEmpty) return null;
  final permissions = <String>[];
  for (final raw in rawPermissions) {
    if (raw is! String || !marketPermissions.contains(raw)) return null;
    if (!permissions.contains(raw)) permissions.add(raw);
  }

  final tags = <String>[];
  final rawTags = value['tags'];
  if (rawTags is List) {
    for (final raw in rawTags) {
      final tag = _text(raw, 32);
      if (tag != null && !tags.contains(tag) && tags.length < 12) tags.add(tag);
    }
  }

  final labels = <String, String>{};
  final rawLabels = value['labels'];
  if (rawLabels is Map) {
    for (final key in const <String>['zh', 'en']) {
      final label = _text(rawLabels[key], 80);
      if (label != null) labels[key] = label;
    }
  }

  final homepage = _text(value['homepage'], 300);
  return MarketEntry(
    id: id,
    version: version,
    name: name,
    description: description,
    author: author,
    permissions: permissions,
    size: size,
    sha256: sha,
    manifestPath: manifest,
    wasmPath: wasm,
    labels: labels,
    tags: tags,
    homepage: homepage != null && homepage.toLowerCase().startsWith('https://') ? homepage : null,
  );
}

/// The reason a rejected entry failed, so the panel can name the offender.
String _entryError(Object? value, int index) {
  if (value is! Map) return 'plugins[$index] 必须是对象';
  final id = value['id'];
  if (id is String && id.isNotEmpty) return '插件 $id 的索引字段不合法';
  return 'plugins[$index] 的索引字段不合法';
}

String? _text(Object? value, int max) {
  if (value is! String) return null;
  final trimmed = value.trim();
  if (trimmed.isEmpty || trimmed.length > max) return null;
  return trimmed;
}

/// Reads the provenance file the app writes after every marketplace install.
Map<String, MarketInstall> parseMarketProvenance(String text) {
  final installs = <String, MarketInstall>{};
  Object? decoded;
  try {
    decoded = jsonDecode(text);
  } catch (_) {
    return installs;
  }
  if (decoded is! Map) return installs;
  final raw = decoded['installed'];
  if (raw is! Map) return installs;
  for (final entry in raw.entries) {
    final id = entry.key.toString();
    if (!_idPattern.hasMatch(id)) continue;
    final record = entry.value;
    if (record is! Map) continue;
    final version = record['version'];
    final sha = record['sha256'];
    if (version is! String || sha is! String) continue;
    final at = record['installedAt'];
    installs[id] = MarketInstall(
      version: version.length > 40 ? version.substring(0, 40) : version,
      sha256: sha.length > 64 ? sha.substring(0, 64) : sha,
      installedAt: at is num ? at.toInt() : 0,
    );
    if (installs.length >= maxMarketPlugins) break;
  }
  return installs;
}

String encodeMarketProvenance(Map<String, MarketInstall> installs) => const JsonEncoder.withIndent('  ')
    .convert(<String, Object?>{
      'schemaVersion': 1,
      'installed': <String, Object?>{
        for (final entry in installs.entries) entry.key: entry.value.toJson(),
      },
    });
