/**
 * 每 tick 共享状态
 * 用于在模块之间传递瞬态信息，避免读写 Memory
 */
var state = {

    /** @type {boolean} 当前是否有角色短缺，需要暂停建造/升级 */
    creepShortage: false,

    /** @type {string|null} 当前正在孵化的角色，null 表示无 */
    spawningRole: null,

    // ── Creep 缓存 ────────────────────────────────────────

    /** @type {string[]} 所有存活的 creep 名字列表（用于角色调度循环） */
    allNames: [],

    /** @type {Object.<string, string[]>} 按角色分组的 creep 名字列表（用于快速计数） */
    byRole: {},

    /** @type {boolean} 缓存是否已初始化 */
    _cacheReady: false,

    // ── 调度器状态 ────────────────────────────────────────

    /** @type {{ active: number, completed: number, failed: number, avgDuration: number }}
     *  调度统计快照（每 100 tick 更新一次） */
    schedulerStats: {
        active:      0,
        completed:   0,
        failed:      0,
        avgDuration: 0,
    },
};

module.exports = state;
