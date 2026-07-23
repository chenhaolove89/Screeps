/**
 * 孵化管理器
 * 负责根据各角色数量缺口自动孵化 Creep，支持动态调整 body 大小
 */
var config = require('config');
var creepCache = require('cache.creep');
var bodyConfig = require('body.config');

var managerSpawn = {

    /** @param {string} spawnName - 孵化器名称（如 'Spawn1'） */
    run: function (spawnName) {
        var spawn = Game.spawns[spawnName];
        if (!spawn) return;

        // 如果孵化器正在忙，跳过
        if (spawn.spawning) return;

        var energy = spawn.room.energyAvailable;
        var targets = config.roleTargets;

        // 基础劳动力充足且能量供应链正常时，等待高能量再孵化
        if (managerSpawn._canWaitForHighEnergy(spawn, targets)) {
            var capacity = spawn.room.energyCapacityAvailable;
            var highThreshold = capacity * 0.8;
            if (energy < highThreshold) {
                return; // 等待更多能量，孵化更高级 creep
            }
        }

        // 按优先级检查各角色缺口（读缓存，O(1)）
        var queue = [
            { role: 'harvester',   need: targets.harvester   },
            { role: 'collector',   need: targets.collector   },
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
     * 判断是否满足等待高能量孵化的条件
     * @param {Spawn} spawn
     * @param {Object} targets
     * @returns {boolean} true=可以等待高能量
     */
    _canWaitForHighEnergy: function (spawn, targets) {
        var collectorCount = creepCache.count('collector');
        var transporterCount = creepCache.count('transporter');

        // 采集者 + 搬运者总数不低于目标一半
        if (collectorCount + transporterCount < (targets.collector + targets.transporter) / 2) {
            return false;
        }

        // 必须有搬运者
        if (transporterCount === 0) {
            return false;
        }

        // Container 中必须有能量
        var containers = spawn.room.find(FIND_STRUCTURES, {
            filter: function (s) {
                return s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0;
            }
        });
        return containers.length > 0;
    },

    /**
     * 根据可用能量和角色生成最优的 creep 身体部件
     * 使用差异化的部件配置策略,根据角色职责优化性能
     */
    getBody: function (energy, role) {
        return bodyConfig.getBody(energy, role);
    }
};

module.exports = managerSpawn;
