var state       = require('state');
var sourceCache = require('cache.sources');

var roleBuilder = {

    /** @param {Creep} creep **/
    run: function (creep) {
        // 状态切换：如果正在建造但能量不足以执行建造，切回采集
        // BUILD_POWER = 5，每个 WORK 部件每 tick 消耗 5*N 能量
        // 当能量 < 5 时，即使 1 个 WORK 部件也无法建造，必须切回采集避免死锁
        if (creep.memory.building && creep.store[RESOURCE_ENERGY] < 5) {
            creep.memory.building = false;
            creep.say('🔄 采集');
        }
        // 状态切换：如果未建造且能量满，切回建造
        if (!creep.memory.building && creep.store.getFreeCapacity() == 0) {
            creep.memory.building = true;
            creep.say('🚧 建造');
        }

        // 建造模式
        if (creep.memory.building) {
            // 角色短缺时暂停建造，优先保证孵化
            if (state.creepShortage) {
                creep.say('⏸ 缺人');
                return;
            }
            // 查找建筑工地
            var targets = creep.room.find(FIND_CONSTRUCTION_SITES);
            if (targets.length) {
                var buildResult = creep.build(targets[0]);
                if (buildResult == ERR_NOT_IN_RANGE) {
                    creep.moveTo(targets[0], { visualizePathStyle: { stroke: '#ffffff' } });
                } else if (buildResult == ERR_NOT_ENOUGH_ENERGY) {
                    // 能量不足时立即切回采集，避免残余能量死锁
                    creep.memory.building = false;
                    creep.say('🔄 缺能');
                }
                // OK: 建造成功，继续下一 tick
            } else {
                // 没有建筑工地时，升级控制器
                if (creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#ffffff' } });
                }
            }
        }
        // 采集模式
        else {
            // 优先从 Spawn/Extension 取能量，然后 Container，最后直接采矿
            var structures = creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => {
                    return (structure.structureType == STRUCTURE_SPAWN ||
                            structure.structureType == STRUCTURE_EXTENSION) &&
                        structure.store[RESOURCE_ENERGY] > 0;
                }
            });
            if (structures.length == 0) {
                structures = creep.room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return structure.structureType == STRUCTURE_CONTAINER &&
                            structure.store[RESOURCE_ENERGY] > 0;
                    }
                });
            }

            var acted = false;
            // 遍历所有可用结构，直到成功取到能量
            for (var i = 0; i < structures.length; i++) {
                var withdrawResult = creep.withdraw(structures[i], RESOURCE_ENERGY);
                if (withdrawResult == ERR_NOT_IN_RANGE) {
                    creep.moveTo(structures[i], { visualizePathStyle: { stroke: '#ffaa00' } });
                    acted = true;
                    break;
                } else if (withdrawResult == OK) {
                    acted = true;
                    break;
                }
                // ERR_NOT_ENOUGH_ENERGY / ERR_FULL: 尝试下一个来源
            }

            if (!acted) {
                // 没有可用结构，直接用缓存矿点采集
                sourceCache.harvestNearest(creep);
            }
        }
    }
};

module.exports = roleBuilder;
