/**
 * 统一任务调度框架
 *
 * 提供跨角色的任务定义、优先级队列、分配与状态管理。
 * 防止多 creep 竞争同一目标，支持死锁检测、重试管理与统计上报。
 *
 * ── 设计原则 ──
 * 1. 一个任务同一时刻只分配给一个 creep
 * 2. 资源节点（source / container / dropped）分配采用"先占先得"
 * 3. 任务有超时机制，超时自动回收
 * 4. 所有状态持久化在 Memory.tasks 中
 */

var taskScheduler = {

    // ── 内置常量 ────────────────────────────────────────
    TASK_TYPES: {
        TRANSPORT:  'transport',
        COLLECT:    'collect',
        BUILD:      'build',
        REPAIR:     'repair',
        UPGRADE:    'upgrade',
    },

    STATUS: {
        PENDING:     'pending',
        ASSIGNED:    'assigned',
        IN_PROGRESS: 'in_progress',
        COMPLETED:   'completed',
        FAILED:      'failed',
        TIMED_OUT:   'timed_out',
    },

    PRIORITY: {
        CRITICAL: 0,  // spawn/extension 急需能量
        HIGH:     1,  // tower 补充弹药
        NORMAL:   2,  // 常规 transport
        LOW:      3,  // storage/container 补充
    },

    /** 任务超时 tick 数（超过则自动回收） */
    TASK_TIMEOUT: 300,

    /** 已完成/失败任务保留 tick 数（用于统计查询） */
    TASK_RETENTION: 100,

    /** 最大并发活跃任务数 */
    MAX_ACTIVE_TASKS: 50,

    // ══════════════════════════════════════════════════════
    //  初始化
    // ══════════════════════════════════════════════════════

    /**
     * 确保 Memory.tasks 存在并初始化结构
     */
    init: function () {
        if (!Memory.tasks) {
            Memory.tasks = {
                active:     {},   // { taskId: Task }
                completed:  {},   // 最近完成的任务统计
                sourceLocks: {},  // { sourceId: assignedCreepName }
                targetLocks: {},  // { targetId: [taskIds...] }
                stats: {
                    totalCreated:  0,
                    totalCompleted: 0,
                    totalFailed:    0,
                    avgDuration:    0,
                },
            };
        }
        // 每 tick 执行一次垃圾回收
        this._gc();
    },

    // ══════════════════════════════════════════════════════
    //  任务 CRUD
    // ══════════════════════════════════════════════════════

    /**
     * 创建一个新任务
     *
     * @param {string}  type         - 任务类型
     * @param {number}  priority     - 优先级 (0=critical, 3=low)
     * @param {string}  sourceId     - 资源来源 ID（structure id / resource id）
     * @param {string}  targetId     - 目标 ID
     * @param {string}  resourceType - 资源类型（默认 RESOURCE_ENERGY）
     * @param {number}  amount       - 目标运输量（0=全部）
     * @param {number}  [maxRetries] - 最大重试次数（默认 3）
     * @returns {string|null} 任务 ID；若队列已满或资源锁冲突返回 null
     */
    createTask: function (type, priority, sourceId, targetId, resourceType, amount, maxRetries) {
        this.init();

        // 容量检查
        if (Object.keys(Memory.tasks.active).length >= this.MAX_ACTIVE_TASKS) {
            return null;
        }

        // 去重：检查是否已有相同 source→target 的活跃任务
        if (this._hasDuplicate(type, sourceId, targetId)) {
            return null;
        }

        var taskId = type + '_' + Game.time + '_' + Math.floor(Math.random() * 10000);

        /** @type {Task} */
        var task = {
            id:           taskId,
            type:         type,
            priority:     priority,
            sourceId:     sourceId,
            targetId:     targetId,
            resourceType: resourceType || RESOURCE_ENERGY,
            amount:       amount || 0,
            status:       this.STATUS.PENDING,
            assignedCreep: null,
            createdAt:    Game.time,
            startedAt:    null,
            completedAt:  null,
            retryCount:   0,
            maxRetries:   (maxRetries !== undefined) ? maxRetries : 3,
            lastError:    null,
            progress:     { current: 0, total: amount || 0 },
        };

        Memory.tasks.active[taskId] = task;
        Memory.tasks.stats.totalCreated++;
        return taskId;
    },

    /**
     * 获取当前 creep 的下一个最优任务
     * 按优先级排序，跳过已分配的任务
     *
     * @param {Creep} creep
     * @returns {Task|null}
     */
    getNextTask: function (creep) {
        this.init();
        var tasks = Memory.tasks.active;
        var bestTask = null;
        var bestPriority = Infinity;

        for (var id in tasks) {
            var t = tasks[id];

            // 只取 pending 状态的任务
            if (t.status !== this.STATUS.PENDING) continue;

            // 检查资源锁：source 是否已被占用
            if (this._isSourceLocked(t.sourceId)) continue;

            // 检查目标冲突：同一个 target 是否已有其他任务
            if (this._hasTargetConflict(t.targetId, creep.name)) continue;

            // 选择优先级最高的
            if (t.priority < bestPriority) {
                bestPriority = t.priority;
                bestTask = t;
            }
        }

        return bestTask;
    },

    /**
     * 将任务分配给指定 creep
     *
     * @param {string} taskId
     * @param {string} creepName
     * @returns {boolean}
     */
    assignTask: function (taskId, creepName) {
        var task = Memory.tasks.active[taskId];
        if (!task || task.status !== this.STATUS.PENDING) return false;

        // 锁住 source
        Memory.tasks.sourceLocks[task.sourceId] = creepName;

        task.status = this.STATUS.ASSIGNED;
        task.assignedCreep = creepName;
        task.startedAt = Game.time;

        this._log('ASSIGN', taskId + ' → ' + creepName + ' [p' + task.priority + ']');
        return true;
    },

    /**
     * 更新任务进度
     *
     * @param {string} taskId
     * @param {string} status - 新状态
     * @param {number} [progressCurrent]
     * @param {number} [progressTotal]
     * @param {string} [error]
     */
    updateTask: function (taskId, status, progressCurrent, progressTotal, error) {
        var task = Memory.tasks.active[taskId];
        if (!task) return;

        if (status) task.status = status;
        if (progressCurrent !== undefined) task.progress.current = progressCurrent;
        if (progressTotal !== undefined)   task.progress.total   = progressTotal;
        if (error)                         task.lastError        = error;
    },

    /**
     * 完成任务
     *
     * @param {string} taskId
     */
    completeTask: function (taskId) {
        var task = Memory.tasks.active[taskId];
        if (!task) return;

        task.status = this.STATUS.COMPLETED;
        task.completedAt = Game.time;

        // 释放锁
        this._releaseLock(task);

        // 移到 completed 区域
        this._archive(task);

        // 更新统计
        var stats = Memory.tasks.stats;
        stats.totalCompleted++;
        var duration = task.completedAt - task.createdAt;
        stats.avgDuration = Math.round(
            (stats.avgDuration * (stats.totalCompleted - 1) + duration) / stats.totalCompleted
        );

        this._log('DONE', taskId + ' [' + duration + ' ticks]');
    },

    /**
     * 标记任务失败（可能触发重试）
     *
     * @param {string} taskId
     * @param {string} error
     * @returns {boolean} 若已触发重试返回 true
     */
    failTask: function (taskId, error) {
        var task = Memory.tasks.active[taskId];
        if (!task) return false;

        task.lastError = error;
        task.retryCount++;

        if (task.retryCount <= task.maxRetries) {
            // 重试：重置为 pending
            task.status = this.STATUS.PENDING;
            task.assignedCreep = null;
            task.startedAt = null;
            this._releaseLock(task);
            this._log('RETRY', taskId + ' (' + task.retryCount + '/' + task.maxRetries + ') ' + error);
            return true;
        }

        // 重试耗尽
        task.status = this.STATUS.FAILED;
        task.completedAt = Game.time;
        this._releaseLock(task);
        this._archive(task);

        Memory.tasks.stats.totalFailed++;
        this._log('FAIL', taskId + ' ' + error);
        return false;
    },

    /**
     * 检查并回收超时任务
     */
    checkTimeouts: function () {
        var tasks = Memory.tasks.active;
        var now = Game.time;

        for (var id in tasks) {
            var t = tasks[id];
            if (
                (t.status === this.STATUS.ASSIGNED || t.status === this.STATUS.IN_PROGRESS) &&
                t.startedAt &&
                now - t.startedAt > this.TASK_TIMEOUT
            ) {
                t.status = this.STATUS.TIMED_OUT;
                this._releaseLock(t);
                this._archive(t);
                this._log('TIMEOUT', id + ' (assigned to ' + t.assignedCreep + ')');
            }
        }
    },

    // ══════════════════════════════════════════════════════
    //  死锁检测
    // ══════════════════════════════════════════════════════

    /**
     * 检测是否存在循环依赖（两个任务互相等待对方的资源）
     * 在当前简单模型下，主要检测：
     *   1. 同一个 source 被多任务锁定
     *   2. 同一个 target 存在冲突任务
     */
    checkDeadlocks: function () {
        var issues = [];

        // 检测 source 锁冲突
        var locks = Memory.tasks.sourceLocks;
        for (var sid in locks) {
            var creepName = locks[sid];
            var creep = Game.creeps[creepName];
            if (!creep) {
                // 持有锁的 creep 已死亡 → 自动释放
                delete Memory.tasks.sourceLocks[sid];
                issues.push('DEAD_CREEP_LOCK: ' + sid + ' ← ' + creepName + ' (released)');
            }
        }

        // 检测被超时任务占用的锁
        var tasks = Memory.tasks.active;
        var now = Game.time;
        for (var id in tasks) {
            var t = tasks[id];
            if (
                t.status === this.STATUS.ASSIGNED &&
                t.assignedCreep &&
                t.startedAt &&
                now - t.startedAt > this.TASK_TIMEOUT * 0.5
            ) {
                issues.push('STALLED: ' + id + ' → ' + t.assignedCreep
                    + ' (' + (now - t.startedAt) + ' ticks)');
            }
        }

        if (issues.length > 0) {
            this._log('DEADLOCK', issues.join(' | '));
        }
        return issues;
    },

    // ══════════════════════════════════════════════════════
    //  查询与统计
    // ══════════════════════════════════════════════════════

    /**
     * 按状态获取任务列表
     * @param {string} [status] - 过滤状态
     * @returns {Task[]}
     */
    getTasks: function (status) {
        this.init();
        var result = [];
        var tasks = Memory.tasks.active;
        for (var id in tasks) {
            if (!status || tasks[id].status === status) {
                result.push(tasks[id]);
            }
        }
        return result;
    },

    /**
     * 获取调度统计信息
     * @returns {{ active: number, completed: number, failed: number, avgDuration: number }}
     */
    getStats: function () {
        this.init();
        return {
            active:      Object.keys(Memory.tasks.active).length,
            completed:   Memory.tasks.stats.totalCompleted,
            failed:      Memory.tasks.stats.totalFailed,
            avgDuration: Memory.tasks.stats.avgDuration,
        };
    },

    /**
     * 获取已分配给某 creep 的任务
     * @param {string} creepName
     * @returns {Task|null}
     */
    getCreepTask: function (creepName) {
        var tasks = Memory.tasks.active;
        for (var id in tasks) {
            if (tasks[id].assignedCreep === creepName) {
                return tasks[id];
            }
        }
        return null;
    },

    /**
     * 释放 creep 持有的所有任务
     * @param {string} creepName
     */
    releaseCreep: function (creepName) {
        var tasks = Memory.tasks.active;
        for (var id in tasks) {
            if (tasks[id].assignedCreep === creepName) {
                var t = tasks[id];
                this._releaseLock(t);
                t.status = this.STATUS.PENDING;
                t.assignedCreep = null;
                t.startedAt = null;
                this._log('RELEASE', id + ' ← ' + creepName);
            }
        }
    },

    // ══════════════════════════════════════════════════════
    //  动态任务创建（各角色专用快捷方法）
    // ══════════════════════════════════════════════════════

    /**
     * 为 transporter 创建运输任务
     * @param {string} sourceId   — 取货源（dropped resource / container / storage / tombstone）
     * @param {string} targetId   — 送货目标（spawn / extension / tower / storage）
     * @param {number} priority   — 优先级
     * @param {number} amount     — 运输量
     * @returns {string|null}
     */
    createTransportTask: function (sourceId, targetId, priority, amount) {
        return this.createTask(
            this.TASK_TYPES.TRANSPORT,
            priority,
            sourceId,
            targetId,
            RESOURCE_ENERGY,
            amount || 0,
            2
        );
    },

    /**
     * 为 collector 创建采集任务（将一个 source 分配给 collector）
     * @param {string} sourceId
     * @param {string} containerId  — 就近的 container（可选）
     * @returns {string|null}
     */
    createCollectTask: function (sourceId, containerId) {
        return this.createTask(
            this.TASK_TYPES.COLLECT,
            this.PRIORITY.NORMAL,
            sourceId,
            containerId || '',
            RESOURCE_ENERGY,
            0,
            1
        );
    },

    // ══════════════════════════════════════════════════════
    //  内部辅助方法
    // ══════════════════════════════════════════════════════

    /**
     * 检查是否有相同 source→target 的活跃任务（去重）
     */
    _hasDuplicate: function (type, sourceId, targetId) {
        var tasks = Memory.tasks.active;
        for (var id in tasks) {
            var t = tasks[id];
            if (
                t.type === type &&
                t.sourceId === sourceId &&
                t.targetId === targetId &&
                t.status !== this.STATUS.COMPLETED &&
                t.status !== this.STATUS.FAILED &&
                t.status !== this.STATUS.TIMED_OUT
            ) {
                return true;
            }
        }
        return false;
    },

    /**
     * 检查 source 是否已被其他 creep 锁定
     */
    _isSourceLocked: function (sourceId) {
        var lock = Memory.tasks.sourceLocks[sourceId];
        if (!lock) return false;
        // 验证持有锁的 creep 仍存活
        if (!Game.creeps[lock]) {
            delete Memory.tasks.sourceLocks[sourceId];
            return false;
        }
        return true;
    },

    /**
     * 检查 target 是否已有冲突任务
     */
    _hasTargetConflict: function (targetId, creepName) {
        if (!Memory.tasks.targetLocks[targetId]) return false;
        var lockList = Memory.tasks.targetLocks[targetId];
        for (var i = 0; i < lockList.length; i++) {
            var tid = lockList[i];
            var t = Memory.tasks.active[tid];
            if (t && t.assignedCreep !== creepName &&
                t.status !== this.STATUS.COMPLETED &&
                t.status !== this.STATUS.FAILED) {
                return true;
            }
        }
        return false;
    },

    /**
     * 释放任务占用的所有锁
     */
    _releaseLock: function (task) {
        // 释放 source 锁
        if (Memory.tasks.sourceLocks[task.sourceId] === task.assignedCreep) {
            delete Memory.tasks.sourceLocks[task.sourceId];
        }
        // 从 targetLocks 移除
        if (Memory.tasks.targetLocks[task.targetId]) {
            var list = Memory.tasks.targetLocks[task.targetId];
            var idx = list.indexOf(task.id);
            if (idx !== -1) list.splice(idx, 1);
            if (list.length === 0) delete Memory.tasks.targetLocks[task.targetId];
        }
    },

    /**
     * 将已完成/失败的任务移至 completed 区域
     */
    _archive: function (task) {
        delete Memory.tasks.active[task.id];
        Memory.tasks.completed[task.id] = {
            type:        task.type,
            status:      task.status,
            priority:    task.priority,
            createdAt:   task.createdAt,
            completedAt: task.completedAt,
            retries:     task.retryCount,
            lastError:   task.lastError,
        };
    },

    /**
     * 垃圾回收：清除过期的已完成任务记录
     */
    _gc: function () {
        var completed = Memory.tasks.completed;
        var cutoff = Game.time - this.TASK_RETENTION;
        for (var id in completed) {
            if (completed[id].completedAt < cutoff) {
                delete completed[id];
            }
        }
    },

    /**
     * 结构化日志
     */
    _log: function (level, message) {
        console.log('[TaskScheduler|' + level + '] ' + message);
    },
};

module.exports = taskScheduler;
