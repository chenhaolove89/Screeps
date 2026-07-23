/**
 * 搬运者 (Transporter)
 *
 * 职责：从采集节点（掉落资源、Container、Storage、Tombstone）搬运能量到
 *       消费节点（Spawn、Extension、Tower、Storage）。
 *       通过统一任务调度框架获取任务，支持优先级调度、错误重试、进度追踪。
 *
 * ── 状态机 ──
 *   IDLE → GET_TASK → MOVING_TO_PICKUP → PICKING_UP
 *        → MOVING_TO_DELIVER → DELIVERING → COMPLETE → IDLE
 *
 * ── 取货优先级 ──
 *   1. 地面掉落资源 (dropped energy) — 防止消失
 *   2. Tombstone / Ruin — 回收死亡 creep 的资源
 *   3. Container — 采集者投放的集中点
 *   4. Storage — 长期存储
 *
 * ── 送货优先级 ──
 *   1. Spawn（能量 < 300）— 保证孵化
 *   2. Extension（未满）— 保证孵化容量
 *   3. Tower（能量 < 500）— 防御
 *   4. Storage — 集中存储
 */

var taskScheduler = require('task.scheduler');

// ── 内部常量 ────────────────────────────────────────────
var LOG_LEVEL = {
    DEBUG: 0,
    INFO:  1,
    WARN:  2,
    ERROR: 3,
};
var CURRENT_LOG_LEVEL = LOG_LEVEL.INFO;

/** Room.find 缓存有效期 (ticks) — 短 TTL 确保快速发现新掉落的资源 */
var CACHE_TTL = 5;

/** 结构体优先级权重（数字越小优先级越高） */
var DELIVERY_PRIORITY = {
    spawn:     1,
    extension: 2,
    tower:     3,
    storage:   4,
    container: 5,
};

/** Spawn 低能量阈值 */
var SPAWN_LOW_ENERGY = 300;

/** Tower 低能量阈值 */
var TOWER_LOW_ENERGY = 500;

// ── Room 级缓存 ─────────────────────────────────────────
var _cache = {
    droppedResources: { tick: 0, data: null },
    tombstones:       { tick: 0, data: null },
    structures:       { tick: 0, data: null },
};

var roleTransporter = {

    /** @param {Creep} creep */
    run: function (creep) {
        var logCtx = '[' + creep.name + ']';

        // 初始化阶段追踪（空=需要取货, carry=正在搬运中）
        if (!creep.memory._transportPhase) {
            creep.memory._transportPhase = 'empty';
        }

        // ── 阶段切换（仅在实际变化时切换，不在每 tick 重置状态） ──
        var phase = creep.memory._transportPhase;

        // 身上没能量了 → 进入取货阶段（只在之前不是取货阶段时重置）
        if (creep.store[RESOURCE_ENERGY] === 0 && phase !== 'empty') {
            creep.memory._transportPhase = 'empty';
            if (creep.memory._taskId) {
                taskScheduler.releaseCreep(creep.name);
                creep.memory._taskId = null;
            }
            creep.memory._pickupId = null;
            creep.memory.transporterState = 'GET_TASK';
            phase = 'empty';
        }

        // 身上装满了 → 进入送货阶段（只在之前不是送货阶段时切换）
        if (creep.store.getFreeCapacity() === 0 && phase !== 'carry') {
            creep.memory._transportPhase = 'carry';
            creep.memory._deliverId = null;
            creep.memory.transporterState = 'DELIVERING';
            phase = 'carry';
        }

        // ── 状态机（按阶段分别处理） ──
        if (phase === 'empty') {
            // 取货阶段的状态
            switch (creep.memory.transporterState) {
                case 'GET_TASK':
                    this._doPickup(creep, logCtx);
                    break;
                case 'MOVING_TO_PICKUP':
                    this._moveToPickup(creep, logCtx);
                    break;
                case 'PICKING_UP':
                    this._executePickup(creep, logCtx);
                    break;
                default:
                    // 状态机异常 → 重置
                    creep.memory.transporterState = 'GET_TASK';
                    this._doPickup(creep, logCtx);
                    break;
            }
        } else {
            // 送货阶段的状态
            switch (creep.memory.transporterState) {
                case 'DELIVERING':
                    this._doDelivery(creep, logCtx);
                    break;
                case 'MOVING_TO_DELIVER':
                    this._moveToDeliver(creep, logCtx);
                    break;
                default:
                    creep.memory.transporterState = 'DELIVERING';
                    this._doDelivery(creep, logCtx);
                    break;
            }
        }

        // ── 健康检查 ──
        this._healthCheck(creep, logCtx);
    },

    // ══════════════════════════════════════════════════════
    //  取货阶段
    // ══════════════════════════════════════════════════════

    /**
     * 获取取货任务 — 扫描并选择最优取货点
     */
    _doPickup: function (creep, logCtx) {
        var target = this._findBestPickup(creep);
        if (!target) {
            // 没有可取的资源 → 尝试通过调度器获取任务
            var task = taskScheduler.getNextTask(creep);
            if (task) {
                taskScheduler.assignTask(task.id, creep.name);
                creep.memory._taskId = task.id;
                creep.memory._pickupId = task.sourceId;
                creep.memory._deliverId = task.targetId;
                this._log(LOG_LEVEL.DEBUG, logCtx + ' 获取任务: ' + task.id);
            } else {
                // 真的无事可做，进入低功耗等待
                this._log(LOG_LEVEL.DEBUG, logCtx + ' 无可用取货点，等待中');
                return;
            }
        } else {
            creep.memory._pickupId = target.id;
        }

        creep.memory.transporterState = 'MOVING_TO_PICKUP';
        this._moveToPickup(creep, logCtx);
    },

    /**
     * 移动到取货点
     */
    _moveToPickup: function (creep, logCtx) {
        var pickupId = creep.memory._pickupId;
        if (!pickupId) {
            creep.memory.transporterState = 'GET_TASK';
            return;
        }

        var target = Game.getObjectById(pickupId);
        if (!target) {
            // 目标消失了 → 重新找
            this._log(LOG_LEVEL.DEBUG, logCtx + ' 取货目标已消失');
            creep.memory._pickupId = null;
            creep.memory.transporterState = 'GET_TASK';
            return;
        }

        // 到达范围内 → 开始取货
        if (creep.pos.inRangeTo(target, 1)) {
            creep.memory.transporterState = 'PICKING_UP';
            this._executePickup(creep, logCtx);
            return;
        }

        var moveResult = creep.moveTo(target, {
            visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' },
            reusePath: 20,
        });

        // 只有不可达错误才算真正失败，其他情况（如 TIRED、未到位等）继续尝试
        if (moveResult === ERR_NO_PATH || moveResult === ERR_INVALID_TARGET) {
            this._log(LOG_LEVEL.WARN, logCtx + ' 移动到取货点失败(无路径): ' + moveResult);
            this._handleMoveError(creep, pickupId, logCtx);
        }
        // 其他返回值（OK, ERR_TIRED, ERR_BUSY, 以及各环境可能的变体）都继续尝试
    },

    /**
     * 执行取货操作
     */
    _executePickup: function (creep, logCtx) {
        var pickupId = creep.memory._pickupId;
        if (!pickupId) {
            creep.memory.transporterState = 'GET_TASK';
            return;
        }

        var target = Game.getObjectById(pickupId);
        if (!target) {
            creep.memory._pickupId = null;
            creep.memory.transporterState = 'GET_TASK';
            return;
        }

        var result;
        var isDropped = !!target.resourceType; // 地面掉落资源

        if (isDropped) {
            result = creep.pickup(target);
        } else {
            // 从 structure 取
            result = creep.withdraw(target, RESOURCE_ENERGY);
        }

        if (result === OK) {
            this._log(LOG_LEVEL.DEBUG, logCtx + ' 取货成功: ' + pickupId);
            creep.memory._pickupId = null;

            // 检查容量：满了就去送货，否则继续取
            if (creep.store.getFreeCapacity() === 0) {
                creep.memory.transporterState = 'DELIVERING';
                this._doDelivery(creep, logCtx);
            } else {
                creep.memory.transporterState = 'GET_TASK';
            }

        } else if (result === ERR_NOT_IN_RANGE) {
            creep.memory.transporterState = 'MOVING_TO_PICKUP';

        } else if (result === ERR_NOT_ENOUGH_RESOURCES || result === ERR_EMPTY) {
            // 资源已被取完 → 找下一个
            this._log(LOG_LEVEL.DEBUG, logCtx + ' 取货点已空: ' + pickupId);
            creep.memory._pickupId = null;
            creep.memory.transporterState = 'GET_TASK';

        } else if (result === ERR_FULL) {
            // creep 满了 → 去送货
            creep.memory.transporterState = 'DELIVERING';
            this._doDelivery(creep, logCtx);

        } else {
            this._log(LOG_LEVEL.WARN, logCtx + ' 取货失败(' + result + '): ' + pickupId);
            // 非致命错误 → 重试
            this._handlePickupError(creep, pickupId, result, logCtx);
        }
    },

    // ══════════════════════════════════════════════════════
    //  送货阶段
    // ══════════════════════════════════════════════════════

    /**
     * 获取送货目标 — 按优先级找最需要能量的建筑
     */
    _doDelivery: function (creep, logCtx) {
        var target = this._findBestDelivery(creep);
        if (!target) {
            this._log(LOG_LEVEL.DEBUG, logCtx + ' 无可用送货目标');
            // 无处可送 → 如果是从调度器拿到任务，完成它
            if (creep.memory._taskId) {
                taskScheduler.completeTask(creep.memory._taskId);
                creep.memory._taskId = null;
                creep.memory._deliverId = null;
            }
            creep.memory.transporterState = 'GET_TASK';
            creep.memory._transportPhase = 'empty';
            return;
        }

        creep.memory._deliverId = target.id;
        creep.memory.transporterState = 'MOVING_TO_DELIVER';
        this._moveToDeliver(creep, logCtx);
    },

    /**
     * 移动到送货目标
     */
    _moveToDeliver: function (creep, logCtx) {
        var deliverId = creep.memory._deliverId;
        if (!deliverId) {
            creep.memory.transporterState = 'DELIVERING';
            return;
        }

        var target = Game.getObjectById(deliverId);
        if (!target) {
            this._log(LOG_LEVEL.DEBUG, logCtx + ' 送货目标已消失');
            creep.memory._deliverId = null;
            creep.memory.transporterState = 'DELIVERING';
            return;
        }

        // 到达范围内 → 开始送货
        if (creep.pos.inRangeTo(target, 1)) {
            this._executeDelivery(creep, target, logCtx);
            return;
        }

        var moveResult = creep.moveTo(target, {
            visualizePathStyle: { stroke: '#ffffff', lineStyle: 'dashed' },
            reusePath: 20,
        });

        // 只有不可达错误才算真正失败
        if (moveResult === ERR_NO_PATH || moveResult === ERR_INVALID_TARGET) {
            this._log(LOG_LEVEL.WARN, logCtx + ' 移动到送货点失败(无路径): ' + moveResult);
            this._handleMoveError(creep, deliverId, logCtx);
        }
    },

    /**
     * 执行送货操作
     */
    _executeDelivery: function (creep, target, logCtx) {
        var result = creep.transfer(target, RESOURCE_ENERGY);

        if (result === OK) {
            // 更新任务进度
            var carried = creep.store.getUsedCapacity(RESOURCE_ENERGY);
            var capacity = creep.store.getCapacity(RESOURCE_ENERGY);
            var progress = capacity - carried;

            // 更新进度
            if (creep.memory._taskId) {
                taskScheduler.updateTask(
                    creep.memory._taskId,
                    taskScheduler.STATUS.IN_PROGRESS,
                    progress,
                    capacity
                );
            }

            this._log(LOG_LEVEL.DEBUG, logCtx + ' 送货: ' + progress + '/' + capacity
                + ' → ' + target.structureType);

            // 检查是否需要继续送货
            if (creep.store[RESOURCE_ENERGY] === 0) {
                // 能量送完了 → 完成任务
                if (creep.memory._taskId) {
                    taskScheduler.completeTask(creep.memory._taskId);
                    creep.memory._taskId = null;
                }
                creep.memory._deliverId = null;
                creep.memory.transporterState = 'GET_TASK';
            } else {
                // 还有能量 → 找下一个送货目标
                creep.memory._deliverId = null;
                creep.memory.transporterState = 'DELIVERING';
            }

        } else if (result === ERR_NOT_IN_RANGE) {
            creep.memory.transporterState = 'MOVING_TO_DELIVER';

        } else if (result === ERR_FULL) {
            // 目标已满 → 找下一个
            this._log(LOG_LEVEL.DEBUG, logCtx + ' 送货目标已满: ' + target.structureType);
            creep.memory._deliverId = null;
            creep.memory.transporterState = 'DELIVERING';

        } else {
            this._log(LOG_LEVEL.WARN, logCtx + ' 送货失败(' + result + '): ' + target.structureType);
            this._handleDeliveryError(creep, target.id, result, logCtx);
        }
    },

    // ══════════════════════════════════════════════════════
    //  目标选择算法
    // ══════════════════════════════════════════════════════

    /**
     * 找到最优取货点
     * 优先级：地面掉落 > Tombstone/Ruin > Container > Storage
     */
    _findBestPickup: function (creep) {
        var room = creep.room;

        // 1. 地面掉落资源（优先级最高 — 会随时间消失）
        var dropped = this._getCachedDroppedResources(room);
        for (var i = 0; i < dropped.length; i++) {
            if (dropped[i].resourceType === RESOURCE_ENERGY && dropped[i].amount >= 50) {
                // 检查是否已被其他 transporter 锁定
                if (!this._isPickupLocked(dropped[i].id)) {
                    this._lockPickup(dropped[i].id, creep.name);
                    return dropped[i];
                }
            }
        }

        // 2. Tombstone / Ruin
        var tombstones = this._getCachedTombstones(room);
        for (var j = 0; j < tombstones.length; j++) {
            if (tombstones[j].store[RESOURCE_ENERGY] > 0) {
                if (!this._isPickupLocked(tombstones[j].id)) {
                    this._lockPickup(tombstones[j].id, creep.name);
                    return tombstones[j];
                }
            }
        }

        // 3. Container（有能量且非空）
        var structures = this._getCachedStructures(room);
        for (var k = 0; k < structures.length; k++) {
            var s = structures[k];
            if (
                s.structureType === STRUCTURE_CONTAINER &&
                s.store[RESOURCE_ENERGY] >= 100 &&
                !this._isPickupLocked(s.id)
            ) {
                this._lockPickup(s.id, creep.name);
                return s;
            }
        }

        // 4. Storage（只取超出一定量的）
        for (var m = 0; m < structures.length; m++) {
            var st = structures[m];
            if (
                st.structureType === STRUCTURE_STORAGE &&
                st.store[RESOURCE_ENERGY] >= 500 &&
                !this._isPickupLocked(st.id)
            ) {
                this._lockPickup(st.id, creep.name);
                return st;
            }
        }

        return null;
    },

    /**
     * 找到最优送货目标
     * 优先级：Spawn低能量 > Extension未满 > Tower低能量 > Storage
     */
    _findBestDelivery: function (creep) {
        var room = creep.room;
        var structures = this._getCachedStructures(room);

        // 按优先级分组排序
        var candidates = [];

        for (var i = 0; i < structures.length; i++) {
            var s = structures[i];
            var st = s.structureType;

            if (st === STRUCTURE_SPAWN || st === STRUCTURE_EXTENSION || st === STRUCTURE_TOWER) {
                if (s.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                    var priority = DELIVERY_PRIORITY[st] || 99;

                    // Spawn 低能量提升优先级
                    if (st === STRUCTURE_SPAWN && s.store[RESOURCE_ENERGY] < SPAWN_LOW_ENERGY) {
                        priority = 0; // 最高优先级
                    }
                    // Tower 低能量提升优先级
                    if (st === STRUCTURE_TOWER && s.store[RESOURCE_ENERGY] < TOWER_LOW_ENERGY) {
                        priority = 2.5;
                    }

                    candidates.push({
                        target:   s,
                        priority: priority,
                        // 按剩余容量排序（同优先级内，空的最优先）
                        freeCap:  s.store.getFreeCapacity(RESOURCE_ENERGY),
                    });
                }
            }
        }

        // 排序：priority 升序，同优先级 freeCap 降序（最空的优先）
        candidates.sort(function (a, b) {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return b.freeCap - a.freeCap;
        });

        if (candidates.length > 0 && !this._isDeliverLocked(candidates[0].target.id)) {
            this._lockDeliver(candidates[0].target.id, creep.name);
            return candidates[0].target;
        }

        // 兜底：Storage（如果所有消费端都满了）
        for (var j = 0; j < structures.length; j++) {
            var ss = structures[j];
            if (
                ss.structureType === STRUCTURE_STORAGE &&
                ss.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                !this._isDeliverLocked(ss.id)
            ) {
                this._lockDeliver(ss.id, creep.name);
                return ss;
            }
        }

        return null;
    },

    // ══════════════════════════════════════════════════════
    //  资源锁管理（防止多个 transporter 抢同一目标）
    // ══════════════════════════════════════════════════════

    /**
     * 检查取货点是否已被锁定
     */
    _isPickupLocked: function (id) {
        if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
        var lock = Memory._transporterLocks.pickups[id];
        if (!lock) return false;
        // 验证持有锁的 creep 仍存活
        if (!Game.creeps[lock]) {
            delete Memory._transporterLocks.pickups[id];
            return false;
        }
        return true;
    },

    /**
     * 锁定取货点
     */
    _lockPickup: function (id, creepName) {
        if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
        Memory._transporterLocks.pickups[id] = creepName;
    },

    /**
     * 检查送货目标是否已被锁定
     */
    _isDeliverLocked: function (id) {
        if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
        var lock = Memory._transporterLocks.delivers[id];
        if (!lock) return false;
        if (!Game.creeps[lock]) {
            delete Memory._transporterLocks.delivers[id];
            return false;
        }
        return true;
    },

    /**
     * 锁定送货目标
     */
    _lockDeliver: function (id, creepName) {
        if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
        Memory._transporterLocks.delivers[id] = creepName;
    },

    /**
     * 释放 creep 持有的所有锁
     */
    _releaseAllLocks: function (creepName) {
        if (!Memory._transporterLocks) return;
        var locks = Memory._transporterLocks;
        for (var key in locks.pickups) {
            if (locks.pickups[key] === creepName) delete locks.pickups[key];
        }
        for (var key in locks.delivers) {
            if (locks.delivers[key] === creepName) delete locks.delivers[key];
        }
    },

    // ══════════════════════════════════════════════════════
    //  Room.find 缓存
    // ══════════════════════════════════════════════════════

    _getCachedDroppedResources: function (room) {
        if (!_cache.droppedResources.data || Game.time - _cache.droppedResources.tick > CACHE_TTL) {
            _cache.droppedResources.data = room.find(FIND_DROPPED_RESOURCES);
            _cache.droppedResources.tick = Game.time;
        }
        return _cache.droppedResources.data;
    },

    _getCachedTombstones: function (room) {
        if (!_cache.tombstones.data || Game.time - _cache.tombstones.tick > CACHE_TTL) {
            _cache.tombstones.data = room.find(FIND_TOMBSTONES);
            _cache.tombstones.tick = Game.time;
        }
        return _cache.tombstones.data;
    },

    _getCachedStructures: function (room) {
        if (!_cache.structures.data || Game.time - _cache.structures.tick > CACHE_TTL) {
            _cache.structures.data = room.find(FIND_STRUCTURES);
            _cache.structures.tick = Game.time;
        }
        return _cache.structures.data;
    },

    // ══════════════════════════════════════════════════════
    //  错误处理与重试
    // ══════════════════════════════════════════════════════

    /**
     * 移动错误处理
     */
    _handleMoveError: function (creep, targetId, logCtx) {
        if (!creep.memory._moveErrors) creep.memory._moveErrors = {};
        creep.memory._moveErrors[targetId] = (creep.memory._moveErrors[targetId] || 0) + 1;

        if (creep.memory._moveErrors[targetId] >= 5) {
            // 连续 5 次移动失败 → 放弃此目标
            this._log(LOG_LEVEL.WARN,
                logCtx + ' 放弃目标 ' + targetId + '（连续移动失败）');
            delete creep.memory._moveErrors[targetId];
            creep.memory._pickupId = null;
            creep.memory._deliverId = null;
            creep.memory.transporterState = 'GET_TASK';
            creep.memory._transportPhase = 'empty';

            // 释放锁
            this._releaseAllLocks(creep.name);
        }
    },

    /**
     * 取货错误处理
     */
    _handlePickupError: function (creep, pickupId, errorCode, logCtx) {
        if (!creep.memory._pickupErrors) creep.memory._pickupErrors = {};
        creep.memory._pickupErrors[pickupId] = (creep.memory._pickupErrors[pickupId] || 0) + 1;

        if (creep.memory._pickupErrors[pickupId] >= 3) {
            this._log(LOG_LEVEL.WARN, logCtx + ' 放弃取货点 ' + pickupId);
            delete creep.memory._pickupErrors[pickupId];
            creep.memory._pickupId = null;
            creep.memory.transporterState = 'GET_TASK';
            this._releaseAllLocks(creep.name);
        }
    },

    /**
     * 送货错误处理
     */
    _handleDeliveryError: function (creep, deliverId, errorCode, logCtx) {
        if (!creep.memory._deliveryErrors) creep.memory._deliveryErrors = {};
        creep.memory._deliveryErrors[deliverId] = (creep.memory._deliveryErrors[deliverId] || 0) + 1;

        if (creep.memory._deliveryErrors[deliverId] >= 3) {
            this._log(LOG_LEVEL.WARN, logCtx + ' 放弃送货目标 ' + deliverId);
            delete creep.memory._deliveryErrors[deliverId];
            creep.memory._deliverId = null;
            creep.memory.transporterState = 'DELIVERING';
            this._releaseAllLocks(creep.name);
        }
    },

    // ══════════════════════════════════════════════════════
    //  健康检查
    // ══════════════════════════════════════════════════════

    /**
     * 检测 transporter 是否卡住或异常
     */
    _healthCheck: function (creep, logCtx) {
        if (!creep.memory._transportHealth) {
            creep.memory._transportHealth = {
                lastProgressTick: Game.time,
                lastPos: { x: creep.pos.x, y: creep.pos.y, room: creep.pos.roomName },
                stagnationCount: 0,
            };
            return;
        }

        var h = creep.memory._transportHealth;
        var moved = (
            h.lastPos.x !== creep.pos.x ||
            h.lastPos.y !== creep.pos.y ||
            h.lastPos.room !== creep.pos.roomName
        );

        if (moved) {
            // 有移动 → 重置停滞计数
            h.lastProgressTick = Game.time;
            h.lastPos = { x: creep.pos.x, y: creep.pos.y, room: creep.pos.roomName };
            h.stagnationCount = 0;
        } else {
            h.stagnationCount++;
        }

        // 停滞超过 50 ticks → 强制重置
        if (h.stagnationCount > 50) {
            this._log(LOG_LEVEL.WARN, logCtx + ' 停滞检测：强制重置状态');
            creep.memory._transportPhase = 'empty';
            creep.memory.transporterState = 'GET_TASK';
            creep.memory._pickupId = null;
            creep.memory._deliverId = null;
            creep.memory._taskId = null;
            creep.memory._moveErrors = {};
            creep.memory._pickupErrors = {};
            creep.memory._deliveryErrors = {};
            this._releaseAllLocks(creep.name);
            h.stagnationCount = 0;
            h.lastProgressTick = Game.time;
        }
    },

    // ══════════════════════════════════════════════════════
    //  结构化日志
    // ══════════════════════════════════════════════════════

    /**
     * @param {number} level
     * @param {string} message
     */
    _log: function (level, message) {
        if (level < CURRENT_LOG_LEVEL) return;

        var prefix;
        switch (level) {
            case LOG_LEVEL.DEBUG: prefix = 'DEBUG'; break;
            case LOG_LEVEL.INFO:  prefix = 'INFO';  break;
            case LOG_LEVEL.WARN:  prefix = 'WARN';  break;
            case LOG_LEVEL.ERROR: prefix = 'ERROR'; break;
            default:              prefix = 'INFO';
        }

        console.log('[Transporter|' + prefix + '] ' + message);
    },
};

module.exports = roleTransporter;
