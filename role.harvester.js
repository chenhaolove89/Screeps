var sourceCache = require('cache.sources');

var roleHarvester = {

    /** @param {Creep} creep **/
    run: function (creep) {
        // 状态切换
        if (creep.store[RESOURCE_ENERGY] == 0) {
            creep.memory.harvesting = true;
        }
        if (creep.store.getFreeCapacity() == 0) {
            creep.memory.harvesting = false;
        }

        // 采集模式：用缓存矿点 + 距离排序 + 满位顺延
        if (creep.memory.harvesting) {
            sourceCache.harvestNearest(creep);
        }
        // 运输模式
        else {
            // 优先给 Spawn / Extension / Tower 补充能量
            var targets = creep.room.find(FIND_STRUCTURES, {
                filter: function (structure) {
                    return (structure.structureType == STRUCTURE_SPAWN ||
                            structure.structureType == STRUCTURE_EXTENSION ||
                            structure.structureType == STRUCTURE_TOWER) &&
                        structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                }
            });
            if (targets.length > 0) {
                if (creep.transfer(targets[0], RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(targets[0], { visualizePathStyle: { stroke: '#ffffff' } });
                }
            } else {
                // 建筑都满了 → 送到 Container
                var containers = creep.room.find(FIND_STRUCTURES, {
                    filter: function (structure) {
                        return structure.structureType == STRUCTURE_CONTAINER &&
                            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                    }
                });
                if (containers.length > 0) {
                    if (creep.transfer(containers[0], RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                        creep.moveTo(containers[0], { visualizePathStyle: { stroke: '#ffffff' } });
                    }
                }
            }
        }
    }
};

module.exports = roleHarvester;
