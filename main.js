var roleHarvester   = require('role.harvester');
var roleCollector   = require('role.collector');
var roleTransporter = require('role.transporter');
var roleUpgrader    = require('role.upgrader');
var roleBuilder     = require('role.builder');
var roleRepairer    = require('role.repairer');
var managerSpawn    = require('manager.spawn');
var state           = require('state');
var creepCache      = require('cache.creep');

module.exports.loop = function () {

    // 每 tick 重置矿点饱和检测缓存（瞬态，不跨 tick）
    state.sourceSlotFree = {};

    // ── 首次运行：全量构建缓存 ──
    if (!state._cacheReady) {
        creepCache.build();
        // 构建矿点缓存（房间固定，只需初始化一次）
        var sources = Game.spawns['Spawn1'].room.find(FIND_SOURCES);
        for (var si = 0; si < sources.length; si++) {
            var s = sources[si];
            state.sourceIds.push(s.id);
            state.sourceData[s.id] = { x: s.pos.x, y: s.pos.y, roomName: s.pos.roomName };
        }
    }

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

    // ── 清理死亡 Creep 内存 + 同步缓存 ──
    for (var name in Memory.creeps) {
        if (!Game.creeps[name]) {
            creepCache.remove(name);
            delete Memory.creeps[name];
        }
    }

    // ── 检测角色是否短缺（用缓存，无需 _.filter） ──
    state.creepShortage = managerSpawn.checkShortage();
    state.spawningRole  = null;

    // ── 角色调度（用缓存的 allNames 避免 for...in Game.creeps） ──
    var names = state.allNames;
    for (var i = 0; i < names.length; i++) {
        var creep = Game.creeps[names[i]];
        // 极端情况：刚死亡但缓存未及时清理，跳过
        if (!creep) continue;
        switch (creep.memory.role) {
            case 'harvester':   roleHarvester.run(creep);   break;
            case 'collector':   roleCollector.run(creep);   break;
            case 'transporter': roleTransporter.run(creep); break;
            case 'upgrader':    roleUpgrader.run(creep);    break;
            case 'builder':     roleBuilder.run(creep);     break;
            case 'repairer':    roleRepairer.run(creep);    break;
        }
    }

    // ── 自动孵化 ──
    managerSpawn.run('Spawn1');
};
