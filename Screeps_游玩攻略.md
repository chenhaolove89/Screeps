# Screeps 游玩攻略大全

> 一款用 JavaScript 编程来经营殖民地的 MMO 即时战略游戏，你的代码就是你的军团。
> 适用版本：Screeps: World（MMO 永久世界）

---

## 目录

1. [游戏简介](#一游戏简介)
2. [服务器与分片选择](#二服务器与分片选择)
3. [快速上手指南](#三快速上手指南)
4. [房间控制器（RCL）逐级攻略](#四房间控制器rcl逐级攻略)
5. [Creep 身体部件详解](#五creep-身体部件详解)
6. [建筑与布局规划](#六建筑与布局规划)
7. [资源体系](#七资源体系)
8. [防御与战斗](#八防御与战斗)
9. [进阶玩法](#九进阶玩法)
10. [常见错误与避坑](#十常见错误与避坑)
11. [实用工具与社区资源](#十一实用工具与社区资源)

---

## 一、游戏简介

**Screeps** 是一款为程序员设计的 MMO 即时战略游戏。与传统 RTS 不同，你不需要手动操作任何单位——你需要编写 JavaScript 代码来控制所有单位（称为 **Creep**）的行为。代码在服务器端持续运行，即使你离线，殖民地也在自动运转。

### 核心玩法循环

1. **编写代码** → 2. **部署到服务器** → 3. **观察殖民地自动运行**
4. **发现问题** → 5. **优化代码** → 6. **重复以上步骤**

### 关键概念

| 术语 | 说明 |
|------|------|
| **Creep** | 你控制的单位，由身体部件组成，有 1500 tick 寿命 |
| **Spawn** | 孵化 Creep 的建筑 |
| **RCL** | Room Controller Level，房间控制等级，决定可建造内容 |
| **GCL** | Global Control Level，全局控制等级，决定可占领房间数，每升一级 +10 CPU |
| **GPL** | Global Power Level，全局超能等级，用于升级 Power Creep |
| **Tick** | 游戏最小时间单位，约 1~3 秒现实时间 |
| **CPU** | 每个 tick 你的代码可用的计算资源，默认 20，随 GCL 增加 |
| **Bucket** | CPU 缓存桶，容量 10000，未使用的 CPU 会存入其中 |
| **Room** | 一个 50×50 的地图区域，是你的殖民地基本单位 |
| **Source** | 能量矿点，每个房间通常有 2 个，每个含 3000 能量，每 300 tick 再生 |

---

## 二、服务器与分片选择

### 官方服务器

| 服务器类型 | 说明 |
|-----------|------|
| **永久世界（MMO）** | 主服务器，全年运行，不会重置。有机器人已运行超过十年 |
| **季节世界** | 限时开放，定期重置，需要访问密钥 |

### 分片（Shard）选择

| 分片 | 特点 | 适合人群 |
|------|------|---------|
| **Shard 3 ★ 推荐新手** | 全玩家限制 20 CPU/tick，tick 速度较快，玩家活跃 | 纯新手，想公平起步 |
| **Shard 0** | 最老最大，tick 最慢，房间正在逐渐收缩 | 不在意 tick 率，想扩张 |
| **Shard 1** | 联盟多样性好，玩家活跃度中等 | 有一定经验后 |
| **Shard 2** | 战斗导向，有高战玩家和"自主谋杀区" | 追求 PvP 的玩家 |

> **建议**：新玩家从 **Shard 3** 开始。20 CPU 上限创造了公平的起步环境。

---

## 三、快速上手指南

### 3.1 完成官方教程

游戏内置了交互式教程，涵盖：
- **第一章**：游戏 UI 与基本脚本——学会孵化 Creep、采集能量
- **第二章**：升级控制器——学习多角色分工（Harvester / Upgrader）
- **第三章**：建造建筑——Extensions、更高效的 Creep
- **第四章**：自动孵化——Creep 死后自动补充
- **第五章**：防御——Tower 与 Safe Mode

> 官方教程地址：https://screeps.com/a/#!/sim 或通过游戏客户端进入

### 3.2 第一个脚本：基础框架

```javascript
// main.js - 最基本的殖民地控制循环
module.exports.loop = function () {
    // 遍历所有 Creep
    for (var name in Game.creeps) {
        var creep = Game.creeps[name];
        // 根据 role 分发任务
        if (creep.memory.role == 'harvester') {
            runHarvester(creep);
        } else if (creep.memory.role == 'upgrader') {
            runUpgrader(creep);
        } else if (creep.memory.role == 'builder') {
            runBuilder(creep);
        }
    }
};
```

### 3.3 最小可行殖民地代码结构

推荐将不同角色的行为分离到独立模块：

```
scripts/
├── main.js              # 主循环
├── role.harvester.js    # 采集者
├── role.upgrader.js     # 升级者
├── role.builder.js      # 建造者
├── role.repairer.js     # 修复者（后期）
├── utils.js             # 工具函数
└── config.js            # 配置常量
```

### 3.4 关建快捷键

| 快捷键 | 功能 |
|--------|------|
| `Alt + 1` | 打开/关闭脚本编辑器 |
| `Alt + 2` | 打开/关闭控制台 |
| `Alt + 3` | 打开/关闭内存查看器 |
| `Ctrl + Enter` | 提交脚本到服务器 |
| `Ctrl + \` | 清除控制台 |

---

## 四、房间控制器（RCL）逐级攻略

房间控制器等级决定了你的建筑能力和殖民地规模。这是整个游戏的核心进度系统。

### RCL 解锁一览

| RCL | 升级所需能量 | 解锁建筑 | 最大 Spawn 能量 |
|-----|------------|---------|----------------|
| 1 | — | Spawn | 300 |
| 2 | 200 | Extensions ×5 + Walls/Ramparts | 550 |
| 3 | 20,000 | Tower + Extensions ×10 | 800 |
| 4 | 130,000 | Storage + Extensions ×20 | 1,300 |
| 5 | 405,000 | Links ×2 + Tower ×2 + Extensions ×30 | 1,800 |
| 6 | 1,213,000 | Terminal + Extractor + Labs ×3 + Links ×3 | 2,300 |
| 7 | 3,055,000 | Factory + Spawn ×2 + Tower ×3 + Links ×4 + Labs ×6 | 5,600 |
| 8 | 7,725,000 | Observer + Power Spawn + Nuker + Tower ×6 + Links ×6 + Labs ×10 | 12,900 |

### RCL 1 → 初始阶段

**目标**：尽快升到 RCL 3

- 从教程代码起步，只需要 1 个 Harvester + 1 个 Upgrader
- 使用 `[WORK, CARRY, MOVE]` 基础 Creep（200 能量）
- **Pro Tip**：从 RCL 1 开始就要利用 CPU Bucket 生成 Pixels！

```javascript
module.exports.loop = function () {
    // 其他代码...
    // CPU 桶满时生成 Pixels（可在市场出售换 Credits）
    if (Game.cpu.generatePixel && Game.cpu.bucket >= 9900) {
        Game.cpu.generatePixel();
    }
};
```

### RCL 2 → 扩展容量

**目标**：建造 5 个 Extensions，提高 Spawn 能量到 550

- 可以建造 **Walls** 和 **Ramparts** 做基础防御
- Creep 最大能量提升到 550，可以孵化更强力的 Creep
- 例如：`[WORK, WORK, CARRY, CARRY, MOVE, MOVE]`（500 能量）
- **注意**：提前规划好 Extensions 的布局，满级需要 60 个

### RCL 3 → 关键里程碑 ⭐

**目标**：立即建造 Tower！

- **Tower 是当前最好的防御设施**
  - 每次攻击消耗 10 能量
  - 伤害 150~600（取决于与目标的距离）
  - 可以攻击任意位置的目标
  - 也可以治疗 Creep 和修复建筑
- 即使不与其他玩家交战，**NPC Invaders** 也会定期入侵！
- Extensions 增加到 10 个，Spawn 能量上限 800

### RCL 4 → 存储时代

**目标**：建造 Storage

- Storage 可存储 **100 万单位**资源，且不会随时间衰减
- **位置选择非常重要**——建好之后很难移动
- 此时可以做**静态采集**（Static Harvesting）：
  - 让 Harvester 留在 Source 旁边不移动
  - 用另一个 Creep（搬运工）从 Container 把能量运回基地
  - 效率远高于让采集者来回跑

### RCL 5 → 物流升级

**目标**：利用 Links 大幅提升效率

- 需要 121 万能量才能升到 RCL 6，必须优化产出
- **Link Mining**：在 Source 旁放一个 Link → 连接 Controller 旁的 Link
- 每 tick 自动传送 100 能量，大幅减少搬运需求
- Extensions ×30，Spawn 能量 1,800

### RCL 6 → 中后期

**目标**：解锁 Terminal、Extractor、Labs

- **Terminal**：可以在全球市场买卖资源
  - 此时可以出售之前生成的 Pixels
  - 在已占领房间之间转移资源（消耗能量）
  - 长距离传输比搬运 Creep 更高效
- **Extractor**：采集房间内的稀有矿物
  - 直接在矿物点上建造
  - 用 Creep 的 `harvest()` 采集
  - 存入 Storage 或 Terminal
- **Labs**：制作 Boosts
  - 至少需要 3 个 Lab
  - 可以增强 Creep 部件效果最高 **600%**
  - 需要两种矿物组：Keanium/Lemergium/Utrium/Zynthium + Oxygen/Hydrogen

### RCL 7 → 大规模扩张

- 第二个 Spawn，Creep 生产速度翻倍
- Factory 解锁，可以加工 Commodities
- Spawn 能量上限 5,600，可以孵化超大型 Creep
- 适合开始远程采集和扩张

### RCL 8 → 满级

- **终极建筑**：Observer、Power Spawn、Nuker
- 每 tick 最多向 Controller 投入 15 能量升级
- Spawn 能量上限 12,900
- 可以制造 **Power Creep**
- **重要**：建好 Power Spawn 后，访问 https://screeps.com/a/#!/power-promo 可**立即获得 GPL 3**（节省 9000 超能）

---

## 五、Creep 身体部件详解

### 部件类型

| 部件 | 成本 | 功能 |
|------|------|------|
| **WORK** | 100 | 采集能量/矿物、建造、修复、升级控制器、拆解建筑 |
| **MOVE** | 50 | 移动，每 MOVE 每 tick 减少 2 疲劳 |
| **CARRY** | 50 | 携带资源，每个 CARRY 可携带 50 容量 |
| **ATTACK** | 80 | 近战攻击，每部件 30 伤害 |
| **RANGED_ATTACK** | 150 | 远程攻击（3 格），单目标 10 伤/范围 1/4/10 衰减 |
| **HEAL** | 250 | 治疗，近程 12/远程 4 每 tick |
| **TOUGH** | 10 | 纯血量部件，100 HP，配合 Boost 可减伤 |
| **CLAIM** | 600 | 占领房间控制器 |

### 移动机制

- 每个非 MOVE 部件在移动时产生疲劳：道路 1，平地 2，沼泽 10
- 每个 MOVE 部件每 tick 减少 2 疲劳
- **1 MOVE 正好带动 1 其他部件**时速度为 1 格/tick

| 示例 Creep 配置 | 移动速度 |
|----------------|---------|
| `[WORK,CARRY,MOVE]` | 空载 1 格/tick，满载 0.5 格/tick |
| `[MOVE,MOVE,WORK,WORK,CARRY]` | 空载 1 格/tick |
| `[TOUGH,ATTACK,MOVE,MOVE]` | 1 格/tick |
| `[WORK,WORK,WORK,WORK,MOVE]` | 1 格/2 tick（4:1 减速） |

### 伤害机制

- 每个部件提供 **100 HP**，50 个部件的 Creep 有 5000 HP
- 受伤时，按**部件排列顺序**依次受伤（从数组头部开始）
- 损坏的部件不再提供功能（但仍增加重量）

### 高效 Creep 配置推荐

**前期（300~550 能量）**：
```
[WORK, CARRY, MOVE]                // 万能小工，200 能量
[WORK, WORK, CARRY, CARRY, MOVE, MOVE]  // 高效采集，500 能量
```

**中期（800~1800 能量）**：
```
[WORK×5, CARRY×5, MOVE×5]         // 5:5:5 平衡型，1500 能量
[WORK×10, MOVE×5]                  // 纯采集者（Source 旁静态采集）
[CARRY×10, MOVE×10]               // 搬运工
```

**后期（2300+ 能量）**：
```
[WORK×15, CARRY×15, MOVE×15]      // 大型工人
[WORK×20, CARRY×10, MOVE×15]      // 偏采集的工人
```

### Body Part 成本优化

> 每多一个 WORK 部件，采集效率线性增加，但成本也线性增加。
> 最优配置取决于 Source 距离、道路情况和你的 CPU 预算。

---

## 六、建筑与布局规划

### 建筑布局原则

1. **Spawn 居中**：Spawn 和 Extensions 尽量靠近 Source 和 Controller
2. **Extensions 集群**：方便搬运 Creep 快速填充
3. **Tower 覆盖全屋**：Tower 放在能覆盖最多区域的位置
4. **Storage 在中心**：作为物流枢纽
5. ** Labs 间距 ≤ 2 格**：化学反应的 Lab 间距不能超过 2 格
6. **提前规划**：满级需要 60 个 Extensions + 6 个 Tower + 10 个 Labs

### 建议建筑顺序

```
RCL 1: Spawn
RCL 2: Extensions ×5 → Roads
RCL 3: Tower → Extensions ×10
RCL 4: Storage → Extensions ×20
RCL 5: Links ×2 → Extensions ×30
RCL 6: Terminal → Extractor → Labs ×3
RCL 7: Spawn ×2 → Factory → Labs ×6
RCL 8: Power Spawn → Nuker → Observer → Labs ×10
```

### 道路规划

- 在 Creep 常走路径上铺设 **Roads**（减少移动疲劳）
- 在沼泽上优先铺路
- 道路会自动随时间损耗，需要定期修复或使用 Rampart 保护

---

## 七、资源体系

### 7.1 能量（Energy）

- 最重要的基础资源
- 从 Source 采集，每个房间通常 2 个 Source
- 每个 Source 初始 3000 能量，每 300 tick 完全再生
- 用途：孵化 Creep、建造建筑、Tower 攻击/修理

### 7.2 矿物（Minerals）

共 7 种基础矿物，每个房间只有一种：

| 矿物 | 符号 | 用途 |
|------|------|------|
| Hydrogen | H | 合成基础化合物 |
| Oxygen | O | 合成基础化合物 |
| Utrium | U | → 攻击/远程攻击 Boost |
| Keanium | K | → 疲劳/移动 Boost |
| Lemergium | L | → 搬运/治疗 Boost |
| Zynthium | Z | → 工作/采集 Boost |
| Catalyst | X | T3 级 Boost 必需 |

**三步骤流程**：
1. 建 **Extractor** 开采基础矿物
2. 在 **Labs** 中合成化合物
3. 用化合物 **Boost** Creep 的身体部件

### 7.3 Boosts

每个部件只能接受一次 Boost，消耗 30 矿物 + 20 能量。

| 等级 | 效果 | 复杂度 |
|------|------|--------|
| T1 | 相当于 2 个部件 | 基础矿物 + O/H |
| T2 | 相当于 3 个部件 | T1 + Hydroxide |
| T3 | 相当于 4 个部件 | T2 + Catalyst |

> **XGH20**（T3 升级 Boost）被认为是最有价值的——让 Upgrader 升级速度翻倍，但能耗不变。

### 7.4 超能（Power）

- RCL 8 后建造 **Power Spawn** 获得
- 需要 **Power Creep** 来使用超能技能
- 重要技能：Generate Ops（产生操作点）、Regen Source（加速能量再生）

### 7.5 商品（Commodities）

- RCL 7 解锁 Factory 后制造
- 可以在市场出售换取 Credits
- 是后期获取 Credits 的主要方式之一

---

## 八、防御与战斗

### 8.1 防御体系

| 设施 | RCL | 功能 |
|------|-----|------|
| Rampart | 2 | 保护建筑，可被攻击，需要维修 |
| Wall | 2 | 阻挡入侵者 |
| Tower | 3 | 全屋自动攻击/治疗/修复 |
| Safe Mode | 1 | 激活后 20,000 tick 内禁止敌人攻击控制器 |

### 8.2 Tower 使用要点

- 伤害随距离衰减（150~600），优先攻击远处的敌人
- 可以治疗友方 Creep（每 tick 恢复，消耗能量）
- 修复建筑（比 Creep 修复更高效）
- **RCL 3 到达后第一时间建造**，因为 NPC Invaders 会定期入侵

### 8.3 战斗 Creep 配置

**近战型**：
```
[TOUGH, ATTACK×10, MOVE×10]   // 肉搏战
```

**远程型**：
```
[MOVE, RANGED_ATTACK×10, MOVE×10]  // 风筝战术
```

**治疗型**：
```
[MOVE, HEAL×10, MOVE×10]  // 奶妈
```

**组合小队**：
- **Duo**（双人组）：1 个近战 + 1 个奶妈（距离 1 格）
- **Squad**（四人组）：2 个远程 + 1 个近战 + 1 个奶妈

### 8.4 Nuker

- RCL 8 解锁，发射核弹
- 需要 300,000 能量 + 10,000 Ghodium 矿物
- 对目标房间造成毁灭性范围伤害
- 核弹飞行需要约 50,000 tick 到达目标

---

## 九、进阶玩法

### 9.1 远程采集（Remote Harvesting）

向未占领的房间派出 Creep 采集能量。编程难度较高，但能大幅增加能量收入。

**步骤**：
1. Scout 探路，找 Source 丰富且安全的房间
2. 在 Source 旁建 Container
3. 派遣远程采集 Creep（含足够 MOVE 部件减少路途时间）
4. 定期派搬运工取回能量

### 9.2 Power Creep 路线

建议首次 Power Creep 技能路线：

```
1. Generate Ops（产生操作点）→ 尽早满级
2. Regen Source（加速能量再生）
3. Operate Lab（加速实验室反应）
4. Operate Extension（自动填充 Extension）
5. Operate Spawn（增加 Spawn 产能）
6. Operate Tower（增强 Tower 性能）
```

### 9.3 市场交易

- RCL 6 后可通过 Terminal 在全球市场买卖
- 可以出售的项目：Pixels、矿物、Boost 化合物、商品
- Credits 可以购买 CPU 升级、装饰品等

### 9.4 多房间管理

当 GCL 足够高时（通常 GCL 2+），可以占领第二个房间：

- **同分片**：通过 Portal 或跨界移动，用 Claim Creep 占领
- **跨分片**：通过分片间的 Portal，使用 `InterShardMemory` 共享数据

### 9.5 Pixel 生成策略

```javascript
if (Game.cpu.generatePixel && Game.cpu.bucket >= 10000) {
    Game.cpu.generatePixel();
}
```

- CPU 桶容量 **10,000**，约 500 tick 从空充满
- 超过的部分会被浪费，所以满了就要生成 Pixels
- Pixels 可以出售换取 Credits，是免费玩家的主要 Credits 来源

---

## 十、常见错误与避坑

### ❌ 新手常见错误

1. **让采集 Creep 来回跑**
   - ✅ 改用在 Source 旁建 Container 的静态采集
2. **不规划布局就乱建 Extensions**
   - ✅ 提前规划好满级布局
3. **忽略防御**
   - ✅ RCL 3 立刻建 Tower，否则随时可能被 NPC 攻破
4. **Creep 不限制数量导致 CPU 爆炸**
   - ✅ 用代码控制最大数量，优先保证核心 Creep
5. **不在常走路线上铺路**
   - ✅ 道路可以提高至少 50% 的移动效率
6. **RCL 8 后忘了领 Power Promo**
   - ✅ 建好 Power Spawn 马上去领 GPL 3
7. **Storage 位置选在不方便的地方**
   - ✅ 放在基地中心，靠近 Spawn 和 Controller
8. **一个脚本跑到底，不加模块化**
   - ✅ 善用 `require()` 拆分模块，提高可维护性

### ⚠️ 重要计时器规则

- **降级计时器**：每 tick 不升级控制器，计时器减 1；有 Creep 升级则加 100
- 计时器归零时控制器降级，**RCL 1 降级意味著失去房间**
- 计时器低于最大值 50% 时**无法开启安全模式**

---

## 十一、实用工具与社区资源

### 官方资源

| 资源 | 链接 |
|------|------|
| 游戏官网 | https://screeps.com |
| 官方 API 文档（英文） | https://docs.screeps.com/api |
| 中文文档（社区翻译） | https://screeps-cn.github.io |
| 社区 Wiki | https://wiki.screepspl.us |
| 官方论坛 | https://screeps.com/forum |

### 社区资源

| 资源 | 说明 |
|------|------|
| **Screeps Discord** | 最活跃的社区，获取帮助最快 |
| **QQ 群** | "Screeps 编程游戏小组"——中文社区 |
| **GitHub 示例代码** | 搜索 "screeps bot" 可找到大量开源机器人 |
| **ScreepsPlus** | 社区成员评级和插件平台（https://screepspl.us） |

### 推荐阅读

- [Intermediate-level tips](https://wiki.screepspl.us/Intermediate-level_tips)
- [Common development problems](https://wiki.screepspl.us/Common_development_problems)
- [Basic debugging](https://wiki.screepspl.us/Basic_debugging)
- [Maturity Matrix](https://wiki.screepspl.us/Maturity_Matrix)

### 常用开源 Bot 参考

| Bot 名称 | 特点 |
|----------|------|
| **Tooangel** | 模块化、注释完善，适合学习 |
| **Hivemind** | Overmind 的后继者，高质量代码 |
| **Screeps-bot** | 社区维护的参考实现 |

---

## 附录：快速查表

### RCL 升级能量需求速查

```
RCL 1→2:    200 能量
RCL 2→3:    20,000 能量
RCL 3→4:    130,000 能量
RCL 4→5:    405,000 能量
RCL 5→6:    1,213,000 能量
RCL 6→7:    3,055,000 能量
RCL 7→8:    7,725,000 能量
```

### 基础 Creep 模板速查

```
万能小工:     [WORK, CARRY, MOVE]                         200 能量
勤劳小工:     [WORK, WORK, CARRY, MOVE]                   300 能量
高效采集:     [WORK×3, CARRY×2, MOVE×3]                   550 能量
主力工人:     [WORK×5, CARRY×5, MOVE×5]                  1500 能量
大型搬运:     [CARRY×10, MOVE×10]                         1000 能量
静态采集:     [WORK×10, MOVE×5]                            1250 能量
战斗近战:     [TOUGH, ATTACK×10, MOVE×10]                 1380 能量
战斗远程:     [RANGED_ATTACK×10, MOVE×10]                 2000 能量
奶妈:         [HEAL×5, MOVE×10]                            1750 能量
斥候:         [MOVE]                                       50 能量
占领:         [CLAIM, MOVE]                                650 能量
```

---

> **最后的话**：Screeps 不是一款"玩完就删"的游戏。它是一场马拉松——你的代码在服务器上每天 24 小时运行，不断演进。写可维护的代码，从简单开始逐步迭代，保持与社区交流，你的殖民地会一天比一天强大。

> **Shard 3 新手指南摘要**：
> 1. 完成游戏内置教程
> 2. RCL 1 就用好 Pixel 生成
> 3. 尽快冲到 RCL 3 建 Tower
> 4. 用静态采集替代来回跑
> 5. 学会使用 Memory 和 role 分工
> 6. RCL 4 建 Storage 后去抢第二个房间
> 7. 加入社区，阅读别人的代码
