/**
 * 采集者 (Collector) — 优化版
 *
 * 职责：纯能量采集，不再负责长途运输。
 *       将采集的能量投放到就近 Container 或直接掉落在地上，
 *       由 Transporter 负责后续搬运。
 *
 * ── 优化点 ──
 * 1. 源分配与并发控制 — 均匀分配到各 source，每 source 限制采集人数
 * 2. 纯采集 — 不走长途运输，大幅减少路上时间
 * 3. 指数退避重试 — harvest 失败时智能退避
 * 4. 健康检查与自恢复 — 卡住检测 + 状态重置
 * 5. 结构化日志 — 分级日志输出
 * 6. Room.find 结果缓存 — 避免每 tick 全量扫描
 */

var taskScheduler = require('task.scheduler');
var sourceCache   = require('cache.sources');

// ── 内部常量 ────────────────────────────────────────────
var LOG_LEVEL = {
    DEBUG: 0,
    INFO:  1,
    WARN:  2,
    ERROR: 3,
};
var CURRENT_LOG_LEVEL = LOG_LEVEL.INFO;

/** 每 source 最大采集者数 */
var MAX_COLLECTORS_PER_SOURCE = 3;

/** 采集者健康检查：超过此 tick 数无进展视为卡住 */
var STUCK_THRESHOLD = 50;

/** 重试退避基础间隔 (ticks) */
var RETRY_BASE_INTERVAL = 5;

/** 连续无法到达同一能量源的最大次数，超过则切换 */
var MAX_SOURCE_FAIL_COUNT = 3;

/** Room.find 缓存有效期 (ticks) */
var CACHE_TTL = 20;

/** 投放 Container 的最大距离(超过此距离的 Container 不予考虑,直接掉落地上) */
var DROP_MAX_DISTANCE = 3;

// ── Room 级缓存 ─────────────────────────────────────────
var _cache = {
    sources:     { tick: 0, data: null },   // 缓存的 sources
    containers:  { tick: 0, data: null },   // 缓存的 containers
};

var roleCollector = {

    /** @param {Creep} creep */
    run: function (creep) {
        // ── 日志上下文 ──
        var logCtx = '[' + creep.name + ']';

        // ── 让位检查(被其他 collector 请求让位时优先执行) ──
        if (taskScheduler.checkYield(creep)) {
            return;
        }

        // ── 健康检查：检测是否卡住 ──
        if (this._healthCheck(creep, logCtx)) {
            return; // 卡住了，本 tick 跳过操作，等待恢复
        }

        // ── 状态机 ──
        // states: 'idle' → 'harvesting' → 'dropping' → 'idle'
        if (!creep.memory.collectorState) {
            creep.memory.collectorState = 'idle';
        }

        // 能量空了 → 去采集
        if (creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.collectorState = 'harvesting';
        }

        // 能量满了 → 去投放（就近 Container 或掉落）
        if (creep.store.getFreeCapacity() === 0) {
            creep.memory.collectorState = 'dropping';
        }

        switch (creep.memory.collectorState) {
            case 'harvesting':
                this._doHarvest(creep, logCtx);
                break;
            case 'dropping':
                this._doDrop(creep, logCtx);
                break;
            default:
                // idle 时默认去采集
                creep.memory.collectorState = 'harvesting';
                this._doHarvest(creep, logCtx);
                break;
        }
    },

    // ══════════════════════════════════════════════════════
    //  采集逻辑
    // ══════════════════════════════════════════════════════

    /**
     * 去能量源采集
     */
    _doHarvest: function (creep, logCtx) {
        var source = this._getAssignedSource(creep);
        if (!source) {
            this._log(LOG_LEVEL.WARN, logCtx + ' 无可用的能量源');
            return;
        }

        // ── 距离检查：未到达 source 时先移动，避免依赖错误码（不同环境映射可能不同） ──
        if (!creep.pos.inRangeTo(source, 1)) {
            var moveResult = creep.moveTo(source, {
                visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dashed' },
                reusePath: 10,
            });
            // 只有路径不可达才算真正的移动失败
            if (moveResult === ERR_NO_PATH) {
                // 记录该 source 的失败次数
                if (!creep.memory._sourceFailCounts) {
                    creep.memory._sourceFailCounts = {};
                }
                var failCount = (creep.memory._sourceFailCounts[source.id] || 0) + 1;
                creep.memory._sourceFailCounts[source.id] = failCount;

                if (failCount >= MAX_SOURCE_FAIL_COUNT) {
                    this._log(LOG_LEVEL.WARN, logCtx + ' 连续 ' + failCount + ' 次无法到达能量源 ' + source.id + '，尝试驱离/调整站位');

                    // 先尝试驱离非采集者或调整站位
                    var yielded = taskScheduler.requestYield(creep, source);
                    if (yielded) {
                        // 已发出让位指令,清空失败计数,下一 tick 重新尝试到达
                        delete creep.memory._sourceFailCounts[source.id];
                        this._updateHealth(creep); // 视为有进展,避免误触发卡住恢复
                        return;
                    }

                    // 附近无可让位者 → fallback 到原有换矿+冷却逻辑
                    this._log(LOG_LEVEL.WARN, logCtx + ' 附近无可让位单位,切换能量源');
                    creep.memory.assignedSourceId = null; // 换一个 source
                    // 标记该 source 为暂时不可用（冷却 100 ticks）
                    if (!creep.memory._sourceCooldowns) {
                        creep.memory._sourceCooldowns = {};
                    }
                    creep.memory._sourceCooldowns[source.id] = Game.time + 100;
                } else {
                    this._log(LOG_LEVEL.WARN, logCtx + ' 无法到达能量源 ' + source.id + '（第 ' + failCount + ' 次）');
                }
            } else {
                // 移动成功或进行中，重置当前 source 的失败计数
                if (creep.memory._sourceFailCounts && creep.memory._sourceFailCounts[source.id]) {
                    delete creep.memory._sourceFailCounts[source.id];
                }
            }
            this._updateHealth(creep); // 尝试移动 = 有进展
            return;
        }

        // 成功到达 source，重置失败计数
        if (creep.memory._sourceFailCounts && creep.memory._sourceFailCounts[source.id]) {
            delete creep.memory._sourceFailCounts[source.id];
        }

        var result = creep.harvest(source);

        if (result === OK) {
            // 采集成功 → 更新健康状态
            this._updateHealth(creep);
            // 接近满仓时切到投放模式
            if (creep.store.getFreeCapacity() === 0 ||
                creep.store.getFreeCapacity() <= creep.getActiveBodyparts(WORK) * 2) {
                creep.memory.collectorState = 'dropping';
            }

        } else if (result === ERR_NOT_ENOUGH_RESOURCES || result === ERR_NOT_ENOUGH_ENERGY || result === -6) {
            // source 能量再生中（正常现象），不算卡住
            this._updateHealth(creep);

        } else if (result === ERR_NOT_OWNER) {
            // 没有权限（极少见），换个 source
            this._log(LOG_LEVEL.WARN, logCtx + ' 无权限采集 ' + source.id);
            creep.memory.assignedSourceId = null;

        } else {
            // 其他意外错误 → 指数退避
            this._handleHarvestError(creep, result, logCtx);
        }
    },

    // ══════════════════════════════════════════════════════
    //  投放逻辑
    // ══════════════════════════════════════════════════════

    /**
     * 将采集的能量投放到就近的 Container 或掉落在地上
     */
    _doDrop: function (creep, logCtx) {
        // 优先找范围内的 Container
        var container = this._findNearestContainer(creep);
        if (container) {
            var result = creep.transfer(container, RESOURCE_ENERGY);
            if (result === OK) {
                this._updateHealth(creep);
                // 检查是否还有能量需要投放
                if (creep.store[RESOURCE_ENERGY] > 0) {
                    // 继续投放到下一个可用 container
                    return;
                }
                creep.memory.collectorState = 'harvesting';

            } else if (result === ERR_NOT_IN_RANGE) {
                creep.moveTo(container, {
                    visualizePathStyle: { stroke: '#00aaff', lineStyle: 'dashed' },
                    reusePath: 5,
                });

            } else if (result === ERR_FULL) {
                // Container 满了 → 标记并尝试范围内的下一个
                this._markContainerFull(container.id, logCtx);
                // 本 tick 重新找(范围内)
                var next = this._findNearestContainer(creep);
                if (!next) {
                    // 范围内 container 都满了 → 直接掉落地上,不去远处
                    creep.drop(RESOURCE_ENERGY);
                    this._log(LOG_LEVEL.DEBUG, logCtx + ' 范围内 Container 已满，能量丢在地上 (剩余: ' + creep.store[RESOURCE_ENERGY] + ')');
                    if (creep.store[RESOURCE_ENERGY] === 0) {
                        creep.memory.collectorState = 'harvesting';
                    }
                    this._updateHealth(creep);
                }
                // 否则下一 tick findNearestContainer 会跳过已标记的

            } else {
                this._log(LOG_LEVEL.WARN, logCtx + ' 投放失败: ' + result);
                this._updateHealth(creep); // transfer 失败通常不是致命问题
            }
        } else {
            // 范围内无可用 Container → 直接丢在地上，等 transporter 来取
            // 这是早期没有 Container 或附近 Container 都满时的标准做法（drop mining）
            creep.drop(RESOURCE_ENERGY);
            this._log(LOG_LEVEL.DEBUG, logCtx + ' 范围内无可用 Container，能量丢在地上 (剩余: ' + creep.store[RESOURCE_ENERGY] + ')');
            // 能量还在身上（drop 只丢了一部分）就继续循环
            if (creep.store[RESOURCE_ENERGY] > 0) {
                // 下一 tick 继续 drop
            } else {
                creep.memory.collectorState = 'harvesting';
            }
            this._updateHealth(creep);
        }
    },

    // ══════════════════════════════════════════════════════
    //  源分配
    // ══════════════════════════════════════════════════════

    /**
     * 获取分配给该 creep 的能量源
     * 优先分配近矿点，固定绑定采集者到矿点
     */
    _getAssignedSource: function (creep) {
        var sources = sourceCache.getSourcesBySpawnDistance(creep.room);
        if (!sources || sources.length === 0) return null;

        // 清理已过期的冷却记录
        if (creep.memory._sourceCooldowns) {
            for (var sid in creep.memory._sourceCooldowns) {
                if (Game.time >= creep.memory._sourceCooldowns[sid]) {
                    delete creep.memory._sourceCooldowns[sid];
                }
            }
        }

        // 已有分配且矿点未满 → 保持绑定
        if (creep.memory.assignedSourceId) {
            var existing = Game.getObjectById(creep.memory.assignedSourceId);
            if (existing) {
                if (creep.memory._sourceCooldowns && creep.memory._sourceCooldowns[creep.memory.assignedSourceId]) {
                    this._log(LOG_LEVEL.DEBUG,
                        '[' + creep.name + '] source ' + creep.memory.assignedSourceId + ' 冷却中，重新分配');
                } else if (this._countCollectorsAtSource(creep.memory.assignedSourceId) <= MAX_COLLECTORS_PER_SOURCE) {
                    return existing;
                }
                this._log(LOG_LEVEL.DEBUG,
                    '[' + creep.name + '] source ' + creep.memory.assignedSourceId + ' 不可用，重新分配');
            }
        }

        // 重新分配：按距离从近到远（sources 已按 spawn 距离升序），
        // 选第一个未满载的矿点，确保近矿优先占用。
        var assigned = null;
        for (var i = 0; i < sources.length; i++) {
            var src = sources[i];
            if (creep.memory._sourceCooldowns && creep.memory._sourceCooldowns[src.id]) {
                continue;
            }
            var cnt = this._countCollectorsAtSource(src.id);
            if (cnt < MAX_COLLECTORS_PER_SOURCE) {
                assigned = src;
                break;
            }
        }

        // 所有矿都满载时的兜底：回到距离最近且未冷却的矿
        if (!assigned) {
            for (var j = 0; j < sources.length; j++) {
                if (creep.memory._sourceCooldowns && creep.memory._sourceCooldowns[sources[j].id]) {
                    continue;
                }
                assigned = sources[j];
                break;
            }
        }

        if (assigned) {
            creep.memory.assignedSourceId = assigned.id;
            return assigned;
        }

        return sources[0];
    },

    /**
     * 统计某 source 当前被多少个 collector 占用
     */
    _countCollectorsAtSource: function (sourceId) {
        var count = 0;
        for (var name in Game.creeps) {
            var c = Game.creeps[name];
            if (c.memory.role === 'collector' && c.memory.assignedSourceId === sourceId) {
                count++;
            }
        }
        // 也检查 harvester（向后兼容）
        for (var name in Game.creeps) {
            var c = Game.creeps[name];
            if (c.memory.role === 'harvester' && c.memory.assignedSourceId === sourceId) {
                count++;
            }
        }
        return count;
    },

    // ══════════════════════════════════════════════════════
    //  Room.find 缓存
    // ══════════════════════════════════════════════════════

    /**
     * 获取缓存的 sources 列表
     */
    _getCachedSources: function (room) {
        if (!_cache.sources.data || Game.time - _cache.sources.tick > CACHE_TTL) {
            _cache.sources.data = room.find(FIND_SOURCES);
            _cache.sources.tick = Game.time;
        }
        return _cache.sources.data;
    },

    /**
     * 获取缓存的 containers 列表
     */
    _getCachedContainers: function (room) {
        if (!_cache.containers.data || Game.time - _cache.containers.tick > CACHE_TTL) {
            _cache.containers.data = room.find(FIND_STRUCTURES, {
                filter: function (s) {
                    return s.structureType === STRUCTURE_CONTAINER;
                },
            });
            _cache.containers.tick = Game.time;
        }
        return _cache.containers.data;
    },

    /**
     * 找最近的可用 Container(仅限 DROP_MAX_DISTANCE 范围内)
     */
    _findNearestContainer: function (creep) {
        var containers = this._getCachedContainers(creep.room);
        var nearest = null;
        var minDist = Infinity;

        for (var i = 0; i < containers.length; i++) {
            var c = containers[i];

            // 跳过已满的 container
            if (c.store.getFreeCapacity(RESOURCE_ENERGY) === 0) continue;

            // 跳过被标记为满的（本 tick 内）
            if (creep.memory._skipContainer === c.id) continue;

            var dist = creep.pos.getRangeTo(c);

            // 超过最大投放距离的 container 不予考虑
            if (dist > DROP_MAX_DISTANCE) continue;

            if (dist < minDist) {
                minDist = dist;
                nearest = c;
            }
        }

        // 清除缓存标记
        creep.memory._skipContainer = null;

        return nearest;
    },

    /**
     * 标记 container 已满，本 tick 不再尝试
     */
    _markContainerFull: function (containerId, logCtx) {
        this._log(LOG_LEVEL.DEBUG, logCtx + ' Container ' + containerId + ' 已满');
    },

    // ══════════════════════════════════════════════════════
    //  错误处理与重试
    // ══════════════════════════════════════════════════════

    /**
     * 指数退避重试
     * 失败后跳过 N 个 tick 再重试，避免连续报错
     */
    _handleHarvestError: function (creep, errorCode, logCtx) {
        if (!creep.memory._retryUntil) {
            creep.memory._retryCount = (creep.memory._retryCount || 0) + 1;
            var backoff = Math.min(
                RETRY_BASE_INTERVAL * Math.pow(2, creep.memory._retryCount - 1),
                100
            );
            creep.memory._retryUntil = Game.time + backoff;

            this._log(LOG_LEVEL.WARN,
                logCtx + ' 采集失败(' + errorCode + ') 将在 ' + backoff + ' ticks 后重试 (第'
                + creep.memory._retryCount + '次)');
        }

        if (Game.time >= creep.memory._retryUntil) {
            // 退避结束，重置计数器并重试
            creep.memory._retryCount = 0;
            creep.memory._retryUntil = null;
            // 重新分配 source（可能之前的 source 有问题）
            creep.memory.assignedSourceId = null;
        }
    },

    // ══════════════════════════════════════════════════════
    //  健康检查与自恢复
    // ══════════════════════════════════════════════════════

    /**
     * 检查 creep 是否卡住
     * @returns {boolean} true=卡住了（本 tick 不要行动）
     */
    _healthCheck: function (creep, logCtx) {
        // 初始化健康记录
        if (!creep.memory._health) {
            creep.memory._health = {
                lastProgressTick: Game.time,
                lastPos:          { x: creep.pos.x, y: creep.pos.y, room: creep.pos.roomName },
                recoveryMode:     false,
                recoveryUntil:    0,
            };
            return false;
        }

        var h = creep.memory._health;

        // 恢复模式：等待冷却
        if (h.recoveryMode) {
            if (Game.time < h.recoveryUntil) {
                // 冷却中 → 找一个安全位置 idle
                return true;
            }
            // 冷却结束 → 退出恢复模式
            h.recoveryMode = false;
            h.lastProgressTick = Game.time;
            h.lastPos = { x: creep.pos.x, y: creep.pos.y, room: creep.pos.roomName };
            this._log(LOG_LEVEL.INFO, logCtx + ' 恢复模式结束，恢复正常运作');
        }

        // 检查是否长时间无进展
        var positionChanged = (
            h.lastPos.x !== creep.pos.x ||
            h.lastPos.y !== creep.pos.y ||
            h.lastPos.room !== creep.pos.roomName
        );

        if (!positionChanged && Game.time - h.lastProgressTick > STUCK_THRESHOLD) {
            this._log(LOG_LEVEL.WARN,
                logCtx + ' 检测到卡住 (' + (Game.time - h.lastProgressTick) + ' ticks 无移动)，进入恢复模式');
            h.recoveryMode = true;
            h.recoveryUntil = Game.time + 20; // 冷却 20 ticks

            // 释放可能占用的资源锁
            taskScheduler.releaseCreep(creep.name);

            // 重置采集状态
            creep.memory.collectorState = 'idle';
            creep.memory.assignedSourceId = null;
            creep.memory._retryCount = 0;
            creep.memory._retryUntil = null;
            creep.memory._sourceFailCounts = null;
            creep.memory._sourceCooldowns = null;

            return true;
        }

        return false;
    },

    /**
     * 更新健康状态（记录本次进展）
     */
    _updateHealth: function (creep) {
        if (!creep.memory._health) {
            creep.memory._health = {
                lastProgressTick: Game.time,
                lastPos: { x: creep.pos.x, y: creep.pos.y, room: creep.pos.roomName },
                recoveryMode: false,
                recoveryUntil: 0,
            };
        } else {
            creep.memory._health.lastProgressTick = Game.time;
            creep.memory._health.lastPos = {
                x: creep.pos.x,
                y: creep.pos.y,
                room: creep.pos.roomName,
            };
            // 进展后清零退避计数
            creep.memory._retryCount = 0;
            creep.memory._retryUntil = null;
        }
    },

    // ══════════════════════════════════════════════════════
    //  结构化日志
    // ══════════════════════════════════════════════════════

    /**
     * 分级日志
     * @param {number} level   - LOG_LEVEL 值
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

        console.log('[Collector|' + prefix + '] ' + message);
    },
};

module.exports = roleCollector;
