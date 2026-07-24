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

    // ── 矿点缓存 ──────────────────────────────────────────

    /** @type {string[]} 所有矿点 ID 列表（房间固定，首次 tick 初始化） */
    sourceIds: [],

    /** @type {Object.<string, {x: number, y: number, roomName: string}>} 矿点坐标缓存 */
    sourceData: {},

    /** @type {Object.<string, number>} 每 tick 矿点空闲相邻格数量的缓存（key: sourceId, value: 空闲格子数） */
    sourceSlotCount: {},

    /** @type {Object.<string, number>} 矿点到 Spawn 的距离缓存（key: sourceId, value: 距离） */
    sourceSpawnDist: {},

    // ── Spawn 与房间缓存 ──────────────────────────────────

    /** @type {string|null} 当前主 spawn 名称（动态发现，不再硬编码 Spawn1） */
    spawnName: null,

    /** @type {string|null} 当前主 spawn 所在房间名（检测房间变更用） */
    spawnRoomName: null,

    // ── 建筑缓存 ──────────────────────────────────────────

    /** @type {string[]} Tower ID 缓存（首次 tick 或缓存失效时刷新） */
    towerIds: [],

    // ── 紧急模式 ──────────────────────────────────────────

    /** @type {boolean} 是否处于紧急模式（基地重启中，以 harvester 为主） */
    emergencyMode: false,
};

module.exports = state;
