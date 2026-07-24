var sourceCache   = require('cache.sources');
var taskScheduler = require('task.scheduler');

/** 防御建筑最低血量阈值（低于此值时优先维修） */
var DEFENSE_HITS_MIN = 10000;

/** 防御建筑目标血量上限（维修到此值即可） */
var DEFENSE_HITS_TARGET = 50000;

/** 维修者是否包含 Wall/Rampart 的维修（默认开启） */
var ENABLE_WALL_REPAIR = true;

var roleRepairer = {

    /** @param {Creep} creep **/
    run: function (creep) {
        // ── 让位检查(被采集者请求让位时优先执行) ──
        if (taskScheduler.checkYield(creep)) {
            return;
        }

        // 状态切换：修理消耗 1 能量/tick/WORK 部件，能量 < 1 时无法修理
        if (creep.memory.repairing && creep.store[RESOURCE_ENERGY] < 1) {
            creep.memory.repairing = false;
            creep.say('🔄 采集');
        }
        if (!creep.memory.repairing && creep.store.getFreeCapacity() == 0) {
            creep.memory.repairing = true;
            creep.say('🔧 修理');
        }

        // 修理模式
        if (creep.memory.repairing) {
            var target = this._findRepairTarget(creep);
            if (target) {
                var repairResult = creep.repair(target);
                if (repairResult == ERR_NOT_IN_RANGE) {
                    creep.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' } });
                } else if (repairResult == ERR_NOT_ENOUGH_ENERGY) {
                    // 能量不足时切回采集
                    creep.memory.repairing = false;
                    creep.say('🔄 缺能');
                }
            } else {
                // 没有需要修理的建筑时，去升级控制器
                if (creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#ffffff' } });
                }
            }
        }
        // 采集模式
        else {
            // 优先从最近的 Container 取能量
            var structures = creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => {
                    return structure.structureType == STRUCTURE_CONTAINER &&
                        structure.store[RESOURCE_ENERGY] > 0;
                }
            });
            // 按距离排序，优先去最近的 Container
            structures.sort((a, b) => creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b));
            if (structures.length == 0) {
                // 从 Spawn/Extension 取
                structures = creep.room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return (structure.structureType == STRUCTURE_SPAWN ||
                                structure.structureType == STRUCTURE_EXTENSION) &&
                            structure.store[RESOURCE_ENERGY] > 0;
                    }
                });
            }

            var acted = false;
            for (var i = 0; i < structures.length; i++) {
                var wd = creep.withdraw(structures[i], RESOURCE_ENERGY);
                if (wd == ERR_NOT_IN_RANGE) {
                    creep.moveTo(structures[i], { visualizePathStyle: { stroke: '#ffaa00' } });
                    acted = true;
                    break;
                } else if (wd == OK) {
                    acted = true;
                    break;
                }
            }

            if (!acted) {
                // 最后手段：直接用缓存矿点采集
                sourceCache.harvestNearest(creep);
            }
        }
    },

    /**
     * 寻找需要修理的目标
     * 优先级：
     * 1. 血量低的防御建筑（Rampart/Wall）- 仅当血量低于 DEFENSE_HITS_MIN 时紧急修理
     * 2. 血量最低的普通建筑（container, road, extension 等）
     */
    _findRepairTarget: function (creep) {
        var allStructures = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => structure.hits < structure.hitsMax
        });

        // 1. 紧急修理：血量低于阈值的防御建筑
        if (ENABLE_WALL_REPAIR) {
            for (var i = 0; i < allStructures.length; i++) {
                var s = allStructures[i];
                if ((s.structureType == STRUCTURE_WALL || s.structureType == STRUCTURE_RAMPART) &&
                    s.hits < DEFENSE_HITS_MIN) {
                    return s;
                }
            }
        }

        // 2. 收集需要修理的非防御建筑
        var normalTargets = [];
        for (var j = 0; j < allStructures.length; j++) {
            var ns = allStructures[j];
            if (ns.structureType != STRUCTURE_WALL && ns.structureType != STRUCTURE_RAMPART) {
                normalTargets.push(ns);
            }
        }

        // 3. 如果开启 wall 维修且有能量富余，附带维修高血量防御建筑
        if (ENABLE_WALL_REPAIR) {
            // 防御建筑里挑血量最低的（但还没到紧急阈值的）
            var wallTargets = [];
            for (var k = 0; k < allStructures.length; k++) {
                var w = allStructures[k];
                if ((w.structureType == STRUCTURE_WALL || w.structureType == STRUCTURE_RAMPART) &&
                    w.hits < DEFENSE_HITS_TARGET) {
                    wallTargets.push(w);
                }
            }
            // 按血量升序
            wallTargets.sort((a, b) => a.hits - b.hits);
            // 找到第一个可以到达的 wall/rampart
            for (var m = 0; m < wallTargets.length; m++) {
                if (creep.pos.getRangeTo(wallTargets[m]) > 0) {
                    return wallTargets[m];
                }
            }
        }

        // 4. 按血量升序排列普通建筑
        normalTargets.sort((a, b) => a.hits - b.hits);

        // 5. 找到第一个可以到达的目标
        for (var n = 0; n < normalTargets.length; n++) {
            if (creep.pos.getRangeTo(normalTargets[n]) > 0) {
                return normalTargets[n];
            }
        }

        return null;
    }
};

module.exports = roleRepairer;
