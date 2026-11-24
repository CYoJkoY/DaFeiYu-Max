/// Settings persistence and sanitizers, ported from src/core/settings.ts.
library;

const petSizes = <int>[360, 460, 560];

const defaultInterests = <String>['DeepSeek', 'Magpie', '编程'];

const defaultMarketRepo = 'CYoJkoY/DaFeiYu-Max-Plugins';
const defaultMarketRef = 'main';

class MarketSettings {
  const MarketSettings({required this.repo, required this.ref, this.lastSync});
  final String repo;
  final String ref;
  final int? lastSync;

  Map<String, Object?> toJson() => {'repo': repo, 'ref': ref, 'lastSync': lastSync};

  static MarketSettings fromJson(Object? value) {
    final source = value is Map<String, Object?> ? value : const <String, Object?>{};
    final repoText = (source['repo'] ?? '').toString().trim();
    final repo = _repoPattern.hasMatch(repoText) && !_hasDotSegment(repoText)
        ? repoText
        : defaultMarketRepo;
    final ref = _refPattern.hasMatch((source['ref'] ?? '').toString().trim())
        && !(source['ref'] as String).contains('..')
        ? (source['ref'] as String).trim()
        : defaultMarketRef;
    final lastSync = source['lastSync'] is num ? (source['lastSync'] as num).toInt() : null;
    return MarketSettings(repo: repo, ref: ref, lastSync: lastSync);
  }
}

class ScriptPluginSelection {
  const ScriptPluginSelection({required this.enabled, required this.options});
  final bool enabled;
  final Map<String, Object> options;

  Map<String, Object?> toJson() => {'enabled': enabled, 'options': options};
}

class PluginSettings {
  const PluginSettings({
    required this.appearance,
    required this.enabled,
    required this.scripts,
    required this.market,
  });
  final String? appearance;
  final Map<String, bool> enabled;
  final Map<String, ScriptPluginSelection> scripts;
  final MarketSettings market;

  Map<String, Object?> toJson() => {
    'appearance': appearance,
    'enabled': enabled,
    'scripts': {for (final entry in scripts.entries) entry.key: entry.value.toJson()},
    'market': market.toJson(),
  };
}

class PlatformSettings {
  const PlatformSettings({required this.enabled, this.bridgeUrl, this.hasCredentials});
  final bool enabled;
  final String? bridgeUrl;
  final bool? hasCredentials;

  Map<String, Object?> toJson() => {'enabled': enabled, if (bridgeUrl != null) 'bridgeUrl': bridgeUrl};
}

class QuietHours {
  const QuietHours({required this.start, required this.end});
  final int start;
  final int end;

  Map<String, Object?> toJson() => {'start': start, 'end': end};
}

class SocialSettings {
  const SocialSettings({
    required this.enabled,
    required this.intervalMinutes,
    required this.allowWrites,
    this.quietHours,
    required this.platforms,
  });
  final bool enabled;
  final int intervalMinutes;
  final bool allowWrites;
  final QuietHours? quietHours;
  final Map<String, PlatformSettings> platforms;

  Map<String, Object?> toJson() => {
    'enabled': enabled,
    'intervalMinutes': intervalMinutes,
    'allowWrites': allowWrites,
    if (quietHours != null) 'quietHours': quietHours!.toJson(),
    'platforms': {for (final entry in platforms.entries) entry.key: entry.value.toJson()},
  };
}

class PetSettings {
  const PetSettings({
    required this.size,
    required this.active,
    required this.paused,
    required this.locked,
    required this.followTasks,
    required this.showBulbs,
    required this.showQuotas,
    required this.hiddenQuotas,
    required this.x,
    required this.y,
    required this.interests,
    required this.social,
    required this.plugins,
  });
  final int size;
  final bool active;
  final bool paused;
  final bool locked;
  final bool followTasks;
  final bool showBulbs;
  final bool showQuotas;
  final Map<String, bool> hiddenQuotas;
  final double? x;
  final double? y;
  final List<String> interests;
  final SocialSettings social;
  final PluginSettings plugins;

  PetSettings copyWith({
    int? size,
    bool? active,
    bool? paused,
    bool? locked,
    bool? followTasks,
    bool? showBulbs,
    bool? showQuotas,
    Map<String, bool>? hiddenQuotas,
    double? x,
    double? y,
    bool clearX = false,
    bool clearY = false,
    List<String>? interests,
    SocialSettings? social,
    PluginSettings? plugins,
  }) =>
      PetSettings(
        size: size ?? this.size,
        active: active ?? this.active,
        paused: paused ?? this.paused,
        locked: locked ?? this.locked,
        followTasks: followTasks ?? this.followTasks,
        showBulbs: showBulbs ?? this.showBulbs,
        showQuotas: showQuotas ?? this.showQuotas,
        hiddenQuotas: hiddenQuotas ?? this.hiddenQuotas,
        x: clearX ? null : (x ?? this.x),
        y: clearY ? null : (y ?? this.y),
        interests: interests ?? this.interests,
        social: social ?? this.social,
        plugins: plugins ?? this.plugins,
      );

  Map<String, Object?> toJson() => {
    'size': size,
    'active': active,
    'paused': paused,
    'locked': locked,
    'followTasks': followTasks,
    'showBulbs': showBulbs,
    'showQuotas': showQuotas,
    'hiddenQuotas': hiddenQuotas,
    'x': x,
    'y': y,
    'interests': interests,
    'social': social.toJson(),
    'plugins': plugins.toJson(),
  };
}

final RegExp _slugPattern = RegExp(r'^[a-z0-9]+(?:-[a-z0-9]+)*$');
final RegExp _repoPattern = RegExp(r'^[A-Za-z0-9_.-]{1,64}/[A-Za-z0-9_.-]{1,100}$');
final RegExp _refPattern = RegExp(r'^[A-Za-z0-9._/\-]{1,120}$');
final RegExp _optionKeyPattern = RegExp(r'^[a-zA-Z][a-zA-Z0-9_\-]{0,48}$');

/// Reject `.`/`..` path segments so a repo string can never escape its root.
bool _hasDotSegment(String value) =>
    value.split('/').any((segment) => segment.isEmpty || segment == '.' || segment == '..');

const defaultSettings = PetSettings(
  size: 460,
  active: true,
  paused: false,
  locked: false,
  followTasks: true,
  showBulbs: true,
  showQuotas: true,
  hiddenQuotas: {},
  x: null,
  y: null,
  interests: defaultInterests,
  social: SocialSettings(
    enabled: false,
    intervalMinutes: 15,
    allowWrites: false,
    quietHours: QuietHours(start: 23, end: 7),
    platforms: {},
  ),
  plugins: PluginSettings(
    appearance: null,
    enabled: {},
    scripts: {},
    market: MarketSettings(repo: defaultMarketRepo, ref: defaultMarketRef),
  ),
);

Map<String, bool> sanitizeHiddenQuotas(Object? value) {
  if (value is! Map) return {};
  final result = <String, bool>{};
  for (final entry in value.entries) {
    final id = entry.key.toString();
    if (id.isEmpty || id.length > 240 || entry.value != true) continue;
    result[id] = true;
    if (result.length >= 500) break;
  }
  return result;
}

List<String> sanitizeInterests(Object? value) {
  if (value is! List) return [...defaultInterests];
  final seen = <String>{};
  final interests = <String>[];
  for (final entry in value) {
    if (entry is! String) continue;
    var text = entry.trim();
    if (text.length > 40) text = text.substring(0, 40);
    if (text.isEmpty) continue;
    final key = text.toLowerCase();
    if (seen.contains(key)) continue;
    seen.add(key);
    interests.add(text);
    if (interests.length >= 20) break;
  }
  return interests;
}

String? sanitizeBridgeUrl(Object? value) {
  if (value is! String) return null;
  final text = value.trim();
  if (text.isEmpty || text.length > 300) return null;
  final uri = Uri.tryParse(text);
  if (uri == null) return null;
  if (uri.scheme != 'http' && uri.scheme != 'https') return null;
  if (uri.userInfo.isNotEmpty) return null;
  final path = uri.path == '/' ? '' : uri.path.replaceFirst(RegExp(r'/+$'), '');
  return '${uri.origin}$path';
}

QuietHours? sanitizeQuietHours(Object? value) {
  if (value is! Map) return null;
  final start = value['start'];
  final end = value['end'];
  bool valid(Object? hour) => hour is int && hour >= 0 && hour <= 23;
  if (!valid(start) || !valid(end)) return null;
  return QuietHours(start: start as int, end: end as int);
}

SocialSettings sanitizeSocial(Object? value, List<String> knownPlatforms) {
  final source = value is Map<String, Object?> ? value : const <String, Object?>{};
  final platforms = <String, PlatformSettings>{};
  final rawPlatforms = source['platforms'] is Map ? source['platforms'] as Map : const {};
  for (final id in knownPlatforms) {
    final entry = rawPlatforms[id];
    if (entry is! Map) continue;
    platforms[id] = PlatformSettings(
      enabled: entry['enabled'] == true,
      bridgeUrl: sanitizeBridgeUrl(entry['bridgeUrl']),
    );
  }
  final rawInterval = source['intervalMinutes'];
  final interval = rawInterval is num && rawInterval.isFinite ? rawInterval.round() : 15;
  return SocialSettings(
    enabled: source['enabled'] == true,
    allowWrites: source['allowWrites'] == true,
    intervalMinutes: interval.clamp(5, 180),
    quietHours: sanitizeQuietHours(source['quietHours']),
    platforms: platforms,
  );
}

Map<String, ScriptPluginSelection> sanitizeScripts(Object? value) {
  if (value is! Map) return {};
  final result = <String, ScriptPluginSelection>{};
  for (final entry in value.entries) {
    final id = entry.key.toString();
    if (id.length > 64 || !_slugPattern.hasMatch(id)) continue;
    if (entry.value is! Map) continue;
    final record = entry.value as Map;
    final options = <String, Object>{};
    final rawOptions = record['options'];
    if (rawOptions is Map) {
      for (final option in rawOptions.entries) {
        final key = option.key.toString();
        if (!_optionKeyPattern.hasMatch(key)) continue;
        if (option.value is bool || option.value is int || option.value is double) {
          options[key] = option.value as Object;
        } else if (option.value is String && (option.value as String).length <= 300) {
          options[key] = option.value as String;
        }
        if (options.length >= 64) break;
      }
    }
    result[id] = ScriptPluginSelection(enabled: record['enabled'] == true, options: options);
    if (result.length >= 200) break;
  }
  return result;
}

PluginSettings sanitizePlugins(Object? value) {
  final source = value is Map<String, Object?> ? value : const <String, Object?>{};
  final appearanceRaw = source['appearance'];
  final appearance = appearanceRaw is String && appearanceRaw.length <= 64 && _slugPattern.hasMatch(appearanceRaw)
      ? appearanceRaw
      : null;
  final enabled = <String, bool>{};
  final rawEnabled = source['enabled'] is Map ? source['enabled'] as Map : const {};
  for (final entry in rawEnabled.entries) {
    final id = entry.key.toString();
    if (id.length > 64 || !_slugPattern.hasMatch(id)) continue;
    enabled[id] = entry.value == true;
    if (enabled.length >= 200) break;
  }
  return PluginSettings(
    appearance: appearance,
    enabled: enabled,
    scripts: sanitizeScripts(source['scripts']),
    market: MarketSettings.fromJson(source['market']),
  );
}

/// Merge a persisted settings map into the defaults, discarding invalid values.
PetSettings normalizeSettings(Object? saved, {List<String> knownPlatforms = const []}) {
  if (saved is! Map) return defaultSettings;
  final record = saved;
  bool boolValue(String key) => record[key] is bool ? record[key] as bool : false;
  final rawSize = record['size'];
  final size = petSizes.contains(rawSize) ? rawSize as int : 460;
  final rawX = record['x'];
  final rawY = record['y'];
  return PetSettings(
    size: size,
    active: record['active'] is bool ? record['active'] as bool : true,
    paused: boolValue('paused'),
    locked: boolValue('locked'),
    followTasks: record['followTasks'] is bool ? record['followTasks'] as bool : true,
    showBulbs: record['showBulbs'] is bool ? record['showBulbs'] as bool : true,
    showQuotas: record['showQuotas'] is bool ? record['showQuotas'] as bool : true,
    hiddenQuotas: sanitizeHiddenQuotas(record['hiddenQuotas']),
    x: rawX is num && rawX.isFinite ? rawX.roundToDouble() : null,
    y: rawY is num && rawY.isFinite ? rawY.roundToDouble() : null,
    interests: sanitizeInterests(record['interests']),
    social: sanitizeSocial(record['social'], knownPlatforms),
    plugins: sanitizePlugins(record['plugins']),
  );
}

