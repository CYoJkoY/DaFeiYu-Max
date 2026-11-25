/// Chooses which WebP clip should play next. Pure state machine: given the
/// Magpie activity and a little history it returns a clip name from the
/// catalog, never an arbitrary string. Ported from src/core/animation.ts.
library;

import 'types.dart';

const lightActionNames = <String>[
  '悠闲哼歌', '超大伸懒腰', '女仆屈膝礼仪', '照镜子',
  '摇扇纳凉', '用鲸鱼尾巴拍打地面', '小幅度原地360度旋转展示', '原地专心玩魔方',
  '三球抛接', '抽陀螺', '吹气球', '踢毽子', '轻快摇摆舞', '轻快记录',
  '原地敲击桌面互动', '鲸鱼吐泡泡特效', '下五子棋', '小提琴演奏',
  '吹笛子', '撸猫',
];

class AnimationDirector {
  AnimationDirector(this.catalog, {MathRandom random = defaultRandom}) {
    _random = random;
    activity = const Activity(state: 'idle', label: '', available: false, activeCount: 0);
    _programs = {
      for (final category in catalog.categories) ...category.actions,
    };
    _lightActions = lightActionNames.where(catalog.names.contains).toList();
  }

  Catalog catalog;
  late final MathRandom _random;
  late Activity activity;
  String current = '';
  bool manual = false;
  bool paused = false;
  String? lastCelebration;
  bool active = true;
  List<String> _recent = [];
  List<String> _recentPrograms = [];
  int _workClips = 0;
  late Set<String> _programs;
  late List<String> _lightActions;

  static double defaultRandom() => DateTime.now().microsecondsSinceEpoch % 1000000 / 1000000;

  void setCatalog(Catalog value) {
    catalog = value;
    _programs = {for (final category in catalog.categories) ...category.actions};
    _lightActions = lightActionNames.where(catalog.names.contains).toList();
  }

  String? select(String? name, {bool manual = false, bool program = false}) {
    if (name == null || !catalog.names.contains(name)) return null;
    current = name;
    this.manual = manual;
    _recent = ([..._recent.where((previous) => previous != name), name]).sublist(
      _recent.length >= 15 ? 1 : 0,
    );
    if ((program || manual) && _programs.contains(name)) {
      _recentPrograms = ([..._recentPrograms, name]).sublist(_recentPrograms.length >= 15 ? 1 : 0);
    }
    return name;
  }

  String? update(Activity value, {bool? followTasks}) {
    activity = value;
    if (followTasks == true) return next();
    return current.isEmpty ? next() : null;
  }

  String pick(List<String> pool) {
    final fresh = pool.where((name) => !_recent.contains(name)).toList();
    if (fresh.isNotEmpty) return fresh[(_random() * fresh.length).floor().clamp(0, fresh.length - 1)];
    return _recent.firstWhere(pool.contains, orElse: () => pool.first);
  }

  String program() {
    final categories = catalog.categories
        .map((category) => CatalogCategory(
              id: category.id,
              weight: category.weight,
              noMirror: category.noMirror,
              actions: category.actions
                  .where((name) => name != current && !_recentPrograms.contains(name))
                  .toList(),
            ))
        .where((category) => category.actions.isNotEmpty && category.weight > 0)
        .toList();
    if (categories.isEmpty) return pick(catalog.idle);
    var roll = _random() * categories.fold(0.0, (sum, category) => sum + category.weight);
    for (final category in categories) {
      roll -= category.weight;
      if (roll < 0) return pick(category.actions);
    }
    return pick(categories.last.actions);
  }

  String next() {
    manual = false;
    if (paused) return select(catalog.idle.first)!;
    final state = activity.state;
    if (state == 'success' && activity.eventId != null && activity.eventId != lastCelebration) {
      lastCelebration = activity.eventId;
      return select('放烟花')!;
    }
    final pool = state == 'success' ? null : catalog.states[state];
    if (pool != null && pool.isNotEmpty) {
      if (active && (state == 'thinking' || state == 'working') && _workClips >= 2 && _lightActions.isNotEmpty) {
        _workClips = 0;
        final fresh = _lightActions.where((name) => !_recentPrograms.contains(name)).toList();
        return select(pick(fresh.isNotEmpty ? fresh : _lightActions), program: true)!;
      }
      _workClips++;
      return select(pick(pool))!;
    }
    _workClips = 0;
    if (!active || (!catalog.idle.contains(current) && _random() < 0.15)) {
      return select(pick(catalog.idle))!;
    }
    return select(program(), program: true)!;
  }
}

typedef MathRandom = double Function();
