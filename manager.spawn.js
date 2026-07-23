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
            { role: 'collector',   need: targets.collector   },
            { role: 'harvester',   need: targets.harvester   },
            { role: 'transporter', need: targets.transporter },
            { role: 'upgrader',    need: targets.upgrader    },
            { role: 'builder',     need: targets.builder     },
            { role: 'repairer',    need: targets.repairer    },
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
     */
    getBody: function (energy, role) {
        var body = [];

        if (energy >= 300) {
            var n; // 每个 "单元" 的数量

            switch (role) {
                case 'collector':
                    // Collector: 专注采集，需要大量 WORK 保证产出效率
                    // 必须包含 CARRY 才能存储采集到的能量
                    // 1 unit = 2*WORK(200) + 1*CARRY(50) + 1*MOVE(50) = 300
                    n = Math.floor(energy / 300);
                    n = Math.min(n, 5); // max 10 WORK, 5 CARRY, 5 MOVE
                    if (n > 0) {
                        for (var i = 0; i < n * 2; i++) body.push(WORK);
                        for (var i = 0; i < n;     i++) body.push(CARRY);
                        for (var i = 0; i < n;     i++) body.push(MOVE);
                    }
                    break;
                case 'harvester':
                    // 旧版 harvester（向后兼容，默认已由 collector 替代）
                    // 1 unit = 2*WORK(100) + 1*CARRY(50) + 1*MOVE(50) = 300
                    n = Math.floor(energy / 300);
                    n = Math.min(n, 4);
                    if (n > 0) {
                        for (var i = 0; i < n * 2; i++) body.push(WORK);
                        for (var i = 0; i < n;     i++) body.push(CARRY);
                        for (var i = 0; i < n;     i++) body.push(MOVE);
                    }
                    break;
                case 'transporter':
                    // Transporter: 专注搬运，需要大量 CARRY + MOVE，少量 WORK
                    // 1 unit = 1*WORK(100) + 2*CARRY(100) + 2*MOVE(100) = 300
                    n = Math.floor(energy / 300);
                    n = Math.min(n, 6); // max 6 WORK, 12 CARRY, 12 MOVE
                    if (n > 0) {
                        for (var i = 0; i < n;     i++) body.push(WORK);
                        for (var i = 0; i < n * 2; i++) body.push(CARRY);
                        for (var i = 0; i < n * 2; i++) body.push(MOVE);
                    }
                    break;
                case 'upgrader':
                case 'builder':
                case 'repairer':
                default:
                    // 1 unit = 1*WORK(100) + 1*CARRY(50) + 1*MOVE(50) = 200
                    n = Math.floor(energy / 200);
                    n = Math.min(n, 8);
                    for (var i = 0; i < n; i++) body.push(WORK);
                    for (var i = 0; i < n; i++) body.push(CARRY);
                    for (var i = 0; i < n; i++) body.push(MOVE);
                    break;
            }
        }

        // 兜底：基础 body（1W+1C+1M = 200 cost，threshold 200 保证够用）
        if (body.length === 0) {
            body = [WORK, CARRY, MOVE];
        }

        return body;
    }
};

module.exports = managerSpawn;
