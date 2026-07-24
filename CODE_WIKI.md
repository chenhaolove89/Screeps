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
3. **