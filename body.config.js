/**
 * Creep 身体部件配置管理器
 *
 * 为不同角色提供差异化的部件生成策略,根据角色职责和可用能量
 * 动态生成最优的身体部件组合方案。
 *
 * ── 设计原则 ──
 * 1. 移动效率优先:确保平原地形无疲劳移动
 * 2. 能量利用最大化:精确匹配可用能量
 * 3. 角色职责匹配:专属化部件组合
 * 4. 生命周期适应:支持不同发展阶段
 */

var config = require('config');

// ══════════════════════════════════════════════════════
//  能量阶段常量
// ══════════════════════════════════════════════════════

var ENERGY_TIERS = {
    SURVIVAL:   { min: 200, max: 300,  name: '生存期' },    // 新房间启动
    DEVELOPING: { min: 300, max: 550,  name: '发展期' },    // RCL 2-3
    GROWING:    { min: 550, max: 800,  name: '成长期' },    // RCL 4-5
    MATURE:     { min: 800, max: 1300, name: '成熟期' },    // RCL 6-7
    PROSPERING: { min: 1300, max: 3000, name: '繁荣期' },   // RCL 8
};

// ══════════════════════════════════════════════════════
//  战斗角色预留接口
// ══════════════════════════════════════════════════════

var COMBAT_ROLES = {
    GUARD:    'guard',      // 近战防御
    RANGER:   'ranger',     // 远程攻击
    HEALER:   'healer',     // 治疗
    CLAIMER:  'claimer',    // 占领房间
};

var COMBAT_BODY_TEMPLATES = {
    guard: {
        low:  [TOUGH, ATTACK, ATTACK, MOVE, MOVE],                    // 成本: 10+80+80+50+50=270
        high: [TOUGH, TOUGH, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE], // 成本: 10+10+80*3+50*3=310
    },
    ranger: {
        low:  [RANGED_ATTACK, MOVE],                                     // 成本: 150+50=200
        high: [RANGED_ATTACK, RANGED_ATTACK, MOVE, MOVE],               // 成本: 150*2+50*2=400
    },
    healer: {
        low:  [HEAL, MOVE],                                              // 成本: 250+50=300
        high: [HEAL, HEAL, MOVE, MOVE],                                  // 成本: 250*2+50*2=600
    },
    claimer: {
        standard: [CLAIM, MOVE],                                         // 成本: 600+50=650
    },
};

// ══════════════════════════════════════════════════════
//  核心配置函数
// ══════════════════════════════════════════════════════

/**
 * Harvester(采集+运输)
 *
 * 职责:需要在矿点和Spawn/Extension之间高频往返
 * 配比策略:WORK:CARRY:MOVE = 2:1:2 (平衡采集与移动)
 */
function getHarvesterBody(energy) {
    // 单元成本:WORK(100) + WORK(100) + CARRY(50) + MOVE(50) + MOVE(50) = 350
    var unitCost = 350;
    var units = Math.max(1, Math.min(Math.floor(energy / unitCost), 4));

    var body = [];
    for (var i = 0; i < units * 2; i++) body.push(WORK);
    for (var i = 0; i < units; i++) body.push(CARRY);
    for (var i = 0; i < units * 2; i++) body.push(MOVE);

    _log('harvester', energy, body, unitCost * units);
    return body;
}

/**
 * Collector(纯采集)
 *
 * 职责:固定矿点工作,移动需求极低
 * 配比策略:最大化WORK,仅保留必要的CARRY和MOVE
 */
function getCollectorBody(energy) {
    // 基础成本:CARRY(50) + MOVE(50) = 100
    var baseCost = 100;
    var workCount = Math.max(1, Math.min(Math.floor((energy - baseCost) / 100), 8));

    var body = [];
    for (var i = 0; i < workCount; i++) body.push(WORK);
    body.push(CARRY);
    body.push(MOVE);

    var totalCost = baseCost + workCount * 100;
    _log('collector', energy, body, totalCost);
    return body;
}

/**
 * Transporter(能量搬运)
 *
 * 职责:全场高频移动,运输效率核心指标
 * 配比策略:CARRY:MOVE = 1:1 (确保满载无疲劳)
 */
function getTransporterBody(energy) {
    // 单元成本:CARRY(50) + MOVE(50) = 100
    var unitCost = 100;
    var units = Math.max(1, Math.min(Math.floor(energy / unitCost), 8));

    var body = [];
    for (var i = 0; i < units; i++) body.push(CARRY);
    for (var i = 0; i < units; i++) body.push(MOVE);

    _log('transporter', energy, body, unitCost * units);
    return body;
}

/**
 * Upgrader(升级控制器)
 *
 * 职责:固定在控制器附近工作,移动需求低
 * 配比策略:类似harvester的2:1:2配比
 */
function getUpgraderBody(energy) {
    // 单元成本:WORK(100) * 2 + CARRY(50) + MOVE(50) * 2 = 350
    var unitCost = 350;
    var units = Math.max(1, Math.min(Math.floor(energy / unitCost), 3));

    var body = [];
    for (var i = 0; i < units * 2; i++) body.push(WORK);
    for (var i = 0; i < units; i++) body.push(CARRY);
    for (var i = 0; i < units * 2; i++) body.push(MOVE);

    _log('upgrader', energy, body, unitCost * units);
    return body;
}

/**
 * Builder(建造工地)
 *
 * 职责:需要在多个工地之间移动
 * 配比策略:WORK主导,确保足够MOVE支持移动
 */
function getBuilderBody(energy) {
    // 最小配置:WORK(100) + CARRY(50) + MOVE(50) = 200
    if (energy < 250) {
        var minBody = [WORK, CARRY, MOVE];
        _log('builder', energy, minBody, 200);
        return minBody;
    }

    // 优化配置:单元成本WORK(100)*2 + CARRY(50) + MOVE(50)*2 = 350
    var unitCost = 350;
    var units = Math.max(1, Math.min(Math.floor(energy / unitCost), 4));

    var body = [];
    for (var i = 0; i < units * 2; i++) body.push(WORK);
    for (var i = 0; i < units; i++) body.push(CARRY);
    for (var i = 0; i < units * 2; i++) body.push(MOVE);

    _log('builder', energy, body, unitCost * units);
    return body;
}

/**
 * Repairer(修理建筑)
 *
 * 职责:在受损建筑之间移动,频率中等
 * 配比策略:类似builder,但CARRY需求较少
 */
function getRepairerBody(energy) {
    // 最小配置:WORK(100) + CARRY(50) + MOVE(50) = 200
    if (energy < 200) {
        var minBody = [WORK, CARRY, MOVE];
        _log('repairer', energy, minBody, 200);
        return minBody;
    }

    // 优化配置:WORK(100) + CARRY(50) + MOVE(50) 为基础单元
    var units = Math.max(1, Math.min(Math.floor((energy - 50) / 150), 5));

    var body = [];
    for (var i = 0; i < units; i++) body.push(WORK);
    body.push(CARRY);
    for (var i = 0; i < units; i++) body.push(MOVE);

    var totalCost = 50 + units * 150;
    _log('repairer', energy, body, totalCost);
    return body;
}

// ══════════════════════════════════════════════════════
//  回退函数(向后兼容)
// ══════════════════════════════════════════════════════

/**
 * 默认配置(保持原有的1:1:1配比)
 * 用于回退和未知角色
 */
function getDefaultBody(energy) {
    var n = Math.max(1, Math.min(Math.floor(energy / 200), 8));
    var body = [];
    for (var i = 0; i < n; i++) body.push(WORK);
    for (var i = 0; i < n; i++) body.push(CARRY);
    for (var i = 0; i < n; i++) body.push(MOVE);

    _log('default', energy, body, n * 200);
    return body;
}

// ══════════════════════════════════════════════════════
//  工具函数
// ══════════════════════════════════════════════════════

/**
 * 调试日志输出
 */
function _log(role, energy, body, cost) {
    if (!config.bodyConfig || !config.bodyConfig.debug) {
        return;
    }

    var parts = {};
    for (var i = 0; i < body.length; i++) {
        parts[body[i]] = (parts[body[i]] || 0) + 1;
    }

    var partsStr = '';
    if (parts.work) partsStr += 'WORK:' + parts.work + ' ';
    if (parts.carry) partsStr += 'CARRY:' + parts.carry + ' ';
    if (parts.move) partsStr += 'MOVE:' + parts.move + ' ';

    console.log('[BodyConfig] ' + role.toUpperCase()
        + ' | 可用能量: ' + energy
        + ' | 部件: ' + partsStr.trim()
        + ' | 成本: ' + cost
        + ' | 剩余: ' + (energy - cost));
}

/**
 * 计算body总成本
 */
function calculateCost(body) {
    var cost = 0;
    for (var i = 0; i < body.length; i++) {
        var part = body[i];
        if (part === MOVE) cost += 50;
        else if (part === WORK) cost += 100;
        else if (part === CARRY) cost += 50;
        else if (part === ATTACK) cost += 80;
        else if (part === RANGED_ATTACK) cost += 150;
        else if (part === HEAL) cost += 250;
        else if (part === TOUGH) cost += 10;
        else if (part === CLAIM) cost += 600;
    }
    return cost;
}

/**
 * 获取能量阶段
 */
function getEnergyTier(energy) {
    for (var tier in ENERGY_TIERS) {
        var range = ENERGY_TIERS[tier];
        if (energy >= range.min && energy <= range.max) {
            return { tier: tier, name: range.name };
        }
    }
    return { tier: 'PROSPERING', name: '繁荣期' };
}

// ══════════════════════════════════════════════════════
//  主接口
// ══════════════════════════════════════════════════════

/**
 * 根据角色和能量获取最优body配置
 *
 * @param {number} energy - 可用能量
 * @param {string} role - 角色类型
 * @returns {string[]} body数组
 */
function getBody(energy, role) {
    // 强制使用默认配置(调试用)
    if (config.bodyConfig && config.bodyConfig.forceDefault) {
        return getDefaultBody(energy);
    }

    // 选择对应的配置策略
    var strategy = null;
    switch (role) {
        case 'harvester':   strategy = getHarvesterBody; break;
        case 'collector':   strategy = getCollectorBody; break;
        case 'transporter': strategy = getTransporterBody; break;
        case 'upgrader':    strategy = getUpgraderBody; break;
        case 'builder':     strategy = getBuilderBody; break;
        case 'repairer':    strategy = getRepairerBody; break;
        default:            strategy = getDefaultBody; break;
    }

    var body = strategy(energy);

    // 安全检查:确保成本不超过可用能量
    var cost = calculateCost(body);
    if (cost > energy) {
        console.log('[BodyConfig] 警告: ' + role + ' 配置成本(' + cost + ')超过可用能量(' + energy + '),回退到默认配置');
        return getDefaultBody(energy);
    }

    return body;
}

module.exports = {
    // 常量
    ENERGY_TIERS: ENERGY_TIERS,
    COMBAT_ROLES: COMBAT_ROLES,
    COMBAT_BODY_TEMPLATES: COMBAT_BODY_TEMPLATES,

    // 主接口
    getBody: getBody,

    // 工具函数
    calculateCost: calculateCost,
    getEnergyTier: getEnergyTier,

    // 角色配置函数(供高级用户直接调用)
    getHarvesterBody: getHarvesterBody,
    getCollectorBody: getCollectorBody,
    getTransporterBody: getTransporterBody,
    getUpgraderBody: getUpgraderBody,
    getBuilderBody: getBuilderBody,
    getRepairerBody: getRepairerBody,
    getDefaultBody: getDefaultBody,
};