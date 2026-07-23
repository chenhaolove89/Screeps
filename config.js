/**
 * 全局配置
 * 所有角色数量和阈值统一管理
 */
module.exports = {

    // 各角色目标数量
    roleTargets: {
        collector:   3,   // 纯采集者，采完投放到 Container
        harvester:   0,   // 旧版 harvester，已由 collector 替代
        transporter: 2,   // 搬运者，从采集节点搬运到消费节点
        upgrader:    1,
        builder:     1,
        repairer:    0,
    },

    // 孵化能量门槛（低于此值不孵化）
    spawnEnergyThreshold: 200,

    // 调度器配置
    scheduler: {
        /** transport 任务默认最大重试次数 */
        defaultMaxRetries: 2,
        /** 任务超时 tick 数 */
        taskTimeout: 300,
    },

    // 采集者配置
    collector: {
        /** 每个 source 最大采集者数 */
        maxPerSource: 2,
        /** 卡住检测阈值 (ticks) */
        stuckThreshold: 50,
        /** Room.find 缓存有效期 (ticks) */
        cacheTTL: 20,
    },

    // 搬运者配置
    transporter: {
        /** Spawn 低能量预警阈值 */
        spawnLowEnergy: 300,
        /** Tower 低弹药预警阈值 */
        towerLowEnergy: 500,
        /** Room.find 缓存有效期 (ticks) */
        cacheTTL: 15,
    },

    // 建造 / 升级节流阈值（房间能量低于此值时暂停）
    // 这个值会自动浮动，参考 spawnEnergyThreshold
    // builder/upgrader 会检查 state.creepShortage 而不是硬编码
};
