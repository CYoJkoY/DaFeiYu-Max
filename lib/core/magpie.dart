/// Reads the local Magpie gateway. Ported from src/core/magpie.ts so both the
/// Electron history and this Flutter runtime resolve the same configuration.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;

import 'types.dart';
import 'version.dart';

/// A per-process salt keeps account ids stable for the lifetime of the app but
/// unlinkable to anything else: Magpie sends providers and users over the local
/// socket and we only ever show a hash of them.
final List<int> _identitySalt = _randomSalt();

List<int> _randomSalt() {
  final random = Random.secure();
  return List<int>.generate(32, (_) => random.nextInt(256));
}

String accountKey(String provider, String user) =>
    Hmac(sha256, _identitySalt).convert(utf8.encode(jsonEncode([provider, user]))).toString();

/// `$XDG_CONFIG_HOME/magpie/settings.json`, or `~/.config/magpie/settings.json`.
/// Magpie uses the same path on Windows and macOS, so the pet does too.
String magpieSettingsPath({Map<String, String>? env, String? home}) {
  final environment = env ?? Platform.environment;
  final configured = environment['XDG_CONFIG_HOME'];
  final root = configured != null && configured.trim().isNotEmpty
      ? configured.trim()
      : p.join(home ?? homeDirectory(environment), '.config');
  return p.join(root, 'magpie', 'settings.json');
}

String homeDirectory([Map<String, String>? env]) {
  final environment = env ?? Platform.environment;
  final home = environment['HOME'] ?? environment['USERPROFILE'] ?? '';
  return home.isEmpty ? Directory.current.path : home;
}

/// Port of Magpie's HTTP API, default 3425.
int resolvePort({
  Map<String, String>? env,
  String? home,
  String? settingsFile,
}) {
  try {
    final file = File(settingsFile ?? magpieSettingsPath(env: env, home: home));
    if (!file.existsSync()) return 3425;
    final decoded = jsonDecode(file.readAsStringSync());
    if (decoded is Map) {
      final port = decoded['port'];
      if (port is int && port > 0 && port <= 65535) return port;
    }
  } catch (_) {
    // A missing or malformed settings file just means "use the default".
  }
  return 3425;
}

final RegExp _keyPattern = RegExp(r'^[\x21-\x7e]{8,256}$');

String resolveKey({Map<String, String>? env}) {
  final environment = env ?? Platform.environment;
  final key = (environment['MAGPIE_API_KEY'] ?? '').trim();
  return _keyPattern.hasMatch(key) ? key : 'magpie-dafeiyu';
}

class ReadLocalOptions {
  const ReadLocalOptions({
    this.port,
    this.key,
    this.timeout = const Duration(milliseconds: 5000),
    this.maxBytes = 2000000,
  });

  final int? port;
  final String? key;
  final Duration timeout;
  final int maxBytes;

  ReadLocalOptions copyWith({Duration? timeout, int? maxBytes}) => ReadLocalOptions(
        port: port,
        key: key,
        timeout: timeout ?? this.timeout,
        maxBytes: maxBytes ?? this.maxBytes,
      );
}

/// Domain-specific failure so callers can distinguish "Magpie is offline" from
/// "Magpie answered something we cannot parse".
class MagpieUnavailable implements Exception {
  MagpieUnavailable(this.reason);
  final String reason;
  @override
  String toString() => 'MagpieUnavailable($reason)';
}

/// GET a JSON document from the loopback gateway. Always 127.0.0.1, always a
/// bearer token, never a redirect, with a hard byte ceiling.
Future<Object?> readLocal(
  String route, {
  ReadLocalOptions options = const ReadLocalOptions(),
  http.Client? client,
}) async {
  final port = options.port ?? resolvePort();
  final key = options.key ?? resolveKey();
  final uri = Uri.parse('http://127.0.0.1:$port$route');
  final owned = client == null;
  final http.Client request = client ?? http.Client();
  try {
    final response = await request
        .get(uri, headers: {
          'User-Agent': appUserAgent,
          'Authorization': 'Bearer $key',
        })
        .timeout(options.timeout);
    if (response.statusCode != 200) {
      throw MagpieUnavailable('HTTP ${response.statusCode}');
    }
    if (response.bodyBytes.length > options.maxBytes) {
      throw MagpieUnavailable('响应过大');
    }
    return jsonDecode(utf8.decode(response.bodyBytes));
  } on TimeoutException {
    throw MagpieUnavailable('请求超时');
  } finally {
    if (owned) request.close();
  }
}

Activity unknownActivity([int? now]) => Activity(
      state: 'unknown',
      label: 'Magpie 未连接或状态暂不可读',
      available: false,
      activeCount: 0,
      observedAt: now ?? DateTime.now().millisecondsSinceEpoch,
    );

bool _isCount(Object? value) => value is int && value >= 0;

Activity chooseActivity(Object? data, {int? now, int? stateCode}) {
  final stamp = now ?? DateTime.now().millisecondsSinceEpoch;
  if (data is! Map || data['object'] != 'concurrency') return unknownActivity(stamp);
  final requests = data['requests'];
  final waiting = data['waiting'];
  final tools = data['tools'];
  if (!_isCount(requests) || !_isCount(waiting) || !_isCount(tools)) {
    return unknownActivity(stamp);
  }
  final r = requests as int;
  final w = waiting as int;
  final t = tools as int;
  final code = stateCode ?? (r > w ? 1 : (w > 0 ? 2 : (t > 0 ? 3 : 0)));
  var state = 'idle';
  var label = 'Magpie 当前没有进行中的请求';
  if (code == 1) {
    state = 'thinking';
    label = 'Magpie 正在处理模型请求';
  } else if (code == 2) {
    state = 'waiting';
    label = 'Magpie 请求排队中';
  } else if (code == 3) {
    state = 'working';
    label = 'Magpie 正在等待客户端工具结果';
  }
  return Activity(
    state: state,
    label: label,
    available: true,
    activeCount: r,
    waitingCount: w,
    toolCount: t,
    observedAt: stamp,
    scope: '本机 Magpie 网关',
  );
}

class _RouteAccount {
  const _RouteAccount({required this.id, required this.provider, required this.who});
  final Object? id;
  final Object? provider;
  final Object? who;
}

List<String> activeAccountsForRoute(Object? route) {
  if (route is! Map) return const [];
  if (route['done'] != false) return const [];
  final tries = route['tries'];
  if (tries is! List) return const [];
  final candidates = <_RouteAccount>[
    ..._routeAccounts(route['order']),
    ..._routeAccounts(route['left']),
  ];
  final result = <String>[];
  for (final attempt in tries) {
    if (attempt is! Map || attempt['done'] != false) continue;
    for (final candidate in candidates) {
      if (candidate.id != attempt['id']) continue;
      final provider = candidate.provider;
      final who = candidate.who;
      if (provider is String && who is String && who.isNotEmpty) {
        result.add(accountKey(provider, who));
      }
      break;
    }
  }
  return result;
}

List<_RouteAccount> _routeAccounts(Object? value) {
  if (value is! List) return const [];
  return [
    for (final entry in value)
      if (entry is Map)
        _RouteAccount(id: entry['id'], provider: entry['provider'], who: entry['who']),
  ];
}

/// Polls `/v1/magpie/concurrency`, and only when something is actually in
/// flight asks `/v1/magpie/trace` which accounts the requests belong to.
class ActivityReader {
  ActivityReader({this.options = const ReadLocalOptions(), this.client});

  final ReadLocalOptions options;
  final http.Client? client;
  int _traceSequence = 0;
  final Map<Object?, List<String>> _routes = {};

  Future<Activity> read() async {
    try {
      final concurrency = await readLocal('/v1/magpie/concurrency', options: options, client: client);
      final activity = chooseActivity(concurrency);
      final activeRoutes = <int>[];
      if (concurrency is Map && concurrency['active'] is List) {
        for (final request in concurrency['active'] as List) {
          if (request is! Map) continue;
          if (request['phase'] != 'upstream') continue;
          final route = request['route'];
          if (route is int && route.abs() <= 9007199254740991) activeRoutes.add(route);
        }
      }
      if (!activity.available || activeRoutes.isEmpty) {
        return activity.rebuild(activeAccountIds: const []);
      }
      try {
        final trace = await readLocal(
          '/v1/magpie/trace?after=$_traceSequence',
          options: options.copyWith(maxBytes: 8000000),
          client: client,
        );
        if (trace is! Map ||
            trace['object'] != 'trace' ||
            trace['routes'] is! List ||
            trace['ids'] is! List ||
            trace['seq'] is! int) {
          throw MagpieUnavailable('不兼容的 trace');
        }
        final seq = trace['seq'] as int;
        if (seq < _traceSequence) _routes.clear();
        _traceSequence = seq;
        for (final route in trace['routes'] as List) {
          if (route is! Map) continue;
          _routes[route['id']] = activeAccountsForRoute(route);
        }
        final retained = {for (final id in trace['ids'] as List) id};
        _routes.removeWhere((key, _) => !retained.contains(key));
        final accounts = <String>{
          for (final route in activeRoutes) ...?_routes[route],
        };
        return activity.rebuild(activeAccountIds: accounts.toList());
      } catch (_) {
        _traceSequence = 0;
        _routes.clear();
        return activity.rebuild(activeAccountIds: const [], accountStatusAvailable: false);
      }
    } catch (_) {
      return unknownActivity();
    }
  }
}

final RegExp _balancePattern = RegExp(
  r'^(?:[¥￥$€£]\s*-?\d+(?:,\d{3})*(?:\.\d+)?'
  r'|(?:CNY|USD|EUR|GBP)\s*-?\d+(?:\.\d+)?'
  r'|-?\d+(?:\.\d+)?\s*(?:CNY|USD|EUR|GBP))$',
);

/// Turns `/v1/magpie/quotas/cards` into subscription windows plus balance
/// accounts. Anything unrecognised is dropped rather than guessed at.
Quota normalizeCards(Object? data, {int? now}) {
  final stamp = now ?? DateTime.now().millisecondsSinceEpoch;
  final windows = <QuotaWindow>[];
  final accounts = <QuotaAccount>[];
  final cards = data is Map && data['data'] is List ? data['data'] as List : const [];
  for (var index = 0; index < cards.length; index++) {
    final card = cards[index];
    if (card is! Map) continue;
    final provider = card['provider'] is String ? card['provider'] as String : '';
    final user = card['user'] is String ? card['user'] as String : 'unknown-$index';
    final accountId = accountKey(provider, user);
    final name = card['name'] is String && (card['name'] as String).isNotEmpty ? card['name'] as String : '订阅';
    final plan = card['plan'] is String && (card['plan'] as String).isNotEmpty ? card['plan'] as String : '账户';
    final icon = card['icon'] is String ? card['icon'] as String : '';
    final stableKey = [provider, name, plan, index + 1].join('|');
    final kind = card['kind'] == 'balance' ? 'balance' : 'subscription';
    final rawBalance = card['balance'];
    final balance = rawBalance is String && _balancePattern.hasMatch(rawBalance.trim())
        ? rawBalance.trim()
        : null;
    final readAt = _parseDateToMillis(card['readAt']);
    accounts.add(QuotaAccount(
      accountId: accountId,
      key: '$stableKey|balance',
      provider: provider,
      icon: icon,
      name: name,
      plan: plan,
      label: '$name · $plan #${index + 1}',
      kind: kind,
      balance: kind == 'balance' ? balance : null,
      readAt: kind == 'balance' ? readAt : null,
    ));
    if (kind == 'balance') continue;
    final rawWindows = card['windows'] is List ? card['windows'] as List : const [];
    for (var windowIndex = 0; windowIndex < rawWindows.length; windowIndex++) {
      final window = rawWindows[windowIndex];
      if (window is! Map) continue;
      final used = window['used'];
      if (used is! num || !used.isFinite) continue;
      final clamped = used.toDouble().clamp(0, 100).toDouble();
      final windowName = window['name'] is String && (window['name'] as String).isNotEmpty
          ? window['name'] as String
          : '额度';
      final reset = _parseDateToMillis(window['resetsAt']);
      windows.add(QuotaWindow(
        accountId: accountId,
        key: '$stableKey|window|$windowIndex|$windowName',
        provider: provider,
        icon: icon,
        name: name,
        plan: plan,
        windowName: windowName,
        label: '$name · $plan #${index + 1} · $windowName',
        used: clamped,
        remaining: 100 - clamped,
        resetsAt: reset == null ? null : (reset ~/ 1000),
        readAt: readAt,
        stale: readAt == null || stamp - readAt > 600000,
      ));
    }
  }
  final ok = windows.isNotEmpty || accounts.any((account) => account.kind == 'balance' && account.balance != null);
  return Quota(
    ok: ok,
    windows: windows,
    accounts: accounts,
    observedAt: stamp,
    error: ok ? null : 'Magpie 尚无可显示的额度或余额；请在 Magpie 中检查账户',
  );
}

/// Epoch milliseconds for an ISO timestamp. `resetAt` is reported in seconds
/// on the model (matching the gateway's own convention), so callers divide.
int? _parseDateToMillis(Object? value) {
  if (value is! String || value.isEmpty) return null;
  return DateTime.tryParse(value)?.millisecondsSinceEpoch;
}

Future<Quota> readQuota({ReadLocalOptions options = const ReadLocalOptions(), http.Client? client}) async {
  try {
    final cards = await readLocal('/v1/magpie/quotas/cards', options: options, client: client);
    final quota = normalizeCards(cards);
    try {
      final usage = await readLocal('/v1/magpie/usage?period=today', options: options, client: client);
      if (usage is Map && _isCount(usage['calls']) && _isCount(usage['errors'])) {
        return quota.withUsage(QuotaUsage(
          calls: usage['calls'] as int,
          errors: usage['errors'] as int,
        ));
      }
    } catch (_) {
      // Usage counters are a nicety; the quota numbers are the point.
    }
    return quota;
  } catch (_) {
    return Quota(
      ok: false,
      windows: const [],
      observedAt: DateTime.now().millisecondsSinceEpoch,
      error: '无法读取 Magpie 额度，请确认本机 Magpie 已启动',
    );
  }
}
