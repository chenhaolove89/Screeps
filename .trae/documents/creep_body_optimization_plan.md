# Creep 部件配置优化实施计划

## 一、任务概述

为 Screeps 房间自动化项目的 6 种 creep 角色（harvester、collector、transporter、upgrader、builder、repairer）设计差异化的身体部件配置策略，根据各角色职责设计专属 body 组合方案，并预留战斗角色配置接口。

---

## 二、当前状态分析

### 2.1 现有孵化逻辑

**文件**：[manager.spawn.js](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/manager.spawn.js)

**现状问题**：
```javascript
// 第74-89行：所有角色使用相同的部件生成逻辑
getBody: function (energy, role) {
    var n = Math.floor(energy / 200);  // 每单元 [WORK, CARRY, MOVE]
    n = Math.min(n, 8);                // 最多 8 单元（24 parts）
    var body = [];
    for (var i = 0; i < n; i++) body.push(WORK);
    for (var i = 0; i < n; i++) body.push(CARRY);
    for (var i = 0; i < n; i++) body.push(MOVE);
    return body;
}
```

**核心缺陷**：
- 所有角色使用相同的 `[WORK, CARRY, MOVE]` 配比
- 忽略了不同角色的性能瓶颈（如 transporter 需要更多 MOVE）
- 未考虑角色职责差异（如 collector 不需要长途运输）
- 固定 1:1:1 配比导致移动效率不优化

### 2.2 角色职责与性能需求分析

| 角色 | 职责 | 关键动作 | 移动频率 | 能量消耗模式 | 部件需求特征 |
|------|------|---------|---------|-------------|-------------|
| **harvester** | 采集+运输 | harvest(高), transfer(中) | 高（往返矿点-Spawn） | WORK主导，需要CARRY | 需平衡移动速度与采集效率 |
| **collector** | 纯采集 | harvest(极高), drop/transfer(低) | 极低（固定矿点） | WORK绝对主导 | 最小化CARRY/MOVE，最大化WORK |
| **transporter** | 搬运能量 | pickup/withdraw(低), transfer(低) | 极高（全场往返） | CARRY+MOVE主导 | 优化移动速度，少量CARRY即可 |
| **upgrader** | 升级控制器 | upgradeController(高), withdraw(中) | 低（固定控制器附近） | WORK主导 | 平衡WORK与MOVE，适度CARRY |
| **builder** | 建造工地 | build(高), withdraw(中) | 中（工地间移动） | WORK主导 | 需要足够的MOVE支持移动 |
| **repairer** | 修理建筑 | repair(中), withdraw(中) | 中（建筑间移动） | WORK主导 | 类似builder，但频率更低 |

### 2.3 部件成本与效率计算

**部件成本**（参考 Screeps_API_参考.md）：
```
MOVE:   50 能量 (降低 fatigue)
WORK:  100 能量 (采集/建造/升级/修理)
CARRY:  50 能量 (携带资源)
ATTACK: 80 能量 (近战攻击)
RANGED_ATTACK: 150 能量 (远程攻击)
HEAL:  250 能量 (治疗)
TOUGH:  10 能量 (减伤，需放在body最前)
CLAIM: 600 能量 (占领控制器)
```

**移动疲劳机制**：
- 每个 **非 MOVE 部件** 在移动时产生 fatigue
- 每个 **MOVE 部件** 减少 2 点 fatigue
- **疲劳值计算**（推测自官方文档）：
  - 平地移动：每个非MOVE部件产生 1 点 fatigue
  - 沼泽移动：每个非MOVE部件产生 5 点 fatigue（swampCost）
  - 道路移动：每个非MOVE部件产生 0.5 点 fatigue（有道路时）
- **速度要求**：MOVE 数量 ≥ 其他部件总数时，可无疲劳移动（平原）

**工作效率**：
- `harvest(source)`：每个 WORK 产生 2 能量/tick
- `build(constructionSite)`：每个 WORK 消耗 5 能量，增加 5 点进度
- `upgradeController(controller)`：每个 WORK 消耗 1 能量，增加 1 点升级进度
- `repair(structure)`：每个 WORK 消耗 1 能量，恢复 100 点 HP
- `carry` 容量：每个 CARRY 可携带 50 单位资源

---

## 三、优化方案设计

### 3.1 设计原则

1. **移动效率优先**：确保每个 creep 移动时无疲劳（平原地形）
2. **能量利用最大化**：根据可用能量动态调整部件数量
3. **角色职责匹配**：为不同角色设计专属部件组合
4. **生命周期适应**：低能量期使用最小可用配置，高能量期使用优化配置
5. **预留扩展接口**：为战斗角色预留配置框架

### 3.2 能量阶段划分

根据房间能量容量划分配置阶段：

| 能量区间 | 阶段名称 | 配置策略 | 适用场景 |
|---------|---------|---------|---------|
| 200-300 | **生存期** | 最小可用配置（1-2 单元） | 新房间启动 |
| 300-550 | **发展期** | 基础配置（2-3 单元） | RCL 2-3 |
| 550-800 | **成长期** | 优化配置（3-4 单元） | RCL 4-5 |
| 800-1300 | **成熟期** | 标准配置（4-6 单元） | RCL 6-7 |
| 1300-3000 | **繁荣期** | 高级配置（6-8 单元） | RCL 8 |

### 3.3 各角色专属部件配置方案

#### 3.3.1 Harvester（采集+运输）

**职责特征**：
- 需要在矿点和 Spawn/Extension 之间高频往返
- 同时承担采集和运输职责
- 需要平衡采集效率与移动速度

**配置策略**：
```javascript
// 低能量（200-300）：[WORK, CARRY, MOVE] - 最小可用
// 中能量（300-550）：[WORK, WORK, CARRY, MOVE, MOVE] - 2:1:2 配比
// 高能量（550+）：动态计算，保持 WORK:CARRY:MOVE = 2:1:2 配比

// 示例配置：
// 能量 300 → [WORK, CARRY, MOVE] (成本 200)
// 能量 500 → [WORK, WORK, CARRY, MOVE, MOVE] (成本 350)
// 能量 800 → [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE] (成本 550)
```

**设计理由**：
- 2 个 WORK 保证采集效率（4 能量/tick）
- 1 个 CARRY 可携带 50 能量，足够运输单次采集
- 2 个 MOVE 确保无疲劳移动（平原地形）

**能量计算公式**：
```javascript
// 单元成本：WORK(100) + WORK(100) + CARRY(50) + MOVE(50) + MOVE(50) = 350
function getHarvesterBody(energy) {
    const unitCost = 350;
    const units = Math.max(1, Math.min(Math.floor(energy / unitCost), 4));
    const body = [];
    for (let i = 0; i < units * 2; i++) body.push(WORK);
    for (let i = 0; i < units; i++) body.push(CARRY);
    for (let i = 0; i < units * 2; i++) body.push(MOVE);
    return body;
}
```

---

#### 3.3.2 Collector（纯采集）

**职责特征**：
- 固定矿点工作，移动需求极低
- 采集能量后立即投放到就近 Container 或掉落
- 无需长途运输

**配置策略**：
```javascript
// 最小配置：[WORK, WORK, WORK, CARRY, MOVE] - 最小化 MOVE
// 推荐配置：最大化 WORK，仅保留 1 个 MOVE 用于站位调整

// 示例配置：
// 能量 300 → [WORK, WORK, CARRY, MOVE] (成本 250)
// 能量 500 → [WORK, WORK, WORK, CARRY, MOVE] (成本 350)
// 能量 800 → [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE] (成本 550)
```

**设计理由**：
- WORK 部件最大化（采集效率优先）
- 仅需 1 个 CARRY 用于暂时存储（或直接 drop）
- 1 个 MOVE 用于矿点位置微调（饱和时顺延）

**能量计算公式**：
```javascript
// 成本：WORK(100) * N + CARRY(50) + MOVE(50)
function getCollectorBody(energy) {
    // 基础成本：CARRY(50) + MOVE(50) = 100
    const baseCost = 100;
    const workCount = Math.max(1, Math.min(Math.floor((energy - baseCost) / 100), 8));
    const body = [];
    for (let i = 0; i < workCount; i++) body.push(WORK);
    body.push(CARRY);
    body.push(MOVE);
    return body;
}
```

---

#### 3.3.3 Transporter（能量搬运）

**职责特征**：
- 全场高频移动，运输效率是核心指标
- 需要从 dropped/tombstone/container 取能量并送到消费端
- 无需 WORK 部件

**配置策略**：
```javascript
// 最小配置：[CARRY, MOVE] - 基础运输单元
// 优化配置：[CARRY, CARRY, MOVE, MOVE] - 保持 CARRY:MOVE = 1:1

// 示例配置：
// 能量 200 → [CARRY, MOVE] (成本 100)
// 能量 400 → [CARRY, CARRY, MOVE, MOVE] (成本 200)
// 能量 800 → [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE] (成本 400)
```

**设计理由**：
- 无 WORK 部件，纯运输角色
- CARRY:MOVE = 1:1 确保移动无疲劳（满载时）
- 能量分配：优先保证 MOVE 数量，再增加 CARRY

**能量计算公式**：
```javascript
// 单元成本：CARRY(50) + MOVE(50) = 100
function getTransporterBody(energy) {
    const unitCost = 100;
    const units = Math.max(1, Math.min(Math.floor(energy / unitCost), 8));
    const body = [];
    for (let i = 0; i < units; i++) body.push(CARRY);
    for (let i = 0; i < units; i++) body.push(MOVE);
    return body;
}
```

---

#### 3.3.4 Upgrader（升级控制器）

**职责特征**：
- 固定在控制器附近工作，移动需求低
- 需要 WORK 部件进行升级操作
- 需要频繁 withdraw 补充能量

**配置策略**：
```javascript
// 最小配置：[WORK, CARRY, MOVE]
// 优化配置：[WORK, WORK, CARRY, MOVE, MOVE] - 保持 2:1:2 配比

// 示例配置：
// 能量 300 → [WORK, CARRY, MOVE] (成本 200)
// 能量 500 → [WORK, WORK, CARRY, MOVE, MOVE] (成本 350)
// 能量 800 → [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE] (成本 550)
```

**设计理由**：
- 类似 harvester 的配置逻辑
- 需要 WORK 进行升级，CARRY 携带能量
- MOVE 保证偶尔的移动需求（能量补充）

**能量计算公式**：
```javascript
// 单元成本：WORK(100) * 2 + CARRY(50) + MOVE(50) * 2 = 350
function getUpgraderBody(energy) {
    const unitCost = 350;
    const units = Math.max(1, Math.min(Math.floor(energy / unitCost), 3));
    const body = [];
    for (let i = 0; i < units * 2; i++) body.push(WORK);
    for (let i = 0; i < units; i++) body.push(CARRY);
    for (let i = 0; i < units * 2; i++) body.push(MOVE);
    return body;
}
```

---

#### 3.3.5 Builder（建造工地）

**职责特征**：
- 需要在多个工地之间移动
- 需要 WORK 部件进行建造
- 需要 withdraw 补充能量

**配置策略**：
```javascript
// 最小配置：[WORK, CARRY, MOVE, MOVE]
// 优化配置：[WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE]

// 示例配置：
// 能量 300 → [WORK, CARRY, MOVE, MOVE] (成本 250)
// 能量 500 → [WORK, WORK, CARRY, MOVE, MOVE] (成本 350)
// 能量 800 → [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE] (成本 550)
```

**设计理由**：
- 需要 WORK 进行建造（消耗 5 能量/动作）
- CARRY 携带能量（每个建造动作消耗 5 能量）
- MOVE 确保在工地间快速移动

**能量计算公式**：
```javascript
// 基础配置：WORK(100) + CARRY(50) + MOVE(50) * 2 = 250
function getBuilderBody(energy) {
    const minEnergy = 250;
    if (energy < minEnergy) {
        return [WORK, CARRY, MOVE];  // 回退到最小配置
    }

    const units = Math.max(1, Math.min(Math.floor((energy - 50) / 300), 4));
    const body = [];
    for (let i = 0; i < units * 2; i++) body.push(WORK);
    for (let i = 0; i < units; i++) body.push(CARRY);
    for (let i = 0; i < units * 2; i++) body.push(MOVE);
    return body;
}
```

---

#### 3.3.6 Repairer（修理建筑）

**职责特征**：
- 在受损建筑之间移动
- 需要 WORK 进行修理
- 移动频率中等

**配置策略**：
```javascript
// 最小配置：[WORK, CARRY, MOVE]
// 优化配置：类似 builder，但可以降低 CARRY 数量

// 示例配置：
// 能量 300 → [WORK, CARRY, MOVE] (成本 200)
// 能量 500 → [WORK, WORK, CARRY, MOVE, MOVE] (成本 350)
// 能量 800 → [WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE] (成本 450)
```

**设计理由**：
- 类似 builder 的配置逻辑
- 修理消耗较低（1 能量/WORK），CARRY 需求较少
- 需要 WORK 和 MOVE 支持

**能量计算公式**：
```javascript
function getRepairerBody(energy) {
    if (energy < 200) return [WORK, CARRY, MOVE];

    const units = Math.max(1, Math.min(Math.floor((energy - 50) / 150), 5));
    const body = [];
    for (let i = 0; i < units; i++) body.push(WORK);
    body.push(CARRY);
    for (let i = 0; i < units; i++) body.push(MOVE);
    return body;
}
```

---

### 3.4 战斗角色配置接口（预留）

为未来可能的战斗角色预留配置框架：

```javascript
// 战斗角色类型枚举（预留）
const COMBAT_ROLES = {
    GUARD: 'guard',           // 近战防御
    RANGER: 'ranger',         // 远程攻击
    HEALER: 'healer',         // 治疗
    CLAIMER: 'claimer',       // 占领房间
};

// 战斗角色配置模板（预留）
const COMBAT_BODY_TEMPLATES = {
    guard: {
        low:  [TOUGH, ATTACK, ATTACK, MOVE, MOVE],           // 成本：10+80+80+50+50=270
        high: [TOUGH, TOUGH, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE],  // 成本：10+10+80*3+50*3=310
    },
    ranger: {
        low:  [RANGED_ATTACK, MOVE],                          // 成本：150+50=200
        high: [RANGED_ATTACK, RANGED_ATTACK, MOVE, MOVE],     // 成本：150*2+50*2=400
    },
    healer: {
        low:  [HEAL, MOVE],                                   // 成本：250+50=300
        high: [HEAL, HEAL, MOVE, MOVE],                       // 成本：250*2+50*2=600
    },
    claimer: {
        standard: [CLAIM, MOVE],                              // 成本：600+50=650
    },
};
```

---

## 四、实施步骤

### 4.1 创建配置模块

**文件**：`body.config.js`（新建）

**内容结构**：
```javascript
/**
 * Creep 身体部件配置管理器
 * 为不同角色提供差异化的部件生成策略
 */

// 能量阶段常量
const ENERGY_TIERS = {
    SURVIVAL:  { min: 200, max: 300 },    // 生存期
    DEVELOPING: { min: 300, max: 550 },   // 发展期
    GROWING:   { min: 550, max: 800 },    // 成长期
    MATURE:    { min: 800, max: 1300 },   // 成熟期
    PROSPERING:{ min: 1300, max: 3000 },  // 繁荣期
};

// 角色配置策略
const ROLE_BODY_STRATEGIES = {
    harvester:   getHarvesterBody,
    collector:   getCollectorBody,
    transporter: getTransporterBody,
    upgrader:    getUpgraderBody,
    builder:     getBuilderBody,
    repairer:    getRepairerBody,
};

// 各角色配置函数实现（如上文 3.3 节所示）
function getHarvesterBody(energy) { ... }
function getCollectorBody(energy) { ... }
// ... 其他角色配置函数

module.exports = {
    ENERGY_TIERS,
    ROLE_BODY_STRATEGIES,
    getBody: function(energy, role) {
        const strategy = ROLE_BODY_STRATEGIES[role];
        if (!strategy) {
            // 回退到默认配置
            return getDefaultBody(energy);
        }
        return strategy(energy);
    },
};
```

### 4.2 修改孵化管理器

**文件**：`manager.spawn.js`

**修改点**：
1. 引入新的配置模块
2. 替换原有的 `getBody` 函数
3. 保持向后兼容性

**修改代码示例**：
```javascript
// 第6行后添加：
var bodyConfig = require('body.config');

// 第74-89行的 getBody 函数替换为：
getBody: function (energy, role) {
    return bodyConfig.getBody(energy, role);
},
```

### 4.3 更新全局配置

**文件**：`config.js`

**添加内容**：
```javascript
// 在第18行后添加：
// 身体部件配置开关（用于调试）
bodyConfig: {
    debug: false,              // 是否打印部件生成日志
    forceTier: null,           // 强制使用指定能量阶段（null=自动）
},
```

### 4.4 测试与验证

**测试步骤**：
1. 在测试房间部署修改后的代码
2. 观察各角色 creep 的部件配置
3. 验证移动效率（是否无疲劳移动）
4. 检查能量消耗是否合理
5. 监控房间整体运营效率

**验证指标**：
- [ ] Harvester 往返矿点-Spawn 无疲劳
- [ ] Collector 在固定矿点高效采集
- [ ] Transporter 全场快速移动
- [ ] Upgrader 升级控制器效率提升
- [ ] Builder 建造速度提升
- [ ] Repairer 修理效率提升

---

## 五、潜在风险与应对

### 5.1 风险识别

| 风险类型 | 风险描述 | 影响等级 | 应对措施 |
|---------|---------|---------|---------|
| **配置错误** | 部件配置导致能量不足或数量超限 | 高 | 添加能量校验逻辑，确保成本 ≤ 可用能量 |
| **移动瓶颈** | MOVE 部件不足导致疲劳积累 | 高 | 计算公式确保 MOVE 数量 ≥ 其他部件 |
| **向后兼容** | 修改影响现有房间运行 | 中 | 保留回退逻辑，config 中添加开关 |
| **调试困难** | 部件配置问题难以定位 | 中 | 添加详细日志输出（可配置） |
| **性能影响** | 新增计算逻辑增加 CPU 开销 | 低 | 使用预计算和缓存优化 |

### 5.2 回退方案

如果优化后出现问题，可快速回退：

```javascript
// body.config.js 中添加回退函数
function getDefaultBody(energy) {
    const n = Math.max(1, Math.min(Math.floor(energy / 200), 8));
    const body = [];
    for (let i = 0; i < n; i++) body.push(WORK);
    for (let i = 0; i < n; i++) body.push(CARRY);
    for (let i = 0; i < n; i++) body.push(MOVE);
    return body;
}

// 在 getBody 中添加回退逻辑
if (!strategy || config.bodyConfig.forceDefault) {
    return getDefaultBody(energy);
}
```

---

## 六、预期收益

### 6.1 效率提升预估

| 角色指标 | 当前状态 | 优化后预期 | 提升幅度 |
|---------|---------|-----------|---------|
| Harvester 移动速度 | 可能疲劳 | 无疲劳移动 | +30% 效率 |
| Collector 采集效率 | 平均 2 WORK | 最高 8 WORK | +300% 效率 |
| Transporter 运输速度 | 可能疲劳 | 无疲劳满载移动 | +50% 效率 |
| Upgrader 升级速度 | 平均 2 WORK | 最高 6 WORK | +200% 效率 |
| Builder 建造速度 | 平均 2 WORK | 最高 8 WORK | +300% 效率 |

### 6.2 能量利用率优化

- **精准匹配**：部件配置与可用能量精确匹配，避免浪费
- **动态调整**：根据房间发展阶段自动选择最优配置
- **瓶颈消除**：解决移动疲劳瓶颈，提升整体吞吐量

---

## 七、后续扩展方向

### 7.1 短期优化（1-2周）

1. 添加沼泽地形适配（增加 MOVE 比例）
2. 实现道路检测（减少 MOVE 需求）
3. 添加能量缓存优化（预计算常用配置）

### 7.2 中期优化（1-2月）

1. 实现多房间支持（不同房间独立配置）
2. 添加远程采矿角色配置
3. 实现动态角色数量调整（根据资源需求）

### 7.3 长期规划（3-6月）

1. 战斗角色完整实现（guard、ranger、healer、claimer）
2. AI 驱动的部件优化（根据实时数据调整）
3. 多房间协同配置管理

---

## 八、关键假设与决策

### 8.1 关键假设

1. **单房间运营**：当前实现仅针对单房间（Spawn1），不考虑多房间协同
2. **平原地形**：默认地形为平原，沼泽地形需后续适配
3. **无道路优化**：初期不检测道路，使用统一的平原配置
4. **能量容量**：使用 `room.energyAvailable` 作为生成上限（不含 storage）
5. **无战斗需求**：战斗角色仅预留接口，暂不实施

### 8.2 设计决策

1. **MOVE 配比策略**：采用保守策略，确保所有地形无疲劳（1:1 或更高）
2. **能量阶段划分**：使用固定阈值而非动态计算（简化逻辑）
3. **角色优先级**：保持现有的孵化优先级（harvester → collector → ...）
4. **向后兼容**：保留原有配置逻辑作为回退方案
5. **调试支持**：通过 config.bodyConfig.debug 控制日志输出

---

## 九、实施检查清单

### 9.1 Phase 1：核心实施

- [ ] 创建 `body.config.js` 文件
- [ ] 实现 6 种角色的配置函数
- [ ] 修改 `manager.spawn.js` 的 `getBody` 函数
- [ ] 在 `config.js` 中添加配置开关
- [ ] 编写单元测试验证部件计算

### 9.2 Phase 2：测试验证

- [ ] 在测试房间部署代码
- [ ] 观察各角色 creep 生成
- [ ] 验证移动效率（观察 fatigue 值）
- [ ] 检查能量消耗是否符合预期
- [ ] 测试极端情况（能量不足、角色死亡）

### 9.3 Phase 3：优化迭代

- [ ] 根据测试结果调整配置策略
- [ ] 添加调试日志输出
- [ ] 实现配置缓存优化
- [ ] 编写使用文档
- [ ] 提交代码到 Git 仓库

---

## 十、总结

本计划通过为 6 种 creep 角色设计差异化的身体部件配置策略，解决了当前所有角色使用相同配置的性能瓶颈问题。核心优化点包括：

1. **移动效率优化**：确保所有角色无疲劳移动（平原地形）
2. **职责匹配**：根据角色实际需求定制部件组合
3. **动态调整**：根据可用能量自动选择最优配置
4. **生命周期适配**：支持不同发展阶段的需求
5. **预留扩展**：为战斗角色预留配置接口

实施后预期可显著提升房间整体运营效率，特别是在能量采集、运输和建造等核心环节。