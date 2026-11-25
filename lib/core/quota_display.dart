/// Turns a [Quota] snapshot into the compact badges the pet shows and the
/// per-window rows the panel lists. Ported from src/core/quota-display.ts.
library;

import 'types.dart';

/// A quota is only trusted when Magpie said "ok", the value was readable, the
/// reading is not from the future, and the window has not already reset.
List<String> activeAccountIds(Activity? activity, int now) {
  final observedAt = activity?.observedAt;
  if (activity == null || !activity.available || observedAt == null) return const [];
  if (now < observedAt || now - observedAt >= 10000) return const [];
  return activity.activeAccountIds;
}

bool _balanceValid(Quota? quota, QuotaAccount account, int now) {
  final readAt = account.readAt;
  if (quota == null || !quota.ok || account.balance == null || readAt == null) return false;
  return now >= readAt ? true : account.cached == true;
}

bool _windowValid(Quota? quota, QuotaWindow window, int now) {
  final readAt = window.readAt;
  if (quota == null || !quota.ok || !window.remaining.isFinite || readAt == null) return false;
  final fresh = now >= readAt;
  if (!(fresh || window.cached == true)) return false;
  final resetsAt = window.resetsAt;
  return resetsAt == null || resetsAt * 1000 > now;
}

class QuotaBadge {
  const QuotaBadge({
    required this.account,
    required this.text,
    required this.available,
    required this.active,
  });

  final QuotaAccount account;
  final String text;
  final bool available;
  final bool active;

  String get key => account.key;
  String get accountId => account.accountId;
  String get icon => account.icon;
  String get label => account.label;
}

List<QuotaBadge> accountPercentages(Quota? quota, Activity? activity, {int? now}) {
  final stamp = now ?? DateTime.now().millisecondsSinceEpoch;
  final active = activeAccountIds(activity, stamp).toSet();
  final badges = <QuotaBadge>[];
  for (final account in quota?.accounts ?? const <QuotaAccount>[]) {
    if (account.kind == 'balance') {
      final valid = _balanceValid(quota, account, stamp);
      badges.add(QuotaBadge(
        account: account,
        text: valid ? account.balance! : '余额待刷新',
        available: valid,
        active: active.contains(account.accountId),
      ));
      continue;
    }
    final windows = (quota?.windows ?? const <QuotaWindow>[])
        .where((window) => window.accountId == account.accountId)
        .toList();
    final valid = quota?.ok == true && windows.isNotEmpty && windows.every((window) => _windowValid(quota, window, stamp));
    final lowest = windows.isEmpty
        ? 0.0
        : windows.map((window) => window.remaining).reduce((a, b) => a < b ? a : b);
    badges.add(QuotaBadge(
      account: account,
      text: valid ? '${lowest.round()}%' : '—%',
      available: valid,
      active: active.contains(account.accountId),
    ));
  }
  return badges;
}

class QuotaEntry {
  const QuotaEntry({
    required this.key,
    required this.accountId,
    required this.kind,
    required this.text,
    required this.available,
    required this.active,
    required this.icon,
    required this.label,
    this.windowName,
    this.remaining,
    this.resetsAt,
    this.readAt,
    this.cached,
    this.balance,
  });

  final String key;
  final String accountId;
  final String kind;
  final String text;
  final bool available;
  final bool active;
  final String icon;
  final String label;
  final String? windowName;
  final double? remaining;
  final int? resetsAt;
  final int? readAt;
  final bool? cached;
  final String? balance;

  /// Share of the window still available, 0–100, for the meter.
  double get percent => (remaining ?? 0).clamp(0, 100).toDouble();
}

List<QuotaEntry> quotaEntries(Quota? quota, Activity? activity, {int? now}) {
  final stamp = now ?? DateTime.now().millisecondsSinceEpoch;
  final active = activeAccountIds(activity, stamp).toSet();
  final accounts = {
    for (final account in quota?.accounts ?? const <QuotaAccount>[]) account.accountId: account,
  };
  final entries = <QuotaEntry>[];
  for (final window in quota?.windows ?? const <QuotaWindow>[]) {
    final account = accounts[window.accountId];
    if (account == null) continue;
    final valid = _windowValid(quota, window, stamp);
    entries.add(QuotaEntry(
      key: window.key.isEmpty ? '${window.accountId}|${window.label}' : window.key,
      accountId: window.accountId,
      kind: 'subscription',
      text: valid ? '${window.remaining.round()}%' : '—%',
      available: valid,
      active: active.contains(window.accountId),
      icon: window.icon,
      label: window.label,
      windowName: window.windowName,
      remaining: window.remaining,
      resetsAt: window.resetsAt,
      readAt: window.readAt,
      cached: window.cached,
    ));
  }
  for (final account in quota?.accounts ?? const <QuotaAccount>[]) {
    if (account.kind != 'balance') continue;
    final valid = _balanceValid(quota, account, stamp);
    entries.add(QuotaEntry(
      key: account.key.isEmpty ? '${account.accountId}|balance' : account.key,
      accountId: account.accountId,
      kind: 'balance',
      text: valid ? account.balance! : '余额待刷新',
      available: valid,
      active: active.contains(account.accountId),
      icon: account.icon,
      label: account.label,
      readAt: account.readAt,
      cached: account.cached,
      balance: account.balance,
    ));
  }
  return entries;
}

const Map<String, String> _labelAliases = {
  'Cursor Models': '模型',
  'Other Models': '其他',
  'On-demand': '按量',
  'Grok Bot': 'Grok',
  'Total': '总计',
  '7 days': '7天',
  '5 hours': '5小时',
  'Weekly': '本周',
  'Month': '本月',
};

/// Short label for a quota badge: known windows get a fixed alias, anything
/// else is clipped by code point so CJK text is not sliced mid-glyph.
String compactQuotaLabel({String? kind, String? windowName}) {
  if (kind == 'balance') return '余额';
  final name = windowName ?? '';
  final alias = _labelAliases[name];
  if (alias != null) return alias;
  final runes = name.runes.toList();
  final limit = runes.isEmpty ? 0 : (runes.first > 0x2e80 ? 5 : 7);
  final clipped = String.fromCharCodes(runes.take(limit));
  return clipped.isEmpty ? '额度' : clipped;
}
