var roleHarvester = require('role.harvester');
var roleUpgrader  = require('role.upgrader');
var roleBuilder   = require('role.builder');
var roleRepairer  = require('role.repairer');
var managerSpawn  = require('manager.spawn');

module.exports.loop = function () {

    // ── 防御塔 ──
    var towers = _.filter(Game.structures, s => s.structureType == STRUCTURE_TOWER);
    for (var i = 0; i < towers.length; i++) {
        var tower = towers[i];
        var hostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
        if (hostile) {
            tower.attack(hostile);
        } else {
            var damaged = tower.pos.findClosestByRange(FIND_STRUCTURES, {
                filter: s => s.hits < s.hitsMax
                    && s.structureType != STRUCTURE_WALL
                    && s.structureType != STRUCTURE_RAMPART
            });
            if (damaged) tower.repair(damaged);
        }
    }

    // ── 清理死亡 Creep 内存 ──
    for (var name in Memory.creeps) {
        if (!Game.creeps[name]) {
            delete Memory.creeps[name];
        }
    }

    // ── 角色调度 ──
    for (var name in Game.creeps) {
        var creep = Game.creeps[name];
        switch (creep.memory.role) {
            case 'harvester': roleHarvester.run(creep); break;
            case 'upgrader':  roleUpgrader.run(creep);  break;
            case 'builder':   roleBuilder.run(creep);   break;
            case 'repairer':  roleRepairer.run(creep);  break;
        }
    }

    // ── 自动孵化 ──
    managerSpawn.run('Spawn1');
};
