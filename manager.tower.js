/**
 * 防御塔管理器 (Tower Manager)
 *
 * 职责：
 * 1. 自动攻击侵入的敌对 Creep
 * 2. 维修血量低于阈值的普通建筑（保护功能性建筑）
 * 3. 空闲时维修 Wall/Rampart（提升防御建筑血量）
 *
 * 优先级：攻击敌人 > 紧急维修普通建筑 > 维修防御建筑
 */

// ── 常量配置 ────────────────────────────────────────────

/** 普通建筑维修阈值（血量低于满血 80% 才修，避免被损耗建筑占用全部精力） */
var NORMAL_REPAIR_THRESHOLD = 0.8;

/** Wall/Rampart 维修血量上限（修到此值即可） */
var DEFENSE_HITS_TARGET = 50000;

/** Tower 最低能量阈值（低于此比例不维修，保留能量用于防御） */
var TOWER_MIN_ENERGY_RATIO = 0.5;

/** 是否开启调试日志 */
var DEBUG = true;

// ── 模块 ────────────────────────────────────────────────

var managerTower = {

    /**
     * 执行所有防御塔逻辑
     * 遍历房间内所有 Tower，按优先级执行动作
     */
    run: function () {
        var towers = _.filter(Game.structures, s => s.structureType == STRUCTURE_TOWER);
        for (var i = 0; i < towers.length; i++) {
            this._runTower(towers[i]);
        }
    },

    /**
     * 单个防御塔的逻辑
     */
    _runTower: function (tower) {
        var energy = tower.store[RESOURCE_ENERGY];
        var capacity = tower.store.getCapacity(RESOURCE_ENERGY);
        var energyRatio = capacity > 0 ? energy / capacity : 0;

        // 1. 最高优先级：攻击敌对 Creep（无论能量多少都尝试）
        var hostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
        if (hostile) {
            tower.attack(hostile);
            return;
        }

        // 能量不足时，只保留防御能力，不做维修
        if (energyRatio < TOWER_MIN_ENERGY_RATIO) {
            if (DEBUG) {
                console.log('[Tower] 能量不足(' + energy + '/' + capacity + ')，跳过维修，等待补充');
            }
            return;
        }

        // 2. 维修血量低于阈值的普通建筑（紧急保护功能性建筑）
        var damaged = tower.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: s => s.hits < s.hitsMax * NORMAL_REPAIR_THRESHOLD
                && s.structureType != STRUCTURE_WALL
                && s.structureType != STRUCTURE_RAMPART
        });
        if (damaged) {
            tower.repair(damaged);
            if (DEBUG) {
                console.log('[Tower] 维修普通建筑: ' + damaged.structureType + ' 血量:' + damaged.hits + '/' + damaged.hitsMax);
            }
            return;
        }

        // 3. 空闲时维修 Wall/Rampart（血量 < DEFENSE_HITS_TARGET）
        var defense = tower.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: s => (s.structureType == STRUCTURE_WALL || s.structureType == STRUCTURE_RAMPART)
                && s.hits < DEFENSE_HITS_TARGET
        });
        if (defense) {
            tower.repair(defense);
            if (DEBUG) {
                console.log('[Tower] 维修防御建筑: ' + defense.structureType + ' 血量:' + defense.hits + '/' + DEFENSE_HITS_TARGET);
            }
        } else {
            // 没有需要维修的 Wall/Rampart
            if (DEBUG) {
                var walls = tower.room.find(FIND_STRUCTURES, {
                    filter: s => s.structureType == STRUCTURE_WALL || s.structureType == STRUCTURE_RAMPART
                });
                if (walls.length === 0) {
                    console.log('[Tower] 房间内无 Wall/Rampart，无法维修');
                } else {
                    console.log('[Tower] Wall/Rampart 血量均已达标(' + DEFENSE_HITS_TARGET + ')，当前数量:' + walls.length);
                }
            }
        }
    }
};

module.exports = managerTower;
