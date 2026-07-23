# Transporter 等待Bug修复计划

## 一、问题概述

**现象**：所有搬运者(transporter)都在一个地方等待，没有去 Container 搬运能量。

**原因**：资源锁机制存在缺陷——取货成功后没有释放锁，导致 Container 被永久锁定，其他 transporter 无法访问。

---

## 二、问题根源分析

### 2.1 锁释放逻辑缺陷

**文件**：[role.transporter.js](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.transporter.js)

**问题代码位置**：第207-262行 `_executePickup` 函数

```javascript
_executePickup: function (creep, logCtx) {
    // ...
    if (result === OK) {
        this._log(LOG_LEVEL.DEBUG, logCtx + ' 取货成功: ' + pickupId);
        creep.memory._pickupId = null;
        
        // ❌ 此处没有释放锁！
        // creep.memory._pickupId = null; 只是清除了本地记忆
        // 但 Memory._transporterLocks.pickups[pickupId] 仍然存在
        
        // 检查容量...
    }
    // ...
}
```

### 2.2 锁释放的现有位置

| 释放位置 | 触发条件 | 是否覆盖正常路径 |
|---------|---------|----------------|
| `_handleMoveError` | 连续5次移动失败 | ❌ 不覆盖 |
| `_handlePickupError` | 连续3次取货失败 | ❌ 不覆盖 |
| `_healthCheck` | 停滞超过50 ticks | ❌ 不覆盖（没有释放锁） |
| `_releaseAllLocks` | 手动调用 | ❌ 不覆盖（未在成功路径调用） |

### 2.3 问题流程图

```
Transporter A 找到 Container → _lockPickup(containerId, 'A') → 锁定成功
    ↓
Transporter A 移动到 Container → _executePickup() → 取货成功
    ↓
❌ 锁仍然存在于 Memory._transporterLocks.pickups[containerId] = 'A'
    ↓
Transporter B 找取货点 → _findBestPickup() → _isPickupLocked(containerId) = true
    ↓
Transporter B 跳过 Container → 继续找其他取货点 → 无可用取货点
    ↓
Transporter B 进入等待状态 → 所有 transporter 都等待
```

---

## 三、修复方案

### 3.1 核心修复点

**修复1：取货成功后释放锁**（第231-241行）

在 `_executePickup` 函数中，取货成功后立即释放对应的取货锁：

```javascript
if (result === OK) {
    this._log(LOG_LEVEL.DEBUG, logCtx + ' 取货成功: ' + pickupId);
    this._releasePickupLock(pickupId, creep.name);  // 新增：释放锁
    creep.memory._pickupId = null;
    // ... 后续逻辑
}
```

**修复2：送货成功后释放锁**（第331-366行）

在 `_executeDelivery` 函数中，送货成功后立即释放对应的送货锁：

```javascript
if (result === OK) {
    // ... 更新任务进度
    this._releaseDeliverLock(deliverId, creep.name);  // 新增：释放锁
    // ... 后续逻辑
}
```

**修复3：健康检查中增加锁释放**（第667-708行）

在 `_healthCheck` 函数中，当检测到卡住并强制重置状态时，释放所有锁：

```javascript
if (h.stagnationCount > 50) {
    this._log(LOG_LEVEL.WARN, logCtx + ' 停滞检测：强制重置状态');
    // ... 重置状态
    this._releaseAllLocks(creep.name);  // 确保释放所有锁
    // ...
}
```

**修复4：添加锁超时机制**（第518-528行）

在 `_isPickupLocked` 函数中，增加锁超时检查：

```javascript
_isPickupLocked: function (id) {
    if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
    var lock = Memory._transporterLocks.pickups[id];
    if (!lock) return false;
    
    // 检查持有锁的 creep 是否存活
    if (!Game.creeps[lock]) {
        delete Memory._transporterLocks.pickups[id];
        return false;
    }
    
    // 新增：检查锁是否超时（超过30 ticks未操作视为过期）
    if (Memory._transporterLockTimestamps && Memory._transporterLockTimestamps[id]) {
        if (Game.time - Memory._transporterLockTimestamps[id] > 30) {
            delete Memory._transporterLocks.pickups[id];
            delete Memory._transporterLockTimestamps[id];
            return false;
        }
    }
    
    return true;
}
```

**修复5：更新锁时间戳**（第533-536行）

在 `_lockPickup` 和 `_lockDeliver` 函数中，记录锁的时间戳：

```javascript
_lockPickup: function (id, creepName) {
    if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
    Memory._transporterLocks.pickups[id] = creepName;
    // 新增：记录时间戳
    if (!Memory._transporterLockTimestamps) Memory._transporterLockTimestamps = {};
    Memory._transporterLockTimestamps[id] = Game.time;
}
```

### 3.2 修复后的状态流程

```
Transporter A 找到 Container → _lockPickup(containerId, 'A') → 锁定成功
    ↓
Transporter A 移动到 Container → _executePickup() → 取货成功
    ↓
✅ _releasePickupLock(containerId, 'A') → 锁被释放
    ↓
Memory._transporterLocks.pickups[containerId] 被删除
    ↓
Transporter B 找取货点 → _findBestPickup() → _isPickupLocked(containerId) = false
    ↓
Transporter B 锁定 Container → 正常搬运
```

---

## 四、实施步骤

### 4.1 修改文件：role.transporter.js

**步骤1：修复取货成功后的锁释放**（第231行附近）

```javascript
// 修改前：
if (result === OK) {
    this._log(LOG_LEVEL.DEBUG, logCtx + ' 取货成功: ' + pickupId);
    creep.memory._pickupId = null;

// 修改后：
if (result === OK) {
    this._log(LOG_LEVEL.DEBUG, logCtx + ' 取货成功: ' + pickupId);
    this._releasePickupLock(pickupId, creep.name);
    creep.memory._pickupId = null;
```

**步骤2：修复送货成功后的锁释放**（第331行附近）

```javascript
// 修改前：
if (result === OK) {
    // 更新任务进度...

// 修改后：
if (result === OK) {
    this._releaseDeliverLock(creep.memory._deliverId, creep.name);
    // 更新任务进度...
```

**步骤3：修复健康检查中的锁释放**（第694行附近）

```javascript
// 修改前：
if (h.stagnationCount > 50) {
    this._log(LOG_LEVEL.WARN, logCtx + ' 停滞检测：强制重置状态');
    creep.memory._transportPhase = 'empty';
    // ...

// 修改后：
if (h.stagnationCount > 50) {
    this._log(LOG_LEVEL.WARN, logCtx + ' 停滞检测：强制重置状态');
    this._releaseAllLocks(creep.name);  // 确保释放所有锁
    creep.memory._transportPhase = 'empty';
    // ...
```

**步骤4：添加锁超时检查**（第518行 `_isPickupLocked` 函数）

```javascript
// 修改前：
_isPickupLocked: function (id) {
    if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
    var lock = Memory._transporterLocks.pickups[id];
    if (!lock) return false;
    // 验证持有锁的 creep 仍存活
    if (!Game.creeps[lock]) {
        delete Memory._transporterLocks.pickups[id];
        return false;
    }
    return true;
},

// 修改后：
_isPickupLocked: function (id) {
    if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
    var lock = Memory._transporterLocks.pickups[id];
    if (!lock) return false;
    
    if (!Game.creeps[lock]) {
        delete Memory._transporterLocks.pickups[id];
        return false;
    }
    
    if (Memory._transporterLockTimestamps && Memory._transporterLockTimestamps[id]) {
        if (Game.time - Memory._transporterLockTimestamps[id] > 30) {
            delete Memory._transporterLocks.pickups[id];
            delete Memory._transporterLockTimestamps[id];
            return false;
        }
    }
    
    return true;
},
```

**步骤5：添加锁时间戳记录**（第533行 `_lockPickup` 函数）

```javascript
// 修改前：
_lockPickup: function (id, creepName) {
    if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
    Memory._transporterLocks.pickups[id] = creepName;
},

// 修改后：
_lockPickup: function (id, creepName) {
    if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
    Memory._transporterLocks.pickups[id] = creepName;
    
    if (!Memory._transporterLockTimestamps) Memory._transporterLockTimestamps = {};
    Memory._transporterLockTimestamps[id] = Game.time;
},
```

**步骤6：为送货锁添加同样的超时检查**（第541行 `_isDeliverLocked` 函数）

```javascript
// 修改前：
_isDeliverLocked: function (id) {
    if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
    var lock = Memory._transporterLocks.delivers[id];
    if (!lock) return false;
    if (!Game.creeps[lock]) {
        delete Memory._transporterLocks.delivers[id];
        return false;
    }
    return true;
},

// 修改后：
_isDeliverLocked: function (id) {
    if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
    var lock = Memory._transporterLocks.delivers[id];
    if (!lock) return false;
    if (!Game.creeps[lock]) {
        delete Memory._transporterLocks.delivers[id];
        return false;
    }
    
    if (Memory._transporterLockTimestamps && Memory._transporterLockTimestamps[id]) {
        if (Game.time - Memory._transporterLockTimestamps[id] > 30) {
            delete Memory._transporterLocks.delivers[id];
            delete Memory._transporterLockTimestamps[id];
            return false;
        }
    }
    
    return true;
},
```

**步骤7：为送货锁添加时间戳记录**（第555行 `_lockDeliver` 函数）

```javascript
// 修改前：
_lockDeliver: function (id, creepName) {
    if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
    Memory._transporterLocks.delivers[id] = creepName;
},

// 修改后：
_lockDeliver: function (id, creepName) {
    if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
    Memory._transporterLocks.delivers[id] = creepName;
    
    if (!Memory._transporterLockTimestamps) Memory._transporterLockTimestamps = {};
    Memory._transporterLockTimestamps[id] = Game.time;
},
```

**步骤8：修改 `_releaseAllLocks` 函数，同时清理时间戳**（第563行）

```javascript
// 修改前：
_releaseAllLocks: function (creepName) {
    if (!Memory._transporterLocks) return;
    var locks = Memory._transporterLocks;
    for (var key in locks.pickups) {
        if (locks.pickups[key] === creepName) delete locks.pickups[key];
    }
    for (var key in locks.delivers) {
        if (locks.delivers[key] === creepName) delete locks.delivers[key];
    }
},

// 修改后：
_releaseAllLocks: function (creepName) {
    if (!Memory._transporterLocks) return;
    var locks = Memory._transporterLocks;
    for (var key in locks.pickups) {
        if (locks.pickups[key] === creepName) {
            delete locks.pickups[key];
            if (Memory._transporterLockTimestamps) {
                delete Memory._transporterLockTimestamps[key];
            }
        }
    }
    for (var key in locks.delivers) {
        if (locks.delivers[key] === creepName) {
            delete locks.delivers[key];
            if (Memory._transporterLockTimestamps) {
                delete Memory._transporterLockTimestamps[key];
            }
        }
    }
},
```

### 4.2 创建辅助函数

**添加单独的锁释放函数**：

```javascript
/**
 * 释放取货锁（单独函数，便于调用）
 */
_releasePickupLock: function (id, creepName) {
    if (!Memory._transporterLocks) return;
    if (Memory._transporterLocks.pickups[id] === creepName) {
        delete Memory._transporterLocks.pickups[id];
        if (Memory._transporterLockTimestamps) {
            delete Memory._transporterLockTimestamps[id];
        }
    }
},

/**
 * 释放送货锁（单独函数，便于调用）
 */
_releaseDeliverLock: function (id, creepName) {
    if (!Memory._transporterLocks) return;
    if (Memory._transporterLocks.delivers[id] === creepName) {
        delete Memory._transporterLocks.delivers[id];
        if (Memory._transporterLockTimestamps) {
            delete Memory._transporterLockTimestamps[id];
        }
    }
},
```

---

## 五、风险评估

| 风险类型 | 风险描述 | 影响等级 | 应对措施 |
|---------|---------|---------|---------|
| **锁竞争** | 多个 transporter 同时锁定同一 Container | 中 | 锁超时机制可自动释放过期锁 |
| **性能影响** | 增加时间戳检查可能影响 CPU | 低 | 时间戳检查只在锁定时执行，开销极小 |
| **兼容性** | 修改可能影响现有逻辑 | 低 | 只添加释放逻辑，不改变核心流程 |
| **死锁** | 锁机制仍可能导致死锁 | 中 | 锁超时（30 ticks）+ 健康检查双重保障 |

---

## 六、验证步骤

1. **部署修改后的代码**
2. **创建多个 transporter**（如4个）
3. **确保 Container 有足够能量**（>= 100）
4. **观察 transporter 行为**：
   - 第一个 transporter 锁定并取货
   - 取货成功后，锁被释放
   - 其他 transporter 可以继续访问该 Container
5. **验证锁超时机制**：
   - 手动让一个 transporter 卡住
   - 观察 30 ticks 后锁是否自动释放
6. **验证健康检查**：
   - 观察卡住的 transporter 是否在 50 ticks 后重置状态并释放锁

---

## 七、预期效果

- ✅ 所有 transporter 能正常访问 Container
- ✅ 锁在取货/送货成功后及时释放
- ✅ 锁超时机制防止永久锁定
- ✅ 健康检查确保卡住时释放锁
- ✅ 不影响现有核心逻辑