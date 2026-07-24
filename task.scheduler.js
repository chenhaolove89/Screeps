/**
 * 任务调度器 (Task Scheduler)
 *
 * 跨角色的统一任务调度框架，状态持久化在 Memory.tasks。
 *
 * ── 设计原则 ──
 * 1. 一个任务同一时刻只分配给一个 creep
 * 2. 资源节点分配采用「先占先得」
 * 3. 任务有超时机制，超时自动回收
 * 4. 所有状态持久化在 Memory.tasks
 *
 * ── 核心功能 ──
 * - 任务优先级队列
 * - 资源锁（sourceLocks / targetLocks）
 * - 死锁检测（死 creep 持锁、停滞任务）
 * - 让位协调（collector 优先级最高，可请求其他角色让位）
 * - 超时回收与 GC
 */

// ══════════════════════════════════════════════════════
//  常量
// ══════════════════════════════════════════════════════

var TASK_TYPES = {
    TRANSPORT: 'transport',
    COLLECT:   'collect',
    BUILD:     'build',
    REPAIR:    'repair',
    UPGRADE:   'upgrade',
};

var STATUS = {
    PENDING:     'pending',
    ASSIGNED:    'assigned',
    IN_PROGRESS: 'in_progress',
    COMPLETED:   'completed',
    FAILED:      'failed',
    TIMED_OUT:   'timed_out',
};

var PRIORITY = {
    CRITICAL: 0,
    HIGH:     1,
    NORMAL:   2,
    LOW:      3,
};

/** 任务超时（ticks） */
var TASK_TIMEOUT = 300;

/** 已完成任务保留时长（ticks） */
var TASK_RETENTION = 100;

/** 最大活跃任务数 */
var MAX_ACTIVE_TASKS = 50;

/** 让位持续 tick 数 */
var YIELD_TICKS = 5;

/** 让位目标距 source 的最小距离 */
var YIELD_DISTANCE = 3;

/** 可被驱离的非采集者角色 */
var YIELDABLE_ROLES = ['transporter', 'upgrader', 'builder', 'repairer'];

// ══════════════════════════════════════════════════════
//  模块
// ══════════════════════════════════════════════════════

var taskScheduler = {

    // ── 常量导出 ──
    TASK_TYPES: TASK_TYPES,
    STATUS:     STATUS,
    PRIORITY:   PRIORITY,

    // ── 可配置参数（供外部读取） ──
    YIELD_TICKS:      YIELD_TICKS,
    YIELD_DISTANCE:   YIELD_DISTANCE,
    YIELDABLE_ROLES:  YIELDABLE_ROLES,
    TASK_TIMEOUT:     TASK_TIMEOUT,
    TASK_RETENTION:   TASK_RETENTION,
    MAX_ACTIVE_TASKS: MAX_ACTIVE_TASKS,

    // ════════════════════════════════════════════════════
    //  初始化与 GC
    // ════════════════════════════════════════════════════

    /**
     * 确保 Memory.tasks 结构存在并执行 GC
     * 应在 main.js 每 tick 开头调用
     */
    init: function () {
        if (!Memory.tasks) {
            Memory.tasks = {
                active:        {},   // 活跃任务（pending/assigned/in_progress）
                completed:     {},   // 已完成任务（待 GC）
                sourceLocks:   {},   // source 资源锁（sourceId → creepName）
                targetLocks:   {},   // target 资源锁（targetId → [creepName, ...]）
                stats: {
                    created:     0,
                    completed:   0,
                    failed:      0,
                    timedOut:    0,
                },
            };
        }
        if (!Memory.tasks.active)      Memory.tasks.active = {};
        if (!Memory.tasks.completed)   Memory.tasks.completed = {};
        if (!Memory.tasks.sourceLocks) Memory.tasks.sourceLocks = {};
        if (!Memory.tasks.targetLocks) Memory.tasks.targetLocks = {};
        if (!Memory.tasks.stats)       Memory.tasks.stats = { created: 0, completed: 0, failed: 0, timedOut: 0 };

        this._gc();
    },

    /**
     * 垃圾回收：清理过期已完成任务
     */
    _gc: function () {
        var now = Game.time;
        var completed = Memory.tasks.completed;
        for (var tid in completed) {
            var t = completed[tid];
            if (t.completedAt && now - t.completedAt > TASK_RETENTION) {
                delete completed[tid];
            }
        }
    },

    // ════════════════════════════════════════════════════
    //  任务生命周期
    // ════════════════════════════════════════════════════

    /**
     * 创建任务
     * @param {string} type - TASK_TYPES 之一
     * @param {number} priority - PRIORITY 之一
     * @param {string} sourceId - 资源来源 ID
     * @param {string} targetId - 目标 ID
     * @param {string} resourceType - 资源类型（如 RESOURCE_ENERGY）
     * @param {number} amount - 数量
     * @param {number} [maxRetries=3] - 最大重试次数
     * @returns {string|null} taskId
     */
    createTask: function (type, priority, sourceId, targetId, resourceType, amount, maxRetries) {
        this.init();

        // 容量检查：活跃任务过多则拒绝
        var activeCount = 0;
        for (var k in Memory.tasks.active) { activeCount++; }
        if (activeCount >= MAX_ACTIVE_TASKS) {
            this._log('活跃任务达上限(' + MAX_ACTIVE_TASKS + ')，拒绝创建');
            return null;
        }

        // 去重：避免相同 source+target+type 的重复任务
        for (var tid in Memory.tasks.active) {
            var existing = Memory.tasks.active[tid];
            if (existing.type === type
                && existing.sourceId === sourceId
                && existing.targetId === targetId
                && existing.status === STATUS.PENDING) {
                return tid; // 已有相同 pending 任务，复用
            }
        }

        var taskId = 'task_' + Game.time + '_' + Math.random().toString(36).substr(2, 6);
        Memory.tasks.active[taskId] = {
            id:            taskId,
            type:          type,
            priority:      priority,
            sourceId:      sourceId,
            targetId:      targetId,
            resourceType:  resourceType || RESOURCE_ENERGY,
            amount:        amount,
            status:        STATUS.PENDING,
            createdAt:     Game.time,
            assignedTo:    null,
            assignedAt:    null,
            progressCurrent: 0,
            progressTotal:   amount || 0,
            retries:       0,
            maxRetries:    maxRetries != null ? maxRetries : 3,
            error:         null,
        };
        Memory.tasks.stats.created++;
        return taskId;
    },

    /**
     * 获取 creep 的下一个最优任务（按优先级，跳过已分配/锁冲突）
     * @param {Creep} creep
     * @returns {Object|null} 任务对象
     */
    getNextTask: function (creep) {
        this.init();

        var best = null;
        var bestPriority = PRIORITY.LOW + 1;

        for (var tid in Memory.tasks.active) {
            var t = Memory.tasks.active[tid];
            if (t.status !== STATUS.PENDING) continue;
            if (t.priority > bestPriority) continue;

            // 检查 source 锁是否被他人占用
            if (t.sourceId && Memory.tasks.sourceLocks[t.sourceId]
                && Memory.tasks.sourceLocks[t.sourceId] !== creep.name) {
                continue;
            }

            best = t;
            bestPriority = t.priority;
        }

        return best;
    },

    /**
     * 分配任务给 creep，锁住 source
     * @param {string} taskId
     * @param {string} creepName
     */
    assignTask: function (taskId, creepName) {
        this.init();
        var t = Memory.tasks.active[taskId];
        if (!t) return false;
        if (t.status !== STATUS.PENDING) return false;

        t.status = STATUS.ASSIGNED;
        t.assignedTo = creepName;
        t.assignedAt = Game.time;

        // 锁住 source
        if (t.sourceId) {
            Memory.tasks.sourceLocks[t.sourceId] = creepName;
        }
        return true;
    },

    /**
     * 更新任务进度
     * @param {string} taskId
     * @param {string} status - STATUS 之一
     * @param {number} [progressCurrent]
     * @param {number} [progressTotal]
     * @param {string} [error]
     */
    updateTask: function (taskId, status, progressCurrent, progressTotal, error) {
        this.init();
        var t = Memory.tasks.active[taskId];
        if (!t) return false;

        t.status = status;
        if (progressCurrent != null) t.progressCurrent = progressCurrent;
        if (progressTotal != null)   t.progressTotal = progressTotal;
        if (error != null)           t.error = error;
        return true;
    },

    /**
     * 完成任务，释放锁，归档，更新统计
     * @param {string} taskId
     */
    completeTask: function (taskId) {
        this.init();
        var t = Memory.tasks.active[taskId];
        if (!t) return false;

        // 释放 source 锁
        if (t.sourceId && Memory.tasks.sourceLocks[t.sourceId] === t.assignedTo) {
            delete Memory.tasks.sourceLocks[t.sourceId];
        }
        // 释放 target 锁
        if (t.targetId) {
            this._releaseTargetLock(t.targetId, t.assignedTo);
        }

        // 归档
        t.status = STATUS.COMPLETED;
        t.completedAt = Game.time;
        Memory.tasks.completed[taskId] = t;
        delete Memory.tasks.active[taskId];
        Memory.tasks.stats.completed++;
        return true;
    },

    /**
     * 标记任务失败，未超重试次数则重置为 PENDING
     * @param {string} taskId
     * @param {string} [error]
     */
    failTask: function (taskId, error) {
        this.init();
        var t = Memory.tasks.active[taskId];
        if (!t) return false;

        t.error = error || 'unknown';

        // 释放锁
        if (t.sourceId && Memory.tasks.sourceLocks[t.sourceId] === t.assignedTo) {
            delete Memory.tasks.sourceLocks[t.sourceId];
        }
        if (t.targetId) {
            this._releaseTargetLock(t.targetId, t.assignedTo);
        }

        t.retries = (t.retries || 0) + 1;
        if (t.retries < (t.maxRetries || 3)) {
            // 重试：重置为 pending
            t.status = STATUS.PENDING;
            t.assignedTo = null;
            t.assignedAt = null;
        } else {
            // 超过重试次数 → 归档为失败
            t.status = STATUS.FAILED;
            t.completedAt = Game.time;
            Memory.tasks.completed[taskId] = t;
            delete Memory.tasks.active[taskId];
            Memory.tasks.stats.failed++;
        }
        return true;
    },

    // ════════════════════════════════════════════════════
    //  超时与死锁检测
    // ════════════════════════════════════════════════════

    /**
     * 回收超时任务
     * 应在 main.js 每 tick 调用
     */
    checkTimeouts: function () {
        if (!Memory.tasks || !Memory.tasks.active) return;
        var now = Game.time;

        for (var tid in Memory.tasks.active) {
            var t = Memory.tasks.active[tid];
            // assigned/in_progress 状态超时
            if ((t.status === STATUS.ASSIGNED || t.status === STATUS.IN_PROGRESS)
                && t.assignedAt && now - t.assignedAt > TASK_TIMEOUT) {
                t.error = '超时 (' + (now - t.assignedAt) + ' ticks)';
                t.status = STATUS.TIMED_OUT;
                t.completedAt = now;
                Memory.tasks.completed[tid] = t;
                delete Memory.tasks.active[tid];
                Memory.tasks.stats.timedOut++;

                // 释放锁
                if (t.sourceId && Memory.tasks.sourceLocks[t.sourceId] === t.assignedTo) {
                    delete Memory.tasks.sourceLocks[t.sourceId];
                }
                if (t.targetId) {
                    this._releaseTargetLock(t.targetId, t.assignedTo);
                }
            }
        }
    },

    /**
     * 死锁检测（死 creep 持锁、停滞任务）
     * 应在 main.js 每 tick 调用
     */
    checkDeadlocks: function () {
        if (!Memory.tasks) return;

        // 1. 检查 sourceLocks：持锁 creep 是否存活
        if (Memory.tasks.sourceLocks) {
            for (var sid in Memory.tasks.sourceLocks) {
                var holder = Memory.tasks.sourceLocks[sid];
                if (!holder || !Game.creeps[holder]) {
                    delete Memory.tasks.sourceLocks[sid];
                }
            }
        }

        // 2. 检查 targetLocks：持锁 creep 是否存活
        if (Memory.tasks.targetLocks) {
            for (var tid in Memory.tasks.targetLocks) {
                var holders = Memory.tasks.targetLocks[tid];
                if (Array.isArray(holders)) {
                    Memory.tasks.targetLocks[tid] = holders.filter(function (name) {
                        return name && Game.creeps[name];
                    });
                    if (Memory.tasks.targetLocks[tid].length === 0) {
                        delete Memory.tasks.targetLocks[tid];
                    }
                } else if (typeof holders === 'string') {
                    if (!Game.creeps[holders]) {
                        delete Memory.tasks.targetLocks[tid];
                    }
                }
            }
        }

        // 3. 检查 active 任务：assignedTo 的 creep 是否存活
        if (Memory.tasks.active) {
            for (var taskId in Memory.tasks.active) {
                var t = Memory.tasks.active[taskId];
                if ((t.status === STATUS.ASSIGNED || t.status === STATUS.IN_PROGRESS)
                    && t.assignedTo && !Game.creeps[t.assignedTo]) {
                    // 持有者已死亡 → 重置为 pending 或失败
                    t.retries = (t.retries || 0) + 1;
                    if (t.retries < (t.maxRetries || 3)) {
                        t.status = STATUS.PENDING;
                        t.assignedTo = null;
                        t.assignedAt = null;
                    } else {
                        t.status = STATUS.FAILED;
                        t.error = '持有者死亡';
                        t.completedAt = Game.time;
                        Memory.tasks.completed[taskId] = t;
                        delete Memory.tasks.active[taskId];
                        Memory.tasks.stats.failed++;
                    }
                }
            }
        }
    },

    /**
     * 释放 creep 持有的所有任务与锁
     * @param {string} creepName
     */
    releaseCreep: function (creepName) {
        if (!Memory.tasks) return;

        // 释放 source 锁
        if (Memory.tasks.sourceLocks) {
            for (var sid in Memory.tasks.sourceLocks) {
                if (Memory.tasks.sourceLocks[sid] === creepName) {
                    delete Memory.tasks.sourceLocks[sid];
                }
            }
        }

        // 释放 target 锁
        if (Memory.tasks.targetLocks) {
            for (var tid in Memory.tasks.targetLocks) {
                var holders = Memory.tasks.targetLocks[tid];
                if (Array.isArray(holders)) {
                    Memory.tasks.targetLocks[tid] = holders.filter(function (n) { return n !== creepName; });
                    if (Memory.tasks.targetLocks[tid].length === 0) {
                        delete Memory.tasks.targetLocks[tid];
                    }
                } else if (holders === creepName) {
                    delete Memory.tasks.targetLocks[tid];
                }
            }
        }

        // 重置该 creep 持有的任务
        if (Memory.tasks.active) {
            for (var taskId in Memory.tasks.active) {
                var t = Memory.tasks.active[taskId];
                if (t.assignedTo === creepName) {
                    t.retries = (t.retries || 0) + 1;
                    if (t.retries < (t.maxRetries || 3)) {
                        t.status = STATUS.PENDING;
                        t.assignedTo = null;
                        t.assignedAt = null;
                    } else {
                        t.status = STATUS.FAILED;
                        t.error = 'creep 释放';
                        t.completedAt = Game.time;
                        Memory.tasks.completed[taskId] = t;
                        delete Memory.tasks.active[taskId];
                        Memory.tasks.stats.failed++;
                    }
                }
            }
        }
    },

    // ════════════════════════════════════════════════════
    //  让位协调
    // ════════════════════════════════════════════════════

    /**
     * 请求 source 附近 creep 让位
     * 优先驱离非采集者（transporter/upgrader/builder/repairer），
     * 其次调整其他 collector 的站位
     * @param {Creep} requester - 请求者（通常是 collector）
     * @param {Source} source - 被阻塞的 source
     * @returns {boolean} 是否找到让位者
     */
    requestYield: function (requester, source) {
        if (!source) return false;

        // 查找 source 附近 1 格内的所有 creep
        var nearby = source.pos.findInRange(FIND_CREEPS, 1);
        if (nearby.length === 0) return false;

        // 优先驱离非采集者
        for (var i = 0; i < nearby.length; i++) {
            var c = nearby[i];
            if (c.name === requester.name) continue;
            if (!c.my) continue;

            var role = c.memory.role;
            if (YIELDABLE_ROLES.indexOf(role) !== -1) {
                // 找到让位目标
                var yieldPos = this._findYieldPosition(source);
                if (yieldPos) {
                    c.memory._yieldUntil = Game.time + YIELD_TICKS;
                    c.memory._yieldTarget = yieldPos;
                    this._log('请求 ' + c.name + ' (' + role + ') 让位，目标: ' + yieldPos.x + ',' + yieldPos.y);
                    return true;
                }
            }
        }

        // 其次调整其他 collector 的站位
        for (var j = 0; j < nearby.length; j++) {
            var other = nearby[j];
            if (other.name === requester.name) continue;
            if (!other.my) continue;
            if (other.memory.role === 'collector' || other.memory.role === 'harvester') {
                var pos = this._findYieldPosition(source);
                if (pos) {
                    other.memory._yieldUntil = Game.time + YIELD_TICKS;
                    other.memory._yieldTarget = pos;
                    this._log('请求 ' + other.name + ' (采集者) 调整站位，目标: ' + pos.x + ',' + pos.y);
                    return true;
                }
            }
        }

        return false;
    },

    /**
     * 检查 creep 是否处于让位状态，是则执行让位移动并返回 true
     * 各角色 run() 入口调用此方法
     * @param {Creep} creep
     * @returns {boolean} true=正在让位，跳过本 tick 正常逻辑
     */
    checkYield: function (creep) {
        if (!creep.memory._yieldUntil) return false;
        if (Game.time > creep.memory._yieldUntil) {
            // 让位期结束 → 清理标记
            delete creep.memory._yieldUntil;
            delete creep.memory._yieldTarget;
            return false;
        }

        // 仍在让位期 → 移动到让位目标
        var target = creep.memory._yieldTarget;
        if (target) {
            var pos = new RoomPosition(target.x, target.y, target.roomName || creep.room.name);
            if (creep.pos.x !== pos.x || creep.pos.y !== pos.y || creep.pos.roomName !== pos.roomName) {
                creep.moveTo(pos, {
                    visualizePathStyle: { stroke: '#ff4444', lineStyle: 'dashed' },
                    reusePath: 5,
                });
            }
            return true;
        }

        // 无让位目标 → 清理标记
        delete creep.memory._yieldUntil;
        delete creep.memory._yieldTarget;
        return false;
    },

    /**
     * 在 source 外圈（YIELD_DISTANCE 格外）找空地作为让位目标
     * 用 lookAtArea 一次性查找，避免多次 lookAt
     * @param {Source} source
     * @returns {{x:number,y:number,roomName:string}|null}
     */
    _findYieldPosition: function (source) {
        var sx = source.pos.x, sy = source.pos.y;
        var room = source.room;

        // 从 YIELD_DISTANCE 到 YIELD_DISTANCE+2 的外圈逐层查找
        for (var r = YIELD_DISTANCE; r <= YIELD_DISTANCE + 2; r++) {
            var minX = Math.max(0, sx - r);
            var maxX = Math.min(49, sx + r);
            var minY = Math.max(0, sy - r);
            var maxY = Math.min(49, sy + r);

            // 一次性获取整个区域的 look 结果
            var look = room.lookAtArea(minY, minX, maxY, maxX, true);

            for (var i = 0; i < look.length; i++) {
                var e = look[i];
                // 只检查外圈格（Chebyshev 距离 = r）
                var dx = Math.abs(e.x - sx);
                var dy = Math.abs(e.y - sy);
                if (Math.max(dx, dy) !== r) continue;

                // 检查该格是否可站立
                if (e.type === 'terrain' && e.terrain === 'wall') continue;
                if (e.type === 'structure' && e.structure.structureType !== STRUCTURE_ROAD
                    && e.structure.structureType !== STRUCTURE_RAMPART) continue;

                // 检查该格是否有 creep（需要额外查询，lookAtArea 的 creep 结果可能不全）
                var creepsHere = room.lookForAt(LOOK_CREEPS, e.x, e.y);
                if (creepsHere.length > 0) continue;

                return { x: e.x, y: e.y, roomName: room.name };
            }
        }

        return null;
    },

    // ════════════════════════════════════════════════════
    //  锁管理（内部）
    // ════════════════════════════════════════════════════

    /**
     * 释放 target 锁
     * @param {string} targetId
     * @param {string} creepName
     */
    _releaseTargetLock: function (targetId, creepName) {
        if (!Memory.tasks.targetLocks || !Memory.tasks.targetLocks[targetId]) return;
        var holders = Memory.tasks.targetLocks[targetId];
        if (Array.isArray(holders)) {
            Memory.tasks.targetLocks[targetId] = holders.filter(function (n) { return n !== creepName; });
            if (Memory.tasks.targetLocks[targetId].length === 0) {
                delete Memory.tasks.targetLocks[targetId];
            }
        } else if (holders === creepName) {
            delete Memory.tasks.targetLocks[targetId];
        }
    },

    // ════════════════════════════════════════════════════
    //  日志
    // ════════════════════════════════════════════════════

    _log: function (msg) {
        console.log('[TaskScheduler] ' + msg);
    },
};

module.exports = taskScheduler;
