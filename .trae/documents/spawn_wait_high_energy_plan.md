# 孵化等待高能量优化计划

## 需求摘要

优化 `manager.spawn.js` 的孵化逻辑，在基础劳动力充足且能量供应链正常时，推迟孵化直到 Spawn + Extension 能量达到 80%，从而孵化出更高级的 creep。

## 当前状态分析

### 关键文件

- **[manager.spawn.js](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/manager.spawn.js)** — 孵化管理器入口
- **[config.js](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/config.js)** — 包含 `roleTargets` 和 `spawnEnergyThreshold`
- **[cache.creep.js](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/cache.creep.js)** — 提供 `creepCache.count(role)`
- **[body.config.js](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/body.config.js)** — 根据能量动态生成 body

### 当前逻辑

`manager.spawn.run()` 在每次 tick 中：
1. 检查孵化器是否空闲
2. 按优先级遍历角色队列
3. 当某角色当前数量 < 目标数量且 `energyAvailable >= spawnEnergyThreshold` 时立即孵化

缺点：一旦触发阈值就立即孵化，经常生成低能量的小体型 creep，导致后期单位质量不足。

## 拟议改动

### 文件：manager.spawn.js

在 `run()` 方法中加入“高能量等待”判断：

1. **计算基础劳动力是否充足**
   - `collectorCurrent = creepCache.count('collector')`
   - `transporterCurrent = creepCache.count('transporter')`
   - `collectorNeed = config.roleTargets.collector`
   - `transporterNeed = config.roleTargets.transporter`
   - 条件：`collectorCurrent + transporterCurrent >= (collectorNeed + transporterNeed) / 2`

2. **检查能量供应链**
   - 存在 transporter：`transporterCurrent > 0`
   - Container 中有能量：查找任意 `STRUCTURE_CONTAINER` 且 `store[RESOURCE_ENERGY] > 0`

3. **高能量等待阈值**
   - `var capacity = spawn.room.energyCapacityAvailable;`
   - `var threshold = capacity * 0.8;`
   - 当三个条件都满足且 `energyAvailable < threshold` 时，跳过本 tick 不孵化
   - 当能量达到阈值后再按原优先级队列孵化

4. **保留原逻辑**
   - 若基础劳动力不足（采集/搬运总数低于目标一半），仍按原 `spawnEnergyThreshold` 立即补充，避免前期崩盘
   - 若没有 transporter 或 Container 无能量，也按原逻辑立即孵化

### 代码结构示例

```javascript
run: function (spawnName) {
    var spawn = Game.spawns[spawnName];
    if (!spawn) return;
    if (spawn.spawning) return;

    var energy = spawn.room.energyAvailable;
    var targets = config.roleTargets;

    // 判断是否可以等待高能量孵化
    var canWaitForHighEnergy = this._canWaitForHighEnergy(spawn, targets);
    if (canWaitForHighEnergy) {
        var capacity = spawn.room.energyCapacityAvailable;
        var highThreshold = capacity * 0.8;
        if (energy < highThreshold) {
            return; // 等待更多能量，孵化更高级 creep
        }
    }

    // 原有孵化队列逻辑保持不变
    ...
},

_canWaitForHighEnergy: function (spawn, targets) {
    var collectorCount = creepCache.count('collector');
    var transporterCount = creepCache.count('transporter');

    // 采集者 + 搬运者总数不低于目标一半
    if (collectorCount + transporterCount < (targets.collector + targets.transporter) / 2) {
        return false;
    }

    // 必须有搬运者
    if (transporterCount === 0) {
        return false;
    }

    // Container 中必须有能量
    var containers = spawn.room.find(FIND_STRUCTURES, {
        filter: function (s) {
            return s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0;
        }
    });
    return containers.length > 0;
}
```

## 假设与决策

- “一半”采用 `(collectorTarget + transporterTarget) / 2` 的合计口径，按用户确认执行。
- “高能量”采用 `spawn.room.energyCapacityAvailable * 0.8`，按用户确认执行。
- 仅在同时满足劳动力充足、有搬运者、Container 有能量时才等待；否则立即按原逻辑补充，保证生存能力。
- 80% 阈值仅影响是否“跳过本 tick”，不修改孵化优先级和角色队列顺序。
- body 生成仍走 `bodyConfig.getBody(energy, role)`，能量更高时自然生成更强 creep。

## 验证步骤

1. 劳动力充足且 Container 有能量、有搬运者时：
   - 若能量 < 80% 容量，`spawn.spawning` 保持为空，不生成 creep。
   - 若能量 >= 80% 容量，按原队列孵化。
2. 劳动力不足时：只要达到 `spawnEnergyThreshold` 立即孵化，避免卡死。
3. 无搬运者或 Container 无能量时：同样立即孵化，不等待。