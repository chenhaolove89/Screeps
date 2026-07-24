# 防御塔逻辑抽离与 Wall 维修修复计划

## 总结

当前 Tower 逻辑内联在 `main.js` 中，且 Wall 未被维修。根因是非防御建筑（Road/Container）因日常损耗血量常不满，Tower 始终在修它们，永远到不了 Wall 维修分支。需要：
1. 将 Tower 逻辑抽离为独立的 `manager.tower.js` 组件
2. 修复 Wall 维修问题：给非防御建筑设置维修阈值（避免 Tower 一直修损耗建筑而忽略 Wall）

## 当前状态分析

### 问题 1：Wall 未被维修
- **位置**：[main.js#L36-L52](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/main.js#L36-L52)
- **根因**：非防御建筑维修条件为 `s.hits < s.hitsMax`，Road/Container 因日常使用持续损耗血量，几乎总是不满，导致 Tower 一直在修这些建筑，永远到不了 `else` 分支维修 Wall。
- **解法**：给非防御建筑设置维修阈值（如血量低于 80% 才修），让 Tower 有空闲维修 Wall。

### 问题 2：Tower 逻辑内联在 main.js
- **位置**：[main.js#L28-L54](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/main.js#L28-L54)
- **现状**：约 26 行 Tower 逻辑直接写在主循环中，违反单一职责
- **解法**：抽离为 `manager.tower.js`，与 `manager.spawn.js` 保持一致的命名规范

## 修改方案

### 1. 新建文件：`manager.tower.js`

创建独立的 Tower 管理组件，职责：
- 遍历所有 Tower
- 按优先级执行：攻击敌人 → 紧急维修普通建筑 → 维修 Wall/Rampart
- 内部封装维修阈值常量

**核心逻辑**：
```javascript
// 常量
var NORMAL_REPAIR_THRESHOLD = 0.8;  // 普通建筑血量低于 80% 才修
var DEFENSE_HITS_TARGET = 50000;    // Wall/Rampart 维修上限

// run(room) 主入口
// 1. 攻击敌对 creep（最高优先级）
// 2. 维修血量 < 80% 的非防御建筑（紧急保护功能性建筑）
// 3. 空闲时维修血量 < 50000 的 Wall/Rampart
```

**关键修复点**：普通建筑维修条件从 `s.hits < s.hitsMax` 改为 `s.hits < s.hitsMax * 0.8`，避免 Tower 被日常损耗建筑占用全部精力。

### 2. 修改文件：`main.js`

- 顶部新增 `var managerTower = require('manager.tower');`
- 删除第 28-54 行的内联 Tower 逻辑
- 替换为 `managerTower.run();`

## 假设与决策

- **命名规范**：遵循项目已有的 `manager.spawn.js` 模式，使用 `manager.tower.js`
- **维修阈值**：普通建筑 80%（避免频繁维修损耗建筑），Wall/Rampart 上限 50000（与 role.repairer.js 保持一致）
- **不修改 role.repairer.js**：Creep 维修逻辑保持独立，本次只修复 Tower 维修问题
- **不引入 config.js 配置**：阈值作为模块内常量，保持简单（如需后续可配置化再迁移）

## 验证步骤

1. 部署后观察 Tower 行为：
   - 有敌人时优先攻击
   - 普通建筑血量 < 80% 时维修
   - 空闲时维修 Wall/Rampart（血量 < 50000）
2. 检查 Wall 血量是否逐步上升
3. 确认 main.js 中不再有 Tower 内联逻辑
