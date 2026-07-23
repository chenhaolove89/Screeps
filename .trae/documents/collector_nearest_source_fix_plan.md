# 采集者近点采集者乱跑远点修复计划

## 问题现象

用户反馈:被分配到**近点**矿的采集者(Collector)依然会"乱动跑向远点"。

## 根因分析(基于 role.collector.js 现状)

### 核心根因:`_getAssignedSource` 的"重新分配"分支只比较采集者数量,完全忽略了距离

当前实现位于 [role.collector.js:266-288](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.collector.js#L266-L288):

```javascript
// 重新分配:按距离排序,选择近矿点中采集者最少的
var bestSource = null;
var minCount = Infinity;

for (var i = 0; i < sources.length; i++) {
    if (creep.memory._sourceCooldowns && creep.memory._sourceCooldowns[sources[i].id]) {
        continue;
    }
    var count = this._countCollectorsAtSource(sources[i].id);
    if (count < minCount) {
        minCount = count;
        bestSource = sources[i];
    }
}
```

虽然 `sources` 已按 spawn 距离升序排列,但循环里**只用 `count` 决定 `bestSource`**,完全没用 `i`(距离序号)。

**触发场景**(以 2 矿点为例):
- 近矿 A 当前已有 1 个采集者(`count=1`)
- 远矿 B 当前 0 个采集者(`count=0`)
- 新采集者孵化后 `assignedSourceId` 为空,进入重新分配
- 循环比较 `count`:A 的 1 > B 的 0 → 选 B
- **结果**:本应守近矿的新采集者被分配到远矿,沿途乱跑

注释明明写"按距离排序,选择近矿点中采集者最少的",但代码与注释不符 —— 这是上一次 [collector_source_assignment_plan.md](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/.trae/documents/collector_source_assignment_plan.md) 落地时遗留的逻辑偏差。

### 次要根因:已有分配但矿点超载时也会被踢回重新分配

[role.collector.js:259-265](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.collector.js#L259-L265) 的保持绑定分支判断 `count <= MAX_COLLECTORS_PER_SOURCE`(MAX=3)。当某矿点临时挤入 4 个采集者(例如 MAX 改过、或前一帧有重叠统计)时,这个 creep 就会被踢出重新分配,再次撞上"只比 count"的根因 → 跑去远矿。

### 次要根因:连续无路径或权限错误时 `assignedSourceId = null` 也会触发重新分配

[role.collector.js:124](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.collector.js#L124)、[:166](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.collector.js#L166)、[:405](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.collector.js#L405)、[:462](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.collector.js#L462) 多处将 `assignedSourceId` 清空,随后都会进入同一缺陷的重新分配逻辑。

## 修复方案

### 修改文件:仅 [role.collector.js](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.collector.js)

### 修改点:重写 `_getAssignedSource` 的重新分配逻辑

把"在所有未冷却矿里挑 count 最小的"改为"**按距离从近到远,选第一个未满载的矿**;若全部满载,才退回到距离最近的未冷却矿"。

新逻辑(替换 [role.collector.js:266-288](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.collector.js#L266-L288)):

```javascript
// 重新分配:按距离从近到远(sources 已按 spawn 距离升序),
// 选第一个未满载的矿点,确保近矿优先占用。
var assigned = null;
for (var i = 0; i < sources.length; i++) {
    var src = sources[i];
    if (creep.memory._sourceCooldowns && creep.memory._sourceCooldowns[src.id]) {
        continue;
    }
    var cnt = this._countCollectorsAtSource(src.id);
    if (cnt < MAX_COLLECTORS_PER_SOURCE) {
        assigned = src;
        break;
    }
}

// 所有矿都满载时的兜底:回到距离最近且未冷却的矿
if (!assigned) {
    for (var j = 0; j < sources.length; j++) {
        if (creep.memory._sourceCooldowns && creep.memory._sourceCooldowns[sources[j].id]) {
            continue;
        }
        assigned = sources[j];
        break;
    }
}

if (assigned) {
    creep.memory.assignedSourceId = assigned.id;
    return assigned;
}

return sources[0];
```

### 关键决策与依据

1. **保持绑定优先** —— 一旦 creep 已绑定到一个矿点(且未冷却、未超载),就保持原绑定不变,避免"采集途中突然换矿"造成的乱跑。这部分逻辑([:253-265](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.collector.js#L253-L265))保留不变。
2. **重新分配按距离序遍历** —— `sources` 已由 `sourceCache.getSourcesBySpawnDistance` 按 spawn 距离升序排列,故第一个 `count < MAX` 的就是"最近的未满载矿"。这正是注释原本宣称、却未落实的行为。
3. **满载兜底也走最近** —— 避免所有矿都满载时被分配到远矿;让 creep 留在近矿排队等待空位,比长途跑去远矿更合理。
4. **冷却过滤保留** —— `_sourceCooldowns` 逻辑保持不变,避免反复撞同一个不可达矿点。
5. **统计方式不变** —— `_countCollectorsAtSource` 的统计逻辑无需改动,它已经在采集者死亡/重新分配后实时反映正确数量。

### 不修改的部分

- `_doHarvest`、`_doDrop`、健康检查、退避重试等逻辑均保持现状 —— 它们不是本 bug 的来源。
- `cache.sources.js`、`state.js`、`main.js` 均无需改动。
- 不修改 harvester 角色逻辑。
- 不写测试代码(遵循用户规则)。
- 不运行调试(遵循用户规则)。

## 验证步骤(运行时观察)

修复后,在游戏内观察:

1. 新孵化或重置的采集者,会直接走向最近的未满载矿点,而非远点。
2. 当近矿有 1~2 个采集者、远矿 0 个时,新采集者依然先填近矿到 3 个,再补远矿。
3. 已绑定近矿的采集者,在状态机切换(harvesting ↔ dropping)时不会突然改绑远矿。
4. 控制台不应出现"source xxx 不可用,重新分配"的反复日志(除非真有冷却或超载)。
