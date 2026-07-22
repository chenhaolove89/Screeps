/**
 * 全局配置
 * 所有角色数量和阈值统一管理
 */
module.exports = {

    // 各角色目标数量
    roleTargets: {
        harvester: 8,
        upgrader:  2,
        builder:   2,
        repairer:  0,
    },

    // 孵化能量门槛（低于此值不孵化）
    spawnEnergyThreshold: 200,

    // 建造 / 升级节流阈值（房间能量低于此值时暂停）
    // 这个值会自动浮动，参考 spawnEnergyThreshold
    // builder/upgrader 会检查 state.creepShortage 而不是硬编码
};
