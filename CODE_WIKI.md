# Screeps 房间自动化脚本 — Code Wiki

> 本文档是对 Screeps 房间自动化 Bot 仓库的结构化技术文档，涵盖项目整体架构、模块职责、关键类与函数说明、依赖关系及运行方式，便于开发者快速理解与二次维护。
>
> 仓库根目录即 Screeps 脚本目录，入口为 [`main.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/main.js)，每 tick 由游戏引擎调用 `module.exports.loop`。

---

## 目录

1. [项目概览](#1-项目概览)
2. [整体架构](#2-整体架构)
3. [目录结构](#3-目录结构)
4. [模块详解](#4-模块详解)
   - 4.1 [入口与主循环](#41-入口与主循环mainjs)
   - 4.2 [全局配置 config.js](#42-全局配置configjs)
   - 4.3 [共享状态 state.js](#43-共享状态statejs)
   - 4.4 [缓存层](#44-缓存层)
   - 4.5 [孵化管理器 manager.spawn.js](#45-孵化管理器managerspawnjs)
   - 4.6 [防御塔管理器 manager.tower.js](#46-防御塔管理器managertowerjs)
   - 4.7 [任务调度器 task.scheduler.js](#47-任务调度器taskschedulerjs)
   - 4.8 [身体部件配置 body.config.js](#48-身体部件配置bodyconfigjs)
   - 4.9 [角色模块](#49-角色模块)
5. [依赖关系](#5-依赖关系)
6. [关键流程](#6-关键流程)
7. [项目运行方式](#7-项目运行方式)
8. [设计要点与已知机制](#8-设计要点与已知机制)

---

## 1. 项目概览

本项目是一个面向 [Screeps](https://screeps.com/) 的单房间自动化管理 Bot，使用模块化 JavaScript 编写。每 tick 由游戏引擎驱动 `module.exports.loop`，按角色调度 Creep 完成**采集、运输、建造、升级、修理与防御**，使房间自给自足运转。

**核心特性：**

- **6 种角色状态机**：harvester、collector、transporter、upgrader、builder、repairer，职责分离。
- **两级缓存降低 CPU**：Creep 名字缓存 + 矿点缓存，避免每 tick 全量 `_.filter(Game.creeps)` / `FIND_SOURCES`。
- **统一任务调度框架**：`task.scheduler.js` 提供优先级队列、资源锁、死锁检测、超时回收与让位协调。
- **差异化身体部件策略**：`body.config.js` 按角色职责与能量阶段动态生成最优 body 组合。
- **短缺优先机制**：检测到角色数量不足时，Builder/Upgrader 自动暂停，把能量与 Spawn 槽位让给孵化。
- **多重死锁/抖动修复**：残余能量死锁、矿点满位顺延、Container↔Spawn 往返抖动、采集者让位等机制完善。

---

## 2. 整体架构

项目采用**单房间、模块化、缓存优先**的架构。整体可分为五层：

```
┌─────────────────────────────────────────────────────────────┐
│  入口层    │  main.js  (每 tick 主循环：调度总控)            │
├─────────────────────────────────────────────────────────────┤
│  配置/状态 │  config.js  (角色目标/阈值)                      │
│            │  state.js   (tick 内瞬态共享状态)                │
├─────────────────────────────────────────────────────────────┤
│  缓存层    │  cache.creep.js   (Creep 名字/角色计数缓存)      │
│            │  cache.sources.js (矿点坐标/距离/空位缓存)       │
├─────────────────────────────────────────────────────────────┤
│  管理器层  │  manager.spawn.js (孵化管理)                     │
│            │  manager.tower.js (防御塔管理)                   │
│            │  task.scheduler.js(跨角色任务调度框架)           │
│            │  body.config.js   (Creep 身体部件策略)           │
├─────────────────────────────────────────────────────────────┤
│  角色层    │  role.harvester.js   role.collector.js           │
│            │  role.transporter.js role.upgrader.js            │
│            │  role.builder.js     role.repairer.js            │
└─────────────────────────────────────────────────────────────┘
```

**架构特点：**

1. **主循环极简**：`main.js` 只做编排，业务逻辑下沉到管理器与角色模块。
2. **瞬态状态与持久状态分离**：`state.js` 只在 tick 内有效，不写 `Memory`；持久状态由各模块按需写入 `Memory.creeps` / `Memory.tasks` / `Memory._transporterLocks`。
3. **缓存驱动**：角色调度、短缺检测、矿点选择均走缓存，O(1) 计数。
4. **职责单一**：每个 role 文件只负责一种 Creep 行为；manager 负责横切关注点（孵化、防御、任务调度）。

---

## 3. 目录结构

| 文件 | 类型 | 职责 |
| --- | --- | --- |
| [`main.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/main.js) | 入口 | 每 tick 主循环：重置瞬态缓存 → 首 tick 初始化 → 防御塔 → 清理死亡 Creep → 检测短缺 → 调度角色 → 自动孵化 |
| [`config.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/config.js) | 配置 | 各角色目标数量、孵化能量阈值、body 调试开关 |
| [`state.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/state.js) | 状态 | tick 内共享瞬态状态（短缺标记、缓存名单、矿点数据） |
| [`body.config.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/body.config.js) | 配置 | 按角色与能量阶段生成差异化 body 部件组合 |
| [`cache.creep.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/cache.creep.js) | 缓存 | Creep 名字缓存：`build/add/remove/count` |
| [`cache.sources.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/cache.sources.js) | 缓存 | 矿点缓存：距离排序、空闲格检测、满位顺延采集 |
| [`manager.spawn.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/manager.spawn.js) | 管理器 | 按优先级检测缺口、动态生成 body、执行孵化 |
| [`manager.tower.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/manager.tower.js) | 管理器 | 防御塔：攻击敌人 > 紧急维修普通建筑 > 维修 Wall/Rampart |
| [`task.scheduler.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/task.scheduler.js) | 框架 | 跨角色任务调度：优先级队列、资源锁、死锁检测、让位协调 |
| [`role.harvester.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.harvester.js) | 角色 | 采集 + 短途运输（兼容旧逻辑，目标数=0） |
| [`role.collector.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.collector.js) | 角色 | 纯采集，投放就近 Container 或掉落地上 |
| [`role.transporter.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.transporter.js) | 角色 | 全场搬运：取货 → 送货状态机，带资源锁与让位 |
| [`role.upgrader.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.upgrader.js) | 角色 | 升级控制器；短缺时远离 Spawn 暂停 |
| [`role.builder.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.builder.js) | 角色 | 建造工地，无工地时升级；短缺时暂停 |
| [`role.repairer.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.repairer.js) | 角色 | 修理受损建筑，无目标时升级 |
| `Screeps_API_参考.md` | 文档 | Screeps API 与常量参考 |
| `Screeps_游玩攻略.md` | 文档 | 游戏玩法参考 |
| `.trae/documents/` | 计划 | 历史开发计划文档（collector 优化、tower 重构等） |

---

## 4. 模块详解

### 4.1 入口与主循环（main.js）

[`main.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/main.js) 是 Screeps 引擎每 tick 调用的入口，导出 `loop` 函数。

#### `module.exports.loop()`

执行顺序（每 tick）：

1. **重置瞬态缓存**：`state.sourceSlotFree = {}`（矿点空位检测每 tick 重算）。
2. **首 tick 初始化**（`!state._cacheReady`）：
   - `creepCache.build()` 全量构建 Creep 名字缓存。
   - 遍历 `Spawn1` 房间内所有 source，初始化 `state.sourceIds` 与 `state.sourceData`（坐标缓存，房间固定只初始化一次）。
3. **防御塔**：`managerTower.run()`。
4. **清理死亡 Creep 内存 + 同步缓存**：遍历 `Memory.creeps`，对已不存在的 creep 调用 `creepCache.remove(name)` 并 `delete Memory.creeps[name]`。
5. **检测角色短缺**：`state.creepShortage = managerSpawn.checkShortage()`。
6. **角色调度**：遍历 `state.allNames` 缓存名单，按 `creep.memory.role` 分派到对应 role 模块的 `run(creep)`。
7. **自动孵化**：`managerSpawn.run('Spawn1')`。

> 调度循环使用缓存名单而非 `for...in Game.creeps`，避免每 tick 全量扫描。

---

### 4.2 全局配置（config.js）

[`config.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/config.js) 集中管理全局可调参数。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `roleTargets` | `Object` | 各角色目标数量。默认：harvester=0, collector=6, transporter=5, upgrader=6, builder=5, repairer=1 |
| `spawnEnergyThreshold` | `number` | 孵化能量门槛，低于此值不孵化（默认 200） |
| `bodyConfig.debug` | `boolean` | 是否打印 body 部件生成日志（默认 false） |
| `bodyConfig.forceDefault` | `boolean` | 强制使用默认 1:1:1 配比（调试用） |
| `bodyConfig.forceTier` | `number|null` | 强制使用指定能量阶段（null=自动） |

> 当前配置已将 harvester 目标数设为 0，主力采集改为 collector + transporter 分工模式。

---

### 4.3 共享状态（state.js）

[`state.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/state.js) 是一个单例对象，用于在模块之间传递 **tick 内瞬态信息**，**不读写 `Memory`**。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `creepShortage` | `boolean` | 当前是否有角色短缺（builder/upgrader 据此暂停） |
| `spawningRole` | `string|null` | 当前正在孵化的角色 |
| `allNames` | `string[]` | 所有存活 creep 名字列表（调度循环用） |
| `byRole` | `Object<string,string[]>` | 按角色分组的名字列表（快速计数） |
| `_cacheReady` | `boolean` | 缓存是否已初始化 |
| `sourceIds` | `string[]` | 所有矿点 ID（首 tick 初始化） |
| `sourceData` | `Object<string,{x,y,roomName}>` | 矿点坐标缓存 |
| `sourceSlotFree` | `Object<string,boolean>` | 每 tick 矿点是否有空位（瞬态） |
| `sourceSlotCount` | `Object<string,number>` | 每 tick 矿点空闲格数量 |
| `sourceSpawnDist` | `Object<string,number>` | 矿点到 Spawn 的 Chebyshev 距离缓存 |

---

### 4.4 缓存层

#### cache.creep.js

[`cache.creep.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/cache.creep.js) 维护 Creep 名字缓存，避免每 tick 多次 `_.filter(Game.creeps)`。仅在「初始化 / 孵化 / 死亡」三个节点刷新。

| 方法 | 说明 |
| --- | --- |
| `build()` | 从 `Game.creeps` 全量构建缓存（首 tick 或全局重置时调用） |
| `add(name)` | 添加一只 creep 到缓存（孵化成功后调用） |
| `remove(name)` | 从缓存移除一只死亡 creep |
| `count(role)` | 获取某角色当前数量，O(1) 读缓存 |

#### cache.sources.js

[`cache.sources.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/cache.sources.js) 维护矿点缓存，矿点坐标房间固定，首 tick 初始化后直接读缓存。

| 方法 | 说明 |
| --- | --- |
| `getSorted(creep)` | 按 Chebyshev 距离排序矿点（最近优先），返回 `[{id, dist}]` |
| `hasFreeSlot(source)` | 矿点周围是否还有空闲可站立格（每 tick 缓存） |
| `getFreeSlotCount(source)` | 获取矿点周围空闲格数量（0-8），用 `lookAtArea` 检测墙/creep/墙结构 |
| `getSpawnDistance(source)` | 获取矿点到 Spawn 的距离（缓存） |
| `getSourcesBySpawnDistance(room)` | 返回按到 Spawn 距离排序的矿点列表（近→远） |
| `harvestNearest(creep)` | 尝试采集最近可用矿点，满位时自动顺延到下一矿点；所有矿点不可用时兜底走向最近矿点 |

---

### 4.5 孵化管理器（manager.spawn.js）

[`manager.spawn.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/manager.spawn.js) 负责根据各角色数量缺口自动孵化 Creep。

#### `run(spawnName)`

1. 若孵化器正在忙则跳过。
2. 调用 `_canWaitForHighEnergy` 判断是否可等待高能量孵化（基础劳动力充足 + 有搬运者 + Container 有能量时，等待能量达到 `capacity * 0.8` 再孵化更高级 creep）。
3. 按优先级队列检查各角色缺口（顺序：harvester → collector → transporter → upgrader → builder → repairer）。
4. 某角色 `current < need` 且 `energy >= spawnEnergyThreshold` 时：
   - 生成名字：`角色首字母大写 + Game.time`。
   - 调用 `getBody(energy, role)` 生成 body。
   - `spawnCreep` 孵化，成功后 `creepCache.add(name)` 同步缓存。
   - **一次只孵一个**。

#### `checkShortage()`

遍历 `config.roleTargets`，任一角色 `count(role) < targets[role]` 返回 `true`。

#### `_canWaitForHighEnergy(spawn, targets)`

满足以下全部条件才允许等待高能量：
- collector + transporter 总数 ≥ 目标一半；
- transporter 数量 > 0；
- 房间内 Container 有能量。

#### `getBody(energy, role)`

委托给 [`body.config.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/body.config.js) 的 `getBody`。

---

### 4.6 防御塔管理器（manager.tower.js）

[`manager.tower.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/manager.tower.js) 遍历房间内所有 Tower，按优先级执行动作。

**优先级：** `攻击敌人 > 紧急维修普通建筑 > 维修防御建筑`

#### 常量

| 常量 | 值 | 说明 |
| --- | --- | --- |
| `NORMAL_REPAIR_THRESHOLD` | 0.8 | 普通建筑血量低于满血 80% 才修 |
| `DEFENSE_HITS_TARGET` | 50000 | Wall/Rampart 维修血量上限 |
| `TOWER_MIN_ENERGY_RATIO` | 0.5 | Tower 能量低于 50% 时不维修，保留防御 |
| `DEBUG` | true | 调试日志开关 |

#### `run()` / `_runTower(tower)`

1. `findClosestByRange(FIND_HOSTILE_CREEPS)` 攻击最近敌人（无视能量）。
2. 能量比例 < 0.5 时跳过维修。
3. `findClosestByRange` 找血量 < 80% 满血的普通建筑（排除 Wall/Rampart）维修。
4. 空闲时找血量 < 50000 的 Wall/Rampart 维修。

---

### 4.7 任务调度器（task.scheduler.js）

[`task.scheduler.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/task.scheduler.js) 是跨角色的统一任务调度框架，状态持久化在 `Memory.tasks`。

#### 设计原则

1. 一个任务同一时刻只分配给一个 creep。
2. 资源节点分配采用「先占先得」。
3. 任务有超时机制，超时自动回收。
4. 所有状态持久化在 `Memory.tasks`。

#### 常量

| 常量 | 说明 |
| --- | --- |
| `TASK_TYPES` | TRANSPORT / COLLECT / BUILD / REPAIR / UPGRADE |
| `STATUS` | PENDING / ASSIGNED / IN_PROGRESS / COMPLETED / FAILED / TIMED_OUT |
| `PRIORITY` | CRITICAL(0) / HIGH(1) / NORMAL(2) / LOW(3) |
| `TASK_TIMEOUT` | 300 ticks |
| `TASK_RETENTION` | 100 ticks（已完成任务保留时长） |
| `MAX_ACTIVE_TASKS` | 50 |
| `YIELD_TICKS` | 5（让位持续 tick 数） |
| `YIELD_DISTANCE` | 3（让位目标距 source 的最小距离） |
| `YIELDABLE_ROLES` | `['transporter','upgrader','builder','repairer']`（可被驱离的非采集者） |

#### 核心 API

| 方法 | 说明 |
| --- | --- |
| `init()` | 确保 `Memory.tasks` 结构存在并执行 GC |
| `createTask(type, priority, sourceId, targetId, resourceType, amount, maxRetries)` | 创建任务，含去重与容量检查，返回 taskId |
| `getNextTask(creep)` | 获取当前 creep 的下一个最优任务（按优先级，跳过已分配/锁冲突） |
| `assignTask(taskId, creepName)` | 分配任务给 creep，锁住 source |
| `updateTask(taskId, status, progressCurrent, progressTotal, error)` | 更新任务进度 |
| `completeTask(taskId)` | 完成任务，释放锁，归档，更新统计 |
| `failTask(taskId, error)` | 标记失败，未超重试次数则重置为 PENDING |
| `checkTimeouts()` | 回收超时任务 |
| `checkDeadlocks()` | 死锁检测（死 creep 持锁、停滞任务） |
| `releaseCreep(creepName)` | 释放 creep 持有的所有任务 |
| `requestYield(requester, source)` | 请求 source 附近 creep 让位（优先驱离非采集者） |
| `checkYield(creep)` | 检查 creep 是否处于让位状态，是则执行让位移动并返回 true |

#### 让位协调机制

当 collector 无法到达 source（连续失败）时，调用 `requestYield`：
1. 优先驱离 source 周围 1 格内的非采集者（transporter/upgrader/builder/repairer）。
2. 其次调整其他 collector 的站位。
3. 在 source 外圈 `YIELD_DISTANCE` 格外找空地作为让位目标。
4. 被请求让位的 creep 在 `run()` 入口调用 `checkYield`，若处于让位期则移动到让位目标并跳过本 tick 正常逻辑。

---

### 4.8 身体部件配置（body.config.js）

[`body.config.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/body.config.js) 为不同角色提供差异化的部件生成策略。

#### 能量阶段（ENERGY_TIERS）

| 阶段 | 能量范围 | 名称 |
| --- | --- | --- |
| SURVIVAL | 200-300 | 生存期（新房间启动） |
| DEVELOPING | 300-550 | 发展期（RCL 2-3） |
| GROWING | 550-800 | 成长期（RCL 4-5） |
| MATURE | 800-1300 | 成熟期（RCL 6-7） |
| PROSPERING | 1300-3000 | 繁荣期（RCL 8） |

#### 角色配比策略

| 角色 | 配比策略 | 设计理由 |
| --- | --- | --- |
| harvester | WORK:CARRY:MOVE = 2:1:2 | 平衡采集与移动，矿点-Spawn 高频往返 |
| collector | 最大化 WORK + 1 CARRY + 1 MOVE | 固定矿点工作，移动需求极低 |
| transporter | CARRY:MOVE = 1:1 | 满载无疲劳，运输效率核心 |
| upgrader | WORK:CARRY:MOVE = 2:1:2 | 固定控制器附近，类似 harvester |
| builder | WORK 主导 + 足够 MOVE | 多工地间移动 |
| repairer | WORK + 1 CARRY + N MOVE | 中等移动频率 |

#### 主接口

```js
bodyConfig.getBody(energy, role)  // 根据角色和能量返回 body 数组
bodyConfig.calculateCost(body)    // 计算 body 总成本
bodyConfig.getEnergyTier(energy)  // 获取能量阶段
```

**安全保证：** `getBody` 生成后会用 `calculateCost` 校验，成本超过可用能量时回退到默认 1:1:1 配比。

> 模块还预留了战斗角色（GUARD/RANGER/HEALER/CLAIMER）的 body 模板常量 `COMBAT_BODY_TEMPLATES`，当前未启用。

---

### 4.9 角色模块

所有角色模块导出 `{ run(creep) }`，由 `main.js` 按 `creep.memory.role` 分派调用。

#### role.harvester.js（采集+运输）

[`role.harvester.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.harvester.js) — 兼容旧逻辑，当前目标数=0。

- **状态机**：`harvesting` (能量空) ↔ `transporting` (能量满)。
- **采集**：`sourceCache.harvestNearest(creep)`（带满位顺延）。
- **运输**：优先补 Spawn/Extension/Tower，其次 Container。

#### role.collector.js（纯采集）

[`role.collector.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.collector.js) — 纯采集，不负责长途运输。

**状态机**：`idle → harvesting → dropping → idle`

**核心特性：**

1. **源分配与并发控制**：每 source 最多 `MAX_COLLECTORS_PER_SOURCE = 3` 个采集者，按 Spawn 距离近→远优先占用。
2. **纯采集投放**：能量满后投放到 `DROP_MAX_DISTANCE = 3` 范围内的 Container，无 Container 则 `drop` 在地上（drop mining），由 transporter 后续搬运。
3. **指数退避重试**：harvest 失败时按 `5 * 2^(retryCount-1)` 退避，上限 100 ticks。
4. **健康检查与自恢复**：`STUCK_THRESHOLD = 50` ticks 无移动视为卡住，进入 20 ticks 恢复模式，重置所有状态并释放任务锁。
5. **Room.find 缓存**：sources/containers 缓存 `CACHE_TTL = 20` ticks。
6. **结构化日志**：`LOG_LEVEL` 分级（DEBUG/INFO/WARN/ERROR），当前 `INFO` 级。
7. **让位协调**：`run()` 入口调用 `taskScheduler.checkYield(creep)`，被请求让位时优先执行。
8. **连续失败切换 source**：`MAX_SOURCE_FAIL_COUNT = 3` 次无法到达同一 source 时，先 `requestYield`，无让位者则换 source 并冷却 100 ticks。

**关键方法：**

| 方法 | 说明 |
| --- | --- |
| `_doHarvest(creep, logCtx)` | 采集逻辑：距离检查 → 移动 → harvest，处理失败计数与让位 |
| `_doDrop(creep, logCtx)` | 投放逻辑：找范围内 Container → transfer，满了/无则 drop |
| `_getAssignedSource(creep)` | 源分配：保持绑定 → 满载则换近矿 → 兜底最近未冷却矿 |
| `_countCollectorsAtSource(sourceId)` | 统计某 source 当前 collector 数（含 harvester 兼容） |
| `_healthCheck(creep, logCtx)` | 卡住检测，进入恢复模式 |
| `_updateHealth(creep)` | 记录进展，重置退避计数 |
| `_handleHarvestError(creep, errorCode, logCtx)` | 指数退避重试 |

#### role.transporter.js（搬运）

[`role.transporter.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.transporter.js) — 全场搬运，从采集节点到消费节点。

**状态机**（两阶段）：

```
empty 阶段: GET_TASK → MOVING_TO_PICKUP → PICKING_UP
carry 阶段: DELIVERING → MOVING_TO_DELIVER → (executeDelivery) → COMPLETE
```

**取货优先级**：地面掉落资源 > Tombstone/Ruin > Container（≥500 不加锁） > Storage（≥500）

**送货优先级**（`DELIVERY_PRIORITY`）：extension(1) > spawn(2) > tower(3) > storage(4) > container(5)
- Spawn 能量 < 200 时提升到优先级 0（最高）。
- Tower 能量 < 500 时提升到 2.5。
- 同优先级内按剩余容量降序（最空的优先）。

**关键特性：**

1. **资源锁管理**（`Memory._transporterLocks`）：防止多 transporter 抢同一目标。取货锁单锁，送货锁支持最多 3 个搬运者同时锁定。锁有 30 ticks 超时自动释放。
2. **让位检查**：`run()` 入口 `taskScheduler.checkYield`。
3. **健康检查**：停滞 > 50 ticks 强制重置状态，释放所有锁。
4. **移动错误处理**：连续 5 次移动失败放弃目标；取货/送货错误 3 次放弃。
5. **抖动修复**：未满容量不切送货阶段，避免 Container↔Spawn 往返抖动；无送货目标时保持 carry 阶段不切 empty。
6. **站在阻挡结构上移开**：`_moveAwayFromTarget` 手动计算相邻格，避免 `creep.pos.getAdjacentPosition` 不存在的问题。
7. **Room.find 缓存**：`CACHE_TTL = 5` ticks（dropped/tombstones/structures）。

**关键方法：**

| 方法 | 说明 |
| --- | --- |
| `_doPickup` / `_moveToPickup` / `_executePickup` | 取货三阶段 |
| `_doDelivery` / `_moveToDeliver` / `_executeDelivery` | 送货三阶段 |
| `_findBestPickup(creep)` | 按优先级找最优取货点 |
| `_findBestDelivery(creep)` | 按优先级找最优送货目标 |
| `_isPickupLocked` / `_lockPickup` / `_releasePickupLock` | 取货锁管理 |
| `_isDeliverLocked` / `_lockDeliver` / `_releaseDeliverLock` | 送货锁管理（多锁） |
| `_releaseAllLocks(creepName)` | 释放 creep 持有的所有锁 |
| `_moveAwayFromTarget(creep, target)` | 从目标位置移开一格 |
| `_healthCheck(creep, logCtx)` | 停滞检测与强制重置 |

#### role.upgrader.js（升级）

[`role.upgrader.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.upgrader.js) — 升级控制器。

- **状态机**：`upgrading` (能量满) ↔ 装能量 (能量空)。
- **短缺暂停**：`state.creepShortage` 为 true 时调用 `_moveAwayFromSpawn` 远离 Spawn（避免挡搬运者）。
- **装能量**：优先 Container（按距离排序），其次 Spawn/Extension，最后 `sourceCache.harvestNearest` 直接采矿。
- **让位检查**：`run()` 入口 `taskScheduler.checkYield`。

#### role.builder.js（建造）

[`role.builder.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.builder.js) — 建造工地。

- **状态机**：`building` (能量满) ↔ 采集 (能量 < 5)。
- **建造**：找 `FIND_CONSTRUCTION_SITES`，无工地时升级控制器。
- **短缺暂停**：`state.creepShortage` 为 true 时 `_moveAwayFromSpawn`。
- **采集**：Container → Spawn/Extension → 直接采矿（同 upgrader）。
- **让位检查**：`run()` 入口 `taskScheduler.checkYield`。

#### role.repairer.js（修理）

[`role.repairer.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/role.repairer.js) — 修理受损建筑。

- **状态机**：`repairing` (能量满) ↔ 采集 (能量空)。
- **修理优先级**（`_findRepairTarget`）：
  1. 血量 < `DEFENSE_HITS_MIN = 10000` 的 Wall/Rampart（紧急）。
  2. 普通建筑按血量升序。
  3. 血量 < `DEFENSE_HITS_TARGET = 50000` 的 Wall/Rampart（按血量升序）。
- **无目标时**：升级控制器。
- **采集**：Container → Spawn/Extension → 直接采矿。
- **让位检查**：`run()` 入口 `taskScheduler.checkYield`。

---

## 5. 依赖关系

### 5.1 模块依赖图

```
main.js
├── role.harvester   → cache.sources
├── role.collector   → task.scheduler, cache.sources
├── role.transporter → task.scheduler
├── role.upgrader    → state, cache.sources, task.scheduler
├── role.builder     → state, cache.sources, task.scheduler
├── role.repairer    → cache.sources, task.scheduler
├── manager.spawn    → config, cache.creep, body.config
├── manager.tower    → (无内部依赖，仅用 Screeps 全局 _)
├── state            → (无依赖)
└── cache.creep      → state

body.config          → config
cache.sources        → state
task.scheduler       → (无内部依赖，操作 Memory.tasks)
```

### 5.2 依赖说明

- **state.js** 是最底层共享状态，被 `cache.creep`、`cache.sources`、`main.js`、`role.upgrader`、`role.builder` 依赖。
- **task.scheduler.js** 自包含（仅操作 `Memory.tasks`），被 collector/transporter/upgrader/builder/repairer 依赖（主要用于让位协调 `checkYield`，transporter 还使用任务队列）。
- **cache.sources.js** 依赖 state，被 harvester/collector/upgrader/builder/repairer 依赖。
- **body.config.js** 依赖 config，仅被 `manager.spawn` 调用。
- **manager.tower.js** 完全独立，仅使用 Screeps 全局 `_`。

### 5.3 角色间协作关系

```
collector ──投放能量──→ Container / 地面掉落
                            │
                      transporter 取货
                            │
                            ▼
            Spawn / Extension / Tower / Storage
                            │
            upgrader / builder / repairer 取能量
                            │
                            ▼
                    升级 / 建造 / 修理
```

- **collector** 纯采集，产出能量到 Container 或地面。
- **transporter** 全场搬运，连接采集端与消费端。
- **upgrader/builder/repairer** 从 Container/Spawn/Extension 取能量工作，能量枯竭时可回退直接采矿。
- **harvester** 是兼容旧逻辑的采集+短途运输一体角色，当前目标数=0。
- **让位协调**：collector 优先级最高，可请求 transporter/upgrader/builder/repairer 让位。

---

## 6. 关键流程

### 6.1 每 tick 主循环

```
loop()
  │
  ├─ 重置 state.sourceSlotFree
  ├─ [首tick] creepCache.build() + 初始化矿点缓存
  ├─ managerTower.run()
  ├─ 清理死亡 creep 内存 + creepCache.remove
  ├─ state.creepShortage = managerSpawn.checkShortage()
  ├─ 遍历 state.allNames → 按 role 分派 run(creep)
  └─ managerSpawn.run('Spawn1')
```

### 6.2 孵化决策流程

```
managerSpawn.run('Spawn1')
  │
  ├─ spawn.spawning? → 跳过
  ├─ _canWaitForHighEnergy? → 等待 energy ≥ capacity*0.8
  ├─ 按优先级遍历角色队列
  │   └─ count(role) < need && energy ≥ threshold?
  │       ├─ 生成 name + body
  │       ├─ spawn.spawnCreep(body, name, {memory:{role}})
  │       └─ 成功 → creepCache.add(name)
  └─ 一次只孵一个
```

### 6.3 Transporter 状态机

```
            ┌──────────────────────────────────────────┐
            ▼                                          │
       GET_TASK ──→ MOVING_TO_PICKUP ──→ PICKING_UP   │
            │                                      │   │
            │           (满容量)                    │   │
            └──────────────────────────────────────┘   │
                                                       │
            ┌──────────────────────────────────────┐   │
            ▼                                      │   │
       DELIVERING ──→ MOVING_TO_DELIVER ──→ executeDelivery
            │                                      │   │
            │           (能量送完)                  │   │
            └──────────────────────────────────────┘   │
                                                       │
                   (回到 GET_TASK) ─────────────────────┘
```

### 6.4 让位协调流程

```
collector 连续 3 次无法到达 source
  │
  ├─ taskScheduler.requestYield(creep, source)
  │   ├─ 找 source 附近 1 格内的非采集者 → 标记 _yieldUntil
  │   └─ 或找其他 collector 调整站位
  │
  └─ 被请求者下一 tick run() 入口:
      └─ taskScheduler.checkYield(creep)
          ├─ 在让位期 → 移动到让位目标 → return true (跳过正常逻辑)
          └─ 过期 → 清理标记 → return false
```

---

## 7. 项目运行方式

### 7.1 运行环境

- **游戏平台**：[Screeps](https://screeps.com/)（编程 MMO）
- **语言**：JavaScript（Screeps 运行时，Node.js 沙箱）
- **入口**：`main.js` 导出 `module.exports.loop`，由游戏引擎每 tick 调用
- **无构建步骤**：无需 npm/webpack，文件即模块

### 7.2 部署方式

仓库根目录即 Screeps 脚本目录，两种方式：

1. **本地同步（推荐）**：本仓库已位于 Screeps 客户端脚本目录（`c:\Users\45221\AppData\Local\Screeps\scripts\screeps.com\default`），客户端会自动同步到游戏服务器。
2. **手动上传**：在 Screeps 官网/客户端的脚本编辑器（Scripts 标签）中，将本目录所有 `.js` 文件作为多模块上传，入口为 `main.js`。

### 7.3 启动流程

部署后 bot 在下一个 tick 自动启动：

1. **首 tick**：`state._cacheReady` 为 false → 全量构建 Creep 缓存 + 初始化矿点坐标缓存。
2. **后续 tick**：进入「防御塔 → 清理死亡 creep → 检测短缺 → 角色调度 → 自动孵化」循环。
3. **自动达稳态**：当各角色数量达到 `config.roleTargets` 目标后，孵化器停止孵化，房间进入自维持运转。

### 7.4 调试

- **body 部件日志**：`config.bodyConfig.debug = true` 打印每次孵化的部件组合与成本。
- **角色日志**：collector/transporter 内置 `LOG_LEVEL` 分级日志，调整 `CURRENT_LOG_LEVEL` 控制输出。
- **Tower 日志**：`manager.tower.js` 中 `DEBUG = true` 打印维修/跳过日志。
- **任务调度日志**：`task.scheduler.js` 的 `_log` 打印任务分配/完成/失败/让位日志。

### 7.5 配置调优

修改 [`config.js`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/config.js) 的 `roleTargets` 调整角色数量：

- 调大 `collector` 提升能量采集吞吐；
- 调大 `transporter` 提升搬运效率；
- 调大 `upgrader`/`builder` 加快升级/扩张（占用孵化名额）；
- `spawnEnergyThreshold` 不应低于 200（一个最小 body 单元成本）。

> 注意：孵化器名称硬编码为 `Spawn1`，房间名通过 `Game.spawns['Spawn1'].room` 获取。多孵化器/多房间需相应改造。

---

## 8. 设计要点与已知机制

### 8.1 性能优化

1. **Creep 名字缓存**：避免每 tick 多次 `_.filter(Game.creeps)`，O(1) 计数。
2. **矿点坐标缓存**：房间固定，首 tick 初始化后直接读缓存。
3. **Room.find 缓存**：collector（TTL=20）、transporter（TTL=5）按需缓存。
4. **路径复用**：`moveTo` 使用 `reusePath`（collector=10, transporter=20）。
5. **瞬态状态分离**：`state.js` 不写 `Memory`，减少序列化开销。

### 8.2 死锁/抖动修复

1. **残余能量死锁**：builder/upgrader/repairer 能量低于动作阈值时立即切回采集。
2. **矿点满位顺延**：`harvestNearest` 检测矿点饱和自动顺延下一矿点。
3. **Container↔Spawn 往返抖动**：transporter 未满容量不切送货阶段；无送货目标时保持 carry 阶段。
4. **站在阻挡结构上抖动**：road/rampart 不算阻挡，避免「移开→走回→移开」循环。
5. **采集者卡住自恢复**：50 ticks 无移动进入恢复模式，重置状态与锁。
6. **transporter 停滞重置**：50 ticks 无移动强制重置所有状态与锁。
7. **资源锁超时**：30 ticks 自动释放，防止死 creep 持锁。

### 8.3 短缺优先机制

`state.creepShortage` 为 true 时：
- builder/upgrader 立即暂停工作并 `_moveAwayFromSpawn`（远离 Spawn 避免挡搬运者）。
- 把能量与 Spawn 槽位让给孵化，保证房间规模能恢复。

### 8.4 让位协调

collector 优先级最高（纯采集是能量链路源头），连续无法到达 source 时可请求 transporter/upgrader/builder/repairer 让位，确保采集链路畅通。

### 8.5 战斗角色预留

`body.config.js` 预留了 `COMBAT_ROLES`（GUARD/RANGER/HEALER/CLAIMER）与 `COMBAT_BODY_TEMPLATES`，当前未启用，为后续 PvP/扩张功能预留接口。

---

## 附录：Screeps API 速查

| 类别 | 常用 API |
| --- | --- |
| 全局对象 | `Game`（creeps/spawns/structures/time）、`Memory`（持久化）、`console` |
| Creep | `creep.harvest(source)`、`creep.transfer(target, resource)`、`creep.withdraw(structure, resource)`、`creep.build(site)`、`creep.repair(structure)`、`creep.upgradeController(controller)`、`creep.move(dir)`、`creep.moveTo(target)`、`creep.pickup(resource)`、`creep.drop(resource)` |
| Structure | `structure.store[RESOURCE_ENERGY]`、`structure.store.getFreeCapacity(resource)`、`structure.store.getCapacity(resource)` |
| Room | `room.find(FIND_SOURCES)`、`room.find(FIND_STRUCTURES)`、`room.find(FIND_CONSTRUCTION_SITES)`、`room.find(FIND_DROPPED_RESOURCES)`、`room.find(FIND_TOMBSTONES)`、`room.find(FIND_HOSTILE_CREEPS)`、`room.lookAtArea`、`room.getTerrain().get(x,y)` |
| Spawn | `spawn.spawnCreep(body, name, opts)`、`spawn.spawning`、`spawn.room.energyAvailable`、`spawn.room.energyCapacityAvailable` |
| Tower | `tower.attack(creep)`、`tower.repair(structure)`、`tower.store[RESOURCE_ENERGY]` |
| 常量 | `OK`、`ERR_NOT_IN_RANGE`、`ERR_NOT_ENOUGH_RESOURCES`、`ERR_FULL`、`ERR_NO_PATH`、`RESOURCE_ENERGY`、`STRUCTURE_SPAWN`、`STRUCTURE_EXTENSION`、`STRUCTURE_TOWER`、`STRUCTURE_CONTAINER`、`STRUCTURE_STORAGE`、`STRUCTURE_WALL`、`STRUCTURE_RAMPART`、`STRUCTURE_ROAD`、`FIND_SOURCES`、`FIND_STRUCTURES`、`FIND_CONSTRUCTION_SITES`、`FIND_DROPPED_RESOURCES`、`FIND_TOMBSTONES`、`FIND_HOSTILE_CREEPS`、`WORK/CARRY/MOVE/ATTACK/RANGED_ATTACK/HEAL/TOUGH/CLAIM`、`TOP/TOP_RIGHT/RIGHT/...` |

> 完整 API 参考见 [`Screeps_API_参考.md`](file:///c:/Users/45221/AppData/Local/Screeps/scripts/screeps.com/default/Screeps_API_参考.md)，官方文档 <https://docs.screeps.com/api/>。

---

*文档生成时间：2026-07-24 · 基于仓库当前代码状态*
