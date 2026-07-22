# Screeps 房间自动化脚本

一个面向 [Screeps](https://screeps.com/) 的房间自动化管理 bot，用模块化 JavaScript 编写，
按 tick 调度 Creep 完成**采集、运输、建造、升级、修理与防御**，无需人工干预即可让房间自给自足地运转。

> 仓库根目录即 Screeps 脚本目录（`main.js` 为入口，`module.exports.loop` 为每 tick 主循环）。

---

## 特性

- **模块化角色状态机**：`harvester / upgrader / builder / repairer` 四个角色，各自独立的状态切换逻辑。
- **两级缓存，降低 CPU 开销**：
  - Creep 名字缓存（`cache.creep.js`）——只在「初始化 / 孵化 / 死亡」三个节点刷新，避免每 tick 多次 `_.filter(Game.creeps)` 全量扫描。
  - 矿点缓存（`cache.sources.js`）——矿点坐标房间固定，首次 tick 初始化后直接读缓存，避免每 tick 调用 `FIND_SOURCES`；并按 Chebyshev 距离排序取最近矿点，矿点饱和时自动顺延。
- **自动孵化管理器**（`manager.spawn.js`）：按能量动态生成 body，数学保证总成本 ≤ 可用能量，永不因能量不足而卡死。
- **短缺优先机制**：检测到角色数量低于目标时，Builder / Upgrader 自动暂停，把能量让给孵化。
- **防御塔**：自动攻击敌对 Creep，无敌人时顺带修理受损建筑。
- **多重死锁修复**：残余能量死锁、矿点满位顺延、孵化能量不足等历史问题均已修复。

---

## 目录结构

| 文件 | 职责 |
| --- | --- |
| `main.js` | 入口。每 tick 主循环：重置瞬态缓存 → 首 tick 初始化缓存 → 防御塔 → 清理死亡 Creep → 检测短缺 → 调度角色 → 自动孵化。 |
| `config.js` | 全局配置：各角色目标数量、孵化能量阈值。 |
| `state.js` | 每 tick 共享瞬态状态（角色短缺标记、存活名单、按角色分组计数、矿点缓存、缓存就绪标记）。不读写 `Memory`。 |
| `cache.creep.js` | Creep 名字缓存：`build()` / `add()` / `remove()` / `count()`，O(1) 计数。 |
| `cache.sources.js` | 矿点缓存：距离排序、空闲格检测、满位顺延采集。 |
| `manager.spawn.js` | 孵化管理器：按优先级检测缺口、动态生成 body、执行孵化并同步缓存。 |
| `role.harvester.js` | 采集 + 运输：能量满后优先补 Spawn/Extension/Tower，再补 Container。 |
| `role.upgrader.js` | 升级控制器；短缺时暂停；能量不足回退采集。 |
| `role.builder.js` | 建造工地，无工地时升级控制器；短缺时暂停；能量不足回退采集。 |
| `role.repairer.js` | 修理受损建筑（按血量升序优先），无目标时升级控制器。 |
| `Screeps_API_参考.md` | 面向 AI / 开发者的全 Screeps API 与常量参考文档（整理自官方文档与 `constants.js`）。 |

---

## 工作机制

### 主循环（`main.js`）

```
每 tick：
  1. 重置 sourceSlotFree（瞬态，不跨 tick）
  2. 首次运行：全量构建 Creep 缓存 + 矿点缓存
  3. 防御塔：有敌人→攻击；否则→修理受损建筑
  4. 清理 Memory.creeps 中已死亡的 Creep，并同步缓存
  5. 计算 state.creepShortage（是否有角色短缺）
  6. 遍历缓存名单，按 role 分派到对应 role 模块
  7. managerSpawn.run('Spawn1') 自动孵化
```

### 缓存层

- **Creep 缓存**：第一 tick 由 `Game.creeps` 全量构建；之后仅在 `spawnCreep` 成功（`add`）和死亡清理（`remove`）时增量更新。
  调度循环与计数全部走缓存，避免每 tick 重复扫描。
- **矿点缓存**：矿点坐标在房间内固定不变，首 tick 通过 `FIND_SOURCES` 初始化一次；
  之后 Creep 取能时按缓存坐标计算距离、直接 `Game.getObjectById` 获取对象。

### 孵化管理器（`manager.spawn.js`）

- 一次性只孵化一只，按优先级 `harvester → upgrader → builder → repairer` 检查缺口。
- `getBody(energy, role)`：每单元 `[WORK, CARRY, MOVE]` 成本 200 能量，`n = min(floor(energy/200), 8)`，
  **数学保证 body 总成本 ≤ 可用能量**，根除「能量不足导致永远孵不出」的死锁。

### 角色调度与短缺机制

- `state.creepShortage` 为 `true`（有角色数量不达标）时，Builder / Upgrader 立即 `return` 暂停工作，
  把能量与 Spawn 槽位让给孵化，保证房间规模能恢复。
- 所有角色在能量不足（`ERR_NOT_ENOUGH_ENERGY` 或低于动作阈值）时立即切回采集，避免残余能量死锁。

### 防御塔

- 房间内有 `TOWER` 时，每 tick 找最近敌对 Creep 攻击；
- 无敌人时找受损建筑（`WALL` / `RAMPART` 除外）修理。

---

## 角色说明

| 角色 | 默认目标数 | 行为 |
| --- | --- | --- |
| `harvester` | 8 | 采矿 → 运能（Spawn/Extension/Tower → Container）。房间能量供给主力。 |
| `upgrader` | 2 | 升级房间控制器；短缺时暂停。 |
| `builder` | 2 | 建造工地，无工地时升级控制器；短缺时暂停。 |
| `repairer` | 0 | 修理受损建筑，无目标时升级控制器（默认关闭）。 |

> 注意：孵化器名称在代码中硬编码为 `Spawn1`，房间名通过 `Game.spawns['Spawn1'].room` 获取。多孵化器 / 多房间需相应改造。

---

## 配置（`config.js`）

```js
module.exports = {
    roleTargets: {
        harvester: 8,   // 采集工目标数量
        upgrader:  2,   // 升级工目标数量
        builder:   2,   // 建造工目标数量
        repairer:  0,   // 修理工目标数量（0 = 不孵化）
    },
    spawnEnergyThreshold: 200,  // 低于此能量不孵化（一个单元的成本）
};
```

- 调大 `harvester` 可提升能量吞吐；调大 `upgrader` / `builder` 可加快升级 / 扩张（但会占用孵化名额）。
- `spawnEnergyThreshold` 不应低于 200（一个 `[WORK,CARRY,MOVE]` 单元的成本）。

---

## 部署

仓库根目录即 Screeps 脚本目录，两种使用方式：

1. **本地同步（推荐）**：本仓库已位于 Screeps 客户端脚本目录下，客户端会自动同步到游戏；
   或在 Screeps 官网 / 客户端的脚本编辑器（Scripts 标签）中，将本目录所有文件作为多模块上传，入口为 `main.js`。
2. **单文件粘贴**：将各模块内容按依赖顺序拼接，粘贴进游戏内脚本编辑器（不推荐，不利于维护）。

部署后 bot 会在下一个 tick 自动启动：首 tick 构建缓存，随后进入自动采集 → 运输 → 建造 / 升级 / 修理循环。

---

## 参考文档

- [`Screeps_API_参考.md`](./Screeps_API_参考.md)：完整 API 对象、常量总表（错误码 / 结构 / 资源 / 身体部件 / 反应 / 强化 / 控制器结构等）与实战模式，适合开发者与 AI 阅读。
- 官方文档：<https://docs.screeps.com/api/>

---

## 提交规范

本项目提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <description>
```

`type` ∈ `feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore`，描述使用中文、简洁概括。

---

## 许可证

随仓库默认协议；如需明确协议请补充 `LICENSE` 文件。
