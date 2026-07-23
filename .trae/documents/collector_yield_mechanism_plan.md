# 采集者失败驱离与站位调整计划

## 需求

当 collector 连续 3 次无法到达能量源时:
1. 检查能量源附近是否有**非采集者**;
2. 若有 → 驱离该单位(让它临时让位);
3. 若无 → 调整当前能量源附近采集者站位(让其他 collector 让位)。

## 现状分析(基于 Phase 1 探索)

### 触发点已存在

[role.collector.js:114-132](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.collector.js#L114-L132) 的 `_doHarvest` 已有 `MAX_SOURCE_FAIL_COUNT = 3` 分支:

```javascript
if (failCount >= MAX_SOURCE_FAIL_COUNT) {
    // 当前仅:清空 assignedSourceId + 冷却 100 tick
    creep.memory.assignedSourceId = null;
    creep.memory._sourceCooldowns[source.id] = Game.time + 100;
}
```

但只是"换矿",没解决"明明近矿有 slot 被非采集者占着"的真问题。

### 项目中无任何让位机制

调研确认:
- 没有 `flee`/`evade`/`giveWay`/`yield`/`reposition` 等通用让位函数
- 现有 `_moveAwayFromSpawn`(upgrader/builder,仅 `state.creepShortage` 时触发)与 `_moveAwayFromTarget`(transporter,仅自解围)都不能响应"别人请求让位"
- 没有 memory 字段用于让位指令
- 各角色 `run()` 入口都很干净,容易注入让位检查

### 谁会"霸占" source slot

- **harvester** — 与 collector 共享配额统计(`_countCollectorsAtSource` 统计 `role==='harvester'`),逻辑上属于"采集者",**不应被驱离**
- **transporter / upgrader / builder / repairer** — 不参与 collector 配额,但走 fallback 时会调用 `sourceCache.harvestNearest` 直接占 source slot,是真正的"非采集者"占位来源

## 设计决策

### 决策 1:"非采集者"定义
**= transporter + upgrader + builder + repairer**(不含 harvester)。
理由:harvester 与 collector 同属采矿者,被同一配额统计管理;驱离它会破坏采矿配额。

### 决策 2:让位机制实现方式
**用 memory 标记跨 tick 协调**(Screeps 不能直接控制别的 creep,只能让被标记 creep 在自己 `run()` 时主动让位)。

让位 memory 字段(临时,自动过期清理):
- `_yieldUntil` — 让位截止 tick
- `_yieldSourceId` — 要让位的 source id
- `_yieldTarget` — 让位目标坐标 `{x, y, roomName}`(source 附近 3 格外的空位)

### 决策 3:让位协调函数放在哪
放进 [task.scheduler.js](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/task.scheduler.js)。
理由:它已是跨角色协调模块(有 `releaseCreep` 等),职责匹配;不新建文件(遵循用户规则)。

### 决策 4:让位参数
- `YIELD_TICKS = 5` — 让位持续 5 tick,够当前 collector 进入 slot
- `YIELD_DISTANCE = 3` — 让位目标选 source 周围 3 格外的空位,保证彻底离开 source 8 邻域

## 修改方案

### 文件清单(共 6 个文件)

| 文件 | 改动 |
|------|------|
| [task.scheduler.js](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/task.scheduler.js) | 新增 `requestYield` / `checkYield` 公共方法 + 常量 |
| [role.collector.js](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.collector.js) | `_doHarvest` 失败 3 次分支调用 `requestYield`;`run()` 入口调 `checkYield` |
| [role.transporter.js](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.transporter.js) | `run()` 入口注入 `checkYield` |
| [role.upgrader.js](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.upgrader.js) | `run()` 入口注入 `checkYield` |
| [role.builder.js](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.builder.js) | `run()` 入口注入 `checkYield` |
| [role.repairer.js](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.repairer.js) | `run()` 入口注入 `checkYield` |

### 步骤 1:task.scheduler.js 新增让位协调 API

在 `releaseCreep` 方法之后(约第 407 行后)新增两个公共方法 + 顶部常量。

#### 顶部新增常量(放在 `MAX_ACTIVE_TASKS: 50,` 之后)
```javascript
/** 让位持续时间(tick) */
YIELD_TICKS: 5,

/** 让位目标距 source 的最小距离 */
YIELD_DISTANCE: 3,

/** 非采集者角色集合(可被驱离) */
YIELDABLE_ROLES: ['transporter', 'upgrader', 'builder', 'repairer'],
```

#### 新增 `requestYield` 方法

签名:`requestYield(requester, source) → boolean`

行为:
1. 用 `source.pos.findInRange(FIND_CREEPS, 1)` 扫描 source 周围 1 格内的所有 creep
2. 排除 `requester` 自己
3. **第一优先级**:找 `role ∈ YIELDABLE_ROLES` 的 creep(非采集者)
4. **第二优先级**:若无非采集者,找 `role === 'collector'` 的 creep(调整站位),排除与 requester 同 source 已绑定的(避免互相让位死循环,只让位给"非本 source 的采集者"或"任何采集者",这里取"任何其他采集者")
5. 选中一个目标后,计算让位目标点(在 source 附近 `YIELD_DISTANCE` 格外找空地,用 `PathFinder` 或简单遍历)
6. 设置目标 creep 的 `_yieldUntil`/`_yieldSourceId`/`_yieldTarget`
7. 返回 true 表示已发指令;false 表示附近无可让位者(此时 fallback 到原有"换矿+冷却"逻辑)

```javascript
/**
 * 请求 source 附近的 creep 让位
 * 优先驱离非采集者;其次调整采集者站位
 * @param {Creep} requester - 发起让位请求的 creep
 * @param {Source} source  - 目标 source
 * @returns {boolean} true=已发出让位指令
 */
requestYield: function (requester, source) {
    var nearby = source.pos.findInRange(FIND_CREEPS, 1);
    var target = null;

    // 第一优先级:非采集者(transporter/upgrader/builder/repairer)
    for (var i = 0; i < nearby.length; i++) {
        var c = nearby[i];
        if (c.name === requester.name) continue;
        if (this.YIELDABLE_ROLES.indexOf(c.memory.role) !== -1) {
            target = c;
            break;
        }
    }

    // 第二优先级:其他 collector(调整站位)
    if (!target) {
        for (var j = 0; j < nearby.length; j++) {
            var cc = nearby[j];
            if (cc.name === requester.name) continue;
            if (cc.memory.role === 'collector') {
                target = cc;
                break;
            }
        }
    }

    if (!target) return false;

    // 计算让位目标点(source 周围 YIELD_DISTANCE 格外的空地)
    var yieldPos = this._findYieldPosition(source, target);
    if (!yieldPos) return false;

    target.memory._yieldUntil    = Game.time + this.YIELD_TICKS;
    target.memory._yieldSourceId  = source.id;
    target.memory._yieldTarget    = yieldPos;
    this._log('YIELD', target.name + ' 让位给 ' + requester.name + ' @ source ' + source.id);
    return true;
},

/**
 * 在 source 附近 YIELD_DISTANCE 格外找一个空地作为让位目标
 */
_findYieldPosition: function (source, creep) {
    var dx, dy, x, y;
    // 简单遍历 source 周围 YIELD_DISTANCE 圈的候选点,选第一个非墙非 creep 的
    for (var r = this.YIELD_DISTANCE; r <= this.YIELD_DISTANCE + 2; r++) {
        for (dx = -r; dx <= r; dx++) {
            for (dy = -r; dy <= r; dy++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // 只看外圈
                x = source.pos.x + dx;
                y = source.pos.y + dy;
                if (x < 1 || y < 1 || x > 49 || y > 49) continue;
                var terrain = source.room.lookForAtArea(LOOK_TERRAIN, y - 1, x - 1, y + 1, x + 1, true);
                // 简化:用 lookAt 检查目标格
                var look = source.room.lookAt(x, y);
                var blocked = false;
                for (var k = 0; k < look.length; k++) {
                    if (look[k].type === 'terrain' && look[k].terrain === 'wall') { blocked = true; break; }
                    if (look[k].type === 'creep') { blocked = true; break; }
                }
                if (!blocked) {
                    return { x: x, y: y, roomName: source.pos.roomName };
                }
            }
        }
    }
    return null;
},
```

#### 新增 `checkYield` 方法

签名:`checkYield(creep) → boolean`(返回 true 表示本 tick 在让位,调用方应 return)

```javascript
/**
 * 检查 creep 是否处于让位状态,若是则执行让位移动
 * 各角色 run() 入口调用,返回 true 时本 tick 跳过正常逻辑
 * @param {Creep} creep
 * @returns {boolean}
 */
checkYield: function (creep) {
    if (!creep.memory._yieldUntil) return false;

    // 让位已过期 → 清理
    if (Game.time >= creep.memory._yieldUntil) {
        delete creep.memory._yieldUntil;
        delete creep.memory._yieldSourceId;
        delete creep.memory._yieldTarget;
        return false;
    }

    // 仍在让位期 → 移动到让位目标
    var target = creep.memory._yieldTarget;
    if (target) {
        var pos = new RoomPosition(target.x, target.y, target.roomName);
        if (!creep.pos.isEqualTo(pos)) {
            creep.moveTo(pos, {
                visualizePathStyle: { stroke: '#ff4444', lineStyle: 'dashed' },
                reusePath: 1,
            });
        }
    }
    return true;
},
```

### 步骤 2:role.collector.js 改动

#### 2.1 `run()` 入口注入 checkYield(在健康检查之前)

修改 [role.collector.js:53-60](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.collector.js#L53-L60):

```javascript
run: function (creep) {
    var logCtx = '[' + creep.name + ']';

    // 让位检查(被其他 collector 请求让位时优先执行)
    if (taskScheduler.checkYield(creep)) {
        return;
    }

    // 健康检查:检测是否卡住
    if (this._healthCheck(creep, logCtx)) {
        return;
    }
    // ... 原逻辑
},
```

#### 2.2 `_doHarvest` 失败 3 次分支改为先驱离/调整站位

修改 [role.collector.js:122-129](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.collector.js#L122-L129):

原逻辑:
```javascript
if (failCount >= MAX_SOURCE_FAIL_COUNT) {
    this._log(LOG_LEVEL.WARN, logCtx + ' 连续 ' + failCount + ' 次无法到达能量源 ' + source.id + '，切换能量源');
    creep.memory.assignedSourceId = null;
    creep.memory._sourceCooldowns[source.id] = Game.time + 100;
}
```

新逻辑:
```javascript
if (failCount >= MAX_SOURCE_FAIL_COUNT) {
    this._log(LOG_LEVEL.WARN, logCtx + ' 连续 ' + failCount + ' 次无法到达能量源 ' + source.id + '，尝试驱离/调整站位');

    // 先尝试驱离非采集者或调整站位
    var yielded = taskScheduler.requestYield(creep, source);
    if (yielded) {
        // 已发出让位指令,清空失败计数,下一 tick 重新尝试到达
        delete creep.memory._sourceFailCounts[source.id];
        return;
    }

    // 附近无可让位者 → fallback 到原有换矿+冷却逻辑
    this._log(LOG_LEVEL.WARN, logCtx + ' 附近无可让位单位,切换能量源');
    creep.memory.assignedSourceId = null;
    creep.memory._sourceCooldowns[source.id] = Game.time + 100;
}
```

### 步骤 3:其他 4 个角色入口注入 checkYield

每个文件在 `run: function(creep) {` 之后第一行插入:

```javascript
var taskScheduler = require('task.scheduler');  // 顶部已有则不重复
// ...
run: function (creep) {
    if (taskScheduler.checkYield(creep)) return;
    // ... 原逻辑
}
```

具体修改位置:
- [role.transporter.js](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.transporter.js) `run` 入口
- [role.upgrader.js](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.upgrader.js) `run` 入口
- [role.builder.js](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.builder.js) `run` 入口
- [role.repairer.js](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.repairer.js) `run` 入口

注入点需在文件顶部确认 `task.scheduler` 已 require(若未 require 则添加)。

## 关键决策与依据

1. **不驱离 harvester** —— 它与 collector 共享配额统计,逻辑上属"采集者";驱离它会破坏采矿配额体系。
2. **collector 自身也注入 checkYield** —— 因为"调整站位"时需要让其他 collector 让位给当前 collector;collector 既是请求者也是响应者。
3. **避免互相让位死循环** —— `requestYield` 只对"source 附近 1 格内"的 creep 发指令,且只发一次;让位 5 tick 后自动结束,期间被让位者不会再被同一请求重复触发。
4. **失败计数清零** —— 发出让位指令后,当前 collector 的失败计数清零,下一 tick 重新尝试到达(避免立即又触发冷却换矿)。
5. **fallback 保留** —— 若附近真的没有任何可让位者(全是墙挡或 source 周围只有 requester 自己),仍走原有"换矿+冷却 100 tick"逻辑。
6. **让位目标用 lookAt 简单检查** —— 不引入 PathFinder,保持与项目现有风格一致(项目里 `cache.sources.js` 也用 `lookAtArea` 检查 terrain)。
7. **不修改 harvester** —— 它不是让位响应者,也不应被驱离。
8. **不写测试代码、不运行调试**(遵循用户规则)。

## 验证步骤(运行时观察)

修复后在游戏内观察:

1. **驱离非采集者**:当 upgrader/builder/repairer/transporter 站在 source 旁挡住 collector 时,collector 连续 3 次失败后会触发让位,该 creep 会沿红色虚线移动离开 source 附近 5 tick,期间 collector 能进入 slot。
2. **调整站位**:若无非采集者占位、全是 collector 互相挡,其中一个 collector 会临时让位 5 tick,给当前 collector 腾位置。
3. **让位自动恢复**:5 tick 后让位 creep 自动恢复原角色逻辑,无需人工干预。
4. **harvester 不受影响**:harvester 始终正常采矿,不会被驱离。
5. **fallback 仍生效**:source 完全被墙包围或无可让位者时,collector 仍会切换矿点(原有行为保留)。
6. **控制台日志**:会出现 `[TaskScheduler|YIELD] xxx 让位给 yyy @ source zzz` 与 `[Collector|WARN] ... 尝试驱离/调整站位` 记录。
