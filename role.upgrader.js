var state       = require('state');
var sourceCache = require('cache.sources');

var roleUpgrader = {

    /** @param {Creep} creep **/
    run: function (creep) {
        // 如果能量不足，切回采集模式（升级消耗 1 能量/tick/WORK 部件）
        if (creep.memory.upgrading && creep.store[RESOURCE_ENERGY] < 1) {
            creep.memory.upgrading = false;
            creep.say('🔄 装能量');
        }
        // 如果能量满了，切回升级模式
        if (!creep.memory.upgrading && creep.store.getFreeCapacity() == 0) {
            creep.memory.upgrading = true;
            creep.say('⚡ 升级');
        }

        // 升级模式：去控制器处升级
        if (creep.memory.upgrading) {
            // 角色短缺时暂停升级，优先保证孵化
            if (state.creepShortage) {
                creep.say('⏸ 缺人');
                return;
            }
            var ugResult = creep.upgradeController(creep.room.controller);
            if (ugResult == ERR_NOT_IN_RANGE) {
                creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#ffffff' } });
            } else if (ugResult == ERR_NOT_ENOUGH_ENERGY) {
                // 能量不足时切回采集
                creep.memory.upgrading = false;
                creep.say('🔄 缺能');
            }
        }
        // 装能量模式：从 Spawn/Extension/Container 获取能量
        else {
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
                sourceCache.harvestNearest(creep);
            }
        }
    }
};

module.exports = roleUpgrader;
