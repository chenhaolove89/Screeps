/**
 * 孵化管理器
 * 负责根据各角色数量缺口自动孵化 Creep，支持动态调整 body 大小
 */
var config = require('config');
var creepCache = require('cache.creep');

var managerSpawn = {

    /** @param {string} spawnName - 孵化器名称（如 'Spawn1'） */
    run: function (spawnName) {
        var spawn = Game.spawns[spawnName];
        if (!spawn) return;

        // 如果孵化器正在忙，跳过
        if (spawn.spawning) return;

        var energy = spawn.room.energyAvailable;
        var targets = config.roleTargets;

        // 按优先级检查各角色缺口（读缓存，O(1)）
        var queue = [
            { role: 'harvester', need: targets.harvester },
            { role: 'upgrader',  need: targets.upgrader  },
            { role: 'builder',   need: targets.builder   },
            { role: 'repairer',  need: targets.repairer  },
        ];

        for (var i = 0; i < queue.length; i++) {
            var item = queue[i];
            var current = creepCache.count(item.role);

            if (current < item.need && energy >= config.spawnEnergyThreshold) {
                var name = item.role.charAt(0).toUpperCase() + item.role.slice(1) + Game.time;
                var body = this.getBody(energy, item.role);
                var result = spawn.spawnCreep(body, name, {
                    memory: { role: item.role }
                });

                if (result == OK) {
                    // 孵化成功 → 同步缓存
                    creepCache.add(name);
                    console.log('[Spawn] 孵化 ' + item.role + ' → ' + name
                        + ' [' + body.length + ' parts, ' + energy + ' energy]');
                } else {
                    console.log('[Spawn] 孵化失败 ' + item.role + ' → 错误码: ' + result);
                }
                return; // 一次只孵一个
            }
        }
    },

    /**
     * 检测是否有角色低于目标数量（读缓存，O(1)）
     * @returns {boolean}
     */
    checkShortage: function () {
        var targets = config.roleTargets;
        for (var role in targets) {
            if (creepCache.count(role) < targets[role]) {
                return true;
            }
        }
        return false;
    },

    /**
     * 根据可用能量生成合适的 creep 身体部件
     * 每"单元" = [WORK, CARRY, MOVE]，成本 = 100+50+50 = 200
     * 数学保证总成本 <= energy
     */
    getBody: function (energy, role) {
        var n = 1;  // 默认 1 单元，成本 200

        if (energy >= 300) {
            // 每单元 [WORK, CARRY, MOVE] = 200 energy
            n = Math.floor(energy / 200);
            n = Math.min(n, 8);  // 最多 8 单元（24 parts, 1600 energy）
        }
        // energy < 300: n=1，成本 200，恰好满足 spawnEnergyThreshold

        var body = [];
        for (var i = 0; i < n; i++) body.push(WORK);
        for (var i = 0; i < n; i++) body.push(CARRY);
        for (var i = 0; i < n; i++) body.push(MOVE);
        return body;
    }
};

module.exports = managerSpawn;
