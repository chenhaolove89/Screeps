/**
 * 全局配置
 * 所有角色数量和阈值统一管理
 */
module.exports = {

    // 各角色目标数量
    roleTargets: {
        harvester:  0,
        collector:  6,
        transporter: 5,
        upgrader:   6,
        builder:    5,
        repairer:   1,
    },

    // 紧急模式角色配置（基地毁灭后重启用，以 harvester 为主不依赖 Container）
    emergencyRoleTargets: {
        harvester:  3,
        collector:  2,
        transporter: 1,
        upgrader:   0,
        builder:    0,
        repairer:   0,
    },

    // 紧急模式判定阈值：存活 creep 总数低于此值触发
    emergencyCreepThreshold: 3,

    // 孵化能量门槛（低于此值不孵化）
    spawnEnergyThreshold: 200,

    // 建造 / 升级节流阈值（房间能量低于此值时暂停）
    // 这个值会自动浮动，参考 spawnEnergyThreshold
    // builder/upgrader 会检查 state.creepShortage 而不是硬编码

    // 身体部件配置开关（用于调试和优化）
    bodyConfig: {
        debug: false,              // 是否打印部件生成日志
        forceDefault: false,       // 强制使用默认配置（调试用）
        forceTier: null,           // 强制使用指定能量阶段（null=自动）
    },
};
