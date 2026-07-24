# 13 · Screeps API 速查

本附录列出项目中使用到的 Screeps API 与常量，便于开发参考。完整文档见 [官方 API](https://docs.screeps.com/api/)。

---

## 13.1 全局对象

| 对象 | 说明 | 项目中的用法 |
| --- | --- | --- |
| `Game` | 游戏状态对象 | `Game.creeps` / `Game.spawns` / `Game.structures` / `Game.time` / `Game.getObjectById(id)` |
| `Memory` | 持久化对象（跨 tick） | `Memory.creeps` / `Memory.tasks` / `Memory._transporterLocks` |
| `console` | 控制台输出 | `console.log(...)` 各模块日志 |
| `_` | lodash（Screeps 内置） | 当前项目避免使用，改用原生遍历 |

---

## 13.2 Creep API

| 方法 | 说明 | 项目中的用法 |
| --- | --- | --- |
| `creep.harvest(source)` | 采集能量 | collector / harvester / 兜底采矿 |
| `creep.transfer(target, resource)` | 转移资源到目标 | harvester / transporter 送货 |
| `creep.withdraw(structure, resource)` | 从结构取资源 | transporter 取货 / upgrader/builder/repairer 取能量 |
| `creep.build(site)` | 建造工地 | builder |
| `creep.repair(structure)` | 修理建筑 | repairer / tower |
| `creep.upgradeController(controller)` | 升级控制器 | upgrader / builder/repairer 无目标时 |
| `creep.move(dir)` | 按方向移动一格 | transporter `_moveAwayFromTarget` |
| `creep.moveTo(target, opts)` | 寻路移动 | 所有角色 |
| `creep.pickup(resource)` | 拾取地面资源 | transporter 取 dropped |
| `creep.drop(resource)` | 丢弃资源 | collector drop mining |
| `creep.say(msg)` | 显示气泡 | 状态切换提示 |
| `creep.pos.inRangeTo(target, range)` | 距离判断 | collector/transporter 距离检查 |
| `creep.pos.isEqualTo(pos)` | 位置相等判断 | transporter 站位检查 |
| `creep.pos.getRangeTo(target)` | 获取距离 | builder/repairer/upgrader 排序 |
| `creep.store[RESOURCE_ENERGY]` | 当前携带能量 | 所有角色状态切换 |
| `creep.store.getFreeCapacity(resource)` | 剩余容量 | 所有角色满载判断 |
| `creep.store.getUsedCapacity(resource)` | 已用容量 | transporter 进度计算 |
| `creep.store.getCapacity(resource)` | 总容量 | transporter 进度计算 |
| `creep.getActiveBodyparts(type)` | 有效部件数 | collector 接近满仓判断 |
| `creep.room.getTerrain().get(x, y)` | 地形查询 | transporter `_moveAwayFromTarget` |
| `creep.room.lookForAt(LOOK_*, x, y)` | 位置查询 | transporter 站位检查 |
| `creep.room.lookAtArea(...)` | 区域查询 | cache.sources / task.scheduler |

---

## 13.3 Structure API

| 方法/属性 | 说明 |
| --- | --- |
| `structure.store[RESOURCE_ENERGY]` | 当前能量 |
| `structure.store.getFreeCapacity(resource)` | 剩余容量 |
| `structure.store.getCapacity(resource)` | 总容量 |
| `structure.hits` / `structure.hitsMax` | 当前/最大血量 |
| `structure.structureType` | 结构类型 |
| `structure.pos` | 位置 |

### Tower 专属

| 方法 | 说明 |
| --- | --- |
| `tower.attack(creep)` | 攻击 creep |
| `tower.repair(structure)` | 远程修理 |
| `tower.store[RESOURCE_ENERGY]` | 能量 |
| `tower.store.getCapacity(RESOURCE_ENERGY)` | 容量 |
| `tower.pos.findClosestByRange(type)` | 最近目标 |

### Spawn 专属

| 方法 | 说明 |
| --- | --- |
| `spawn.spawnCreep(body, name, opts)` | 孵化 creep |
| `spawn.spawning` | 是否正在孵化 |
| `spawn.room.energyAvailable` | 当前可用能量 |
| `spawn.room.energyCapacityAvailable` | 最大能量容量 |
| `spawn.room.find(type, opts)` | 房间查找 |

---

## 13.4 Room API

| 方法 | 说明 | 项目中的用法 |
| --- | --- | --- |
| `room.find(FIND_SOURCES)` | 所有矿点 | 初始化 / 兜底 |
| `room.find(FIND_STRUCTURES, {filter})` | 所有结构 | 取能量 / 送货 / 维修目标 |
| `room.find(FIND_CONSTRUCTION_SITES)` | 所有工地 | builder |
| `room.find(FIND_DROPPED_RESOURCES)` | 地面掉落资源 | transporter 取货 |
| `room.find(FIND_TOMBSTONES)` | 墓碑 | transporter 取货 |
| `room.find(FIND_HOSTILE_CREEPS)` | 敌对 creep | tower 攻击 |
| `room.find(FIND_CREEPS, {filter})` | 所有 creep | transporter 让位检查 |
| `room.findClosestByRange(type, {filter})` | 最近目标 | tower / harvester |
| `room.lookAtArea(top, left, bottom, right, asArray)` | 区域查询 | cache.sources 空位检测 |
| `room.lookForAt(LOOK_*, x, y)` | 位置查询 | transporter / task.scheduler |
| `room.getTerrain().get(x, y)` | 地形查询 | transporter 移开 |
| `room.controller` | 控制器 | upgrader/builder/repairer |

---

## 13.5 常量

### 返回码

| 常量 | 值 | 说明 |
| --- | --- | --- |
| `OK` | 0 | 成功 |
| `ERR_NOT_IN_RANGE` | -9 | 不在范围内 |
| `ERR_NOT_ENOUGH_RESOURCES` | -6 | 资源不足 |
| `ERR_NOT_ENOUGH_ENERGY` | -6 | 能量不足（同上） |
| `ERR_FULL` | -8 | 已满 |
| `ERR_NOT_OWNER` | -1 | 无权限 |
| `ERR_NO_PATH` | -2 | 无路径 |
| `ERR_INVALID_TARGET` | -7 | 无效目标 |
| `ERR_TIRED` | -11 | 疲劳 |
| `ERR_BUSY` | -4 | 忙碌 |

### 资源类型

| 常量 | 说明 |
| --- | --- |
| `RESOURCE_ENERGY` | 能量 |

### 结构类型

| 常量 | 说明 |
| --- | --- |
| `STRUCTURE_SPAWN` | 孵化器 |
| `STRUCTURE_EXTENSION` | 扩展 |
| `STRUCTURE_TOWER` | 防御塔 |
| `STRUCTURE_CONTAINER` | 容器 |
| `STRUCTURE_STORAGE` | 仓库 |
| `STRUCTURE_WALL` | 墙 |
| `STRUCTURE_RAMPART` | 城墙 |
| `STRUCTURE_ROAD` | 道路 |

### FIND 常量

| 常量 | 说明 |
| --- | --- |
| `FIND_SOURCES` | 矿点 |
| `FIND_STRUCTURES` | 所有结构 |
| `FIND_CONSTRUCTION_SITES` | 工地 |
| `FIND_DROPPED_RESOURCES` | 地面掉落资源 |
| `FIND_TOMBSTONES` | 墓碑 |
| `FIND_HOSTILE_CREEPS` | 敌对 creep |
| `FIND_CREEPS` | 所有 creep |

### LOOK 常量

| 常量 | 说明 |
| --- | --- |
| `LOOK_CREEPS` | creep |
| `LOOK_STRUCTURES` | 结构 |
| `LOOK_TERRAIN` | 地形 |

### 身体部件

| 常量 | 成本 | 说明 |
| --- | --- | --- |
| `WORK` | 100 | 采集/建造/修理/升级 |
| `CARRY` | 50 | 携带资源 |
| `MOVE` | 50 | 移动 |
| `ATTACK` | 80 | 近战攻击 |
| `RANGED_ATTACK` | 150 | 远程攻击 |
| `HEAL` | 250 | 治疗 |
| `TOUGH` | 10 | 肉盾 |
| `CLAIM` | 600 | 占领 |

### 方向常量

| 常量 | 值 | 方向 |
| --- | --- | --- |
| `TOP` | 1 | 上 |
| `TOP_RIGHT` | 2 | 右上 |
| `RIGHT` | 3 | 右 |
| `BOTTOM_RIGHT` | 4 | 右下 |
| `BOTTOM` | 5 | 下 |
| `BOTTOM_LEFT` | 6 | 左下 |
| `LEFT` | 7 | 左 |
| `TOP_LEFT` | 8 | 左上 |

### 地形常量

| 常量 | 说明 |
| --- | --- |
| `TERRAIN_MASK_WALL` | 墙（不可站立） |
| `TERRAIN_MASK_SWAMP` | 沼泽（移动消耗 5 倍） |
| `0`（或无掩码） | 平原 |

---

## 13.6 moveTo 选项

项目中常用选项：

```js
creep.moveTo(target, {
    visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dashed' },
    reusePath: 10,        // 路径复用 tick 数
    ignoreCreeps: false,  // 是否忽略其他 creep（默认 false，允许绕过）
});
```

### 颜色约定

| 角色/场景 | 颜色 |
| --- | --- |
| 采集移动 | `#ffaa00`（橙） |
| 送货移动 | `#ffffff`（白） |
| 投放 Container | `#00aaff`（蓝） |
| 让位移动 | `#ff4444`（红，虚线） |
| 远离 Spawn | `#888888`（灰，点线） |

---

## 13.7 RoomPosition 构造

```js
new RoomPosition(x, y, roomName)
```

项目中的用法：`task.scheduler.js` 的 `checkYield` 中构造让位目标位置。

---

← [返回索引](README.md) | 上一篇：[12 · 设计要点与机制](12-设计要点与机制.md)
