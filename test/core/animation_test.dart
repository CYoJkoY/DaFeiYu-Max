import 'package:flutter_test/flutter_test.dart';
import 'package:magpie_dafeiyu/core/animation.dart';
import 'package:magpie_dafeiyu/core/types.dart';

Catalog _catalog() => const Catalog(
      names: ['待机呼吸休闲', '放烟花', '工作状态-思考冒泡', '工作状态-忙碌点按', '悠闲哼歌'],
      idle: ['待机呼吸休闲'],
      clicks: ['闲转'],
      categories: [
        CatalogCategory(id: '小动作', weight: 20, actions: ['悠闲哼歌']),
      ],
      states: {
        'thinking': ['工作状态-思考冒泡'],
        'working': ['工作状态-忙碌点按'],
        'success': ['放烟花'],
      },
    );

double _fixed() => 0.0;

void main() {
  test('select ignores unknown clips', () {
    final director = AnimationDirector(_catalog(), random: _fixed);
    expect(director.select('nope'), isNull);
    expect(director.select('悠闲哼歌'), '悠闲哼歌');
  });

  test('paused replays the idle clip', () {
    final director = AnimationDirector(_catalog(), random: _fixed)..paused = true;
    director.update(const Activity(state: 'idle', label: '', available: true, activeCount: 0));
    expect(director.current, '待机呼吸休闲');
  });

  test('success with a fresh event celebrates once', () {
    final director = AnimationDirector(_catalog(), random: _fixed);
    director.select('待机呼吸休闲');
    final activity = const Activity(
      state: 'success', label: '', available: true, activeCount: 0, eventId: 'evt-1',
    );
    expect(director.update(activity, followTasks: true), '放烟花');
  });

  test('thinking plays a state clip', () {
    final director = AnimationDirector(_catalog(), random: _fixed);
    director.select('待机呼吸休闲');
    final next = director.update(
      const Activity(state: 'thinking', label: '', available: true, activeCount: 1),
      followTasks: true,
    );
    expect(next, '工作状态-思考冒泡');
  });
}
