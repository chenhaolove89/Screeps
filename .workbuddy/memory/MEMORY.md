# 项目长期记忆 — Screeps AI

## 项目概述
Screeps MMO 策略游戏 AI，控制 creep 自动化采集、运输、建造、升级、修理。

## 架构

### 文件结构
- `main.js` — 主循环：防御塔、内存清理、角色调度、孵化
- `config.js` — 全局配置：角色数量、能量阈值等
- `state.js` — 每 tick 瞬态共享状态
- `cache.creep.js` — Creep 名字缓存（O(1) 角色计数）
- `manager.spawn.js` — 孵化管理器：自动孵化、动态 body
- `task.scheduler.js` — 统一任务调度框架
- `role.collector.js` — 采集者（纯采集，投放 Container）
- `role.transporter.js` — 搬运者（Container→消费节点）
- `role.harvester.js` — 旧版 harvester（保留向后兼容，默认禁用）
- `role.upgrader.js` — 升级者
- `role.builder.js` — 建造者
- `role.repairer.js` — 修理者

### 能量流
```
Source → Collector(harvest) → Container(drop)
                                  ↓
                  Transporter(pickup) → Spawn/Extension/Tower/Storage
```

### 调度器设计
- 任务持久化在 `Memory.tasks`
- 优先级 0-3，sourceLocks/targetLocks 防竞争
- 300 ticks 超时自动回收
- 死亡 creep 自动释放锁

### 关键约定
- 所有文件使用 CommonJS 模块 (`require`/`module.exports`)
- 数据结构优先 Memory 持久化，避免每 tick 重建
- Room.find 结果缓存 TTL 15-20 ticks
- 日志使用结构化分级输出
