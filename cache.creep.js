/**
 * Creep 名字缓存
 *
 * 避免每 tick 多次 _.filter(Game.creeps, ...) 全量扫描。
 * 只在「初始化 / 孵化 / 死亡」三个节点刷缓存。
 *
 * 用法：
 *   creepCache.build()     — 第一 tick 全量构建
 *   creepCache.add(name)   — 孵化成功后调用
 *   creepCache.remove(name)— 死亡清理时调用
 */
var state = require('state');

var creepCache = {

    /**
     * 从 Game.creeps 全量构建缓存
     * 只在第一 tick 或极端情况（如全局重置）下调用
     */
    build: function () {
        state.allNames = [];
        state.byRole   = {};

        for (var name in Game.creeps) {
            this.add(name);
        }
        state._cacheReady = true;
    },

    /**
     * 添加一只 creep 到缓存
     * @param {string} name
     */
    add: function (name) {
        var creep = Game.creeps[name];
        if (!creep || !creep.memory || !creep.memory.role) return;

        state.allNames.push(name);

        var role = creep.memory.role;
        if (!state.byRole[role]) {
            state.byRole[role] = [];
        }
        state.byRole[role].push(name);
    },

    /**
     * 从缓存移除一只死亡的 creep
     * @param {string} name
     */
    remove: function (name) {
        // 从 allNames 移除
        var idx = state.allNames.indexOf(name);
        if (idx !== -1) {
            state.allNames.splice(idx, 1);
        }

        // 从 byRole 各列表移除
        for (var role in state.byRole) {
            var list = state.byRole[role];
            idx = list.indexOf(name);
            if (idx !== -1) {
                list.splice(idx, 1);
                if (list.length === 0) {
                    delete state.byRole[role];
                }
                break;
            }
        }
    },

    /**
     * 获取某角色当前数量（读缓存，O(1)）
     * @param {string} role
     * @returns {number}
     */
    count: function (role) {
        return state.byRole[role] ? state.byRole[role].length : 0;
    },
};

module.exports = creepCache;
