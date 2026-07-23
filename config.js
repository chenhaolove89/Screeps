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
        upgrader:   4,
        builder:    3,
        repairer:   1,
    },

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
