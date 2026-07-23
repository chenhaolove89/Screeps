var state        = require('state');
var sourceCache  = require('cache.sources');
var taskScheduler = require('task.scheduler');

/** 离开 Spawn 的距离（避免停在 Spawn 周围挡住搬运者） */
var SPAWN_CLEAR_DISTANCE = 5;

var roleUpgrader = {

    /** @param {Creep} creep **/
    run: function (creep) {
        // ── 让位检查(被采集者请求让位时优先执行) ──
        if (taskScheduler.checkYield(creep)) {
            return;
        }

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
                this._moveAwayFromSpawn(creep);
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
        // 装能量模式：从 Container/Spawn/Extension 获取能量
        else {
            var structures = creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => {
                    return structure.structureType == STRUCTURE_CONTAINER &&
                        structure.store[RESOURCE_ENERGY] > 0;
                }
            });
            // 按距离排序，优先去最近的 Container
            structures.sort((a, b) => creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b));
            if (structures.length == 0) {
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
                sourceCache.harvestNearest(creep);
            }
        }
    },

    /**
     * 远离 Spawn，避免挡路
     * 搬运者需要频繁进出 Spawn 区域收集/投放能量
     */
    _moveAwayFromSpawn: function (creep) {
        var spawn = creep.room.find(FIND_STRUCTURES, {
            filter: (s) => s.structureType == STRUCTURE_SPAWN
        })[0];
        if (!spawn) return;

        if (creep.pos.getRangeTo(spawn) >= SPAWN_CLEAR_DISTANCE) {
            return; // 已经在安全距离之外
        }

        // 选一个远离 Spawn 的方向（Creep 当前位置的反方向）
        var dx = creep.pos.x - spawn.pos.x;
        var dy = creep.pos.y - spawn.pos.y;
        var distance = Math.sqrt(dx * dx + dy * dy);
        if (distance === 0) distance = 1;

        var offsetX = Math.round((dx / distance) * SPAWN_CLEAR_DISTANCE);
        var offsetY = Math.round((dy / distance) * SPAWN_CLEAR_DISTANCE);
        var targetX = creep.pos.x + offsetX;
        var targetY = creep.pos.y + offsetY;

        // 边界保护
        targetX = Math.max(1, Math.min(48, targetX));
        targetY = Math.max(1, Math.min(48, targetY));

        creep.moveTo(targetX, targetY, {
            visualizePathStyle: { stroke: '#888888', lineStyle: 'dotted' }
        });
    }
};

module.exports = roleUpgrader;
