# 采集者矿点分配优化计划

## 需求分析

用户要求修改采集者(Collector)的能量源分配逻辑：
1. 默认每个矿点安排 **3** 个采集者（当前为 2 个）
2. 根据与 Spawn 的距离区分矿点（近矿点优先分配）
3. 直接固定分配每个矿点的采集者，避免采集者到处移动
4. **关键需求**：采集者死亡或新增时，能正确重新分配

## 当前代码分析

### 现有逻辑（roleCollector.js）
- `MAX_COLLECTORS_PER_SOURCE = 2` — 每矿点最大采集者数
- `_getAssignedSource()` — 使用 hash 分配 + 采集者数量统计的方式分配矿点
- `_countCollectorsAtSource()` — 实时统计某矿点的采集者数量
- 分配逻辑没有考虑与 Spawn 的距离
- 重新分配逻辑不够完善（仅在冷却或超载时触发）

### 矿点缓存（cache.sources.js）
- `state.sourceData` — 存储矿点坐标信息
- `getSorted()` — 按 Chebyshev 距离排序矿点（相对于 creep）

### 状态管理（state.js）
- 已有矿点相关缓存变量

## 修改方案

### 1. 修改 state.js
- 新增 `sourceSpawnDist` — 缓存矿点到 Spawn 的距离

### 2. 修改 cache.sources.js
- 新增 `getSpawnDistance(source)` — 计算并缓存矿点到 Spawn 的距离
- 新增 `getSourcesBySpawnDistance()` — 返回按距离排序的矿点列表（近→远）

### 3. 修改 roleCollector.js
- 将 `MAX_COLLECTORS_PER_SOURCE` 改为 3
- 修改 `_getAssignedSource()` — 优先分配近矿点，固定绑定采集者
- **增强重新分配逻辑**：当采集者死亡或新增时自动触发重新分配

## 修改步骤

### 步骤 1: 修改 state.js
在矿点缓存区域新增 `sourceSpawnDist` 变量：
```javascript
/** @type {Object.<string, number>} 矿点到 Spawn 的距离缓存（key: sourceId, value: 距离） */
sourceSpawnDist: {},
```

### 步骤 2: 修改 cache.sources.js
添加两个新方法：
```javascript
// 获取矿点到 Spawn 的距离（缓存）
getSpawnDistance: function(source) {
    var sid = source.id;
    if (state.sourceSpawnDist.hasOwnProperty(sid)) {
        return state.sourceSpawnDist[sid];
    }
    var spawn = source.room.find(FIND_STRUCTURES, {
        filter: s => s.structureType == STRUCTURE_SPAWN
    })[0];
    if (!spawn) {
        state.sourceSpawnDist[sid] = Infinity;
        return Infinity;
    }
    var dist = Math.max(
        Math.abs(source.pos.x - spawn.pos.x),
        Math.abs(source.pos.y - spawn.pos.y)
    );
    state.sourceSpawnDist[sid] = dist;
    return dist;
},

// 返回按到 Spawn 距离排序的矿点列表（近→远）
getSourcesBySpawnDistance: function(room) {
    var ids = state.sourceIds;
    var result = [];
    for (var i = 0; i < ids.length; i++) {
        var source = Game.getObjectById(ids[i]);
        if (!source) continue;
        result.push(source);
    }
    result.sort((a, b) => {
        return this.getSpawnDistance(a) - this.getSpawnDistance(b);
    });
    return result;
},
```

### 步骤 3: 修改 roleCollector.js

#### 3.1 修改常量
```javascript
var MAX_COLLECTORS_PER_SOURCE = 3;
```

#### 3.2 修改 `_getAssignedSource()` 方法
核心逻辑：
1. **固定绑定优先**：如果已有分配且矿点未满，保持绑定
2. **动态重新分配**：当矿点超载或采集者死亡导致空位时，重新分配
3. **近矿点优先**：按到 Spawn 的距离排序，优先分配近矿点
4. **负载均衡**：在近矿点中选择当前采集者最少的

```javascript
_getAssignedSource: function(creep) {
    var sources = sourceCache.getSourcesBySpawnDistance(creep.room);
    if (!sources || sources.length === 0) return null;

    // 已有分配且矿点未满 → 保持绑定
    if (creep.memory.assignedSourceId) {
        var existing = Game.getObjectById(creep.memory.assignedSourceId);
        if (existing) {
            var count = this._countCollectorsAtSource(creep.memory.assignedSourceId);
            if (count <= MAX_COLLECTORS_PER_SOURCE) {
                return existing;
            }
        }
    }

    // 重新分配：选择近矿点中采集者最少的
    var bestSource = null;
    var minCount = Infinity;

    for (var i = 0; i < sources.length; i++) {
        var count = this._countCollectorsAtSource(sources[i].id);
        if (count < minCount) {
            minCount = count;
            bestSource = sources[i];
        }
    }

    if (bestSource) {
        creep.memory.assignedSourceId = bestSource.id;
        return bestSource;
    }

    return null;
},
```

#### 3.3 修改 `_countCollectorsAtSource()` 方法
确保能正确统计当前存活的采集者数量（自动处理死亡采集者）：
```javascript
_countCollectorsAtSource: function(sourceId) {
    var count = 0;
    for (var name in Game.creeps) {
        var c = Game.creeps[name];
        if (c.memory.role === 'collector' && c.memory.assignedSourceId === sourceId) {
            count++;
        }
    }
    return count;
},
```

## 动态重新分配机制

### 采集者死亡时
- `_countCollectorsAtSource()` 实时统计存活采集者
- 死亡的采集者自动从统计中移除
- 新采集者孵化后，`_getAssignedSource()` 会发现空位并分配

### 采集者新增时
- 新采集者没有 `assignedSourceId`
- `_getAssignedSource()` 会找到负载最低的矿点并分配

### 矿点超载时
- 如果某个矿点采集者超过限制
- 多余的采集者下次调用 `_getAssignedSource()` 时会重新分配

### 冷却机制（保留）
- 当采集者无法到达矿点时，标记冷却
- 冷却期间跳过该矿点，尝试其他矿点

## 潜在风险与注意事项

1. **兼容性**：`harvester` 角色仍使用旧的 `sourceCache.harvestNearest()`，需要确保不影响其运行
2. **距离计算**：使用 Chebyshev 距离（与现有逻辑一致）
3. **负载均衡**：优先分配近矿点，但当近矿点满载时会分配到远矿点
4. **动态调整**：实时统计确保死亡/新增时能正确重新分配
5. **性能**：`_countCollectorsAtSource()` 每次遍历所有 creeps，需要注意性能

## 预期效果

- 每个矿点最多分配 3 个采集者
- 近矿点优先分配，减少采集者移动距离
- 采集者固定绑定到矿点，避免到处移动
- 采集者死亡或新增时自动重新分配，保持最优配置
- 提高能量采集效率