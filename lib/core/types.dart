/// Shared, platform-neutral types for the DaFeiYu pet core.
library;

class PetRect {
  const PetRect({required this.x, required this.y, required this.width, required this.height});
  final double x;
  final double y;
  final double width;
  final double height;
}

class PetPoint {
  const PetPoint({required this.x, required this.y});
  final double x;
  final double y;
}

class PetDimensions {
  const PetDimensions({required this.width, required this.height});
  final double width;
  final double height;
}

class CatalogCategory {
  const CatalogCategory({required this.id, required this.weight, this.noMirror = false, required this.actions});
  final String id;
  final double weight;
  final bool noMirror;
  final List<String> actions;
}

class Catalog {
  const Catalog({required this.names, required this.idle, required this.clicks, required this.categories, required this.states});
  final List<String> names;
  final List<String> idle;
  final List<String> clicks;
  final List<CatalogCategory> categories;
  final Map<String, List<String>> states;
}

const activityStateValues = ['idle', 'thinking', 'waiting', 'working', 'success', 'unknown'];

class Activity {
  const Activity({
    required this.state,
    required this.label,
    required this.available,
    required this.activeCount,
    this.waitingCount,
    this.toolCount,
    this.observedAt,
    this.scope,
    this.activeAccountIds = const [],
    this.accountStatusAvailable,
    this.eventId,
  });
  final String state;
  final String label;
  final bool available;
  final int activeCount;
  final int? waitingCount;
  final int? toolCount;
  final int? observedAt;
  final String? scope;
  final List<String> activeAccountIds;
  final bool? accountStatusAvailable;
  final String? eventId;

  Activity rebuild({
    List<String>? activeAccountIds,
    bool? accountStatusAvailable,
    String? eventId,
  }) =>
      Activity(
        state: state,
        label: label,
        available: available,
        activeCount: activeCount,
        waitingCount: waitingCount,
        toolCount: toolCount,
        observedAt: observedAt,
        scope: scope,
        activeAccountIds: activeAccountIds ?? this.activeAccountIds,
        accountStatusAvailable: accountStatusAvailable ?? this.accountStatusAvailable,
        eventId: eventId ?? this.eventId,
      );
}

class QuotaWindow {
  const QuotaWindow({
    required this.accountId,
    required this.key,
    required this.provider,
    required this.icon,
    required this.name,
    required this.plan,
    required this.windowName,
    required this.label,
    required this.used,
    required this.remaining,
    required this.resetsAt,
    required this.readAt,
    required this.stale,
    this.cached,
  });
  final String accountId;
  final String key;
  final String provider;
  final String icon;
  final String name;
  final String plan;
  final String windowName;
  final String label;
  final double used;
  final double remaining;
  final int? resetsAt;
  final int? readAt;
  final bool stale;
  final bool? cached;
}

class QuotaAccount {
  const QuotaAccount({
    required this.accountId,
    required this.key,
    required this.provider,
    required this.icon,
    required this.name,
    required this.plan,
    required this.label,
    required this.kind,
    this.balance,
    this.readAt,
    this.cached,
  });
  final String accountId;
  final String key;
  final String provider;
  final String icon;
  final String name;
  final String plan;
  final String label;
  final String kind;
  final String? balance;
  final int? readAt;
  final bool? cached;
}

class Quota {
  const Quota({
    required this.ok,
    required this.windows,
    this.accounts = const [],
    this.observedAt,
    this.cachedAt,
    this.error,
    this.usage,
  });
  final bool ok;
  final List<QuotaWindow> windows;
  final List<QuotaAccount> accounts;
  final int? observedAt;
  final int? cachedAt;
  final String? error;
  final QuotaUsage? usage;

  Quota withUsage(QuotaUsage value) => Quota(
        ok: ok,
        windows: windows,
        accounts: accounts,
        observedAt: observedAt,
        cachedAt: cachedAt,
        error: error,
        usage: value,
      );
}

class QuotaUsage {
  const QuotaUsage({required this.calls, required this.errors});
  final int calls;
  final int errors;
}

