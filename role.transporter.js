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
    extension: 1,  // 优先填充 Extension 以支持高资源 creep 孵化
    spawn:     2,
    tower:     3,
    storage:   4,
    container: 5,
};

/** Spawn 低能量阈值 */
var SPAWN_LOW_ENERGY = 200;

/** Tower 低能量阈值 */
var TOWER_LOW_ENERGY = 500;

/** 最小搬运资源阈值（低于此值忽略，避免搬运者守着采集者） */
var MIN_PICKUP_AMOUNT = 20;

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

        // ── 让位检查(被采集者请求让位时优先执行) ──
        if (taskScheduler.checkYield(creep)) {
            return;
        }

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
            creep.say('🔄 取货');
        }

        // 身上装满了 → 进入送货阶段（只在之前不是送货阶段时切换）
        if (creep.store.getFreeCapacity() === 0 && phase !== 'carry') {
            creep.memory._transportPhase = 'carry';
            creep.memory._deliverId = null;
            creep.memory.transporterState = 'DELIVERING';
            phase = 'carry';
            creep.say('📦 送货');
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

        // 如果站在目标上，先移开一格
        if (creep.pos.isEqualTo(target.pos)) {
            this._moveAwayFromTarget(creep, target);
            return;
        }

        // 检查是否站在阻挡型结构上(如 Container/Spawn)需要先移开;
        // 注意:road/rampart 不阻挡移动,creep 站在上面是正常的,不要移开,
        // 否则会"站在road→移开→moveTo走回road→又移开"循环抖动
        var structuresAtPos = creep.room.lookForAt(LOOK_STRUCTURES, creep.pos);
        var hasBlockingStructure = false;
        var isOnTarget = false;
        for (var j = 0; j < structuresAtPos.length; j++) {
            if (structuresAtPos[j].id === target.id) {
                isOnTarget = true;
                break;
            }
            var stType = structuresAtPos[j].structureType;
            if (stType !== STRUCTURE_ROAD && stType !== STRUCTURE_RAMPART) {
                hasBlockingStructure = true;
            }
        }
        if (!isOnTarget && hasBlockingStructure) {
            this._moveAwayFromTarget(creep, target);
            return;
        }

        var moveResult = creep.moveTo(target, {
            visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' },
            reusePath: 20,
            ignoreCreeps: false,  // 允许绕过其他 creep，避免被包围
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

        var isDropped = !!target.resourceType;
        var resourceAmount = isDropped ? target.amount : target.store[RESOURCE_ENERGY];
        if (resourceAmount < MIN_PICKUP_AMOUNT) {
            this._log(LOG_LEVEL.DEBUG, logCtx + ' 资源不足(' + resourceAmount + '), 放弃取货点');
            this._releasePickupLock(pickupId, creep.name);
            creep.memory._pickupId = null;
            creep.memory.transporterState = 'GET_TASK';
            return;
        }

        var result;

        if (isDropped) {
            result = creep.pickup(target);
        } else {
            // 从 structure 取
            result = creep.withdraw(target, RESOURCE_ENERGY);
        }

        if (result === OK) {
            this._log(LOG_LEVEL.DEBUG, logCtx + ' 取货成功: ' + pickupId);
            // 只有加过锁的目标才需要释放锁（资源 < 500 的 Container 才会加锁）
            if (!target.structureType || target.store[RESOURCE_ENERGY] < 500) {
                this._releasePickupLock(pickupId, creep.name);
            }
            creep.memory._pickupId = null;

            // 检查容量：满了才去送货；未满则切回 GET_TASK 继续找取货点
            // (修复"上上下下"bug:此前两个分支都进入 DELIVERING,
            //  导致 withdraw 一点就跑去送货,造成 Container↔Spawn 往返抖动)
            if (creep.store.getFreeCapacity() === 0) {
                creep.memory._transportPhase = 'carry';
                creep.memory.transporterState = 'DELIVERING';
                creep.say('📦 送货');
                this._doDelivery(creep, logCtx);
            } else {
                // 未满,继续在 empty 阶段,下一 tick 重新选最近取货点
                creep.memory.transporterState = 'GET_TASK';
            }

        } else if (result === ERR_NOT_IN_RANGE) {
            creep.memory.transporterState = 'MOVING_TO_PICKUP';

        } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
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
            // 身上还有能量 → 保持 carry 阶段等待下一 tick 重试,
            // 不要切 empty(否则会"找取货点→走到Container→满→找送货→无目标→切empty→..."
            //  在 Container↔原位 之间循环抖动)
            creep.memory.transporterState = 'DELIVERING';
            // 防止每 tick say 刷屏:只在首次进入"无目标"时喊一次
            if (!creep.memory._saidNoTarget) {
                creep.say('⏸ 无目标');
                creep.memory._saidNoTarget = true;
            }
            return;
        }

        // 找到目标 → 清除"无目标"标记
        creep.memory._saidNoTarget = false;
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

        // 如果站在目标上或其他结构上，先移开一格
        if (creep.pos.isEqualTo(target.pos)) {
            this._moveAwayFromTarget(creep, target);
            return;
        }

        // 检查是否站在阻挡型结构上(如 Container/Spawn)需要先移开;
        // 注意:road/rampart 不阻挡移动,creep 站在上面是正常的,不要移开,
        // 否则会"站在road→移开→moveTo走回road→又移开"循环抖动
        var structuresAtPos = creep.room.lookForAt(LOOK_STRUCTURES, creep.pos);
        var hasBlockingStructure = false;
        var isOnTarget = false;
        for (var j = 0; j < structuresAtPos.length; j++) {
            if (structuresAtPos[j].id === target.id) {
                isOnTarget = true;
                break;
            }
            var stType = structuresAtPos[j].structureType;
            if (stType !== STRUCTURE_ROAD && stType !== STRUCTURE_RAMPART) {
                hasBlockingStructure = true;
            }
        }
        if (!isOnTarget && hasBlockingStructure) {
            this._moveAwayFromTarget(creep, target);
            return;
        }

        var moveResult = creep.moveTo(target, {
            visualizePathStyle: { stroke: '#ffffff', lineStyle: 'dashed' },
            reusePath: 20,
            ignoreCreeps: false,  // 允许绕过其他 creep，避免被包围
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
            this._releaseDeliverLock(creep.memory._deliverId, creep.name);
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
            if (tombstones[j].store[RESOURCE_ENERGY] >= MIN_PICKUP_AMOUNT) {
                if (!this._isPickupLocked(tombstones[j].id)) {
                    this._lockPickup(tombstones[j].id, creep.name);
                    return tombstones[j];
                }
            }
        }

        // 3. Container（有能量且非空）
        // 资源 >= 500 时不加锁，支持多个搬运者同时搬运
        var structures = this._getCachedStructures(room);
        for (var k = 0; k < structures.length; k++) {
            var s = structures[k];
            if (s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] >= 100) {
                if (s.store[RESOURCE_ENERGY] >= 500) {
                    return s;
                }
                if (!this._isPickupLocked(s.id)) {
                    this._lockPickup(s.id, creep.name);
                    return s;
                }
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
     * 优先级：Extension未满 > Spawn低能量 > Tower低能量 > Storage
     * 优先填充 Extension 以保证孵化高资源 creep 的容量
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

        // 遍历候选列表，找到第一个未达到锁定上限的收货方
        for (var j = 0; j < candidates.length; j++) {
            var candidate = candidates[j];
            if (!this._isDeliverLocked(candidate.target.id)) {
                this._lockDeliver(candidate.target.id, creep.name);
                return candidate.target;
            }
        }

        // 兜底：Storage（如果所有消费端都满了或都被锁定）
        for (var k = 0; k < structures.length; k++) {
            var ss = structures[k];
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
        if (!Game.creeps[lock]) {
            delete Memory._transporterLocks.pickups[id];
            return false;
        }
        if (Memory._transporterLockTimestamps && Memory._transporterLockTimestamps[id]) {
            if (Game.time - Memory._transporterLockTimestamps[id] > 30) {
                delete Memory._transporterLocks.pickups[id];
                delete Memory._transporterLockTimestamps[id];
                return false;
            }
        }
        return true;
    },

    /**
     * 锁定取货点
     */
    _lockPickup: function (id, creepName) {
        if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
        Memory._transporterLocks.pickups[id] = creepName;
        if (!Memory._transporterLockTimestamps) Memory._transporterLockTimestamps = {};
        Memory._transporterLockTimestamps[id] = Game.time;
    },

    /**
     * 检查送货目标是否已被锁定（支持最多 3 个搬运者同时锁定）
     */
    _isDeliverLocked: function (id) {
        var MAX_LOCKS_PER_DELIVER = 3;
        if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
        
        var locks = Memory._transporterLocks.delivers[id];
        if (!locks) return false;
        
        // 兼容旧格式（字符串）→ 转换为数组
        if (typeof locks === 'string') {
            locks = [locks];
            Memory._transporterLocks.delivers[id] = locks;
        }
        
        // 清理无效锁定（已死亡的 creep）
        var validLocks = [];
        for (var i = 0; i < locks.length; i++) {
            if (Game.creeps[locks[i]]) {
                validLocks.push(locks[i]);
            }
        }
        
        if (validLocks.length !== locks.length) {
            Memory._transporterLocks.delivers[id] = validLocks;
            locks = validLocks;
        }
        
        // 清理超时锁定
        if (Memory._transporterLockTimestamps && Memory._transporterLockTimestamps[id]) {
            if (Game.time - Memory._transporterLockTimestamps[id] > 30) {
                delete Memory._transporterLocks.delivers[id];
                delete Memory._transporterLockTimestamps[id];
                return false;
            }
        }
        
        // 检查是否达到锁定上限
        return locks.length >= MAX_LOCKS_PER_DELIVER;
    },

    /**
     * 锁定送货目标（支持多个搬运者同时锁定）
     */
    _lockDeliver: function (id, creepName) {
        if (!Memory._transporterLocks) Memory._transporterLocks = { pickups: {}, delivers: {} };
        
        if (!Memory._transporterLocks.delivers[id]) {
            Memory._transporterLocks.delivers[id] = [];
        }
        
        var locks = Memory._transporterLocks.delivers[id];
        // 兼容旧格式（字符串）→ 转换为数组
        if (typeof locks === 'string') {
            locks = [locks];
            Memory._transporterLocks.delivers[id] = locks;
        }
        
        // 避免重复锁定
        if (locks.indexOf(creepName) === -1) {
            locks.push(creepName);
        }
        
        if (!Memory._transporterLockTimestamps) Memory._transporterLockTimestamps = {};
        Memory._transporterLockTimestamps[id] = Game.time;
    },

    /**
     * 释放 creep 持有的所有锁（支持数组格式送货锁）
     */
    _releaseAllLocks: function (creepName) {
        if (!Memory._transporterLocks) return;
        var locks = Memory._transporterLocks;
        
        // 取货锁（保持单锁格式）
        for (var key in locks.pickups) {
            if (locks.pickups[key] === creepName) {
                delete locks.pickups[key];
                if (Memory._transporterLockTimestamps) {
                    delete Memory._transporterLockTimestamps[key];
                }
            }
        }
        
        // 送货锁（支持数组格式）
        for (var key in locks.delivers) {
            var deliverLocks = locks.delivers[key];
            
            // 兼容旧格式（字符串）
            if (typeof deliverLocks === 'string') {
                if (deliverLocks === creepName) {
                    delete locks.delivers[key];
                    if (Memory._transporterLockTimestamps) {
                        delete Memory._transporterLockTimestamps[key];
                    }
                }
                continue;
            }
            
            var idx = deliverLocks.indexOf(creepName);
            if (idx !== -1) {
                deliverLocks.splice(idx, 1);
                if (deliverLocks.length === 0) {
                    delete locks.delivers[key];
                    if (Memory._transporterLockTimestamps) {
                        delete Memory._transporterLockTimestamps[key];
                    }
                }
            }
        }
    },

    /**
     * 释放取货锁
     */
    _releasePickupLock: function (id, creepName) {
        if (!Memory._transporterLocks) return;
        if (Memory._transporterLocks.pickups[id] === creepName) {
            delete Memory._transporterLocks.pickups[id];
            if (Memory._transporterLockTimestamps) {
                delete Memory._transporterLockTimestamps[id];
            }
        }
    },

    /**
     * 释放送货锁（支持数组格式）
     */
    _releaseDeliverLock: function (id, creepName) {
        if (!Memory._transporterLocks) return;
        
        var locks = Memory._transporterLocks.delivers[id];
        if (!locks) return;
        
        // 兼容旧格式（字符串）
        if (typeof locks === 'string') {
            if (locks === creepName) {
                delete Memory._transporterLocks.delivers[id];
                if (Memory._transporterLockTimestamps) {
                    delete Memory._transporterLockTimestamps[id];
                }
            }
            return;
        }
        
        var idx = locks.indexOf(creepName);
        if (idx !== -1) {
            locks.splice(idx, 1);
            if (locks.length === 0) {
                delete Memory._transporterLocks.delivers[id];
                if (Memory._transporterLockTimestamps) {
                    delete Memory._transporterLockTimestamps[id];
                }
            }
        }
    },

    /**
     * 从目标位置移开一格（处理站在目标上无法寻路的情况）
     */
    _moveAwayFromTarget: function (creep, target) {
        var directions = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT];
        for (var i = 0; i < directions.length; i++) {
            var dx = 0, dy = 0;
            switch (directions[i]) {
                case TOP:          dy = -1; break;
                case TOP_RIGHT:    dx = 1; dy = -1; break;
                case RIGHT:        dx = 1; break;
                case BOTTOM_RIGHT: dx = 1; dy = 1; break;
                case BOTTOM:       dy = 1; break;
                case BOTTOM_LEFT:  dx = -1; dy = 1; break;
                case LEFT:         dx = -1; break;
                case TOP_LEFT:     dx = -1; dy = -1; break;
            }
            var newX = creep.pos.x + dx;
            var newY = creep.pos.y + dy;
            if (newX >= 0 && newX < 50 && newY >= 0 && newY < 50) {
                var terrain = creep.room.getTerrain().get(newX, newY);
                if (terrain !== TERRAIN_MASK_WALL) {
                    var hasCreep = false;
                    var creepsAtPos = creep.room.find(FIND_CREEPS, {
                        filter: function(c) {
                            return c.pos.x === newX && c.pos.y === newY && c.name !== creep.name;
                        }
                    });
                    if (creepsAtPos.length === 0) {
                        creep.move(directions[i]);
                        return;
                    }
                }
            }
        }
        // 如果所有方向都被堵住，尝试随机移动
        creep.move(Math.floor(Math.random() * 8) + 1);
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
            creep.say('🔄 取货');

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
            creep.say('🔄 重置');
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
