# Screeps 代码参考（面向 AI / 开发者）

> 本文件整理自官方文档 https://docs.screeps.com/api/ 与官方 `constants.js` 源码，旨在作为**编写 Screeps bot 的完整 API 参考**。
> 所有对象、方法、属性、常量均按官方定义逐条提取；方法描述保留官方英文（最准确，AI 可直接理解），并配以中文分组、速查表与实战模式。

---

## 1. Screeps 是什么 / 运行模型

Screeps 是一款「编程即玩法」的 MMO RTS：你用 **JavaScript（或编译到 JS 的 TS/Wasm）** 编写一段在服务器端每 tick（约每秒 1 次）执行的脚本，控制你的 creeps（小兵）和结构。

- **Tick**：游戏的基本时间单位。`Game.time` 每 tick +1。你的 `main.js` 导出的 `loop()` 每 tick 被调用一次。
- **全局对象 `Game`**：每个 tick 开始时由引擎注入，包含本 tick 可见的一切（`Game.creeps`、`Game.spawns`、`Game.rooms`、`Game.structures` 等）。
- **`Memory`**：跨 tick 持久化的 JSON 对象（自动序列化）。把需要长期保存的状态放进 `Memory.creeps[name]`、`Memory.rooms[roomName]` 等。
- **`RawMemory`**：更底层的字符串内存（含 segments），用于大型/结构化数据或跨 shard。
- **CPU 预算**：每 tick 有 `Game.cpu.limit` 的计算预算；用不完的会累积到 `Game.cpu.bucket`。`Game.cpu.getUsed()` 查看本 tick 已用 CPU。**优化 CPU 是写 bot 的核心**。
- **GCL / RCL**：Global Control Level 决定你能同时控制的房间数；每个房间的 RCL（Room Control Level）决定可建造的结构与数量（见 `CONTROLLER_STRUCTURES`）。

### 最小可运行脚本

```js
module.exports.loop = function () {
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        if (creep.store.getFreeCapacity() > 0) {
            const source = creep.pos.findClosestByPath(FIND_SOURCES);
            if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                creep.moveTo(source);
            }
        } else {
            const spawn = Game.spawns['Spawn1'];
            if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(spawn);
            }
        }
    }
};
```

---

## 2. 全局对象速览（每 tick 都可用）

| 全局 | 说明 |
|------|------|
| `Game.creeps` | `object<string, Creep>`：你所有的 creep（键=名字） |
| `Game.spawns` | `object<string, StructureSpawn>`：所有孵化器 |
| `Game.rooms` | `object<string, Room>`：你可见的房间 |
| `Game.structures` | `object<string, Structure>`：你所有的结构 |
| `Game.constructionSites` | `object<string, ConstructionSite>`：建筑工地 |
| `Game.flags` | `object<string, Flag>`：旗帜 |
| `Game.time` | `number`：当前 tick |
| `Game.cpu` | CPU 预算对象（`limit`/`bucket`/`getUsed()`） |
| `Game.map` | 世界地图导航（`findPath`/`findRoute`/`getRoomTerrain` 等） |
| `Game.market` | 跨玩家市场（买卖、订单、交易费用） |
| `Game.gcl` / `Game.gpl` | 全局控制等级 / 全局能量等级 |
| `Game.shard` | 当前 shard 信息 |
| `Memory` / `RawMemory` | 持久化内存 |
| `PathFinder` | 高级寻路引擎（`search()` + `CostMatrix`） |
| `InterShardMemory` | 跨 shard 内存 |
| `console` | `console.log()` / `console.error()`（每 tick 最多约 20 条） |

**常用辅助：**
- `Game.getObjectById(id)`：用 id 取任意可见对象（creep、结构、资源…）。
- `Game.notify(message, [groupInterval])`：向账号邮箱发通知（每 tick 最多 20 条）。

---

## 3. 错误码（所有动作方法返回 `number`）

动作方法统一返回 `OK (0)` 或负向错误码。务必 `if (creep.harvest(source) === ERR_NOT_IN_RANGE) creep.moveTo(source);` 这类写法。

| 常量 | 值 | 含义 |
|------|----|------|
| `OK` | 0 | 成功 |
| `ERR_NOT_OWNER` | -1 | 不是你的对象 |
| `ERR_NO_PATH` | -2 | 找不到路径 |
| `ERR_NAME_EXISTS` | -3 | 名字已存在 |
| `ERR_BUSY` | -4 | 对象正忙 |
| `ERR_NOT_FOUND` | -5 | 未找到 |
| `ERR_NOT_ENOUGH_ENERGY` | -6 | 能量不足 |
| `ERR_NOT_ENOUGH_RESOURCES` | -6 | 资源不足 |
| `ERR_INVALID_TARGET` | -7 | 目标非法 |
| `ERR_FULL` | -8 | 目标已满 |
| `ERR_NOT_IN_RANGE` | -9 | 不在范围内（常见，用于触发 `moveTo`） |
| `ERR_INVALID_ARGS` | -10 | 参数非法 |
| `ERR_TIRED` | -11 | 疲劳（move 后 fatigue>0） |
| `ERR_NO_BODYPART` | -12 | 缺少对应身体部件 |
| `ERR_NOT_ENOUGH_EXTENSIONS` | -6 | 扩展不足 |
| `ERR_RCL_NOT_ENOUGH` | -14 | 房间控制等级不足 |
| `ERR_GCL_NOT_ENOUGH` | -15 | 全局控制等级不足 |
| `ERR_ACCESS_DENIED` | -16 | 访问被拒绝 |

---

## 4. 身体部件（Body Parts）与成本

身体由 1–50 个部件组成；`spawnCreep(body, name)` 的总能量 = 各部件成本之和（上限 3000）。

| 部件 | 常量 | 成本 | 作用 |
|------|------|------|------|
| 移动 | `MOVE` | 50 | 移动、降低 fatigue |
| 工作 | `WORK` | 100 | 采集/建造/升级/修理/拆解/强化 |
| 搬运 | `CARRY` | 50 | 携带资源（`store`） |
| 攻击 | `ATTACK` | 80 | 近战 |
| 远程攻击 | `RANGED_ATTACK` | 150 | 远程/群体攻击 |
| 治疗 | `HEAL` | 250 | 治疗 |
| claim | `CLAIM` | 600 | 占领/预留控制器 |
| tough | `TOUGH` | 10 | 减伤（需放在 body 最前） |

> 完整成本表见下文「身体部件成本 (BODYPART_COST)」。

---

## 5. 如何阅读本文档的对象参考

每个对象按以下格式给出：

```
## 对象名
<对象简介（官方英文）>

### 属性 (Properties)
- **`属性名`** → `类型` — 描述

### 方法 (Methods)
- **`methodName(arg1, arg2?)`**  _(CPU: 低)_
  - 描述
  - **参数 (opts 子项 / 详细):**
    - `arg` (`类型`) — 说明
  - **返回码 (返回 number 错误码):**
    | 常量 | 说明 |
    |------|------|
    | `OK` | ... |
```

- **签名中的 `[x]`** 表示可选参数。
- 方法返回类型在官方文档中对「动作方法」省略（统一返回上述错误码 `number`）；取值/查询类方法会标注返回类型。
- **CPU 标注**：`极低 / 低 / 中 / 高 / 动作(返回OK时+0.2)`——动作类方法在返回 `OK` 时额外 +0.2 CPU。
- 标注 `_(继承自 X)_` 的属性/方法来自父类（如 `Structure` 的 `hits`、`pos` 被各子类继承）。

---

## 6. 目录（对象分组）

- **全局对象 (Globals)**：`Game` / `Memory` / `RawMemory` / `PathFinder` / `InterShardMemory` / `Game.cpu` / `Game.map` / `Game.market` / `Game.shard`
- **游戏对象基类 (Base)**：`RoomObject` / `RoomPosition` / `Room` / `Room.Terrain` / `RoomVisual` / `Store` / `Structure` / `OwnedStructure` / `ConstructionSite` / `Flag` / `Resource` / `Tombstone` / `Ruin` / `Source` / `Mineral` / `Deposit` / `Nuke`
- **Creep**：`Creep` / `PowerCreep`
- **建筑 (Structures)**：`StructureSpawn` / `StructureExtension` / `StructureTower` / `StructureContainer` / `StructureStorage` / `StructureTerminal` / `StructureLab` / `StructureLink` / `StructureExtractor` / `StructureFactory` / `StructureNuker` / `StructureObserver` / `StructurePowerSpawn` / `StructureController` / `StructureRampart` / `StructureRoad` / `StructureWall` / `StructurePortal` 等
- **寻路 (PathFinder)**：`PathFinder.CostMatrix`
- **常量总表 (Constants)**：错误码 / 方向 / Find / Look / 结构类型 / 资源类型 / 颜色 / 地形掩码 / 身体部件 / 玩法常量 / 反应公式 / 强化配方 / 身体部件成本 / 控制器结构数量

> 下文「API 对象参考」按上述分组展开；完整 53 个对象的全部属性与方法均在其中。



---


## 常量总表 (Constants)

以下数值均来自官方 `constants.js` 源码，可直接在代码中引用（如 `OK`、`ERR_NOT_IN_RANGE`、`FIND_SOURCES`）。

### 错误码 (Error Codes)

| 常量 | 值 |
|------|----|
| `ERR_NOT_OWNER` | -1 |
| `ERR_INVALID_ARGS` | -10 |
| `ERR_TIRED` | -11 |
| `ERR_NO_BODYPART` | -12 |
| `ERR_RCL_NOT_ENOUGH` | -14 |
| `ERR_GCL_NOT_ENOUGH` | -15 |
| `ERR_ACCESS_DENIED` | -16 |
| `ERR_NO_PATH` | -2 |
| `ERR_NAME_EXISTS` | -3 |
| `ERR_BUSY` | -4 |
| `ERR_NOT_FOUND` | -5 |
| `ERR_NOT_ENOUGH_ENERGY` | -6 |
| `ERR_NOT_ENOUGH_RESOURCES` | -6 |
| `ERR_NOT_ENOUGH_EXTENSIONS` | -6 |
| `ERR_INVALID_TARGET` | -7 |
| `ERR_FULL` | -8 |
| `ERR_NOT_IN_RANGE` | -9 |
| `OK` | 0 |

### 方向 (Directions)

| 常量 | 值 |
|------|----|
| `TOP` | 1 |
| `TOP_RIGHT` | 2 |
| `RIGHT` | 3 |
| `BOTTOM_RIGHT` | 4 |
| `BOTTOM` | 5 |
| `BOTTOM_LEFT` | 6 |
| `LEFT` | 7 |
| `TOP_LEFT` | 8 |

### Find 常量

| 常量 | 值 |
|------|----|
| `FIND_EXIT_TOP` | 1 |
| `FIND_EXIT` | 10 |
| `FIND_CREEPS` | 101 |
| `FIND_MY_CREEPS` | 102 |
| `FIND_HOSTILE_CREEPS` | 103 |
| `FIND_SOURCES_ACTIVE` | 104 |
| `FIND_SOURCES` | 105 |
| `FIND_DROPPED_RESOURCES` | 106 |
| `FIND_STRUCTURES` | 107 |
| `FIND_MY_STRUCTURES` | 108 |
| `FIND_HOSTILE_STRUCTURES` | 109 |
| `FIND_FLAGS` | 110 |
| `FIND_CONSTRUCTION_SITES` | 111 |
| `FIND_MY_SPAWNS` | 112 |
| `FIND_HOSTILE_SPAWNS` | 113 |
| `FIND_MY_CONSTRUCTION_SITES` | 114 |
| `FIND_HOSTILE_CONSTRUCTION_SITES` | 115 |
| `FIND_MINERALS` | 116 |
| `FIND_NUKES` | 117 |
| `FIND_TOMBSTONES` | 118 |
| `FIND_POWER_CREEPS` | 119 |
| `FIND_MY_POWER_CREEPS` | 120 |
| `FIND_HOSTILE_POWER_CREEPS` | 121 |
| `FIND_DEPOSITS` | 122 |
| `FIND_RUINS` | 123 |
| `FIND_EXIT_RIGHT` | 3 |
| `FIND_EXIT_BOTTOM` | 5 |
| `FIND_EXIT_LEFT` | 7 |

### Look 常量

| 常量 | 值 |
|------|----|
| `LOOK_CONSTRUCTION_SITES` | constructionSite |
| `LOOK_CREEPS` | creep |
| `LOOK_DEPOSITS` | deposit |
| `LOOK_ENERGY` | energy |
| `LOOK_FLAGS` | flag |
| `LOOK_MINERALS` | mineral |
| `LOOK_NUKES` | nuke |
| `LOOK_POWER_CREEPS` | powerCreep |
| `LOOK_RESOURCES` | resource |
| `LOOK_RUINS` | ruin |
| `LOOK_SOURCES` | source |
| `LOOK_STRUCTURES` | structure |
| `LOOK_TERRAIN` | terrain |
| `LOOK_TOMBSTONES` | tombstone |

### 结构类型 (STRUCTURE_*)

| 常量 | 值 |
|------|----|
| `STRUCTURE_WALL` | constructedWall |
| `STRUCTURE_CONTAINER` | container |
| `STRUCTURE_CONTROLLER` | controller |
| `STRUCTURE_EXTENSION` | extension |
| `STRUCTURE_EXTRACTOR` | extractor |
| `STRUCTURE_FACTORY` | factory |
| `STRUCTURE_INVADER_CORE` | invaderCore |
| `STRUCTURE_KEEPER_LAIR` | keeperLair |
| `STRUCTURE_LAB` | lab |
| `STRUCTURE_LINK` | link |
| `STRUCTURE_NUKER` | nuker |
| `STRUCTURE_OBSERVER` | observer |
| `STRUCTURE_PORTAL` | portal |
| `STRUCTURE_POWER_BANK` | powerBank |
| `STRUCTURE_POWER_SPAWN` | powerSpawn |
| `STRUCTURE_RAMPART` | rampart |
| `STRUCTURE_ROAD` | road |
| `STRUCTURE_SPAWN` | spawn |
| `STRUCTURE_STORAGE` | storage |
| `STRUCTURE_TERMINAL` | terminal |
| `STRUCTURE_TOWER` | tower |

### 资源类型 (RESOURCE_*)

| 常量 | 值 |
|------|----|
| `RESOURCE_GHODIUM` | G |
| `RESOURCE_GHODIUM_HYDRIDE` | GH |
| `RESOURCE_GHODIUM_ACID` | GH2O |
| `RESOURCE_GHODIUM_ALKALIDE` | GHO2 |
| `RESOURCE_GHODIUM_OXIDE` | GO |
| `RESOURCE_HYDROGEN` | H |
| `RESOURCE_KEANIUM` | K |
| `RESOURCE_KEANIUM_HYDRIDE` | KH |
| `RESOURCE_KEANIUM_ACID` | KH2O |
| `RESOURCE_KEANIUM_ALKALIDE` | KHO2 |
| `RESOURCE_KEANIUM_OXIDE` | KO |
| `RESOURCE_LEMERGIUM` | L |
| `RESOURCE_LEMERGIUM_HYDRIDE` | LH |
| `RESOURCE_LEMERGIUM_ACID` | LH2O |
| `RESOURCE_LEMERGIUM_ALKALIDE` | LHO2 |
| `RESOURCE_LEMERGIUM_OXIDE` | LO |
| `RESOURCE_OXYGEN` | O |
| `RESOURCE_HYDROXIDE` | OH |
| `RESOURCE_UTRIUM` | U |
| `RESOURCE_UTRIUM_HYDRIDE` | UH |
| `RESOURCE_UTRIUM_ACID` | UH2O |
| `RESOURCE_UTRIUM_ALKALIDE` | UHO2 |
| `RESOURCE_UTRIUM_LEMERGITE` | UL |
| `RESOURCE_UTRIUM_OXIDE` | UO |
| `RESOURCE_CATALYST` | X |
| `RESOURCE_CATALYZED_GHODIUM_ACID` | XGH2O |
| `RESOURCE_CATALYZED_GHODIUM_ALKALIDE` | XGHO2 |
| `RESOURCE_CATALYZED_KEANIUM_ACID` | XKH2O |
| `RESOURCE_CATALYZED_KEANIUM_ALKALIDE` | XKHO2 |
| `RESOURCE_CATALYZED_LEMERGIUM_ACID` | XLH2O |
| `RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE` | XLHO2 |
| `RESOURCE_CATALYZED_UTRIUM_ACID` | XUH2O |
| `RESOURCE_CATALYZED_UTRIUM_ALKALIDE` | XUHO2 |
| `RESOURCE_CATALYZED_ZYNTHIUM_ACID` | XZH2O |
| `RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE` | XZHO2 |
| `RESOURCE_ZYNTHIUM` | Z |
| `RESOURCE_ZYNTHIUM_HYDRIDE` | ZH |
| `RESOURCE_ZYNTHIUM_ACID` | ZH2O |
| `RESOURCE_ZYNTHIUM_ALKALIDE` | ZHO2 |
| `RESOURCE_ZYNTHIUM_KEANITE` | ZK |
| `RESOURCE_ZYNTHIUM_OXIDE` | ZO |
| `RESOURCE_ALLOY` | alloy |
| `RESOURCE_BATTERY` | battery |
| `RESOURCE_BIOMASS` | biomass |
| `RESOURCE_CELL` | cell |
| `RESOURCE_CIRCUIT` | circuit |
| `RESOURCE_COMPOSITE` | composite |
| `RESOURCE_CONCENTRATE` | concentrate |
| `RESOURCE_CONDENSATE` | condensate |
| `RESOURCE_CRYSTAL` | crystal |
| `RESOURCE_DEVICE` | device |
| `RESOURCE_EMANATION` | emanation |
| `RESOURCE_ENERGY` | energy |
| `RESOURCE_ESSENCE` | essence |
| `RESOURCE_EXTRACT` | extract |
| `RESOURCE_FIXTURES` | fixtures |
| `RESOURCE_FRAME` | frame |
| `RESOURCE_GHODIUM_MELT` | ghodium_melt |
| `RESOURCE_HYDRAULICS` | hydraulics |
| `RESOURCE_KEANIUM_BAR` | keanium_bar |
| `RESOURCE_LEMERGIUM_BAR` | lemergium_bar |
| `RESOURCE_LIQUID` | liquid |
| `RESOURCE_MACHINE` | machine |
| `RESOURCE_METAL` | metal |
| `RESOURCE_MICROCHIP` | microchip |
| `RESOURCE_MIST` | mist |
| `RESOURCE_MUSCLE` | muscle |
| `RESOURCE_OPS` | ops |
| `RESOURCE_ORGANISM` | organism |
| `RESOURCE_ORGANOID` | organoid |
| `RESOURCE_OXIDANT` | oxidant |
| `RESOURCE_PHLEGM` | phlegm |
| `RESOURCE_POWER` | power |
| `RESOURCE_PURIFIER` | purifier |
| `RESOURCE_REDUCTANT` | reductant |
| `RESOURCE_SILICON` | silicon |
| `RESOURCE_SPIRIT` | spirit |
| `RESOURCE_SWITCH` | switch |
| `RESOURCE_TISSUE` | tissue |
| `RESOURCE_TRANSISTOR` | transistor |
| `RESOURCE_TUBE` | tube |
| `RESOURCE_UTRIUM_BAR` | utrium_bar |
| `RESOURCE_WIRE` | wire |
| `RESOURCE_ZYNTHIUM_BAR` | zynthium_bar |

### 颜色 (COLOR_*)

| 常量 | 值 |
|------|----|
| `COLOR_RED` | 1 |
| `COLOR_WHITE` | 10 |
| `COLOR_PURPLE` | 2 |
| `COLOR_BLUE` | 3 |
| `COLOR_CYAN` | 4 |
| `COLOR_GREEN` | 5 |
| `COLOR_YELLOW` | 6 |
| `COLOR_ORANGE` | 7 |
| `COLOR_BROWN` | 8 |
| `COLOR_GREY` | 9 |

### 地形掩码 (TERRAIN_MASK_*)

| 常量 | 值 |
|------|----|
| `TERRAIN_MASK_WALL` | 1 |
| `TERRAIN_MASK_SWAMP` | 2 |
| `TERRAIN_MASK_LAVA` | 4 |

### 身体部件 (Body Parts)

| 常量 | 值 |
|------|----|
| `ATTACK` | attack |
| `CARRY` | carry |
| `CLAIM` | claim |
| `HEAL` | heal |
| `MOVE` | move |
| `RANGED_ATTACK` | ranged_attack |
| `TOUGH` | tough |
| `WORK` | work |

### 其他常量

| 常量 | 值 |
|------|----|
| `LAB_UNBOOST_ENERGY` | 0 |
| `HARVEST_MINERAL_POWER` | 1 |
| `HARVEST_DEPOSIT_POWER` | 1 |
| `UPGRADE_CONTROLLER_POWER` | 1 |
| `RAMPART_HITS` | 1 |
| `WALL_HITS` | 1 |
| `ROAD_WEAROUT` | 1 |
| `LINK_COOLDOWN` | 1 |
| `CONTROLLER_RESERVE` | 1 |
| `DENSITY_LOW` | 1 |
| `EVENT_ATTACK` | 1 |
| `EVENT_ATTACK_TYPE_MELEE` | 1 |
| `EVENT_HEAL_TYPE_MELEE` | 1 |
| `PWR_GENERATE_OPS` | 1 |
| `RANGED_ATTACK_POWER` | 10 |
| `TOWER_ENERGY_COST` | 10 |
| `OBSERVER_RANGE` | 10 |
| `TERMINAL_COOLDOWN` | 10 |
| `NUKE_RANGE` | 10 |
| `EVENT_EXIT` | 10 |
| `PWR_DISRUPT_TOWER` | 10 |
| `REPAIR_POWER` | 100 |
| `RAMPART_DECAY_TIME` | 100 |
| `ROAD_WEAROUT_POWER_CREEP` | 100 |
| `ROAD_DECAY_AMOUNT` | 100 |
| `CONTROLLER_DOWNGRADE_RESTORE` | 100 |
| `POWER_SPAWN_POWER_CAPACITY` | 100 |
| `MAX_CONSTRUCTION_SITES` | 100 |
| `TERMINAL_MIN_SEND` | 100 |
| `CONTAINER_DECAY_TIME` | 100 |
| `ENERGY_DECAY` | 1000 |
| `EXTENSION_HITS` | 1000 |
| `ROAD_DECAY_TIME` | 1000 |
| `LINK_HITS` | 1000 |
| `LINK_HITS_MAX` | 1000 |
| `CONTROLLER_ATTACK_BLOCKED_UPGRADE` | 1000 |
| `SAFE_MODE_COST` | 1000 |
| `TOWER_CAPACITY` | 1000 |
| `NUKER_HITS` | 1000 |
| `FACTORY_HITS` | 1000 |
| `POWER_LEVEL_MULTIPLY` | 1000 |
| `STORAGE_HITS` | 10000 |
| `FLAGS_LIMIT` | 10000 |
| `PIXEL_CPU_COST` | 10000 |
| `NUKER_COOLDOWN` | 100000 |
| `INVADERS_ENERGY_GOAL` | 100000 |
| `INVADER_CORE_HITS` | 100000 |
| `STORAGE_CAPACITY` | 1000000 |
| `GCL_MULTIPLY` | 1000000 |
| `EFFECT_INVULNERABILITY` | 1001 |
| `EFFECT_COLLAPSE_TIMER` | 1002 |
| `EVENT_POWER` | 11 |
| `PWR_DISRUPT_SOURCE` | 11 |
| `HEAL_POWER` | 12 |
| `EVENT_TRANSFER` | 12 |
| `PWR_SHIELD` | 12 |
| `CREEP_PART_MAX_ENERGY` | 125 |
| `PWR_REGEN_SOURCE` | 13 |
| `PWR_REGEN_MINERAL` | 14 |
| `CONTROLLER_MAX_UPGRADE_PER_TICK` | 15 |
| `LAB_UNBOOST_MINERAL` | 15 |
| `PWR_DISRUPT_TERMINAL` | 15 |
| `CONSTRUCTION_COST_ROAD_WALL_RATIO` | 150 |
| `CREEP_LIFE_TIME` | 1500 |
| `SOURCE_ENERGY_NEUTRAL_CAPACITY` | 1500 |
| `PWR_OPERATE_POWER` | 16 |
| `PWR_FORTIFY` | 17 |
| `PWR_OPERATE_CONTROLLER` | 18 |
| `PWR_OPERATE_FACTORY` | 19 |
| `HARVEST_POWER` | 2 |
| `MINERAL_RANDOM_FACTOR` | 2 |
| `DENSITY_MODERATE` | 2 |
| `EVENT_OBJECT_DESTROYED` | 2 |
| `EVENT_ATTACK_TYPE_RANGED` | 2 |
| `EVENT_HEAL_TYPE_RANGED` | 2 |
| `POWER_LEVEL_POW` | 2 |
| `PWR_OPERATE_SPAWN` | 2 |
| `INVADER_CORE_CONTROLLER_POWER` | 2 |
| `TOWER_FALLOFF_RANGE` | 20 |
| `LAB_BOOST_ENERGY` | 20 |
| `CONTROLLER_NUKE_BLOCKED_UPGRADE` | 200 |
| `LAB_ENERGY_CAPACITY` | 2000 |
| `CONTAINER_CAPACITY` | 2000 |
| `SAFE_MODE_DURATION` | 20000 |
| `POWER_BANK_HITS` | 2000000 |
| `WORLD_WIDTH` | 202 |
| `WORLD_HEIGHT` | 202 |
| `POWER_CREEP_MAX_LEVEL` | 25 |
| `CONTAINER_HITS` | 250000 |
| `CREEP_SPAWN_TIME` | 3 |
| `GCL_NOVICE` | 3 |
| `DENSITY_HIGH` | 3 |
| `EVENT_ATTACK_CONTROLLER` | 3 |
| `EVENT_ATTACK_TYPE_RANGED_MASS` | 3 |
| `PWR_OPERATE_TOWER` | 3 |
| `ATTACK_POWER` | 30 |
| `LAB_BOOST_MINERAL` | 30 |
| `RAMPART_DECAY_AMOUNT` | 300 |
| `ENERGY_REGEN_TIME` | 300 |
| `SPAWN_ENERGY_START` | 300 |
| `SPAWN_ENERGY_CAPACITY` | 300 |
| `CONTROLLER_CLAIM_DOWNGRADE` | 300 |
| `MARKET_MAX_ORDERS` | 300 |
| `SOURCE_ENERGY_CAPACITY` | 3000 |
| `TOWER_HITS` | 3000 |
| `LAB_MINERAL_CAPACITY` | 3000 |
| `TERMINAL_HITS` | 3000 |
| `PORTAL_DECAY` | 30000 |
| `TERMINAL_CAPACITY` | 300000 |
| `NUKER_ENERGY_CAPACITY` | 300000 |
| `WALL_HITS_MAX` | 300000000 |
| `RANGED_HEAL_POWER` | 4 |
| `DENSITY_ULTRA` | 4 |
| `EVENT_BUILD` | 4 |
| `EVENT_ATTACK_TYPE_DISMANTLE` | 4 |
| `PWR_OPERATE_STORAGE` | 4 |
| `TOWER_POWER_HEAL` | 400 |
| `SOURCE_ENERGY_KEEPER_CAPACITY` | 4000 |
| `BUILD_POWER` | 5 |
| `CONSTRUCTION_COST_ROAD_SWAMP_RATIO` | 5 |
| `TOWER_OPTIMAL_RANGE` | 5 |
| `EXTRACTOR_COOLDOWN` | 5 |
| `LAB_REACTION_AMOUNT` | 5 |
| `TOMBSTONE_DECAY_PER_PART` | 5 |
| `EVENT_HARVEST` | 5 |
| `EVENT_ATTACK_TYPE_HIT_BACK` | 5 |
| `PWR_OPERATE_LAB` | 5 |
| `CARRY_CAPACITY` | 50 |
| `DISMANTLE_POWER` | 50 |
| `POWER_SPAWN_ENERGY_RATIO` | 50 |
| `MAX_CREEP_SIZE` | 50 |
| `OBSERVER_HITS` | 500 |
| `POWER_BANK_CAPACITY_MIN` | 500 |
| `EXTRACTOR_HITS` | 500 |
| `LAB_HITS` | 500 |
| `CONTAINER_DECAY_TIME_OWNED` | 500 |
| `TOMBSTONE_DECAY_POWER_CREEP` | 500 |
| `RUIN_DECAY` | 500 |
| `SPAWN_HITS` | 5000 |
| `ROAD_HITS` | 5000 |
| `CONTROLLER_DOWNGRADE_SAFEMODE_THRESHOLD` | 5000 |
| `CONTROLLER_RESERVE_MAX` | 5000 |
| `POWER_BANK_CAPACITY_MAX` | 5000 |
| `POWER_BANK_DECAY` | 5000 |
| `POWER_SPAWN_HITS` | 5000 |
| `POWER_SPAWN_ENERGY_CAPACITY` | 5000 |
| `CONTAINER_DECAY` | 5000 |
| `NUKER_GHODIUM_CAPACITY` | 5000 |
| `POWER_CREEP_LIFE_TIME` | 5000 |
| `INVADER_CORE_CONTROLLER_DOWNGRADE` | 5000 |
| `SAFE_MODE_COOLDOWN` | 50000 |
| `MINERAL_REGEN_TIME` | 50000 |
| `DEPOSIT_DECAY_TIME` | 50000 |
| `NUKE_LAND_TIME` | 50000 |
| `FACTORY_CAPACITY` | 50000 |
| `POWER_BANK_RESPAWN_TIME` | 50000 |
| `EVENT_HEAL` | 6 |
| `EVENT_ATTACK_TYPE_NUKE` | 6 |
| `PWR_OPERATE_EXTENSION` | 6 |
| `CREEP_CLAIM_LIFE_TIME` | 600 |
| `TOWER_POWER_ATTACK` | 600 |
| `EVENT_REPAIR` | 7 |
| `PWR_OPERATE_OBSERVER` | 7 |
| `STRONGHOLD_DECAY_TICKS` | 75000 |
| `EVENT_RESERVE_CONTROLLER` | 8 |
| `PWR_OPERATE_TERMINAL` | 8 |
| `LINK_CAPACITY` | 800 |
| `TOWER_POWER_REPAIR` | 800 |
| `EVENT_UPGRADE_CONTROLLER` | 9 |
| `PWR_DISRUPT_SPAWN` | 9 |
| `SIGN_NOVICE_AREA` | A new Novice or Respawn Area is being planned somewhere in this sector. Please make sure all important rooms are reserved. |
| `SIGN_RESPAWN_AREA` | A new Novice or Respawn Area is being planned somewhere in this sector. Please make sure all important rooms are reserved. |
| `SIGN_PLANNED_AREA` | A new Novice or Respawn Area is being planned somewhere in this sector. Please make sure all important rooms are reserved. |
| `SYSTEM_USERNAME` | Screeps |
| `ACCESS_KEY` | accessKey |
| `ORDER_BUY` | buy |
| `CPU_UNLOCK` | cpuUnlock |
| `PIXEL` | pixel |
| `ORDER_SELL` | sell |
| `SUBSCRIPTION_TOKEN` | token |

### 身体部件成本 (BODYPART_COST)

孵化一个身体部件所需能量（`spawnCreep` 的总能量 = 各部件成本之和，上限 3000）。

| 部件 | 成本 |
|------|------|
| `move` | 50 |
| `work` | 100 |
| `attack` | 80 |
| `carry` | 50 |
| `heal` | 250 |
| `ranged_attack` | 150 |
| `tough` | 10 |
| `claim` | 600 |

### 控制器等级可建结构数量 (CONTROLLER_STRUCTURES)

每个 RCL 等级下，各类结构的最大数量。

| RCL 等级 | 结构类型 | 最大数量 |
|----------|----------|----------|
| spawn | `0` | 0 |
| spawn | `1` | 1 |
| spawn | `2` | 1 |
| spawn | `3` | 1 |
| spawn | `4` | 1 |
| spawn | `5` | 1 |
| spawn | `6` | 1 |
| spawn | `7` | 2 |
| spawn | `8` | 3 |
| extension | `0` | 0 |
| extension | `1` | 0 |
| extension | `2` | 5 |
| extension | `3` | 10 |
| extension | `4` | 20 |
| extension | `5` | 30 |
| extension | `6` | 40 |
| extension | `7` | 50 |
| extension | `8` | 60 |
| link | `1` | 0 |
| link | `2` | 0 |
| link | `3` | 0 |
| link | `4` | 0 |
| link | `5` | 2 |
| link | `6` | 3 |
| link | `7` | 4 |
| link | `8` | 6 |
| road | `0` | 2500 |
| road | `1` | 2500 |
| road | `2` | 2500 |
| road | `3` | 2500 |
| road | `4` | 2500 |
| road | `5` | 2500 |
| road | `6` | 2500 |
| road | `7` | 2500 |
| road | `8` | 2500 |
| constructedWall | `1` | 0 |
| constructedWall | `2` | 2500 |
| constructedWall | `3` | 2500 |
| constructedWall | `4` | 2500 |
| constructedWall | `5` | 2500 |
| constructedWall | `6` | 2500 |
| constructedWall | `7` | 2500 |
| constructedWall | `8` | 2500 |
| rampart | `1` | 0 |
| rampart | `2` | 2500 |
| rampart | `3` | 2500 |
| rampart | `4` | 2500 |
| rampart | `5` | 2500 |
| rampart | `6` | 2500 |
| rampart | `7` | 2500 |
| rampart | `8` | 2500 |
| storage | `1` | 0 |
| storage | `2` | 0 |
| storage | `3` | 0 |
| storage | `4` | 1 |
| storage | `5` | 1 |
| storage | `6` | 1 |
| storage | `7` | 1 |
| storage | `8` | 1 |
| tower | `1` | 0 |
| tower | `2` | 0 |
| tower | `3` | 1 |
| tower | `4` | 1 |
| tower | `5` | 2 |
| tower | `6` | 2 |
| tower | `7` | 3 |
| tower | `8` | 6 |
| observer | `1` | 0 |
| observer | `2` | 0 |
| observer | `3` | 0 |
| observer | `4` | 0 |
| observer | `5` | 0 |
| observer | `6` | 0 |
| observer | `7` | 0 |
| observer | `8` | 1 |
| powerSpawn | `1` | 0 |
| powerSpawn | `2` | 0 |
| powerSpawn | `3` | 0 |
| powerSpawn | `4` | 0 |
| powerSpawn | `5` | 0 |
| powerSpawn | `6` | 0 |
| powerSpawn | `7` | 0 |
| powerSpawn | `8` | 1 |
| extractor | `1` | 0 |
| extractor | `2` | 0 |
| extractor | `3` | 0 |
| extractor | `4` | 0 |
| extractor | `5` | 0 |
| extractor | `6` | 1 |
| extractor | `7` | 1 |
| extractor | `8` | 1 |
| terminal | `1` | 0 |
| terminal | `2` | 0 |
| terminal | `3` | 0 |
| terminal | `4` | 0 |
| terminal | `5` | 0 |
| terminal | `6` | 1 |
| terminal | `7` | 1 |
| terminal | `8` | 1 |
| lab | `1` | 0 |
| lab | `2` | 0 |
| lab | `3` | 0 |
| lab | `4` | 0 |
| lab | `5` | 0 |
| lab | `6` | 3 |
| lab | `7` | 6 |
| lab | `8` | 10 |
| container | `0` | 5 |
| container | `1` | 5 |
| container | `2` | 5 |
| container | `3` | 5 |
| container | `4` | 5 |
| container | `5` | 5 |
| container | `6` | 5 |
| container | `7` | 5 |
| container | `8` | 5 |
| nuker | `1` | 0 |
| nuker | `2` | 0 |
| nuker | `3` | 0 |
| nuker | `4` | 0 |
| nuker | `5` | 0 |
| nuker | `6` | 0 |
| nuker | `7` | 0 |
| nuker | `8` | 1 |
| factory | `1` | 0 |
| factory | `2` | 0 |
| factory | `3` | 0 |
| factory | `4` | 0 |
| factory | `5` | 0 |
| factory | `6` | 0 |
| factory | `7` | 1 |
| factory | `8` | 1 |

### 反应公式 (REACTIONS)

实验室将两个基础矿物合成一种新产品。格式：`成分A + 成分B → 产品`。

| 反应式 | 产品 |
|--------|------|
| `G` + `H` | `GH` |
| `G` + `O` | `GO` |
| `GH` + `OH` | `GH2O` |
| `GH2O` + `X` | `XGH2O` |
| `GHO2` + `X` | `XGHO2` |
| `GO` + `OH` | `GHO2` |
| `H` + `K` | `KH` |
| `H` + `L` | `LH` |
| `H` + `O` | `OH` |
| `H` + `U` | `UH` |
| `H` + `Z` | `ZH` |
| `K` + `O` | `KO` |
| `K` + `Z` | `ZK` |
| `KH` + `OH` | `KH2O` |
| `KH2O` + `X` | `XKH2O` |
| `KHO2` + `X` | `XKHO2` |
| `KO` + `OH` | `KHO2` |
| `L` + `O` | `LO` |
| `L` + `U` | `UL` |
| `LH` + `OH` | `LH2O` |
| `LH2O` + `X` | `XLH2O` |
| `LHO2` + `X` | `XLHO2` |
| `LO` + `OH` | `LHO2` |
| `O` + `U` | `UO` |
| `O` + `Z` | `ZO` |
| `OH` + `UH` | `UH2O` |
| `OH` + `UO` | `UHO2` |
| `OH` + `ZH` | `ZH2O` |
| `OH` + `ZO` | `ZHO2` |
| `UH2O` + `X` | `XUH2O` |
| `UHO2` + `X` | `XUHO2` |
| `UL` + `ZK` | `G` |
| `X` + `ZH2O` | `XZH2O` |
| `X` + `ZHO2` | `XZHO2` |

### 强化配方 (BOOSTS)

在实验室用强化化合物强化 creep 的身体部件。格式：`身体部件 ← 强化资源（效果）`。

| 身体部件 | 强化资源 | 效果 |
|----------|----------|------|
| `work` | `UO` | harvest×3 |
| `work` | `UHO2` | harvest×5 |
| `work` | `XUHO2` | harvest×7 |
| `work` | `LH` | build×1.5, repair×1.5 |
| `work` | `LH2O` | build×1.8, repair×1.8 |
| `work` | `XLH2O` | build×2, repair×2 |
| `work` | `ZH` | dismantle×2 |
| `work` | `ZH2O` | dismantle×3 |
| `work` | `XZH2O` | dismantle×4 |
| `work` | `GH` | upgradeController×1.5 |
| `work` | `GH2O` | upgradeController×1.8 |
| `work` | `XGH2O` | upgradeController×2 |
| `attack` | `UH` | attack×2 |
| `attack` | `UH2O` | attack×3 |
| `attack` | `XUH2O` | attack×4 |
| `ranged_attack` | `KO` | rangedAttack×2, rangedMassAttack×2 |
| `ranged_attack` | `KHO2` | rangedAttack×3, rangedMassAttack×3 |
| `ranged_attack` | `XKHO2` | rangedAttack×4, rangedMassAttack×4 |
| `heal` | `LO` | heal×2, rangedHeal×2 |
| `heal` | `LHO2` | heal×3, rangedHeal×3 |
| `heal` | `XLHO2` | heal×4, rangedHeal×4 |
| `carry` | `KH` | capacity×2 |
| `carry` | `KH2O` | capacity×3 |
| `carry` | `XKH2O` | capacity×4 |
| `move` | `ZO` | fatigue×2 |
| `move` | `ZHO2` | fatigue×3 |
| `move` | `XZHO2` | fatigue×4 |
| `tough` | `GO` | damage×0.7 |
| `tough` | `GHO2` | damage×0.5 |
| `tough` | `XGHO2` | damage×0.3 |


---


## 全局对象 (Globals)

## Game

The main global game object containing all the game play information.

### 属性 (Properties)

- **`Game.constructionSites`** → `object<string, ConstructionSite>`
  - A hash containing all your construction sites with their id as hash keys.

- **`Game.cpu`** → `object`
  - A global object containing information about your CPU usage and methods. See the below.

- **`Game.creeps`** → `object<string, Creep>`
  - A hash containing all your creeps with creep names as hash keys.

- **`Game.flags`** → `object<string, Flag>`
  - A hash containing all your flags with flag names as hash keys.

- **`Game.gcl`** → `object`
  - Your , an object with the following properties : The current level. The current progress to the next level. The progress required to reach the next level.

- **`Game.gpl`** → `object`
  - Your Global Power Level, an object with the following properties : The current level. The current progress to the next level. The progress required to reach the next level.

- **`Game.map`** → `object`
  - A global object representing world map. See the below.

- **`Game.market`** → `object`
  - A global object representing the in-game market. See the below.

- **`Game.powerCreeps`** → `object<string, PowerCreep>`
  - A hash containing all your power creeps with their names as hash keys. Even power creeps not spawned in the world can be accessed here.

- **`Game.resources`** → `object`
  - An object with your global resources that are bound to the account, like pixels or cpu unlocks. Each object key is a resource constant, values are resources amounts.

- **`Game.rooms`** → `object<string, Room>`
  - A hash containing all the rooms available to you with room names as hash keys. A room is visible if you have a creep or an owned structure in it.

- **`Game.shard`** → `object`
  - A global object describing the world shard where your script is currently being executed in. See the below.

- **`Game.spawns`** → `object<string, StructureSpawn>`
  - A hash containing all your spawns with spawn names as hash keys.

- **`Game.structures`** → `object<string, Structure>`
  - A hash containing all your structures with structure id as hash keys.

- **`Game.time`** → `number`
  - System game tick counter. It is automatically incremented on every tick.

### 方法 (Methods)

- **`Game.getObjectById(id)`**  _(CPU: 低)_
  - Get an object with the specified unique ID. It may be a game object of any type. Only objects from the rooms which are visible to you can be accessed. The unique identificator. Returns an object instance or null if it cannot be found.

- **`Game.notify(message, [groupInterval])`**  _(CPU: 动作(返回OK时+0.2))_
  - Send a custom message at your profile email. This way, you can set up notifications to yourself on any occasion within the game. You can schedule up to 20 notifications during one game tick. Not available in the Simulation Room. Custom text which will be sent in the message. Maximum length is 1000 characters. If set to 0 (default), the notification will be scheduled immediately. Otherwise, it will be grouped with other notifications and mailed out later using the specified time in minutes.

## InterShardMemory

InterShardMemory object provides an interface for communicating between shards. Your script is executed separatedly on each shard, and their Memory objects are isolated from each other. In order to pass messages and data between shards, you need to use InterShardMemory instead. Every shard can have its own 100 KB of data in string format that can be accessed by all other shards. A shard can write only to its own data, other shards' data is read-only. This data has nothing to do with Memory contents, it's a separate data container.

### 方法 (Methods)

- **`InterShardMemory.getLocal()`**  _(CPU: 极低)_
  - Returns the string contents of the current shard's data.

- **`InterShardMemory.setLocal(value)`**  _(CPU: 极低)_
  - Replace the current shard's data with the new value. New data value in string format.

- **`InterShardMemory.getRemote(shard)`**  _(CPU: 极低)_
  - Returns the string contents of another shard's data. Shard name.

## Memory

A global plain object which can contain arbitrary data. You can access it both using the API and the Memory UI in the game editor. Learn how to work with memory from this article.

## PathFinder

Contains powerful methods for pathfinding in the game world. This module is written in fast native C++ code and supports custom navigation costs and paths which span multiple rooms.

### 方法 (Methods)

- **`PathFinder.search(origin, goal, [opts])`**  _(CPU: 高)_
  - Find an optimal path between and . The start position. A goal or an array of goals. If more than one goal is supplied then the cheapest path found out of all the goals will be returned. A goal is either a RoomPosition or an object as defined below. Please note that if your goal is not walkable (for instance, a source) then you should set to at least 1 or else you will waste many CPU cycles searching for a target that you can't walk on. An object containing additional pathfinding flags. An object containing the following properties:
  - **参数 (opts 子项 / 详细):**
    - `pos` (``) — The target.
    - `range` (``) — The target.
    - `roomCallback` (``) — The target.
    - `plainCost` (``) — The target.
    - `swampCost` (``) — The target.
    - `flee` (``) — The target.
    - `maxOps` (``) — The target.
    - `maxRooms` (``) — The target.
    - `maxCost` (``) — The target.
    - `heuristicWeight` (``) — The target.

- **`PathFinder.use(isEnabled)`**  _(CPU: 极低)_ ⚠️已废弃
  - This method is deprecated and will be removed soon. Specify whether to use this new experimental pathfinder in game objects methods. This method should be invoked every tick. It affects the following methods behavior: , , , . Whether to activate the new pathfinder or deactivate. The default is .

## RawMemory

RawMemory object allows to implement your own memory stringifier instead of built-in serializer based on JSON.stringify. It also allows to request up to 10 MB of additional memory using asynchronous memory segments feature. You can also access memory segments of other players using methods below.

### 属性 (Properties)

- **`RawMemory.segments`** → `object`
  - An object with asynchronous memory segments available on this tick. Each object key is the segment ID with data in string values. Use to fetch segments on the next tick. Segments data is saved automatically in the end of the tick. The maximum size per segment is 100 KB.

- **`RawMemory.foreignSegment`** → `object`
  - An object with a memory segment of another player available on this tick. Use to fetch segments on the next tick. The object consists of the following properties: Another player's name. The ID of the requested memory segment. The segment contents.

- **`RawMemory.interShardSegment`** → `string` ⚠️已废弃
  - This property is deprecated and will be removed soon. Please use instead. A string with a shared memory segment available on every world shard. Maximum string length is 100 KB. this segment is not safe for concurrent usage! All shards have shared access to the same instance of data. When the segment contents is changed by two shards simultaneously, you may lose some data, since the segment string value is written all at once atomically. You must implement your own system to determine when each shard is allowed to rewrite the inter-shard memory, e.g. based on .

### 方法 (Methods)

- **`RawMemory.get()`**  _(CPU: 极低)_
  - Get a raw string representation of the object. Returns a string value.

- **`RawMemory.set(value)`**  _(CPU: 极低)_
  - Set new value. New memory value as a string.

- **`RawMemory.setActiveSegments(ids)`**  _(CPU: 极低)_
  - Request memory segments using the list of their IDs. Memory segments will become available on the next tick in object. An array of segment IDs. Each ID should be a number from 0 to 99. Maximum 10 segments can be active at the same time. Subsequent calls of override previous ones.

- **`RawMemory.setActiveForeignSegment(username, [id])`**  _(CPU: 极低)_
  - Request a memory segment of another user. The segment should be marked by its owner as public using . The segment data will become available on the next tick in object. You can only have access to one foreign segment at the same time. The name of another user. Pass to clear the foreign segment. The ID of the requested segment from 0 to 99. If undefined, the user's default public segment is requested as set by .

- **`RawMemory.setDefaultPublicSegment(id)`**  _(CPU: 极低)_
  - Set the specified segment as your default public segment. It will be returned if no parameter is passed to by another user. The ID of the memory segment from 0 to 99. Pass to remove your default public segment.

- **`RawMemory.setPublicSegments(ids)`**  _(CPU: 极低)_
  - Set specified segments as public. Other users will be able to request access to them using . An array of segment IDs. Each ID should be a number from 0 to 99. Subsequent calls of override previous ones.

## Game-market

A global object representing the in-game market. You can use this object to track resource transactions to/from your terminals, and your buy/sell orders. Learn more about the market system from this article.

### 属性 (Properties)

- **`Game.market.credits`** → `number`
  - Your current credits balance.

- **`Game.market.incomingTransactions`** → `array`
  - An array of the last 100 incoming transactions to your terminals with the following format:

- **`Game.market.outgoingTransactions`** → `array`
  - An array of the last 100 outgoing transactions from your terminals with the following format:

- **`Game.market.orders`** → `object`
  - An object with your active and inactive buy/sell orders on the market. See for properties explanation.

### 方法 (Methods)

- **`Game.market.calcTransactionCost(amount, roomName1, roomName2)`**  _(CPU: 极低)_
  - Estimate the energy transaction cost of and methods. The formula: Amount of resources to be sent. The name of the first room. The name of the second room. The amount of energy required to perform the transaction.

- **`Game.market.cancelOrder(orderId)`**  _(CPU: 动作(返回OK时+0.2))_
  - Cancel a previously created order. The 5% fee is not returned. The order ID as provided in . One of the following codes:

- **`Game.market.changeOrderPrice(orderId, newPrice)`**  _(CPU: 动作(返回OK时+0.2))_
  - Change the price of an existing order. If is greater than old price, you will be charged credits. The order ID as provided in . The new order price. One of the following codes:

- **`Game.market.createOrder(params)`**  _(CPU: 动作(返回OK时+0.2))_
  - Create a market order in your terminal. You will be charged credits when the order is placed. The maximum orders count is 300 per player. You can create an order at any time with any amount, it will be automatically activated and deactivated depending on the resource/credits availability. An object with the following params: One of the following codes:
  - **参数 (opts 子项 / 详细):**
    - `type` (`string`) — The order type, either or .
    - `resourceType` (`string`) — The order type, either or .
    - `price` (`string`) — The order type, either or .
    - `totalAmount` (`string`) — The order type, either or .
    - `roomName (optional)` (`string` 可选) — The order type, either or .

- **`Game.market.deal(orderId, amount, [yourRoomName])`**  _(CPU: 动作(返回OK时+0.2))_
  - Execute a trade deal from your Terminal in to another player's Terminal using the specified buy/sell order. Your Terminal will be charged energy units of transfer cost regardless of the order resource type. You can use method to estimate it. When multiple players try to execute the same deal, the one with the shortest distance takes precedence. You cannot execute more than 10 deals during one tick. The order ID as provided in . The amount of resources to transfer. The name of your room which has to contain an active Terminal with enough amount of energy. This argument is not used when the order resource type is one of account-bound resources (See constant). One of the following codes:

- **`Game.market.extendOrder(orderId, addAmount)`**  _(CPU: 动作(返回OK时+0.2))_
  - Add more capacity to an existing order. It will affect and properties. You will be charged credits. The order ID as provided in . How much capacity to add. Cannot be a negative value. One of the following codes:

- **`Game.market.getAllOrders([filter])`**  _(CPU: 高)_
  - Get other players' orders currently active on the market. This method supports internal indexing by . An object or function that will filter the resulting list using the method. An orders array in the following form:

- **`Game.market.getHistory([resourceType])`**  _(CPU: 低)_
  - Get daily price history of the specified resource on the market for the last 14 days. One of the constants. If undefined, returns history data for all resources. Returns an array of objects with the following format:

- **`Game.market.getOrderById(id)`**  _(CPU: 低)_
  - Retrieve info for specific market order. The order ID. An object with the order info. See for properties explanation.

## Game-shard

An object describing the world shard where your script is currently being executed in.

### 属性 (Properties)

- **`Game.shard.name`** → `string`
  - The name of the shard.

- **`Game.shard.type`** → `string`
  - Currently always equals to .

- **`Game.shard.ptr`** → `boolean`
  - Whether this shard belongs to the .

- **`Game.shard.access`** → `boolean`
  - Whether you currently have access to this shard. Always on non-restricted shards. On restricted shards, requires either an active resource or an unlimited access subscription. Use to activate access.

- **`Game.shard.accessTime`** → `number`
  - The time until access to this restricted shard is active. This property is not defined when access is unlimited or when access is not currently active.

### 方法 (Methods)

- **`Game.shard.activateAccess()`**  _(CPU: 低)_
  - Activate access to the current restricted shard for additional 30 days. This method will consume 1 resource bound to your account (See ). This method is only available on restricted shards (when is defined). One of the following codes:

## Game-map

A global object representing world map. Use it to navigate between rooms.

### 方法 (Methods)

- **`Game.map.describeExits(roomName)`**  _(CPU: 低)_
  - List all exits available from the room with the given name. The room name. The exits information in the following format, or null if the room not found.

- **`Game.map.findExit(fromRoom, toRoom, [opts])`**  _(CPU: 高)_
  - Find the exit direction from the given room en route to another room. Start room name or room object. Finish room name or room object. An object with the pathfinding options. See . The room direction constant, one of the following: Or one of the following error codes:

- **`Game.map.findRoute(fromRoom, toRoom, [opts])`**  _(CPU: 高)_
  - Find route from the given room to another room. Start room name or room object. Finish room name or room object. An object with the following options: The route array in the following format: Or one of the following error codes:
  - **参数 (opts 子项 / 详细):**
    - `routeCallback` (`function`) — This callback accepts two arguments: . It can be used to calculate the cost of entering that room. You can use this to do things like prioritize your own rooms, or avoid some rooms. You can return a floating point cost or to block the room.

- **`Game.map.getRoomLinearDistance(roomName1, roomName2, [continuous])`**  _(CPU: 极低)_
  - Get the linear distance (in rooms) between two rooms. You can use this function to estimate the energy cost of sending resources through terminals, or using observers and nukes. The name of the first room. The name of the second room. Whether to treat the world map continuous on borders. Set to true if you want to calculate the trade or terminal send cost. Default is false. A number of rooms between the given two rooms.

- **`Game.map.getRoomTerrain(roomName)`**  _(CPU: 极低)_
  - Get a object which provides fast access to static terrain data. This method works for any room in the world even if you have no access to it. The room name. Returns new object.

- **`Game.map.getTerrainAt(pos)`**  _(CPU: 低)_ ⚠️已废弃
  - This method is deprecated and will be removed soon. Please use a faster method instead. Get terrain type at the specified room position. This method works for any room in the world even if you have no access to it. X position in the room. Y position in the room. The room name. The position object. One of the following string values:

- **`Game.map.getWorldSize()`**  _(CPU: 极低)_
  - Returns the world size as a number of rooms between world corners. For example, for a world with rooms from W50N50 to E50S50 this method will return 102.

- **`Game.map.isRoomAvailable(roomName)`**  _(CPU: 中)_ ⚠️已废弃
  - This method is deprecated and will be removed soon. Please use instead. Check if the room is available to move into. The room name. A boolean value.

- **`Game.map.getRoomStatus(roomName)`**  _(CPU: 中)_
  - Gets availablity status of the room with the specified name. Learn more about starting areas from . The room name. An object containing the following properties:

## Game-map-visual

Map visuals provide a way to show various visual debug info on the game map. You can use the Game.map.visual object to draw simple shapes that are visible only to you. Map visuals are not stored in the database, their only purpose is to display something in your browser. All drawings will persist for one tick and will disappear if not updated. All Game.map.visual calls have no added CPU cost (their cost is natural and mostly related to simple JSON.serialize calls). However, there is a usage limit: you cannot post more than 1000 KB of serialized data. All draw coordinates are measured in global game coordinates (RoomPosition).

### 方法 (Methods)

- **`line(pos1, pos2, [style])`**  _(CPU: 极低)_
  - Draw a line. The start position object. The finish position object. An object with the following properties: The object itself, so that you can chain calls.
  - **参数 (opts 子项 / 详细):**
    - `width` (`number`) — Line width, default is 0.1.
    - `color` (`number`) — Line width, default is 0.1.
    - `opacity` (`number`) — Line width, default is 0.1.
    - `lineStyle` (`number`) — Line width, default is 0.1.

- **`circle(pos, [style])`**  _(CPU: 极低)_
  - Draw a circle. The position object of the center. An object with the following properties: The object itself, so that you can chain calls.
  - **参数 (opts 子项 / 详细):**
    - `radius` (`number`) — Circle radius, default is 10.
    - `fill` (`number`) — Circle radius, default is 10.
    - `opacity` (`number`) — Circle radius, default is 10.
    - `stroke` (`number`) — Circle radius, default is 10.
    - `strokeWidth` (`number`) — Circle radius, default is 10.
    - `lineStyle` (`number`) — Circle radius, default is 10.

- **`rect(topLeftPos, width, height, [style])`**  _(CPU: 极低)_
  - Draw a rectangle. The position object of the top-left corner. The width of the rectangle. The height of the rectangle. An object with the following properties: The object itself, so that you can chain calls.
  - **参数 (opts 子项 / 详细):**
    - `fill` (`string`) — Fill color in the following format: (hex triplet). Default is #ffffff.
    - `opacity` (`string`) — Fill color in the following format: (hex triplet). Default is #ffffff.
    - `stroke` (`string`) — Fill color in the following format: (hex triplet). Default is #ffffff.
    - `strokeWidth` (`string`) — Fill color in the following format: (hex triplet). Default is #ffffff.
    - `lineStyle` (`string`) — Fill color in the following format: (hex triplet). Default is #ffffff.

- **`poly(points, [style])`**  _(CPU: 极低)_
  - Draw a polyline. An array of points. Every item should be a object. An object with the following properties: The object itself, so that you can chain calls.
  - **参数 (opts 子项 / 详细):**
    - `fill` (`string`) — Fill color in the following format: (hex triplet). Default is (no fill).
    - `opacity` (`string`) — Fill color in the following format: (hex triplet). Default is (no fill).
    - `stroke` (`string`) — Fill color in the following format: (hex triplet). Default is (no fill).
    - `strokeWidth` (`string`) — Fill color in the following format: (hex triplet). Default is (no fill).
    - `lineStyle` (`string`) — Fill color in the following format: (hex triplet). Default is (no fill).

- **`text(text, pos, [style])`**  _(CPU: 极低)_
  - Draw a text label. You can use any valid Unicode characters, including . The text message. The position object of the label baseline. An object with the following properties: The object itself, so that you can chain calls.
  - **参数 (opts 子项 / 详细):**
    - `color` (`string`) — Font color in the following format: (hex triplet). Default is #ffffff.
    - `fontFamily` (`string`) — Font color in the following format: (hex triplet). Default is #ffffff.
    - `fontSize` (`string`) — Font color in the following format: (hex triplet). Default is #ffffff.
    - `fontStyle` (`string`) — Font color in the following format: (hex triplet). Default is #ffffff.
    - `fontVariant` (`string`) — Font color in the following format: (hex triplet). Default is #ffffff.
    - `stroke` (`string`) — Font color in the following format: (hex triplet). Default is #ffffff.
    - `strokeWidth` (`string`) — Font color in the following format: (hex triplet). Default is #ffffff.
    - `backgroundColor` (`string`) — Font color in the following format: (hex triplet). Default is #ffffff.
    - `backgroundPadding` (`string`) — Font color in the following format: (hex triplet). Default is #ffffff.
    - `align` (`string`) — Font color in the following format: (hex triplet). Default is #ffffff.
    - `opacity` (`string`) — Font color in the following format: (hex triplet). Default is #ffffff.

- **`clear()`**  _(CPU: 极低)_
  - Remove all visuals from the map. The object itself, so that you can chain calls.

- **`getSize()`**  _(CPU: 极低)_
  - Get the stored size of all visuals added on the map in the current tick. It must not exceed 1024,000 (1000 KB). The size of the visuals in bytes.

- **`export()`**  _(CPU: 极低)_
  - Returns a compact representation of all visuals added on the map in the current tick. A string with visuals data. There's not much you can do with the string besides store them for later.

- **`import(val)`**  _(CPU: 极低)_
  - Add previously exported (with ) map visuals to the map visual data of the current tick. The string returned from Game.map.visual.export. The object itself, so that you can chain calls.

## Game-cpu

A global object containing information about your CPU usage.

### 属性 (Properties)

- **`Game.cpu.limit`** → `number`
  - Your assigned CPU limit for the current shard.

- **`Game.cpu.tickLimit`** → `number`
  - An amount of available CPU time at the current game tick. Usually it is higher than .

- **`Game.cpu.bucket`** → `number`
  - An amount of unused CPU accumulated in your .

- **`Game.cpu.shardLimits`** → `object<string,number>`
  - An object with limits for each shard with shard names as keys. You can use method to re-assign them.

- **`Game.cpu.unlocked`** → `boolean`
  - Whether full CPU is currently unlocked for your account.

- **`Game.cpu.unlockedTime`** → `number`
  - The time until full CPU is unlocked for your account. This property is not defined when full CPU is not unlocked for your account or it's unlocked with a subscription.

### 方法 (Methods)

- **`Game.cpu.getHeapStatistics()`**  _(CPU: 低)_
  - Use this method to get heap statistics for your virtual machine. The return value is almost identical to the Node.js function . This function returns one additional property: which is the total amount of currently allocated memory which is not included in the v8 heap but counts against this isolate's memory limit. instances over a certain size are externally allocated and will be counted here. Returns an objects with heap statistics in the following format:

- **`Game.cpu.getUsed()`**  _(CPU: 低)_
  - Get amount of CPU time used from the beginning of the current game tick. Always returns 0 in the Simulation mode. Returns currently used CPU time as a float number.

- **`Game.cpu.halt()`**  _(CPU: 低)_
  - Reset your runtime environment and wipe all data in heap memory.

- **`Game.cpu.setShardLimits(limits)`**  _(CPU: 低)_
  - Allocate CPU limits to different shards. Total amount of CPU should remain equal to . This method can be used only once per 12 hours. An object with CPU values for each shard in the same format as . One of the following codes:

- **`Game.cpu.unlock()`**  _(CPU: 低)_
  - Unlock full CPU for your account for additional 24 hours. This method will consume 1 CPU unlock bound to your account (See ). If full CPU is not currently unlocked for your account, it may take some time (up to 5 minutes) before unlock is applied to your account. One of the following codes:

- **`Game.cpu.generatePixel()`**  _(CPU: 高)_
  - Generate 1 pixel resource unit for 10000 CPU from your bucket. One of the following codes:


## 游戏对象基类 (Base)

## RoomObject

Any object with a position in a room. Almost all game objects prototypes are derived from RoomObject.

### 属性 (Properties)

- **`effects`** → `array`
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition`
  - An object representing the position of this object in the room.

- **`room`** → `Room`
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

## RoomPosition

An object representing the specified position in the room. Every RoomObject in the room contains RoomPosition as the pos property. The position object of a custom location can be obtained using the Room.getPositionAt method or using the constructor.

### 属性 (Properties)

- **`constructor`** → ``
  - You can create new object using its constructor. X position in the room. Y position in the room. The room name.

- **`roomName`** → `string`
  - The name of the room.

- **`x`** → `number`
  - X position in the room.

- **`y`** → `number`
  - Y position in the room.

### 方法 (Methods)

- **`createConstructionSite(structureType, [name])`**  _(CPU: 动作(返回OK时+0.2))_
  - Create new at the specified location. One of the constants. The name of the structure, for structures that support it (currently only spawns). One of the following codes:

- **`createFlag([name], [color], [secondaryColor])`**  _(CPU: 动作(返回OK时+0.2))_
  - Create new at the specified location. The name of a new flag. It should be unique, i.e. the object should not contain another flag with the same name (hash key). If not defined, a random name will be generated. The color of a new flag. Should be one of the constants. The default value is . The secondary color of a new flag. Should be one of the constants. The default value is equal to . The name of a new flag, or one of the following error codes:

- **`findClosestByPath(objects, [opts])`**  _(CPU: 高)_
  - Find an object with the shortest path from the given position. Uses and . See . An array of room's objects or objects that the search should be executed against. An object containing pathfinding options (see ), or one of the following: The closest object if found, null otherwise.
  - **参数 (opts 子项 / 详细):**
    - `filter` (`object, function, string`) — Only the objects which pass the filter using the method will be used.
    - `algorithm` (`object, function, string`) — Only the objects which pass the filter using the method will be used.

- **`findClosestByRange(objects, [opts])`**  _(CPU: 中)_
  - Find an object with the shortest linear distance from the given position. See . An array of room's objects or objects that the search should be executed against. An object containing one of the following options: The closest object if found, null otherwise.
  - **参数 (opts 子项 / 详细):**
    - `filter` (`object, function, string`) — Only the objects which pass the filter using the method will be used.

- **`findInRange(objects, range, [opts])`**  _(CPU: 中)_
  - Find all objects in the specified linear range. See . An array of room's objects or objects that the search should be executed against. The range distance. See . An array with the objects found.

- **`findPathTo(target, [opts])`**  _(CPU: 高)_
  - Find an optimal path to the specified position using . This method is a shorthand for . If the target is in another room, then the corresponding exit will be used as a target. X position in the room. Y position in the room. Can be a object or any object containing . An object containing pathfinding options flags (see for more details). An array with path steps in the following format:

- **`getDirectionTo(target)`**  _(CPU: 低)_
  - Get linear direction to the specified position. X position in the room. Y position in the room. Can be a object or any object containing . A number representing one of the direction constants.

- **`getRangeTo(target)`**  _(CPU: 低)_
  - Get linear range to the specified position. X position in the room. Y position in the room. Can be a object or any object containing . A number of squares to the given position.

- **`inRangeTo(target, range)`**  _(CPU: 低)_
  - Check whether this position is in the given range of another position. X position in the same room. Y position in the same room. The target position. The range distance. A boolean value.

- **`isEqualTo(target)`**  _(CPU: 低)_
  - Check whether this position is the same as the specified position. X position in the room. Y position in the room. Can be a object or any object containing . A boolean value.

- **`isNearTo(target)`**  _(CPU: 低)_
  - Check whether this position is on the adjacent square to the specified position. The same as . X position in the room. Y position in the room. Can be a object or any object containing . A boolean value.

- **`look()`**  _(CPU: 中)_
  - Get the list of objects at the specified room position. An array with objects at the specified position in the following format:

- **`lookFor(type)`**  _(CPU: 低)_
  - Get an object with the given type at the specified room position. One of the constants. An array of objects of the given type at the specified position if found.

## Room

An object representing the room in which your units and structures are in. It can be used to look around, find paths, etc. Every RoomObject in the room contains its linked Room instance in the room property.

### 属性 (Properties)

- **`controller`** → `StructureController`
  - The Controller structure of this room, if present, otherwise undefined.

- **`energyAvailable`** → `number`
  - Total amount of energy available in all spawns and extensions in the room.

- **`energyCapacityAvailable`** → `number`
  - Total amount of of all spawns and extensions in the room.

- **`memory`** → `any`
  - A shorthand to . You can use it for quick access the room’s specific memory data object.

- **`name`** → `string`
  - The name of the room.

- **`storage`** → `StructureStorage`
  - The Storage structure of this room, if present, otherwise undefined.

- **`terminal`** → `StructureTerminal`
  - The Terminal structure of this room, if present, otherwise undefined.

- **`visual`** → `RoomVisual`
  - A object for this room. You can use this object to draw simple shapes (lines, circles, text labels) in the room.

### 方法 (Methods)

- **`Room.serializePath(path)`**  _(CPU: 低)_
  - Serialize a path array into a short string representation, which is suitable to store in memory. A path array retrieved from . A serialized string form of the given path.

- **`Room.deserializePath(path)`**  _(CPU: 低)_
  - Deserialize a short string path representation into an array form. A serialized path string. A path array.

- **`createConstructionSite(pos, structureType, [name])`**  _(CPU: 动作(返回OK时+0.2))_
  - Create new at the specified location. The X position. The Y position. Can be a object or any object containing . One of the constants. The name of the structure, for structures that support it (currently only spawns). The name length limit is 100 characters. One of the following codes:

- **`createFlag(pos, [name], [color], [secondaryColor])`**  _(CPU: 动作(返回OK时+0.2))_
  - Create new at the specified location. The X position. The Y position. Can be a object or any object containing . The name of a new flag. It should be unique, i.e. the object should not contain another flag with the same name (hash key). If not defined, a random name will be generated. The maximum length is 100 characters. The color of a new flag. Should be one of the constants. The default value is . The secondary color of a new flag. Should be one of the constants. The default value is equal to . The name of a new flag, or one of the following error codes:

- **`find(type, [opts])`**  _(CPU: 中)_
  - Find all objects of the specified type in the room. Results are cached automatically for the specified room and type before applying any custom filters. This automatic cache lasts until the end of the tick. One of the constants. An object with additional options: An array with the objects found.
  - **参数 (opts 子项 / 详细):**
    - `filter` (`object, function, string`) — The result list will be filtered using the method.

- **`findExitTo(room)`**  _(CPU: 高)_
  - Find the exit direction en route to another room. Please note that this method is not required for inter-room movement, you can simply pass the target in another room into method. Another room name or room object. The room direction constant, one of the following: Or one of the following error codes:

- **`findPath(fromPos, toPos, [opts])`**  _(CPU: 高)_
  - Find an optimal path inside the room between fromPos and toPos using . The start position. The end position. An object containing additonal pathfinding flags: An array with path steps in the following format:
  - **参数 (opts 子项 / 详细):**
    - `ignoreCreeps` (`boolean`) — Treat squares with creeps as walkable. Can be useful with too many moving creeps around or in some other cases. The default value is false.
    - `ignoreDestructibleStructures` (`boolean`) — Treat squares with creeps as walkable. Can be useful with too many moving creeps around or in some other cases. The default value is false.
    - `ignoreRoads` (`boolean`) — Treat squares with creeps as walkable. Can be useful with too many moving creeps around or in some other cases. The default value is false.
    - `costCallback` (`boolean`) — Treat squares with creeps as walkable. Can be useful with too many moving creeps around or in some other cases. The default value is false.
    - `ignore` (`boolean`) — Treat squares with creeps as walkable. Can be useful with too many moving creeps around or in some other cases. The default value is false.
    - `avoid` (`boolean`) — Treat squares with creeps as walkable. Can be useful with too many moving creeps around or in some other cases. The default value is false.
    - `maxOps` (`boolean`) — Treat squares with creeps as walkable. Can be useful with too many moving creeps around or in some other cases. The default value is false.
    - `heuristicWeight` (`boolean`) — Treat squares with creeps as walkable. Can be useful with too many moving creeps around or in some other cases. The default value is false.
    - `serialize` (`boolean`) — Treat squares with creeps as walkable. Can be useful with too many moving creeps around or in some other cases. The default value is false.
    - `maxRooms` (`boolean`) — Treat squares with creeps as walkable. Can be useful with too many moving creeps around or in some other cases. The default value is false.
    - `range` (`boolean`) — Treat squares with creeps as walkable. Can be useful with too many moving creeps around or in some other cases. The default value is false.
    - `plainCost` (`boolean`) — Treat squares with creeps as walkable. Can be useful with too many moving creeps around or in some other cases. The default value is false.
    - `swampCost` (`boolean`) — Treat squares with creeps as walkable. Can be useful with too many moving creeps around or in some other cases. The default value is false.

- **`getEventLog([raw])`**  _(CPU: 低)_
  - Returns an array of events happened on the previous tick in this room. If this parameter is false or undefined, the method returns an object parsed using which incurs some CPU cost on the first access (the return value is cached on subsequent calls). If is truthy, then raw JSON in string format is returned. An array of events. Each event represents some game action in the following format: The property is different for each event type according to the following table:

- **`getPositionAt(x, y)`**  _(CPU: 低)_
  - Creates a object at the specified location. The X position. The Y position. A object or null if it cannot be obtained.

- **`getTerrain()`**  _(CPU: 极低)_
  - Get a object which provides fast access to static terrain data. This method works for any room in the world even if you have no access to it. Returns new object.

- **`lookAt(target)`**  _(CPU: 中)_
  - Get the list of objects at the specified room position. X position in the room. Y position in the room. Can be a object or any object containing . An array with objects at the specified position in the following format:

- **`lookAtArea(top, left, bottom, right, [asArray])`**  _(CPU: 中)_
  - Get the list of objects at the specified room area. The top Y boundary of the area. The left X boundary of the area. The bottom Y boundary of the area. The right X boundary of the area. Set to true if you want to get the result as a plain array. If is set to false or undefined, the method returns an object with all the objects in the specified area in the following format: If is set to true, the method returns an array in the following format:

- **`lookForAt(type, target)`**  _(CPU: 低)_
  - Get an object with the given type at the specified room position. One of the constants. X position in the room. Y position in the room. Can be a object or any object containing . An array of objects of the given type at the specified position if found.

- **`lookForAtArea(type, top, left, bottom, right, [asArray])`**  _(CPU: 低)_
  - Get the list of objects with the given type at the specified room area. One of the constants. The top Y boundary of the area. The left X boundary of the area. The bottom Y boundary of the area. The right X boundary of the area. Set to true if you want to get the result as a plain array. If is set to false or undefined, the method returns an object with all the objects of the given type in the specified area in the following format: If is set to true, the method returns an array in the following format:

## Room-Terrain

An object which provides fast access to room terrain data. These objects can be constructed for any room in the world even if you have no access to it. Technically every Room.Terrain object is a very lightweight adapter to underlying static terrain buffers with corresponding minimal accessors.

### 属性 (Properties)

- **`constructor`** → ``
  - Creates a new of room by its name. objects can be constructed for any room in the world even if you have no access to it. The room name.

### 方法 (Methods)

- **`get(x, y)`**  _(CPU: 极低)_
  - Get terrain type at the specified room position by coordinates. Unlike the method, this one doesn't perform any string operations and returns integer terrain type values (see below). X position in the room. Y position in the room. One of the following integer values:

- **`getRawBuffer([destinationArray])`**  _(CPU: 低)_
  - Get copy of underlying static terrain buffer. . A typed array view in which terrain will be copied to. See usage examples. Learn more about . Copy of underlying room terrain representations as a new of size 2500. Each element is an integer number, terrain type can be obtained by applying bitwise AND () operator with appropriate constant. Room tiles are stored . If is specified, function returns reference to this filled if coping succeeded, or error code otherwise:

## RoomVisual

Room visuals provide a way to show various visual debug info in game rooms. You can use the RoomVisual object to draw simple shapes that are visible only to you. Every existing Room object already contains the visual property, but you also can create new RoomVisual objects for any room (even without visibility) using the constructor. Room visuals are not stored in the database, their only purpose is to display something in your browser. All drawings will persist for one tick and will disappear if not updated. All RoomVisual API calls have no added CPU cost (their cost is natural and mostly related to simple JSON.serialize calls). However, there is a usage limit: you cannot post more than 500 KB of serialized data per one room (see getSize method). All draw coordinates are measured in game coordinates and centered to tile centers, i.e. (10,10) will point to the center of the creep at x:10; y:10 position. Fractional coordinates are allowed.

### 属性 (Properties)

- **`constructor`** → ``
  - You can directly create new object in any room, even if it's invisible to your script. The room name. If undefined, visuals will be posted to all rooms simultaneously.

- **`roomName`** → `string`
  - The name of the room.

### 方法 (Methods)

- **`line(pos1, pos2, [style])`**  _(CPU: 极低)_
  - Draw a line. The start X coordinate. The start Y coordinate. The finish X coordinate. The finish Y coordinate. The start position object. The finish position object. An object with the following properties: The object itself, so that you can chain calls.
  - **参数 (opts 子项 / 详细):**
    - `width` (`number`) — Line width, default is 0.1.
    - `color` (`number`) — Line width, default is 0.1.
    - `opacity` (`number`) — Line width, default is 0.1.
    - `lineStyle` (`number`) — Line width, default is 0.1.

- **`circle(pos, [style])`**  _(CPU: 极低)_
  - Draw a circle. The X coordinate of the center. The Y coordinate of the center. The position object of the center. An object with the following properties: The object itself, so that you can chain calls.
  - **参数 (opts 子项 / 详细):**
    - `radius` (`number`) — Circle radius, default is 0.15.
    - `fill` (`number`) — Circle radius, default is 0.15.
    - `opacity` (`number`) — Circle radius, default is 0.15.
    - `stroke` (`number`) — Circle radius, default is 0.15.
    - `strokeWidth` (`number`) — Circle radius, default is 0.15.
    - `lineStyle` (`number`) — Circle radius, default is 0.15.

- **`rect(topLeftPos, width, height, [style])`**  _(CPU: 极低)_
  - Draw a rectangle. The X coordinate of the top-left corner. The Y coordinate of the top-left corner. The position object of the top-left corner. The width of the rectangle. The height of the rectangle. An object with the following properties: The object itself, so that you can chain calls.
  - **参数 (opts 子项 / 详细):**
    - `fill` (`string`) — Fill color in any web format, default is (white).
    - `opacity` (`string`) — Fill color in any web format, default is (white).
    - `stroke` (`string`) — Fill color in any web format, default is (white).
    - `strokeWidth` (`string`) — Fill color in any web format, default is (white).
    - `lineStyle` (`string`) — Fill color in any web format, default is (white).

- **`poly(points, [style])`**  _(CPU: 极低)_
  - Draw a polyline. An array of points. Every item should be either an array with 2 numbers (i.e. ), or a object. An object with the following properties: The object itself, so that you can chain calls.
  - **参数 (opts 子项 / 详细):**
    - `fill` (`string`) — Fill color in any web format, default is (no fill).
    - `opacity` (`string`) — Fill color in any web format, default is (no fill).
    - `stroke` (`string`) — Fill color in any web format, default is (no fill).
    - `strokeWidth` (`string`) — Fill color in any web format, default is (no fill).
    - `lineStyle` (`string`) — Fill color in any web format, default is (no fill).

- **`text(text, pos, [style])`**  _(CPU: 极低)_
  - Draw a text label. You can use any valid Unicode characters, including . The text message. The X coordinate of the label baseline point. The Y coordinate of the label baseline point. The position object of the label baseline. An object with the following properties: The object itself, so that you can chain calls.
  - **参数 (opts 子项 / 详细):**
    - `color` (`string`) — Font color in any web format, default is (white).
    - `font` (`string`) — Font color in any web format, default is (white).
    - `stroke` (`string`) — Font color in any web format, default is (white).
    - `strokeWidth` (`string`) — Font color in any web format, default is (white).
    - `backgroundColor` (`string`) — Font color in any web format, default is (white).
    - `backgroundPadding` (`string`) — Font color in any web format, default is (white).
    - `align` (`string`) — Font color in any web format, default is (white).
    - `opacity` (`string`) — Font color in any web format, default is (white).

- **`clear()`**  _(CPU: 极低)_
  - Remove all visuals from the room. The object itself, so that you can chain calls.

- **`getSize()`**  _(CPU: 极低)_
  - Get the stored size of all visuals added in the room in the current tick. It must not exceed 512,000 (500 KB). The size of the visuals in bytes.

- **`export()`**  _(CPU: 极低)_
  - Returns a compact representation of all visuals added in the room in the current tick. A string with visuals data. There's not much you can do with the string besides store them for later.

- **`import(val)`**  _(CPU: 极低)_
  - Add previously exported (with ) room visuals to the room visual data of the current tick. The string returned from RoomVisual.export. The object itself, so that you can chain calls.

## Store

An object that can contain resources in its cargo. There are two types of stores in the game: general purpose stores and limited stores. General purpose stores can contain any resource within its capacity (e.g. creeps, containers, storages, terminals). Limited stores can contain only a few types of resources needed for that particular object (e.g. spawns, extensions, labs, nukers). The Store prototype is the same for both types of stores, but they have different behavior depending on the resource argument in its methods. You can get specific resources from the store by addressing them as object properties:

### 方法 (Methods)

- **`getCapacity([resource])`**  _(CPU: 极低)_
  - Returns capacity of this store for the specified resource. For a general purpose store, it returns total capacity if is undefined. The type of the resource. Returns capacity number, or in case of an invalid for this store type.

- **`getFreeCapacity([resource])`**  _(CPU: 极低)_
  - Returns free capacity for the store. For a limited store, it returns the capacity available for the specified resource if is defined and valid for this store. The type of the resource. Returns available capacity number, or in case of an invalid for this store type.

- **`getUsedCapacity([resource])`**  _(CPU: 极低)_
  - Returns the capacity used by the specified resource. For a general purpose store, it returns total used capacity if is undefined. The type of the resource. Returns used capacity number, or in case of a not valid for this store type.

## Structure

The base prototype object of all structures.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number`
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number`
  - The total amount of hit points of the structure.

- **`id`** → `string`
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string`
  - One of the constants.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

## OwnedStructure

The base prototype for a structure that has an owner. Such structures can be found using FIND_MY_STRUCTURES and FIND_HOSTILE_STRUCTURES constants.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`my`** → `boolean`
  - Whether this is your own structure.

- **`owner`** → `object`
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

## ConstructionSite

A site of a structure which is currently under construction. A construction site can be created using the 'Construct' button at the left of the game field or the Room.createConstructionSite method. To build a structure on the construction site, give a worker creep some amount of energy and perform Creep.build action. You can remove enemy construction sites by moving a creep on it.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`id`** → `string`
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`my`** → `boolean`
  - Whether this is your own construction site.

- **`owner`** → `object`
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

- **`progress`** → `number`
  - The current construction progress.

- **`progressTotal`** → `number`
  - The total construction progress needed for the structure to be built.

- **`structureType`** → `string`
  - One of the constants.

### 方法 (Methods)

- **`remove()`**  _(CPU: 动作(返回OK时+0.2))_
  - Remove the construction site. One of the following codes:

## Flag

A flag. Flags can be used to mark particular spots in a room. Flags are visible to their owners only. You cannot have more than 10,000 flags.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`color`** → `number`
  - Flag primary color. One of the constants.

- **`memory`** → `any`
  - A shorthand to . You can use it for quick access the flag's specific memory data object.

- **`name`** → `string`
  - Flag’s name. You can choose the name while creating a new flag, and it cannot be changed later. This name is a hash key to access the flag via the object. The maximum name length is 100 charactes.

- **`secondaryColor`** → `number`
  - Flag secondary color. One of the constants.

### 方法 (Methods)

- **`remove()`**  _(CPU: 动作(返回OK时+0.2))_
  - Remove the flag. Always returns OK .

- **`setColor(color, [secondaryColor])`**  _(CPU: 动作(返回OK时+0.2))_
  - Set new color of the flag. Primary color of the flag. One of the constants. Secondary color of the flag. One of the constants. One of the following codes:

- **`setPosition(pos)`**  _(CPU: 动作(返回OK时+0.2))_
  - Set new position of the flag. The X position in the room. The Y position in the room. Can be a object or any object containing . One of the following codes:

## Resource

A dropped piece of resource. It will decay after a while if not picked up. Dropped resource pile decays for ceil(amount/1000) units per tick.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`amount`** → `number`
  - The amount of resource units containing.

- **`id`** → `string`
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`resourceType`** → `string`
  - One of the constants.

## Tombstone

A remnant of dead creeps. This is a walkable object.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`creep`** → `Creep | PowerCreep`
  - An object containing the deceased creep or power creep.

- **`deathTime`** → `number`
  - Time of death.

- **`id`** → `string`
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`store`** → `Store`
  - A object that contains cargo of this structure.

- **`ticksToDecay`** → `number`
  - The amount of game ticks before this tombstone decays.

## Ruin

A destroyed structure. This is a walkable object.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`destroyTime`** → `number`
  - The time when the structure has been destroyed.

- **`id`** → `string`
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`store`** → `Store`
  - A object that contains resources of this structure.

- **`structure`** → `Structure | OwnedStructure`
  - An object containing basic data of the destroyed structure.

- **`ticksToDecay`** → `number`
  - The amount of game ticks before this ruin decays.

## Source

An energy source object. Can be harvested by creeps with a WORK body part.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`energy`** → `number`
  - The remaining amount of energy.

- **`energyCapacity`** → `number`
  - The total amount of energy in the source.

- **`id`** → `string`
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`ticksToRegeneration`** → `number`
  - The remaining time after which the source will be refilled.

## Mineral

A mineral deposit. Can be harvested by creeps with a WORK body part using the extractor structure. Learn more about minerals from this article.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`density`** → `number`
  - The density that this mineral deposit will be refilled to once reaches 0. This is one of the constants.

- **`mineralAmount`** → `number`
  - The remaining amount of resources.

- **`mineralType`** → `string`
  - The resource type, one of the constants.

- **`id`** → `string`
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`ticksToRegeneration`** → `number`
  - The remaining time after which the deposit will be refilled.

## Deposit

A rare resource deposit needed for producing commodities. Can be harvested by creeps with a WORK body part. Each harvest operation triggers a cooldown period, which becomes longer and longer over time. Learn more about deposits from this article.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`cooldown`** → `number`
  - The amount of game ticks until the next harvest action is possible.

- **`depositType`** → `string`
  - The deposit type, one of the following constants:

- **`id`** → `string`
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`lastCooldown`** → `number`
  - The cooldown of the last harvest operation on this deposit.

- **`ticksToDecay`** → `number`
  - The amount of game ticks when this deposit will disappear.

## Nuke

A nuke landing position. This object cannot be removed or modified. You can find incoming nukes in the room using the FIND_NUKES constant. Note that you can stack multiple nukes from different rooms at the same target position to increase damage. Nuke landing does not generate tombstones and ruins, and destroys all existing tombstones and ruins in the room If the room is in safe mode, then the safe mode is cancelled immediately, and the safe mode cooldown is reset to 0. The room controller is hit by triggering upgradeBlocked period, which means it is unavailable to activate safe mode again within the next 200 ticks.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`id`** → `string`
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`launchRoomName`** → `string`
  - The name of the room where this nuke has been launched from.

- **`timeToLand`** → `number`
  - The remaining landing time.


## Creep

## Creep

Creeps are your units. Creeps can move, harvest energy, construct structures, attack another creeps, and perform other actions. Each creep consists of up to 50 body parts with the following possible types: Harvests 2 energy units from a source per tick. Harvests 1 resource unit from a mineral or a deposit per tick. Builds a structure for 5 energy units per tick. Repairs a structure for 100 hits per tick consuming 1 energy unit per tick. Dismantles a structure for 50 hits per tick returning 0.25 energy unit per tick. Upgrades a controller for 1 energy unit per tick. Attacks another single creep/structure with 10 hits per tick in a long-range attack up to 3 squares long. Attacks all hostile creeps/structures within 3 squares range with 1-4-10 hits (depending on the range). Claims a neutral room controller. Reserves a neutral room controller for 1 tick per body part. Attacks a hostile room controller downgrading its timer by 300 ticks per body parts. Attacks a neutral room controller reservation timer by 1 tick per body parts. A creep with this body part will have a reduced life time of 600 ticks and cannot be renewed.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`body`** → `array`
  - An array describing the creep’s body. Each element contains the following properties: If the body part is boosted, this property specifies the mineral type which is used for boosting. One of the constants. One of the body part types constants. The remaining amount of hit points of this body part.

- **`carry`** → `object` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`carryCapacity`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`fatigue`** → `number`
  - The movement fatigue indicator. If it is greater than zero, the creep cannot move.

- **`hits`** → `number`
  - The current amount of hit points of the creep.

- **`hitsMax`** → `number`
  - The maximum amount of hit points of the creep.

- **`id`** → `string`
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`memory`** → `any`
  - A shorthand to . You can use it for quick access the creep’s specific memory data object.

- **`my`** → `boolean`
  - Whether it is your creep or foe.

- **`name`** → `string`
  - Creep’s name. You can choose the name while creating a new creep, and it cannot be changed later. This name is a hash key to access the creep via the object.

- **`owner`** → `object`
  - An object with the creep’s owner info containing the following properties: The name of the owner user.

- **`saying`** → `string`
  - The text message that the creep was saying at the last tick.

- **`spawning`** → `boolean`
  - Whether this creep is still being spawned.

- **`store`** → `Store`
  - A object that contains cargo of this creep.

- **`ticksToLive`** → `number`
  - The remaining amount of game ticks after which the creep will die.

### 方法 (Methods)

- **`attack(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Attack another creep, power creep, or structure in a short-ranged attack. Requires the body part. If the target is inside a rampart, then the rampart is attacked instead. The target has to be at adjacent square to the creep. If the target is a creep with body parts and is not inside a rampart, it will automatically hit back at the attacker. The target object to be attacked. One of the following codes:

- **`attackController(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Decreases the controller's downgrade timer by 300 ticks per every body part, or reservation timer by 1 tick per every body part. If the controller under attack is owned, it cannot be upgraded or attacked again for the next 1,000 ticks. The target has to be at adjacent square to the creep. The target controller object. One of the following codes:

- **`build(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Build a structure at the target construction site using carried energy. Requires and body parts. The target has to be within 3 squares range of the creep. The target construction site to be built. One of the following codes:

- **`cancelOrder(methodName)`**  _(CPU: 极低)_
  - Cancel the order given during the current game tick. The name of a creep's method to be cancelled. One of the following codes:

- **`claimController(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Claims a neutral controller under your control. Requires the body part. The target has to be at adjacent square to the creep. You need to have the corresponding Global Control Level in order to claim a new room. If you don't have enough GCL, consider this room instead. The target controller object. One of the following codes:

- **`dismantle(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Dismantles any structure that can be constructed (even hostile) returning 50% of the energy spent on its repair. Requires the body part. If the creep has an empty body part, the energy is put into it; otherwise it is dropped on the ground. The target has to be at adjacent square to the creep. The target structure. One of the following codes:

- **`drop(resourceType, [amount])`**  _(CPU: 动作(返回OK时+0.2))_
  - Drop this resource on the ground. One of the constants. The amount of resource units to be dropped. If omitted, all the available carried amount is used. One of the following codes:

- **`generateSafeMode(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Add one more available safe mode activation to a room controller. The creep has to be at adjacent square to the target room controller and have 1000 ghodium resource. The target room controller. One of the following codes:

- **`getActiveBodyparts(type)`**  _(CPU: 极低)_
  - Get the quantity of live body parts of the given type. Fully damaged parts do not count. A body part type, one of the following body part constants: A number representing the quantity of body parts.

- **`harvest(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Harvest energy from the source or resources from minerals and deposits. Requires the body part. If the creep has an empty body part, the harvested resource is put into it; otherwise it is dropped on the ground. The target has to be at an adjacent square to the creep. The object to be harvested. One of the following codes:

- **`heal(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Heal self or another creep. It will restore the target creep’s damaged body parts function and increase the hits counter. Requires the body part. The target has to be at adjacent square to the creep. The target creep object. One of the following codes:

- **`move(direction)`**  _(CPU: 动作(返回OK时+0.2))_
  - Move the creep one square in the specified direction. Requires the body part, or another creep nearby the creep. In case if you call on a creep nearby, the and the checks will be bypassed; otherwise, the check will be bypassed. A creep nearby, or one of the following constants: One of the following codes:

- **`moveByPath(path)`**  _(CPU: 动作(返回OK时+0.2))_
  - Move the creep using the specified predefined path. Requires the body part. A path value as returned from , , or methods. Both array form and serialized string form are accepted. One of the following codes:

- **`moveTo(target, [opts])`**  _(CPU: 高)_
  - Find the optimal path to the target within the same room and move to it. A shorthand to consequent calls of and methods. If the target is in another room, then the corresponding exit will be used as a target. Requires the body part. X position of the target in the same room. Y position of the target in the same room. Can be a object or any object containing . The position doesn't have to be in the same room with the creep. An object containing additional options: One of the following codes:
  - **参数 (opts 子项 / 详细):**
    - `reusePath` (`number`) — This option enables reusing the path found along multiple game ticks. It allows to save CPU time, but can result in a slightly slower creep reaction behavior. The path is stored into the creep's memory to the property. The value defines the amount of ticks which the path should be reused for. The default value is 5. Increase the amount to save more CPU, decrease to make the movement more consistent. Set to 0 if you want to disable path reusing.
    - `serializeMemory` (`number`) — This option enables reusing the path found along multiple game ticks. It allows to save CPU time, but can result in a slightly slower creep reaction behavior. The path is stored into the creep's memory to the property. The value defines the amount of ticks which the path should be reused for. The default value is 5. Increase the amount to save more CPU, decrease to make the movement more consistent. Set to 0 if you want to disable path reusing.
    - `noPathFinding` (`number`) — This option enables reusing the path found along multiple game ticks. It allows to save CPU time, but can result in a slightly slower creep reaction behavior. The path is stored into the creep's memory to the property. The value defines the amount of ticks which the path should be reused for. The default value is 5. Increase the amount to save more CPU, decrease to make the movement more consistent. Set to 0 if you want to disable path reusing.
    - `visualizePathStyle` (`number`) — This option enables reusing the path found along multiple game ticks. It allows to save CPU time, but can result in a slightly slower creep reaction behavior. The path is stored into the creep's memory to the property. The value defines the amount of ticks which the path should be reused for. The default value is 5. Increase the amount to save more CPU, decrease to make the movement more consistent. Set to 0 if you want to disable path reusing.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_
  - Toggle auto notification when the creep is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

- **`pickup(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Pick up an item (a dropped piece of energy). Requires the body part. The target has to be at adjacent square to the creep or at the same square. The target object to be picked up. One of the following codes:

- **`pull(target)`**  _(CPU: 极低)_
  - Help another creep to follow this creep. The fatigue generated for the target's move will be added to the creep instead of the target. Requires the body part. The target has to be at adjacent square to the creep. The creep must elsewhere, and the target must towards the creep. The target creep. One of the following codes:

- **`rangedAttack(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - A ranged attack against another creep or structure. Requires the body part. If the target is inside a rampart, the rampart is attacked instead. The target has to be within 3 squares range of the creep. The target object to be attacked. One of the following codes:

- **`rangedHeal(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Heal another creep at a distance. It will restore the target creep’s damaged body parts function and increase the hits counter. Requires the body part. The target has to be within 3 squares range of the creep. The target creep object. One of the following codes:

- **`rangedMassAttack()`**  _(CPU: 动作(返回OK时+0.2))_
  - A ranged attack against all hostile creeps or structures within 3 squares range. Requires the body part. The attack power depends on the range to each target. Friendly units are not affected. One of the following codes:

- **`repair(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Repair a damaged structure using carried energy. Requires the and body parts. The target has to be within 3 squares range of the creep. The target structure to be repaired. One of the following codes:

- **`reserveController(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Temporarily block a neutral controller from claiming by other players and restore energy sources to their full capacity. Each tick, this command increases the counter of the period during which the controller is unavailable by 1 tick per each body part. The maximum reservation period to maintain is 5,000 ticks. The target has to be at adjacent square to the creep. The target controller object to be reserved. One of the following codes:

- **`say(message, [public])`**  _(CPU: 极低)_
  - Display a visual speech balloon above the creep with the specified message. The message will be available for one tick. You can read the last message using the property. Any valid Unicode characters are allowed, including . The message to be displayed. Maximum length is 10 characters. Set to true to allow other players to see this message. Default is false. One of the following codes:

- **`signController(target, text)`**  _(CPU: 动作(返回OK时+0.2))_
  - Sign a controller with an arbitrary text visible to all players. This text will appear in the room UI, in the world map, and can be accessed via the API. You can sign unowned and hostile controllers. The target has to be at adjacent square to the creep. Pass an empty string to remove the sign. The target controller object to be signed. The sign text. The string is cut off after 100 characters. One of the following codes:

- **`suicide()`**  _(CPU: 动作(返回OK时+0.2))_
  - Kill the creep immediately. One of the following codes:

- **`transfer(target, resourceType, [amount])`**  _(CPU: 动作(返回OK时+0.2))_
  - Transfer resource from the creep to another object. The target has to be at adjacent square to the creep. The target object. One of the constants. The amount of resources to be transferred. If omitted, all the available carried amount is used. One of the following codes:

- **`upgradeController(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Upgrade your controller to the next level using carried energy. Upgrading controllers raises your Global Control Level in parallel. Requires and body parts. The target has to be within 3 squares range of the creep. A fully upgraded level 8 controller can't be upgraded over 15 energy units per tick regardless of creeps abilities. The cumulative effect of all the creeps performing in the current tick is taken into account. This limit can be increased by using . Upgrading the controller raises its timer by 100. The timer must be full in order for controller to be levelled up. The target controller object to be upgraded. One of the following codes:

- **`withdraw(target, resourceType, [amount])`**  _(CPU: 动作(返回OK时+0.2))_
  - Withdraw resources from a structure or tombstone. The target has to be at adjacent square to the creep. Multiple creeps can withdraw from the same object in the same tick. Your creeps can withdraw resources from hostile structures/tombstones as well, in case if there is no hostile rampart on top of it. This method should not be used to transfer resources between creeps. To transfer between creeps, use the method on the original creep. The target object. One of the constants. The amount of resources to be transferred. If omitted, all the available amount is used. One of the following codes:

## PowerCreep

Power Creeps are immortal "heroes" that are tied to your account and can be respawned in any PowerSpawn after death. You can upgrade their abilities ("powers") up to your account Global Power Level (see Game.gpl). Full list of available powers

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`carry`** → `object` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`carryCapacity`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`className`** → `string`
  - The power creep's class, one of the constants.

- **`deleteTime`** → `number`
  - A timestamp when this creep is marked to be permanently deleted from the account, or undefined otherwise.

- **`hits`** → `number`
  - The current amount of hit points of the creep.

- **`hitsMax`** → `number`
  - The maximum amount of hit points of the creep.

- **`id`** → `string`
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`level`** → `number`
  - The power creep's level.

- **`memory`** → `any`
  - A shorthand to . You can use it for quick access the creep’s specific memory data object.

- **`my`** → `boolean`
  - Whether it is your creep or foe.

- **`name`** → `string`
  - Power creep’s name. You can choose the name while creating a new power creep, and it cannot be changed later. This name is a hash key to access the creep via the object.

- **`owner`** → `object`
  - An object with the creep’s owner info containing the following properties:

- **`store`** → `Store`
  - A object that contains cargo of this creep.

- **`powers`** → `object`
  - Available powers, an object with power ID as a key, and the following properties: Current level of the power. Cooldown ticks remaining, or undefined if the power creep is not spawned in the world.

- **`saying`** → `string`
  - The text message that the creep was saying at the last tick.

- **`shard`** → `string`
  - The name of the shard where the power creep is spawned, or undefined.

- **`spawnCooldownTime`** → `number`
  - The timestamp when spawning or deleting this creep will become available. Undefined if the power creep is spawned in the world.

- **`ticksToLive`** → `number`
  - The remaining amount of game ticks after which the creep will die and become unspawned. Undefined if the creep is not spawned in the world.

### 方法 (Methods)

- **`PowerCreep.create(name, className)`**  _(CPU: 低)_
  - A static method to create new Power Creep instance in your account. It will be added in an unspawned state, use method to spawn it in the world. You need one free Power Level in your account to perform this action. The name of the new power creep. The name length limit is 100 characters. The class of the new power creep, one of the constants. One of the following codes:

- **`cancelOrder(methodName)`**  _(CPU: 极低)_
  - Cancel the order given during the current game tick. The name of a creep's method to be cancelled. One of the following codes:

- **`delete([cancel])`**  _(CPU: 动作(返回OK时+0.2))_
  - Delete the power creep permanently from your account. It should NOT be spawned in the world. The creep is not deleted immediately, but a 24-hours delete timer is started instead (see ). You can cancel deletion by calling . Set this to true to cancel previously scheduled deletion. One of the following codes:

- **`drop(resourceType, [amount])`**  _(CPU: 动作(返回OK时+0.2))_
  - Drop this resource on the ground. One of the constants. The amount of resource units to be dropped. If omitted, all the available carried amount is used. One of the following codes:

- **`enableRoom(controller)`**  _(CPU: 动作(返回OK时+0.2))_
  - Enable powers usage in this room. The room controller should be at adjacent tile. The room controller. One of the following codes:

- **`move(direction)`**  _(CPU: 动作(返回OK时+0.2))_
  - Move the creep one square in the specified direction. A creep nearby, or one of the following constants: One of the following codes:

- **`moveByPath(path)`**  _(CPU: 动作(返回OK时+0.2))_
  - Move the creep using the specified predefined path. A path value as returned from , , or methods. Both array form and serialized string form are accepted. One of the following codes:

- **`moveTo(target, [opts])`**  _(CPU: 高)_
  - Find the optimal path to the target within the same room and move to it. A shorthand to consequent calls of and methods. If the target is in another room, then the corresponding exit will be used as a target. X position of the target in the same room. Y position of the target in the same room. Can be a object or any object containing . The position doesn't have to be in the same room with the creep. An object containing additional options: One of the following codes:
  - **参数 (opts 子项 / 详细):**
    - `reusePath` (`number`) — This option enables reusing the path found along multiple game ticks. It allows to save CPU time, but can result in a slightly slower creep reaction behavior. The path is stored into the creep's memory to the property. The value defines the amount of ticks which the path should be reused for. The default value is 5. Increase the amount to save more CPU, decrease to make the movement more consistent. Set to 0 if you want to disable path reusing.
    - `serializeMemory` (`number`) — This option enables reusing the path found along multiple game ticks. It allows to save CPU time, but can result in a slightly slower creep reaction behavior. The path is stored into the creep's memory to the property. The value defines the amount of ticks which the path should be reused for. The default value is 5. Increase the amount to save more CPU, decrease to make the movement more consistent. Set to 0 if you want to disable path reusing.
    - `noPathFinding` (`number`) — This option enables reusing the path found along multiple game ticks. It allows to save CPU time, but can result in a slightly slower creep reaction behavior. The path is stored into the creep's memory to the property. The value defines the amount of ticks which the path should be reused for. The default value is 5. Increase the amount to save more CPU, decrease to make the movement more consistent. Set to 0 if you want to disable path reusing.
    - `visualizePathStyle` (`number`) — This option enables reusing the path found along multiple game ticks. It allows to save CPU time, but can result in a slightly slower creep reaction behavior. The path is stored into the creep's memory to the property. The value defines the amount of ticks which the path should be reused for. The default value is 5. Increase the amount to save more CPU, decrease to make the movement more consistent. Set to 0 if you want to disable path reusing.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_
  - Toggle auto notification when the creep is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

- **`pickup(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Pick up an item (a dropped piece of energy). The target has to be at adjacent square to the creep or at the same square. The target object to be picked up. One of the following codes:

- **`rename(name)`**  _(CPU: 极低)_
  - Rename the power creep. It must not be spawned in the world. The new name of the power creep. One of the following codes:

- **`renew(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Instantly restore time to live to the maximum using a Power Spawn or a Power Bank nearby. It has to be at adjacent tile. The target structure. One of the following codes:

- **`say(message, [public])`**  _(CPU: 极低)_
  - Display a visual speech balloon above the creep with the specified message. The message will be available for one tick. You can read the last message using the property. Any valid Unicode characters are allowed, including . The message to be displayed. Maximum length is 10 characters. Set to true to allow other players to see this message. Default is false. One of the following codes:

- **`spawn(powerSpawn)`**  _(CPU: 动作(返回OK时+0.2))_
  - Spawn this power creep in the specified Power Spawn. Your Power Spawn structure. One of the following codes:

- **`suicide()`**  _(CPU: 动作(返回OK时+0.2))_
  - Kill the power creep immediately. It will not be destroyed permanently, but will become unspawned, so that you can it again. One of the following codes:

- **`transfer(target, resourceType, [amount])`**  _(CPU: 动作(返回OK时+0.2))_
  - Transfer resource from the creep to another object. The target has to be at adjacent square to the creep. The target object. One of the constants. The amount of resources to be transferred. If omitted, all the available carried amount is used. One of the following codes:

- **`upgrade(power)`**  _(CPU: 动作(返回OK时+0.2))_
  - Upgrade the creep, adding a new power ability to it or increasing level of the existing power. You need one free Power Level in your account to perform this action. The power ability to upgrade, one of the constants. One of the following codes:

- **`usePower(power, [target])`**  _(CPU: 动作(返回OK时+0.2))_
  - Apply one the creep's powers on the specified target. You can only use powers in rooms either without a controller, or with a controller. Only one power can be used during the same tick, each call will override the previous one. If the target has the same effect of a lower or equal level, it is overridden. If the existing effect level is higher, an error is returned. The power ability to use, one of the constants. A target object in the room. One of the following codes:

- **`withdraw(target, resourceType, [amount])`**  _(CPU: 动作(返回OK时+0.2))_
  - Withdraw resources from a structure or tombstone. The target has to be at adjacent square to the creep. Multiple creeps can withdraw from the same object in the same tick. Your creeps can withdraw resources from hostile structures/tombstones as well, in case if there is no hostile rampart on top of it. This method should not be used to transfer resources between creeps. To transfer between creeps, use the method on the original creep. The target object. One of the constants. The amount of resources to be transferred. If omitted, all the available amount is used. One of the following codes:


## 建筑 (Structures)

## StructureSpawn

Spawn is your colony center. This structure can create, renew, and recycle creeps. All your spawns are accessible through Game.spawns hash list. Spawns auto-regenerate a little amount of energy each tick, so that you can easily recover even if all your creeps died.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`my`** → `boolean` _(继承自 Inherited from)_
  - Whether this is your own structure.

- **`owner`** → `object` _(继承自 Inherited from)_
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

- **`energy`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`energyCapacity`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`memory`** → `any`
  - A shorthand to . You can use it for quick access the spawn’s specific memory data object.

- **`name`** → `string`
  - Spawn’s name. You choose the name upon creating a new spawn, and it cannot be changed later. This name is a hash key to access the spawn via the object.

- **`spawning`** → `StructureSpawn.Spawning`
  - If the spawn is in process of spawning a new creep, this object will contain a object, or null otherwise.

- **`store`** → `Store`
  - A object that contains cargo of this structure.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

- **`canCreateCreep(body, [name])`**  _(CPU: 低)_ ⚠️已废弃
  - This method is deprecated and will be removed soon. Please use with flag instead. Check if a creep can be created. An array describing the new creep’s body. Should contain 1 to 50 elements with one of these constants: The name of a new creep. The name length limit is 100 characters. It should be unique creep name, i.e. the object should not contain another creep with the same name (hash key). If not defined, a random name will be generated. One of the following codes:

- **`createCreep(body, [name], [memory])`**  _(CPU: 动作(返回OK时+0.2))_ ⚠️已废弃
  - This method is deprecated and will be removed soon. Please use instead. Start the creep spawning process. The required energy amount can be withdrawn from all spawns and extensions in the room. An array describing the new creep’s body. Should contain 1 to 50 elements with one of these constants: The name of a new creep. The name length limit is 100 characters. It should be unique creep name, i.e. the object should not contain another creep with the same name (hash key). If not defined, a random name will be generated. The memory of a new creep. If provided, it will be immediately stored into . The name of a new creep or one of these error codes:

- **`spawnCreep(body, name, [opts])`**  _(CPU: 动作(返回OK时+0.2))_
  - Start the creep spawning process. The required energy amount can be withdrawn from all spawns and extensions in the room. An array describing the new creep’s body. Should contain 1 to 50 elements with one of these constants: The name of a new creep. The name length limit is 100 characters. It must be a unique creep name, i.e. the object should not contain another creep with the same name (hash key). An object with additional options for the spawning process. One of the following codes:
  - **参数 (opts 子项 / 详细):**
    - `memory` (`any`) — Memory of the new creep. If provided, it will be immediately stored into .
    - `energyStructures` (`any`) — Memory of the new creep. If provided, it will be immediately stored into .
    - `dryRun` (`any`) — Memory of the new creep. If provided, it will be immediately stored into .
    - `directions` (`any`) — Memory of the new creep. If provided, it will be immediately stored into .

- **`recycleCreep(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Kill the creep and drop up to 100% of resources spent on its spawning and boosting depending on remaining life time. The target should be at adjacent square. Energy return is limited to 125 units per body part. The target creep object. One of the following codes:

- **`renewCreep(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Increase the remaining time to live of the target creep. The target should be at adjacent square. The target should not have CLAIM body parts. The spawn should not be busy with the spawning process. Each execution increases the creep's timer by amount of ticks according to this formula: Energy required for each execution is determined using this formula: Renewing a creep removes all of its boosts. The target creep object. One of the following codes:

## StructureSpawn-Spawning

Details of the creep being spawned currently that can be addressed by the StructureSpawn.spawning property.

### 属性 (Properties)

- **`directions`** → `array`
  - An array with the spawn directions, see .

- **`name`** → `string`
  - The name of a new creep.

- **`needTime`** → `number`
  - Time needed in total to complete the spawning.

- **`remainingTime`** → `number`
  - Remaining time to go.

- **`spawn`** → `StructureSpawn`
  - A link to the spawn.

### 方法 (Methods)

- **`cancel()`**  _(CPU: 动作(返回OK时+0.2))_
  - Cancel spawning immediately. Energy spent on spawning is not returned. One of the following codes:

- **`setDirections(directions)`**  _(CPU: 动作(返回OK时+0.2))_
  - Set desired directions where the creep should move when spawned. An array with the direction constants: One of the following codes:

## StructureExtension

Contains energy which can be spent on spawning bigger creeps. Extensions can be placed anywhere in the room, any spawns will be able to use them regardless of distance.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`my`** → `boolean` _(继承自 Inherited from)_
  - Whether this is your own structure.

- **`owner`** → `object` _(继承自 Inherited from)_
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

- **`energy`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`energyCapacity`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for . The total amount of energy the extension can contain.

- **`store`** → `Store`
  - A object that contains cargo of this structure.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

## StructureTower

Remotely attacks or heals creeps, or repairs structures. Can be targeted to any object in the room. However, its effectiveness linearly depends on the distance. Each action consumes energy.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`my`** → `boolean` _(继承自 Inherited from)_
  - Whether this is your own structure.

- **`owner`** → `object` _(继承自 Inherited from)_
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

- **`energy`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`energyCapacity`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`store`** → `Store`
  - A object that contains cargo of this structure.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

- **`attack(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Remotely attack any creep, power creep or structure in the room. The target object. One of the following codes:

- **`heal(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Remotely heal any creep or power creep in the room. The target object. One of the following codes:

- **`repair(target)`**  _(CPU: 动作(返回OK时+0.2))_
  - Remotely repair any structure in the room. The target structure. One of the following codes:

## StructureContainer

A small container that can be used to store resources. This is a walkable structure. All dropped resources automatically goes to the container at the same tile.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`store`** → `Store`
  - A object that contains cargo of this structure.

- **`storeCapacity`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`ticksToDecay`** → `number`
  - The amount of game ticks when this container will lose some hit points.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

## StructureStorage

A structure that can store huge amount of resource units. Only one structure per room is allowed that can be addressed by Room.storage property.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`my`** → `boolean` _(继承自 Inherited from)_
  - Whether this is your own structure.

- **`owner`** → `object` _(继承自 Inherited from)_
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

- **`store`** → `Store`
  - A object that contains cargo of this structure.

- **`storeCapacity`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

## StructureTerminal

Sends any resources to a Terminal in another room. The destination Terminal can belong to any player. Each transaction requires additional energy (regardless of the transfer resource type) that can be calculated using Game.market.calcTransactionCost method. For example, sending 1000 mineral units from W0N0 to W10N5 will consume 742 energy units. You can track your incoming and outgoing transactions using the Game.market object. Only one Terminal per room is allowed that can be addressed by Room.terminal property. Terminals are used in the Market system.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`my`** → `boolean` _(继承自 Inherited from)_
  - Whether this is your own structure.

- **`owner`** → `object` _(继承自 Inherited from)_
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

- **`cooldown`** → `number`
  - The remaining amount of ticks while this terminal cannot be used to make or calls.

- **`store`** → `Store`
  - A object that contains cargo of this structure.

- **`storeCapacity`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

- **`send(resourceType, amount, destination, [description])`**  _(CPU: 动作(返回OK时+0.2))_
  - Sends resource to a Terminal in another room with the specified name. One of the constants. The amount of resources to be sent. The name of the target room. You don't have to gain visibility in this room. The description of the transaction. It is visible to the recipient. The maximum length is 100 characters. One of the following codes:

## StructureLab

Produces mineral compounds from base minerals, boosts and unboosts creeps. Learn more about minerals from this article.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`my`** → `boolean` _(继承自 Inherited from)_
  - Whether this is your own structure.

- **`owner`** → `object` _(继承自 Inherited from)_
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

- **`cooldown`** → `number`
  - The amount of game ticks the lab has to wait until the next reaction or unboost operation is possible.

- **`energy`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`energyCapacity`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`mineralAmount`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`mineralType`** → `string`
  - The type of minerals containing in the lab. Labs can contain only one mineral type at the same time.

- **`mineralCapacity`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`store`** → `Store`
  - A object that contains cargo of this structure.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

- **`boostCreep(creep, [bodyPartsCount])`**  _(CPU: 动作(返回OK时+0.2))_
  - Boosts creep body parts using the containing mineral compound. The creep has to be at adjacent square to the lab. The target creep. The number of body parts of the corresponding type to be boosted. Body parts are always counted left-to-right for , and right-to-left for other types. If undefined, all the eligible body parts are boosted. One of the following codes:

- **`reverseReaction(lab1, lab2)`**  _(CPU: 动作(返回OK时+0.2))_
  - Breaks mineral compounds back into reagents. The same output labs can be used by many source labs. The first result lab. The second result lab. One of the following codes:

- **`runReaction(lab1, lab2)`**  _(CPU: 动作(返回OK时+0.2))_
  - Produce mineral compounds using reagents from two other labs. The same input labs can be used by many output labs. The first source lab. The second source lab. One of the following codes:

- **`unboostCreep(creep)`**  _(CPU: 动作(返回OK时+0.2))_
  - Immediately remove boosts from the creep and drop 50% of the mineral compounds used to boost it onto the ground regardless of the creep's remaining time to live. The creep has to be at adjacent square to the lab. Unboosting requires cooldown time equal to the total sum of the reactions needed to produce all the compounds applied to the creep. The target creep. One of the following codes:

## StructureLink

Remotely transfers energy to another Link in the same room.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`my`** → `boolean` _(继承自 Inherited from)_
  - Whether this is your own structure.

- **`owner`** → `object` _(继承自 Inherited from)_
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

- **`cooldown`** → `number`
  - The amount of game ticks the link has to wait until the next transfer is possible.

- **`energy`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`energyCapacity`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`store`** → `Store`
  - A object that contains cargo of this structure.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

- **`transferEnergy(target, [amount])`**  _(CPU: 动作(返回OK时+0.2))_
  - Remotely transfer energy to another link at any location in the same room. The target object. The amount of energy to be transferred. If omitted, all the available energy is used. One of the following codes:

## StructureExtractor

Allows to harvest a mineral deposit. Learn more about minerals from this article.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`my`** → `boolean` _(继承自 Inherited from)_
  - Whether this is your own structure.

- **`owner`** → `object` _(继承自 Inherited from)_
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

- **`cooldown`** → `number`
  - The amount of game ticks until the next harvest action is possible.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

## StructureFactory

Produces trade commodities from base minerals and other commodities. Learn more about commodities from this article.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`my`** → `boolean` _(继承自 Inherited from)_
  - Whether this is your own structure.

- **`owner`** → `object` _(继承自 Inherited from)_
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

- **`cooldown`** → `number`
  - The amount of game ticks the factory has to wait until the next production is possible.

- **`level`** → `number`
  - The factory's level. Can be set by applying the power to a newly built factory. Once set, the level cannot be changed.

- **`store`** → `Store`
  - A object that contains cargo of this structure.

- **`storeCapacity`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

- **`produce(resourceType)`**  _(CPU: 动作(返回OK时+0.2))_
  - Produces the specified commodity. All ingredients should be available in the factory store. One of the constants. One of the following codes:

## StructureNuker

Launches a nuke to another room dealing huge damage to the landing area. Each launch has a cooldown and requires energy and ghodium resources. Launching creates a Nuke object at the target room position which is visible to any player until it is landed. Incoming nuke cannot be moved or cancelled. Nukes cannot be launched from or to novice rooms. Resources placed into a StructureNuker cannot be withdrawn. Note that you can stack multiple nukes from different rooms at the same target position to increase damage. Nuke landing does not generate tombstones and ruins, and destroys all existing tombstones and ruins in the room If the room is in safe mode, then the safe mode is cancelled immediately, and the safe mode cooldown is reset to 0. The room controller is hit by triggering upgradeBlocked period, which means it is unavailable to activate safe mode again within the next 200 ticks.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`my`** → `boolean` _(继承自 Inherited from)_
  - Whether this is your own structure.

- **`owner`** → `object` _(继承自 Inherited from)_
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

- **`energy`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`energyCapacity`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`ghodium`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`ghodiumCapacity`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`cooldown`** → `number`
  - The amount of game ticks until the next launch is possible.

- **`store`** → `Store`
  - A object that contains cargo of this structure.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

- **`launchNuke(pos)`**  _(CPU: 动作(返回OK时+0.2))_
  - Launch a nuke to the specified position. The target room position. One of the following codes:

## StructureObserver

Provides visibility into a distant room from your script.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`my`** → `boolean` _(继承自 Inherited from)_
  - Whether this is your own structure.

- **`owner`** → `object` _(继承自 Inherited from)_
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

- **`observeRoom(roomName)`**  _(CPU: 动作(返回OK时+0.2))_
  - Provide visibility into a distant room from your script. The target room object will be available on the next tick. The name of the target room. One of the following codes:

## StructurePowerSpawn

Processes power into your account, and spawns power creeps with special unique powers (in development). Learn more about power from this article.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`my`** → `boolean` _(继承自 Inherited from)_
  - Whether this is your own structure.

- **`owner`** → `object` _(继承自 Inherited from)_
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

- **`energy`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`energyCapacity`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`power`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`powerCapacity`** → `number` ⚠️已废弃
  - This property is deprecated and will be removed soon. An alias for .

- **`store`** → `Store`
  - A object that contains cargo of this structure.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

- **`processPower()`**  _(CPU: 动作(返回OK时+0.2))_
  - Register power resource units into your account. Registered power allows to develop power creeps skills. One of the following codes:

## StructureController

Claim this structure to take control over the room. The controller structure cannot be damaged or destroyed. It can be addressed by Room.controller property.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`my`** → `boolean` _(继承自 Inherited from)_
  - Whether this is your own structure.

- **`owner`** → `object` _(继承自 Inherited from)_
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

- **`isPowerEnabled`** → `boolean`
  - Whether using power is enabled in this room. Use to turn powers on.

- **`level`** → `number`
  - Current controller level, from 0 to 8.

- **`progress`** → `number`
  - The current progress of upgrading the controller to the next level.

- **`progressTotal`** → `number`
  - The progress needed to reach the next level.

- **`reservation`** → `object`
  - An object with the controller reservation info if present: The name of a player who reserved this controller. The amount of game ticks when the reservation will end.

- **`safeMode`** → `number`
  - How many ticks of safe mode remaining, or undefined.

- **`safeModeAvailable`** → `number`
  - Safe mode activations available to use.

- **`safeModeCooldown`** → `number`
  - During this period in ticks new safe mode activations will be blocked, undefined if cooldown is inactive.

- **`sign`** → `object`
  - An object with the controller sign info if present: The name of a player who signed this controller. The sign text. The sign time in game ticks. The sign real date.

- **`ticksToDowngrade`** → `number`
  - The amount of game ticks when this controller will lose one level. This timer is set to 50% on level upgrade or downgrade, and it can be increased by using . Must be full to upgrade the controller to the next level.

- **`upgradeBlocked`** → `number`
  - The amount of game ticks while this controller cannot be upgraded due to attack. Safe mode is also unavailable during this period.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

- **`activateSafeMode()`**  _(CPU: 动作(返回OK时+0.2))_
  - Activate safe mode if available. One of the following codes:

- **`unclaim()`**  _(CPU: 动作(返回OK时+0.2))_
  - Make your claimed controller neutral again. One of the following codes:

## StructureKeeperLair

Non-player structure. Spawns NPC Source Keepers that guards energy sources and minerals in some rooms. This structure cannot be destroyed.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`my`** → `boolean` _(继承自 Inherited from)_
  - Whether this is your own structure.

- **`owner`** → `object` _(继承自 Inherited from)_
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

- **`ticksToSpawn`** → `number`
  - Time to spawning of the next Source Keeper.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

## StructureInvaderCore

This NPC structure is a control center of NPC Strongholds, and also rules all invaders in the sector. It spawns NPC defenders of the stronghold, refill towers, repairs structures. While it's alive, it will spawn invaders in all rooms in the same sector. It also contains some valuable resources inside, which you can loot from its ruin if you destroy the structure. An Invader Core has two lifetime stages: deploy stage and active stage. When it appears in a random room in the sector, it has ticksToDeploy property, public ramparts around it, and doesn't perform any actions. While in this stage it's invulnerable to attacks (has EFFECT_INVULNERABILITY enabled). When the ticksToDeploy timer is over, it spawns structures around it and starts spawning creeps, becomes vulnerable, and receives EFFECT_COLLAPSE_TIMER which will remove the stronghold when this timer is over. An active Invader Core spawns level-0 Invader Cores in neutral neighbor rooms inside the sector. These lesser Invader Cores are spawned near the room controller and don't perform any activity except reserving/attacking the controller. One Invader Core can spawn up to 42 lesser Cores during its lifetime.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`my`** → `boolean` _(继承自 Inherited from)_
  - Whether this is your own structure.

- **`owner`** → `object` _(继承自 Inherited from)_
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

- **`level`** → `number`
  - The level of the stronghold. The amount and quality of the loot depends on the level.

- **`ticksToDeploy`** → `number`
  - Shows the timer for a not yet deployed stronghold, undefined otherwise.

- **`spawning`** → `StructureSpawn.Spawning`
  - If the core is in process of spawning a new creep, this object will contain a object, or null otherwise.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

## StructurePowerBank

Non-player structure. Contains power resource which can be obtained by destroying the structure. Hits the attacker creep back on each attack. Learn more about power from this article.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`my`** → `boolean` _(继承自 Inherited from)_
  - Whether this is your own structure.

- **`owner`** → `object` _(继承自 Inherited from)_
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

- **`power`** → `number`
  - The amount of power containing.

- **`ticksToDecay`** → `number`
  - The amount of game ticks when this structure will disappear.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

## StructureRampart

Blocks movement of hostile creeps, and defends your creeps and structures on the same tile. Can be used as a controllable gate.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`my`** → `boolean` _(继承自 Inherited from)_
  - Whether this is your own structure.

- **`owner`** → `object` _(继承自 Inherited from)_
  - An object with the structure’s owner info containing the following properties: The name of the owner user.

- **`isPublic`** → `boolean`
  - If false (default), only your creeps can step on the same square. If true, any hostile creeps can pass through.

- **`ticksToDecay`** → `number`
  - The amount of game ticks when this rampart will lose some hit points.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

- **`setPublic(isPublic)`**  _(CPU: 动作(返回OK时+0.2))_
  - Make this rampart public to allow other players' creeps to pass through. Whether this rampart should be public or non-public. One of the following codes:

## StructureRoad

Decreases movement cost to 1. Using roads allows creating creeps with less MOVE body parts. You can also build roads on top of natural terrain walls which are otherwise impassable.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`ticksToDecay`** → `number`
  - The amount of game ticks when this road will lose some hit points.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

## StructurePortal

A non-player structure. Instantly teleports your creeps to a distant room acting as a room exit tile. Portals appear randomly in the central room of each sector.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

- **`destination`** → `RoomPosition | object`
  - If this is an portal, then this property contains a object leading to the point in the destination room. If this is an portal, then this property contains an object with and string properties. Exact coordinates are undetermined, the creep will appear at any free spot in the destination room.

- **`ticksToDecay`** → `number`
  - The amount of game ticks when the portal disappears, or undefined when the portal is stable.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:

## StructureWall

Blocks movement of all creeps. Players can build destructible walls in controlled rooms. Some rooms also contain indestructible walls separating novice and respawn areas from the rest of the world or dividing novice / respawn areas into smaller sections. Indestructible walls have no hits property.

### 属性 (Properties)

- **`effects`** → `array` _(继承自 Inherited from)_
  - Applied effects, an array of objects with the following properties: Effect ID of the applied effect. Can be either natural effect ID or Power ID. Power level of the applied effect. Absent if the effect is not a Power effect. How many ticks will the effect last.

- **`pos`** → `RoomPosition` _(继承自 Inherited from)_
  - An object representing the position of this object in the room.

- **`room`** → `Room` _(继承自 Inherited from)_
  - The link to the Room object. May be undefined in case if an object is a flag or a construction site and is placed in a room that is not visible to you.

- **`hits`** → `number` _(继承自 Inherited from)_
  - The current amount of hit points of the structure.

- **`hitsMax`** → `number` _(继承自 Inherited from)_
  - The total amount of hit points of the structure.

- **`id`** → `string` _(继承自 Inherited from)_
  - A unique object identificator. You can use method to retrieve an object instance by its .

- **`structureType`** → `string` _(继承自 Inherited from)_
  - One of the constants.

### 方法 (Methods)

- **`destroy()`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Destroy this structure immediately. One of the following codes:

- **`isActive()`**  _(CPU: 中)_ _(继承自 Inherited from)_
  - Check whether this structure can be used. If room controller level is insufficient, then this method will return false, and the structure will be highlighted with red in the game. A boolean value.

- **`notifyWhenAttacked(enabled)`**  _(CPU: 动作(返回OK时+0.2))_ _(继承自 Inherited from)_
  - Toggle auto notification when the structure is under attack. The notification will be sent to your account email. Turned on by default. Whether to enable notification or disable. One of the following codes:


## 寻路 (PathFinder)

## PathFinder-CostMatrix

Container for custom navigation cost data. By default PathFinder will only consider terrain data (plain, swamp, wall) — if you need to route around obstacles such as buildings or creeps you must put them into a CostMatrix. Generally you will create your CostMatrix from within roomCallback. If a non-0 value is found in a room's CostMatrix then that value will be used instead of the default terrain cost. You should avoid using large values in your CostMatrix and terrain cost flags. For example, running PathFinder.search with { plainCost: 1, swampCost: 5 } is faster than running it with {plainCost: 2, swampCost: 10 } even though your paths will be the same.

### 属性 (Properties)

- **`constructor`** → ``
  - Creates a new CostMatrix containing 0's for all positions.

### 方法 (Methods)

- **`set(x, y, cost)`**  _(CPU: 极低)_
  - Set the cost of a position in this CostMatrix. X position in the room. Y position in the room. Cost of this position. Must be a whole number. A cost of 0 will use the terrain cost for that tile. A cost greater than or equal to 255 will be treated as unwalkable.

- **`get(x, y)`**  _(CPU: 极低)_
  - Get the cost of a position in this CostMatrix. X position in the room. Y position in the room.

- **`clone()`**  _(CPU: 低)_
  - Copy this CostMatrix into a new CostMatrix with the same data. A new CostMatrix instance.

- **`serialize()`**  _(CPU: 低)_
  - Returns a compact representation of this CostMatrix which can be stored via . An array of numbers. There's not much you can do with the numbers besides store them for later.

- **`PathFinder.CostMatrix.deserialize(val)`**  _(CPU: 低)_
  - Static method which deserializes a new CostMatrix using the return value of . Whatever returned Returns new instance.


## 其他 (Other)

## Constants

All the following constant names are available in the global scope:



---


---

# 7. 实战模式（基于本仓库现有代码）

本仓库已采用一套**高性能、低 CPU** 的架构（角色分工 + 缓存 + 共享瞬态状态）。下面把可复用模式提炼出来，供 AI 在扩展功能时直接套用。

## 7.1 主循环骨架（`main.js`）

原则：**每 tick 只读一次 `Game.*` 集合，用缓存代替 `_.filter` 全量扫描；先防御/清理，再调度角色，最后孵化。**

```js
module.exports.loop = function () {
    // 1) 首次运行：构建缓存（矿点、creep 名字）
    if (!state._cacheReady) {
        creepCache.build();
        // 矿点房间固定，只初始化一次
        var sources = Game.spawns['Spawn1'].room.find(FIND_SOURCES);
        for (var si = 0; si < sources.length; si++) {
            state.sourceIds.push(sources[si].id);
            state.sourceData[sources[si].id] = {
                x: sources[si].pos.x, y: sources[si].pos.y,
                roomName: sources[si].pos.roomName
            };
        }
    }

    // 2) 防御塔：有敌人攻击，否则修受损结构（跳过 Wall/Rampart）
    var towers = _.filter(Game.structures, s => s.structureType == STRUCTURE_TOWER);
    for (var i = 0; i < towers.length; i++) {
        var tower = towers[i];
        var hostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
        if (hostile) tower.attack(hostile);
        else {
            var damaged = tower.pos.findClosestByRange(FIND_STRUCTURES, {
                filter: s => s.hits < s.hitsMax
                    && s.structureType != STRUCTURE_WALL
                    && s.structureType != STRUCTURE_RAMPART
            });
            if (damaged) tower.repair(damaged);
        }
    }

    // 3) 清理死亡 creep 内存 + 同步缓存
    for (var name in Memory.creeps) {
        if (!Game.creeps[name]) {
            creepCache.remove(name);
            delete Memory.creeps[name];
        }
    }

    // 4) 检测角色短缺（读缓存，O(1)）→ 决定建造/升级是否暂停
    state.creepShortage = managerSpawn.checkShortage();

    // 5) 角色调度（用缓存 allNames，避免 for...in Game.creeps）
    var names = state.allNames;
    for (var i = 0; i < names.length; i++) {
        var creep = Game.creeps[names[i]];
        if (!creep) continue; // 极端情况容错
        switch (creep.memory.role) {
            case 'harvester': roleHarvester.run(creep); break;
            case 'upgrader':  roleUpgrader.run(creep);  break;
            case 'builder':   roleBuilder.run(creep);   break;
            case 'repairer':  roleRepairer.run(creep);  break;
        }
    }

    // 6) 自动孵化
    managerSpawn.run('Spawn1');
};
```

## 7.2 角色状态机（`role.harvester`）

最常见的角色模式：**靠 `creep.store` 容积在两个状态间切换**，决定「去采集」还是「去送货」。

```js
run: function (creep) {
    // 状态切换：空了去采，满了去送
    if (creep.store[RESOURCE_ENERGY] == 0) creep.memory.harvesting = true;
    if (creep.store.getFreeCapacity() == 0) creep.memory.harvesting = false;

    if (creep.memory.harvesting) {
        // 采集：用矿点缓存 + 就近；返回 ERR_NOT_IN_RANGE 就 moveTo
        var src = Game.getObjectById(creep.memory.sourceId) || creep.pos.findClosestByPath(FIND_SOURCES);
        if (creep.harvest(src) == ERR_NOT_IN_RANGE) creep.moveTo(src);
    } else {
        // 送货：优先 Spawn/Extension/Tower，再考虑 Container
        var targets = creep.room.find(FIND_STRUCTURES, {
            filter: s => (s.structureType == STRUCTURE_SPAWN ||
                          s.structureType == STRUCTURE_EXTENSION ||
                          s.structureType == STRUCTURE_TOWER) &&
                         s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        });
        var dest = targets[0] || creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: s => s.structureType == STRUCTURE_CONTAINER &&
                         s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        });
        if (dest && creep.transfer(dest, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
            creep.moveTo(dest, { visualizePathStyle: { stroke: '#ffffff' } });
        }
    }
}
```

> 要点：`creep.store` 是新版统一资源容器（替代旧 `creep.carry`/`creep.energy`）。`store.getFreeCapacity()`、`store.getUsedCapacity()`、`store[RESOURCE_ENERGY]` 都可用。`transfer`/`withdraw`/`pickup`/`drop` 统一操作 `store`。

## 7.3 孵化管理器（`manager.spawn`）

按角色目标数量缺口自动孵化；body 用「单元」动态扩缩，成本随能量增长。

```js
// 配置（config.js）
var config = {
    roleTargets: { harvester: 8, upgrader: 2, builder: 2, repairer: 0 },
    spawnEnergyThreshold: 200,   // 低于此能量不孵化
};

// 动态 body：每单元 [WORK, CARRY, MOVE]=200 能量
getBody: function (energy, role) {
    var n = (energy >= 300) ? Math.min(Math.floor(energy / 200), 8) : 1;
    var body = [];
    for (var i = 0; i < n; i++) body.push(WORK);
    for (var i = 0; i < n; i++) body.push(CARRY);
    for (var i = 0; i < n; i++) body.push(MOVE);
    return body;
},

// 一次只孵一个，按优先级补缺口
run: function (spawnName) {
    var spawn = Game.spawns[spawnName];
    if (!spawn || spawn.spawning) return;          // 正在忙就跳过
    var energy = spawn.room.energyAvailable;
    var queue = [
        { role: 'harvester', need: config.roleTargets.harvester },
        { role: 'upgrader',  need: config.roleTargets.upgrader  },
        { role: 'builder',   need: config.roleTargets.builder   },
        { role: 'repairer',  need: config.roleTargets.repairer  },
    ];
    for (var i = 0; i < queue.length; i++) {
        var item = queue[i];
        if (creepCache.count(item.role) < item.need && energy >= config.spawnEnergyThreshold) {
            var name = item.role.charAt(0).toUpperCase() + item.role.slice(1) + Game.time;
            var body = this.getBody(energy, item.role);
            var res = spawn.spawnCreep(body, name, { memory: { role: item.role } });
            if (res == OK) { creepCache.add(name); console.log('[Spawn]', item.role, name); }
            return; // 一次一个
        }
    }
}
```

> 注意 `spawn.spawning` 为真时 `spawnCreep` 会返回 `ERR_BUSY`。`spawnCreep` 返回 `OK(0)` 表示开始孵化（不是瞬间完成）。body 部件数 1–50，总能量 ≤ 3000。

## 7.4 Creep 名字缓存（`cache.creep`）

**避免每 tick `_.filter(Game.creeps, ...)` 全量扫描**——只在「初始化 / 孵化 / 死亡」三个节点更新缓存，调度与计数均走缓存（O(1)）。

```js
// state.allNames：所有存活 creep 名字；state.byRole[role]：按角色分组
build:  function () { /* 第一 tick 遍历一次 Game.creeps 填充 */ },
add:    function (name) { /* 孵化成功后 */ },
remove: function (name) { /* 死亡清理时 */ },
count:  function (role) { return state.byRole[role] ? state.byRole[role].length : 0; }
```

## 7.5 共享瞬态状态（`state.js`）

`state` 是**每 tick 重建的全局对象**，用于模块间传瞬态信息（如 `creepShortage`、`spawningRole`），**不要放进 `Memory`**（Memory 会序列化、有 CPU 开销）。只有需要跨 tick 保留的才写 `Memory.*`。

## 7.6 防御塔 + 死亡清理（见 7.1）

- `StructureTower.attack(hostile)` / `.repair(damaged)`：攻击敌人优先级最高，否则修受损结构。
- 死亡清理：`for (name in Memory.creeps) if (!Game.creeps[name]) { delete Memory.creeps[name]; creepCache.remove(name); }`——**必须做**，否则 `Memory.creeps` 会无限膨胀。

## 7.7 寻路与 `moveTo` 选项

`creep.moveTo(target, opts)` 是 `creep.move()` + `Room.findPath` 的便捷封装。常用 `opts`：

```js
creep.moveTo(target, {
    reusePath: 20,                       // 复用缓存路径的 tick 数（省 CPU，默认 5）
    visualizePathStyle: { stroke: '#ff0000', lineStyle: 'dashed' },
    // ignoreCreeps: true,               // 穿过其他 creep（避免堵车，但可能卡住）
    // range: 1,                         // 停在距离目标几格处
    // maxOps: 2000,                     // 寻路 CPU 上限
});
```

高级场景用 `PathFinder.search(origin, goal, opts)` + `CostMatrix` 自定义地形代价（如绕开敌方/道路）。

## 7.8 常用代码段速查

```js
// 取最近的源 / 结构 / 敌对 creep
creep.pos.findClosestByPath(FIND_SOURCES);
creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
creep.room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType == STRUCTURE_TOWER });

// 资源搬运（统一用 store）
creep.harvest(source);
creep.transfer(structure, RESOURCE_ENERGY);
creep.withdraw(structure, RESOURCE_ENERGY);
creep.pickup(resource);
creep.drop(RESOURCE_ENERGY);

// 建造 / 升级 / 修理 / 拆除
creep.build(constructionSite);
creep.upgradeController(controller);
creep.repair(structure);
creep.dismantle(structure);

// 建工地 / 插旗
room.createConstructionSite(x, y, STRUCTURE_EXTENSION);
room.createFlag(x, y, 'myFlag', COLOR_RED, COLOR_RED);

// 用 id 取对象（避免保存整个对象，只存 id）
var obj = Game.getObjectById(creep.memory.targetId);

// 错误码判断（最常见）
if (creep.harvest(source) == ERR_NOT_IN_RANGE) creep.moveTo(source);
if (creep.transfer(spawn, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) creep.moveTo(spawn);

// 跨 tick 持久化：放 Memory
Memory.creeps[name].role = 'harvester';
Memory.rooms[roomName].someFlag = true;
```

---

# 8. 进阶主题（查阅对应对象章节）

| 主题 | 看哪里 |
|------|--------|
| 实验室反应 / 强化 | `StructureLab`、`REACTIONS` 表、`BOOSTS` 表 |
| 跨房间物流 | `StructureTerminal.send(...)`、`Game.market` |
| 控制器占领 / 预留 | `StructureController.claim`/`reserve`/`activateSafeMode` |
| 高级寻路 | `PathFinder.search`、`PathFinder.CostMatrix`、`Room.Terrain` |
| 矿物 / 沉积矿 | `Mineral`、`Deposit`（需 `extract`/`harvest`） |
| Power Creep | `PowerCreep`、`StructurePowerSpawn` |
| 核弹 | `StructureNuker`、`Nuke` |
| 地图可视化调试 | `RoomVisual`、`Game.map.visual` |
| 内存优化 | `Memory`、`RawMemory`（segments） |