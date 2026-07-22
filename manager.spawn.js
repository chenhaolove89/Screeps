/**
 * 孵化管理器
 * 负责根据各角色数量缺口自动孵化 Creep，支持动态调整 body 大小
 */

var managerSpawn = {

    /** @param {string} spawnName - 孵化器名称（如 'Spawn1'） */
    run: function (spawnName) {
        var spawn = Game.spawns[spawnName];
        if (!spawn) {
            console.log('[Spawn] Spawn not found: ' + spawnName);
            return;
        }

        // 统计各角色数量
        var harvesters = _.filter(Game.creeps, (c) => c.memory.role == 'harvester');
        var upgraders  = _.filter(Game.creeps, (c) => c.memory.role == 'upgrader');
        var builders   = _.filter(Game.creeps, (c) => c.memory.role == 'builder');
        var repairers  = _.filter(Game.creeps, (c) => c.memory.role == 'repairer');

        // 如果孵化器正在忙，跳过
        if (spawn.spawning) return;

        var energy = spawn.room.energyAvailable;

        // 按优先级依次检查各角色缺口
        var queue = [
            { role: 'harvester', need: 2, current: harvesters.length },
            { role: 'upgrader',  need: 2, current: upgraders.length  },
            { role: 'builder',   need: 2, current: builders.length   },
            { role: 'repairer',  need: 1, current: repairers.length  }
        ];

        for (var i = 0; i < queue.length; i++) {
            var item = queue[i];
            if (item.current < item.need && energy >= 200) {
                var name = item.role.charAt(0).toUpperCase() + item.role.slice(1) + Game.time;
                var body = this.getBody(energy, item.role);
                var result = spawn.spawnCreep(body, name, {
                    memory: { role: item.role }
                });

                if (result == OK) {
                    console.log('[Spawn] 孵化 ' + item.role + ' → ' + name + ' [' + body.length + ' parts, ' + energy + ' energy]');
                } else {
                    console.log('[Spawn] 孵化失败 ' + item.role + ' → 错误码: ' + result);
                }
                return; // 一次只孵一个
            }
        }
    },

    /**
     * 根据可用能量生成合适的 creep 身体部件
     * @param {number} energy - 当前可用能量
     * @param {string} role - 角色类型
     * @returns {Array} body 部件数组
     */
    getBody: function (energy, role) {
        var workParts  = 1;
        var carryParts = 1;
        var moveParts  = 1;

        if (energy >= 300) {
            switch (role) {
                case 'harvester':
                    // 采集者：多 WORK 高效采集
                    workParts  = Math.floor(energy / 100);
                    carryParts = Math.min(Math.floor(energy / 50), workParts);
                    moveParts  = Math.ceil((workParts + carryParts) / 2);
                    break;
                case 'upgrader':
                case 'builder':
                case 'repairer':
                default:
                    // 均衡型：WORK / CARRY / MOVE 约 1:1:1
                    workParts  = Math.floor(energy / 130);
                    carryParts = workParts;
                    moveParts  = workParts;
                    break;
            }

            // 避免溢出
            workParts  = Math.min(workParts,  8);
            carryParts = Math.min(carryParts, 8);
            moveParts  = Math.min(moveParts,  8);
        }

        var body = [];
        for (var i = 0; i < workParts;  i++) body.push(WORK);
        for (var i = 0; i < carryParts; i++) body.push(CARRY);
        for (var i = 0; i < moveParts;  i++) body.push(MOVE);
        return body;
    }
};

module.exports = managerSpawn;
