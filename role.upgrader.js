var roleUpgrader = {

    /** @param {Creep} creep **/
    run: function (creep) {
        // 如果能量为空，切回采集模式
        if (creep.memory.upgrading && creep.store[RESOURCE_ENERGY] == 0) {
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
            if (creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE) {
                creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#ffffff' } });
            }
        }
        // 装能量模式：从 Spawn/Extension/Container 获取能量
        else {
            // 优先从 Spawn 和 Extension 取能量
            var sources = creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => {
                    return (structure.structureType == STRUCTURE_SPAWN ||
                            structure.structureType == STRUCTURE_EXTENSION) &&
                        structure.store[RESOURCE_ENERGY] > 0;
                }
            });
            if (sources.length == 0) {
                // 如果 Spawn/Extension 没能量，从 Container 取
                sources = creep.room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return structure.structureType == STRUCTURE_CONTAINER &&
                            structure.store[RESOURCE_ENERGY] > 0;
                    }
                });
            }
            if (sources.length > 0) {
                if (creep.withdraw(sources[0], RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(sources[0], { visualizePathStyle: { stroke: '#ffaa00' } });
                }
            } else {
                // 最后手段：自己去采集
                var source = creep.room.find(FIND_SOURCES)[0];
                if (creep.harvest(source) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(source, { visualizePathStyle: { stroke: '#ffaa00' } });
                }
            }
        }
    }
};

module.exports = roleUpgrader;
