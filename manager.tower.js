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

// ── 模块 ────────────────────────────────────────────────

var state = require('state');

var managerTower = {

    /**
     * 执行所有防御塔逻辑
     * 遍历房间内所有 Tower，按优先级执行动作
     */
    run: function () {
        var towers = this._getTowers();
        for (var i = 0; i < towers.length; i++) {
            this._runTower(towers[i]);
        }
    },

    /**
     * 获取房间内所有 Tower（带缓存）
     * 缓存命中时用 Game.getObjectById（O(1) per tower），
     * 缓存失效或为空时全量扫描刷新
     */
    _getTowers: function () {
        var towers = [];
        var needRefresh = false;

        // 缓存为空 → 需要扫描（检测新建的 Tower）
        if (state.towerIds.length === 0) {
            needRefresh = true;
        } else {
            // 验证缓存中的 Tower 是否仍然有效
            for (var i = 0; i < state.towerIds.length; i++) {
                var t = Game.getObjectById(state.towerIds[i]);
                if (t && t.structureType == STRUCTURE_TOWER) {
                    towers.push(t);
                } else {
                    // 某个 Tower 失效（被摧毁）→ 需要重新扫描
                    needRefresh = true;
                    break;
                }
            }
        }

        if (needRefresh) {
            state.towerIds = [];
            towers = [];
            for (var id in Game.structures) {
                var s = Game.structures[id];
                if (s.structureType == STRUCTURE_TOWER) {
                    state.towerIds.push(id);
                    towers.push(s);
                }
            }
        }

        return towers;
    },

    /**
     * 单个防御塔的逻辑
     * 用 RoomVisual 在塔上方显示状态文字（Tower 结构本身无 say 方法）
     */
    _runTower: function (tower) {
        var energy = tower.store[RESOURCE_ENERGY];
        var capacity = tower.store.getCapacity(RESOURCE_ENERGY);
        var energyRatio = capacity > 0 ? energy / capacity : 0;
        var visual = new RoomVisual(tower.room.name);

        // 1. 最高优先级：攻击敌对 Creep（无论能量多少都尝试）
        var hostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
        if (hostile) {
            tower.attack(hostile);
            this._say(visual, tower, '⚔ 攻击', '#ff4444');
            return;
        }

        // 能量不足时，只保留防御能力，不做维修
        if (energyRatio < TOWER_MIN_ENERGY_RATIO) {
            this._say(visual, tower, '⏸ 等待', '#ffaa00');
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
            this._say(visual, tower, '🔧 修建筑', '#00aaff');
            return;
        }

        // 3. 空闲时维修 Wall/Rampart（血量 < DEFENSE_HITS_TARGET）
        var defense = tower.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: s => (s.structureType == STRUCTURE_WALL || s.structureType == STRUCTURE_RAMPART)
                && s.hits < DEFENSE_HITS_TARGET
        });
        if (defense) {
            tower.repair(defense);
            this._say(visual, tower, '🛡 修防御', '#00ff00');
        } else {
            this._say(visual, tower, '✓ 已达标', '#888888');
        }
    },

    /**
     * 在 Tower 上方显示状态文字（模拟喊话效果）
     */
    _say: function (visual, tower, text, color) {
        visual.text(text, tower.pos.x, tower.pos.y - 1.5, {
            color: color,
            font: 0.6,
            backgroundColor: 'rgba(0,0,0,0.5)',
            padding: 0.1,
        });
    }
};

module.exports = managerTower;
