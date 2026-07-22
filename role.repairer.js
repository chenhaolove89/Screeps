var roleRepairer = {

    /** @param {Creep} creep **/
    run: function (creep) {
        // 状态切换
        if (creep.memory.repairing && creep.store[RESOURCE_ENERGY] == 0) {
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
                if (creep.repair(targets[0]) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(targets[0], { visualizePathStyle: { stroke: '#ffffff' } });
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
            // 优先从 Spawn/Extension 取能量
            var sources = creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => {
                    return (structure.structureType == STRUCTURE_SPAWN ||
                            structure.structureType == STRUCTURE_EXTENSION) &&
                        structure.store[RESOURCE_ENERGY] > 0;
                }
            });
            if (sources.length == 0) {
                // 从 Container 取
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

module.exports = roleRepairer;
