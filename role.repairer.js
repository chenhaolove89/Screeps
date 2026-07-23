var sourceCache   = require('cache.sources');
var taskScheduler = require('task.scheduler');

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
            // 找需要修理的建筑（优先找血量最低的）
            var targets = creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => {
                    return structure.hits < structure.hitsMax &&
                        structure.structureType != STRUCTURE_WALL &&
                        structure.structureType != STRUCTURE_RAMPART;
                }
            });
            // 按血量升序排列
            targets.sort((a, b) => a.hits - b.hits);

            if (targets.length > 0) {
                var repairResult = creep.repair(targets[0]);
                if (repairResult == ERR_NOT_IN_RANGE) {
                    creep.moveTo(targets[0], { visualizePathStyle: { stroke: '#ffffff' } });
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
            // 优先从 Container 取能量
            var structures = creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => {
                    return structure.structureType == STRUCTURE_CONTAINER &&
                        structure.store[RESOURCE_ENERGY] > 0;
                }
            });
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
    }
};

module.exports = roleRepairer;
