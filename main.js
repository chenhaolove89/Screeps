var roleHarvester   = require('role.harvester');
var roleCollector   = require('role.collector');
var roleTransporter = require('role.transporter');
var roleUpgrader    = require('role.upgrader');
var roleBuilder     = require('role.builder');
var roleRepairer    = require('role.repairer');
var managerSpawn    = require('manager.spawn');
var managerTower    = require('manager.tower');
var taskScheduler   = require('task.scheduler');
var state           = require('state');
var creepCache      = require('cache.creep');

/**
 * 清理房间级状态（房间毁灭/迁移时调用）
 * 清理引用已不存在建筑的任务与锁
 */
function _purgeRoomState() {
    // 清理 Memory.tasks.active 中引用失效建筑的任务
    if (Memory.tasks && Memory.tasks.active) {
        for (var tid in Memory.tasks.active) {
            var t = Memory.tasks.active[tid];
            var src = t.sourceId ? Game.getObjectById(t.sourceId) : null;
            var tgt = t.targetId ? Game.getObjectById(t.targetId) : null;
            if (!src && !tgt) {
                t.status = 'timed_out';
                t.completedAt = Game.time;
                delete Memory.tasks.active[tid];
            }
        }
    }
    // 清理 targetLocks
    if (Memory.tasks && Memory.tasks.targetLocks) {
        for (var lockId in Memory.tasks.targetLocks) {
            if (!Game.getObjectById(lockId)) {
                delete Memory.tasks.targetLocks[lockId];
            }
        }
    }
    // 清理 transporter 锁
    if (Memory._transporterLocks) {
        if (Memory._transporterLocks.pickups) {
            for (var pickId in Memory._transporterLocks.pickups) {
                if (!Game.getObjectById(pickId)) {
                    delete Memory._transporterLocks.pickups[pickId];
                }
            }
        }
        if (Memory._transporterLocks.delivers) {
            for (var delivId in Memory._transporterLocks.delivers) {
                if (!Game.getObjectById(delivId)) {
                    delete Memory._transporterLocks.delivers[delivId];
                }
            }
        }
    }
    if (Memory._transporterLockTimestamps) {
        for (var tsId in Memory._transporterLockTimestamps) {
            var stillExists = (Memory._transporterLocks && Memory._transporterLocks.pickups && Memory._transporterLocks.pickups[tsId])
                || (Memory._transporterLocks && Memory._transporterLocks.delivers && Memory._transporterLocks.delivers[tsId]);
            if (!stillExists) {
                delete Memory._transporterLockTimestamps[tsId];
            }
        }
    }
    console.log('[Main] 房间级状态已清理');
}

module.exports.loop = function () {

    // 每 tick 重置矿点饱和检测缓存（瞬态，不跨 tick）
    state.sourceSlotCount = {};

    // ── Spawn 动态发现 + 房间变更检测 ──
    var spawn = null;
    for (var sname in Game.spawns) {
        spawn = Game.spawns[sname];
        break; // 取第一个可用 spawn
    }

    if (spawn) {
        // 检测房间变更（迁移新房间）
        if (state.spawnRoomName && state.spawnRoomName !== spawn.room.name) {
            _purgeRoomState();
            state._cacheReady = false;
            state.sourceIds = [];
            state.sourceData = {};
            state.sourceSpawnDist = {};
            state.towerIds = [];
            console.log('[Main] 检测到房间变更: ' + state.spawnRoomName + ' → ' + spawn.room.name + '，缓存已重置');
        }
        state.spawnName = spawn.name;
        state.spawnRoomName = spawn.room.name;
    } else {
        // 无可用 spawn → 等待重建
        state.spawnName = null;
    }

    // ── 首次运行：全量构建缓存 ──
    if (!state._cacheReady) {
        // 无可用 spawn → 跳过初始化，等下一 tick
        if (!state.spawnName) return;
        var initSpawn = Game.spawns[state.spawnName];
        if (!initSpawn) return;

        creepCache.build();
        // 构建矿点缓存（房间固定，只需初始化一次）
        var sources = initSpawn.room.find(FIND_SOURCES);
        for (var si = 0; si < sources.length; si++) {
            var s = sources[si];
            state.sourceIds.push(s.id);
            state.sourceData[s.id] = { x: s.pos.x, y: s.pos.y, roomName: s.pos.roomName };
        }
    }

    // ── 任务调度器初始化 ──
    taskScheduler.init();

    // ── 防御塔 ──
    managerTower.run();

    // ── 清理死亡 Creep 内存 + 同步缓存 ──
    for (var name in Memory.creeps) {
        if (!Game.creeps[name]) {
            creepCache.remove(name);
            delete Memory.creeps[name];
        }
    }

    // ── 任务调度器维护：超时回收 + 死锁检测 ──
    taskScheduler.checkTimeouts();
    taskScheduler.checkDeadlocks();

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
    if (state.spawnName) {
        managerSpawn.run(state.spawnName);
    }
};
