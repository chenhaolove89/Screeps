# 搬运者多锁定机制优化计划

## 需求摘要

修改搬运者（Transporter）的送货目标锁定机制，将单锁改为多锁，允许最多 3 个搬运者同时锁定同一个收货方。当锁定达到上限时，自动尝试下一个收货方。

## 当前状态分析

### 问题定位

在 `role.transporter.js` 中，当前锁机制存在以下问题：

1. **单锁限制**：`_isDeliverLocked()` 和 `_lockDeliver()` 使用单个名称存储锁定者，导致每个送货目标只能被一个搬运者锁定
2. **无法顺延**：`_findBestDelivery()` 在最高优先级目标被锁定时直接跳过，不会尝试下一个候选

### 相关代码位置

- **[role.transporter.js:580-694](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.transporter.js#L580-L694)** — 资源锁管理模块
- **[role.transporter.js:519-578](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.transporter.js#L519-L578)** — `_findBestDelivery()` 方法

### 当前锁数据结构

```javascript
Memory._transporterLocks = {
    pickups: { 'id1': 'creepName1', 'id2': 'creepName2' },  // 单锁
    delivers: { 'id1': 'creepName1' }                        // 单锁
};
```

## 拟议改动

### 修改锁机制（支持多锁定）

#### 1. 修改 `_isDeliverLocked(id)`

从检查单个锁定者改为统计有效锁定数量：

```javascript
_isDeliverLocked: function (id) {
    const MAX_LOCKS_PER_DELIVER = 3;
    if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
    
    var locks = Memory._transporterLocks.delivers[id];
    if (!locks) return false;
    
    // 清理无效锁定（已死亡的 creep）
    var validLocks = [];
    for (var i = 0; i < locks.length; i++) {
        if (Game.creeps[locks[i]]) {
            validLocks.push(locks[i]);
        }
    }
    
    if (validLocks.length !== locks.length) {
        Memory._transporterLocks.delivers[id] = validLocks;
    }
    
    // 检查是否达到锁定上限
    return validLocks.length >= MAX_LOCKS_PER_DELIVER;
},
```

#### 2. 修改 `_lockDeliver(id, creepName)`

从存储单个名称改为存储名称数组：

```javascript
_lockDeliver: function (id, creepName) {
    if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
    
    if (!Memory._transporterLocks.delivers[id]) {
        Memory._transporterLocks.delivers[id] = [];
    }
    
    var locks = Memory._transporterLocks.delivers[id];
    if (locks.indexOf(creepName) === -1) {
        locks.push(creepName);
    }
    
    if (!Memory._transporterLockTimestamps) Memory._transporterLockTimestamps = {};
    Memory._transporterLockTimestamps[id] = Game.time;
},
```

#### 3. 修改 `_releaseDeliverLock(id, creepName)`

更新释放逻辑以支持数组：

```javascript
_releaseDeliverLock: function (id, creepName) {
    if (!Memory._transporterLocks) return;
    
    var locks = Memory._transporterLocks.delivers[id];
    if (!locks) return;
    
    var idx = locks.indexOf(creepName);
    if (idx !== -1) {
        locks.splice(idx, 1);
        if (locks.length === 0) {
            delete Memory._transporterLocks.delivers[id];
        }
        if (Memory._transporterLockTimestamps) {
            delete Memory._transporterLockTimestamps[id];
        }
    }
},
```

#### 4. 修改 `_releaseAllLocks(creepName)`

更新以支持数组格式的送货锁：

```javascript
_releaseAllLocks: function (creepName) {
    if (!Memory._transporterLocks) return;
    var locks = Memory._transporterLocks;
    
    // 取货锁（保持单锁格式）
    for (var key in locks.pickups) {
        if (locks.pickups[key] === creepName) {
            delete locks.pickups[key];
            if (Memory._transporterLockTimestamps) {
                delete Memory._transporterLockTimestamps[key];
            }
        }
    }
    
    // 送货锁（改为数组格式）
    for (var key in locks.delivers) {
        var deliverLocks = locks.delivers[key];
        var idx = deliverLocks.indexOf(creepName);
        if (idx !== -1) {
            deliverLocks.splice(idx, 1);
            if (deliverLocks.length === 0) {
                delete locks.delivers[key];
            }
            if (Memory._transporterLockTimestamps) {
                delete Memory._transporterLockTimestamps[key];
            }
        }
    }
},
```

### 修改送货目标查找逻辑（自动顺延）

#### 修改 `_findBestDelivery(creep)`

遍历候选列表，找到第一个未达到锁定上限的收货方：

```javascript
_findBestDelivery: function (creep) {
    var room = creep.room;
    var structures = this._getCachedStructures(room);

    var candidates = [];

    for (var i = 0; i < structures.length; i++) {
        var s = structures[i];
        var st = s.structureType;

        if (st === STRUCTURE_SPAWN || st === STRUCTURE_EXTENSION || st === STRUCTURE_TOWER) {
            if (s.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                var priority = DELIVERY_PRIORITY[st] || 99;

                if (st === STRUCTURE_SPAWN && s.store[RESOURCE_ENERGY] < SPAWN_LOW_ENERGY) {
                    priority = 0;
                }
                if (st === STRUCTURE_TOWER && s.store[RESOURCE_ENERGY] < TOWER_LOW_ENERGY) {
                    priority = 2.5;
                }

                candidates.push({
                    target:   s,
                    priority: priority,
                    freeCap:  s.store.getFreeCapacity(RESOURCE_ENERGY),
                });
            }
        }
    }

    candidates.sort(function (a, b) {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return b.freeCap - a.freeCap;
    });

    // 遍历候选列表，找到第一个未达到锁定上限的收货方
    for (var j = 0; j < candidates.length; j++) {
        var candidate = candidates[j];
        if (!this._isDeliverLocked(candidate.target.id)) {
            this._lockDeliver(candidate.target.id, creep.name);
            return candidate.target;
        }
    }

    // 兜底：Storage
    for (var k = 0; k < structures.length; k++) {
        var ss = structures[k];
        if (
            ss.structureType === STRUCTURE_STORAGE &&
            ss.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
            !this._isDeliverLocked(ss.id)
        ) {
            this._lockDeliver(ss.id, creep.name);
            return ss;
        }
    }

    return null;
},
```

## 假设与决策

1. **取货锁保持不变**：取货目标（Container、Storage 等）继续使用单锁，避免多个搬运者抢同一资源点
2. **送货锁改为多锁**：送货目标（Spawn、Extension、Tower）支持最多 3 个搬运者同时锁定，提高吞吐量
3. **自动顺延**：当最高优先级目标达到锁定上限时，自动尝试下一个候选目标
4. **兼容旧数据**：通过在 `_isDeliverLocked` 中处理旧格式（字符串），平滑迁移到新格式（数组）

## 风险处理

1. **旧数据兼容性**：`_isDeliverLocked` 需要处理旧的单锁格式（字符串），将其转换为数组格式
2. **锁定上限**：设置 `MAX_LOCKS_PER_DELIVER = 3`，可以在后续根据实际情况调整
3. **性能影响**：数组操作比对象属性操作稍慢，但在搬运者数量有限的情况下影响很小

## 验证步骤

1. 当 3 个搬运者同时锁定同一送货目标时，第 4 个搬运者应自动选择下一个目标
2. 当某个搬运者完成送货后，锁定应释放，允许新的搬运者锁定
3. 当搬运者死亡时，其持有的锁定应自动清理