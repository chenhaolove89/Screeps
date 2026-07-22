/**
 * 矿点缓存工具
 * 矿点坐标在房间固定不变，首次 tick 初始化后直接读缓存，避免每 tick 调用 FIND_SOURCES
 */
var state = require('state');

var sourceCache = {

    /**
     * 按 Chebyshev 距离排序矿点（最近优先）
     * @param {Creep} creep
     * @returns {{id: string, dist: number}[]}
     */
    getSorted: function (creep) {
        var result = [];
        var ids = state.sourceIds;
        for (var i = 0; i < ids.length; i++) {
            var data = state.sourceData[ids[i]];
            if (!data) continue;
            var dist = Math.max(
                Math.abs(creep.pos.x - data.x),
                Math.abs(creep.pos.y - data.y)
            );
            result.push({ id: ids[i], dist: dist });
        }
        result.sort(function (a, b) { return a.dist - b.dist; });
        return result;
    },

    /**
     * 矿点周围是否还有空闲可站立格（每 tick 缓存）
     * @param {Source} source
     * @returns {boolean} true=有空位可入位采集
     */
    hasFreeSlot: function (source) {
        var sid = source.id;
        if (state.sourceSlotFree.hasOwnProperty(sid)) {
            return state.sourceSlotFree[sid];
        }

        var sx = source.pos.x, sy = source.pos.y;
        var room = source.room;
        var look = room.lookAtArea(sy - 1, sx - 1, sy + 1, sx + 1, true);

        var blocked = {};
        for (var i = 0; i < look.length; i++) {
            var e = look[i];
            var key = e.x + ',' + e.y;
            if (e.type == 'terrain' && e.terrain == 'wall') {
                blocked[key] = true;
            } else if (e.type == 'creep') {
                blocked[key] = true;
            } else if (e.type == 'structure' && e.structure.structureType == STRUCTURE_WALL) {
                blocked[key] = true;
            }
        }

        var hasFree = false;
        for (var dx = -1; dx <= 1 && !hasFree; dx++) {
            for (var dy = -1; dy <= 1; dy++) {
                if (dx == 0 && dy == 0) continue;
                if (!blocked[(sx + dx) + ',' + (sy + dy)]) {
                    hasFree = true;
                    break;
                }
            }
        }

        state.sourceSlotFree[sid] = hasFree;
        return hasFree;
    },

    /**
     * 尝试采集最近可用矿点，满位时自动顺延到下一矿点
     * @param {Creep} creep
     * @returns {boolean} 是否执行了动作
     */
    harvestNearest: function (creep) {
        var sorted = this.getSorted(creep);

        for (var i = 0; i < sorted.length; i++) {
            var source = Game.getObjectById(sorted[i].id);
            if (!source) continue;

            var result = creep.harvest(source);
            if (result == OK) {
                return true;
            }
            if (result == ERR_NOT_IN_RANGE) {
                // 矿点已饱和（周围 8 格全被占/墙挡）→ 顺延下一矿点
                if (!this.hasFreeSlot(source)) {
                    continue;
                }
                creep.moveTo(source, { visualizePathStyle: { stroke: '#ffaa00' } });
                return true;
            }
            // 其他错误 → 尝试下一矿点
        }

        // 所有矿点都不可用时的兜底：走向最近矿点
        if (sorted.length > 0) {
            var fallback = Game.getObjectById(sorted[0].id);
            if (fallback) {
                creep.moveTo(fallback, { visualizePathStyle: { stroke: '#ffaa00' } });
                return true;
            }
        }
        return false;
    }
};

module.exports = sourceCache;
