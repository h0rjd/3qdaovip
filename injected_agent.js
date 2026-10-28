// ==UserScript==
// @name         3Q Đào Đào Đào - AutoBot v3.9.32 (Farm KNB Homestead Rescue Edition)
// @namespace    https://joyplay.vn/
// @version      3.9.32
// @description  AutoBot v3.9.32: Tích hợp chế độ Farm KNB Giải Cứu Gia Viên (50 KNB/lượt không giới hạn), kiểm tra & trảm quân chiếm đóng.
// @author       Antigravity
// @match        *://3qdao.joyplay.vn/*
// @match        *://*.joyplay.vn/*
// @match        *://*.anhhung3q.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

/**
 * 3Q Đào Đào Đào - Injected In-Game Automation Agent (Smart State Engine v3.0 - Anti-Disconnect & Condition-Driven)
 * 
 * Các nguyên tắc cốt lõi:
 * 1. Condition-Driven: CHỈ gửi lệnh khi ĐỦ ĐIỀU KIỆN (có tướng đủ mảnh, có đồ giám mới, thợ rảnh, hoa chín, có lượt cướp, v.v.).
 * 2. Rate-Limiting: Giãn cách tối thiểu 300ms - 500ms giữa các gói tin socket, chống nghẽn và chống bị server ngắt kết nối.
 * 3. Chạy ngầm 100%: Chặn triệt để popup Xếp Trận / Bố Trận, không ảnh hưởng thao tác xem hoặc chơi của game thủ.
 * 4. Defeat Guard: Dừng an toàn khi thua trận ở Vượt Ải và Leo Tháp để bảo vệ lượt và chống spam.
 * 5. Bỏ qua QC 0s & Tốc độ trận đấu x1/x2/x3/x5.
 */

(function () {
    if (window.__AUTO_BOT_INITIALIZED__) {
        console.log("[AutoBot] Cập nhật Smart State Engine v3.0 (dọn phiên bản cũ)...");
        try {
            (window.__AUTO_BOT_TIMERS__ || []).forEach(function (id) { clearInterval(id); clearTimeout(id); });
        } catch (e) { }
        window.__AUTO_BOT_LOOP_RUNNING__ = false;
        try {
            const oldHud = document.getElementById("autobot-hud-root");
            if (oldHud && oldHud.parentNode) oldHud.parentNode.removeChild(oldHud);
        } catch (e) { }
        window.__3Q_HUD_MOUNTED__ = false;
    }
    window.__AUTO_BOT_INITIALIZED__ = true;
    window.__AUTO_BOT_TIMERS__ = [];
    const trackTimer = function (id) { window.__AUTO_BOT_TIMERS__.push(id); return id; };

    // Dynamic Fallback Proxies / Getters for Global Managers (Crucial for iOS Safari & Userscripts)
    function setupGlobalProxy(propName, requireName) {
        try {
            const desc = Object.getOwnPropertyDescriptor(window, propName);
            if (desc && !desc.configurable) return;
            let _cached = window[propName] || null;
            Object.defineProperty(window, propName, {
                get: function () {
                    if (_cached) return _cached;
                    try {
                        const gm = window.G_Mapping;
                        if (gm) {
                            if (gm[propName]) return (_cached = gm[propName]);
                            if (propName === "BattleFastManager" && gm.BatteFastManager) return (_cached = gm.BatteFastManager);
                            if (propName === "BatteFastManager" && gm.BattleFastManager) return (_cached = gm.BattleFastManager);
                        }
                        if (typeof window.__require === "function") {
                            const m = window.__require(requireName || propName);
                            if (m) {
                                const res = m[propName] || m.default || m;
                                if (res) return (_cached = res);
                            }
                        }
                    } catch (e) { }
                    return undefined;
                },
                set: function (v) {
                    _cached = v;
                    try {
                        Object.defineProperty(window, propName, {
                            value: v,
                            writable: true,
                            configurable: true,
                            enumerable: true
                        });
                    } catch (e) { }
                },
                configurable: true,
                enumerable: true
            });
        } catch (e) { }
    }

    const CORE_MANAGERS = [
        "ModelManager",
        "ViewManager",
        "ControllerManager",
        "Dispatcher",
        "FightManager",
        "RollTips",
        "NetWork",
        "BattleFastManager",
        "BatteFastManager",
        "EventType",
        "ModuleUtil",
        "RPCReq",
        "FubenManager",
        "RedManager",
        "TowerConfiger",
        "RankConfiger",
        "ConfigManager",
        "LotteryConfiger",
        "CrossMineConfiger",
        "LmLotteryConfiger",
        "TimeLib",
        "BitUtil"
    ];
    CORE_MANAGERS.forEach(function (mgr) { setupGlobalProxy(mgr); });

    // Helper: Hỗ trợ Native SkipBattle trực tiếp từ engine Cocos (kết thúc ngay tức thì 0s, không vào cảnh chiến đấu)
    // Chỉ áp dụng cho các chế độ game CÓ HỖ TRỢ SKIP NATIVE:
    // Tháp Thông Thiên (2), Tháp Trận Doanh (12..16), Phụ bản ngày (3), Đấu trường (101)
    // Tuyệt đối KHÔNG gộp Bí Cảnh Tần Lĩnh (9), Ải Chính Tuyến (1), Leo Hạng Liên Server / Lôi Đài (105), và các loại Boss (4, 6, 10, v.v.) vào đây!
    function canNativeSkipBattle(gameplayType) {
        const t = Number(gameplayType);
        return (
            t === 2 ||                           // Tower (Leo tháp)
            (t >= 12 && t <= 16) ||              // YsTower 1..5 (Tháp nguyên tố / trận doanh)
            t === 3 ||                           // DailyDungeon (Phụ bản hằng ngày)
            t === 101 ||                         // Arena (Đấu trường)
            t === 106 ||                         // Revolt (Giải cứu gia viên)
            t === 105                            // CityFight (Đánh cướp gia viên)
        );
    }

    window.__AUTO_STAGE_ENABLED__ = false;

    const bot = {
        canNativeSkipBattle: canNativeSkipBattle,
        isAutoStageOn: function () {
            return !!(bot.state && bot.state.isAutoStageActive && bot.settings && bot.settings.auto_stage && window.__AUTO_STAGE_ENABLED__);
        },
        logs: [],
        settings: {
            auto_stage: false,
            auto_tower: true,
            skip_ads: true,
            skip_battle: true,
            speed_hack: 2,
            auto_shovel: false,
            auto_treasure: false,
            auto_host: true,
            auto_rescue_knb: true,
            auto_dispatch: true,
            auto_arena: true,
            auto_afk: true,
            auto_hero_up: false,
            auto_star_up: true,
            auto_manual: true,
            auto_rank: true,
            auto_yyzq_core: true,
            auto_touhu: true,
            touhu_aimbot: true,
            auto_feidao: true,
            auto_hongbao: true,
            auto_act_task: true,
            auto_act_daily: true,
            auto_longmach: true,
            longmach_aimbot: true,
            auto_skvs: true,
            auto_guild_mine: true,
            auto_recycle_fragments: true,
            auto_defjz: false,
            auto_free_lottery: true,
            auto_daily_rewards: true,
            reserve_gold: 500000,
            mod_skin: true,
            mod_headframe_title: true,
            mod_headframe: null,
            mod_title: null,
            mod_avatar: null,
            hero_skins: {}
        },
        stats: {
            roleName: "Đang tải...",
            level: 0,
            power: 0,
            gold: 0,
            jade: 0,
            stage: 1,
            towerFloor: 1,
            rescuedCount: 0,
            rescuedKnbTotal: 0,
            inspectedHomesCount: 0,
            totalRescueScanned: 0,
            basePower: 0
        },

        // Bộ nhớ trạng thái & Cooldown
        state: {
            master: true,
            stageFailCount: 0,
            lastStageFailTime: 0,
            lastStageFailPower: 0,
            lastStageFailStage: 0,
            stage10401ErrCount: 0,
            towerFailCount: 0,
            lastTowerFailTime: 0,
            lastTowerFailPower: 0,
            battleInProgress: false,
            lastBattleEndTime: 0,
            viewingBattleData: false,
            isAutoStageActive: false,
            isAutoTowerActive: true,
            isAutoHostActive: true,
            isAutoRescueKnbActive: true,
            rescuedCount: 0,
            rescuedKnbTotal: 0,
            rescueChecking: false,
            failedRescueRids: {},
            isAutoYyzqCoreActive: true,
            isAutoRankActive: true,
            isAutoTouhuActive: true,
            isAutoSkVsActive: true,
            _skvsCandidates: null,
            _skvsLastCandidateReq: 0,
            _skvsVsingData: null,
            _skvsLastVsingReq: 0,
            _skvsLastRedPackReq: 0,
            rankLikedDate: null,
            mod_skin: true,
            mod_headframe_title: true,
            cooldowns: {}
        },

        saveSettings: function () {
            try {
                if (typeof window !== "undefined" && window.localStorage) {
                    window.localStorage.setItem("3qdao_bot_settings", JSON.stringify(bot.settings));
                }
            } catch (e) { }
        },

        loadSettings: function () {
            try {
                if (typeof window !== "undefined" && window.localStorage) {
                    const raw = window.localStorage.getItem("3qdao_bot_settings");
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        Object.assign(bot.settings, parsed);
                        // Đảm bảo tính năng Vượt Ải luôn khởi động ở trạng thái TẮT an toàn khi mở game
                        bot.settings.auto_stage = false;
                        if (bot.state) {
                            bot.state.isAutoStageActive = false;
                            if (bot.settings.auto_tower !== undefined) bot.state.isAutoTowerActive = !!bot.settings.auto_tower;
                            if (bot.settings.auto_host !== undefined) bot.state.isAutoHostActive = !!bot.settings.auto_host;
                            if (bot.settings.auto_rescue_knb !== undefined) bot.state.isAutoRescueKnbActive = !!bot.settings.auto_rescue_knb;
                            if (bot.settings.auto_yyzq_core !== undefined) bot.state.isAutoYyzqCoreActive = !!bot.settings.auto_yyzq_core;
                            if (bot.settings.auto_rank !== undefined) bot.state.isAutoRankActive = !!bot.settings.auto_rank;
                            if (bot.settings.auto_touhu !== undefined) bot.state.isAutoTouhuActive = !!bot.settings.auto_touhu;
                            if (bot.settings.auto_skvs !== undefined) bot.state.isAutoSkVsActive = !!bot.settings.auto_skvs;
                            if (bot.settings.auto_defjz !== undefined) bot.state.isAutoDefJzActive = !!bot.settings.auto_defjz;
                            if (bot.settings.mod_skin !== undefined) bot.state.mod_skin = !!bot.settings.mod_skin;
                            if (bot.settings.mod_headframe_title !== undefined) bot.state.mod_headframe_title = !!bot.settings.mod_headframe_title;
                        }
                        window.__AUTO_STAGE_ENABLED__ = false;
                        if (window.__DAUTO_CONFIG) window.__DAUTO_CONFIG.FEAT_AUTO_STAGE = false;
                    }
                }
            } catch (e) { }
        },

        getBestFashionIdForHero: function (heroId) {
            if (!heroId) return null;
            try {
                const gm = window.G_Mapping || {};
                const hc = gm.HeroConfiger || window.HeroConfiger;
                if (!hc) return null;

                let heroBaseInfo = null;
                if (typeof hc.getHeroBaseInfo === "function") {
                    heroBaseInfo = hc.getHeroBaseInfo(heroId, false);
                }
                if (!heroBaseInfo && typeof hc.getHeroBaseInfoByHeroBaseId === "function") {
                    heroBaseInfo = hc.getHeroBaseInfoByHeroBaseId(heroId, false);
                }
                if (!heroBaseInfo) return null;

                const baseId = heroBaseInfo.id || heroBaseInfo.base_id || heroId;
                if (bot.settings.hero_skins && bot.settings.hero_skins[baseId]) {
                    return bot.settings.hero_skins[baseId];
                }
                if (bot.settings.hero_skins && bot.settings.hero_skins[heroId]) {
                    return bot.settings.hero_skins[heroId];
                }

                let fList = heroBaseInfo.fashion_id;
                if (typeof fList === "number") fList = [fList];
                if (Array.isArray(fList) && fList.length > 0) {
                    const rawFid = fList[fList.length - 1];
                    if (typeof hc.getHeroFashionData === "function") {
                        const fData = hc.getHeroFashionData(rawFid, false);
                        if (fData && fData.base_id && typeof hc.getHeroFashionDataByBaseIdAndLv === "function") {
                            for (let lv = 10; lv >= 1; lv--) {
                                const maxLv = hc.getHeroFashionDataByBaseIdAndLv(fData.base_id, lv);
                                if (maxLv && maxLv.id) return maxLv.id;
                            }
                        }
                    }
                    return rawFid;
                }
            } catch (e) { }
            return null;
        },

        ensureHeroItemHooks: function () {
            try {
                const gm = window.G_Mapping || {};

                // 1. HeroItem Hook (Spine Model & Animation & Combat in all Battles)
                let hi = (gm && gm.HeroItem) || window.HeroItem;
                if (!hi && typeof window.__require === "function") {
                    try { hi = window.__require("HeroItem"); } catch (e) { }
                    if (!hi) {
                        try { hi = window.__require("./Game/Modules/Battle/Cell/HeroItem"); } catch (e) { }
                    }
                }
                if (!hi && typeof cc !== "undefined" && cc.js && cc.js.getClassByName) {
                    try { hi = cc.js.getClassByName("HeroItem"); } catch (e) { }
                }
                if (!hi) {
                    const fm = gm.FightManager || window.FightManager;
                    if (fm && fm.arayHeroComs) {
                        for (let k in fm.arayHeroComs) {
                            const com = fm.arayHeroComs[k];
                            if (com && typeof com.getHeroItemById === "function") {
                                const item = com.getHeroItemById(1, 0) || com.getHeroItemById(1, 1) || com.getHeroItemById(1, 2);
                                if (item && item.constructor && item.constructor.prototype) {
                                    hi = item.constructor;
                                    break;
                                }
                            }
                        }
                    }
                }

                if (hi && hi.prototype && !hi.prototype.__QA_MOD_BATTLE_SKIN__) {
                    hi.prototype.__QA_MOD_BATTLE_SKIN__ = true;

                    const applyHeroFashion = function (item, e) {
                        if (!e || bot.state.mod_skin === false) return;
                        try {
                            const isPlayer = (e._pos !== 2 && e._camp !== 2);
                            if (isPlayer && e._hero_id) {
                                const customFid = bot.settings.hero_skins && (bot.settings.hero_skins[e._hero_id] || bot.settings.hero_skins[String(e._hero_id)]);
                                const fid = customFid || bot.getBestFashionIdForHero(e._hero_id);
                                if (fid) {
                                    e._fashion = [{ _fashion_id: fid, _val: fid }];
                                    if (item) item.lastHaveSkin = true;
                                }
                            }
                        } catch (err) { }
                    };

                    const origRestHeroSpine = hi.prototype.restHeroSpine;
                    hi.prototype.restHeroSpine = function (e, cb) {
                        applyHeroFashion(this, e);
                        const self = this;
                        const wrappedCb = function () {
                            try {
                                if (self.battleState && self.skeletonNode) {
                                    self.battleState.skeletonNode = self.skeletonNode;
                                }
                                if (typeof self.toStand === "function") {
                                    self.toStand();
                                }
                            } catch (err) { }
                            if (typeof cb === "function") cb.apply(this, arguments);
                        };
                        return origRestHeroSpine.call(this, e, wrappedCb);
                    };

                    const origSetData = hi.prototype.setData;
                    if (origSetData) {
                        hi.prototype.setData = function (e, t, i) {
                            applyHeroFashion(this, e);
                            return origSetData.call(this, e, t, i);
                        };
                    }

                    const origOnlyResetBaseData = hi.prototype.onlyResetBaseData;
                    if (origOnlyResetBaseData) {
                        hi.prototype.onlyResetBaseData = function (e) {
                            applyHeroFashion(this, e);
                            const res = origOnlyResetBaseData.call(this, e);
                            if (bot.state.mod_skin !== false && e && e._fashion && e._fashion.length > 0) {
                                if (!this.lastHaveSkin || !this.skeletonNode) {
                                    this.lastHaveSkin = true;
                                    this.restHeroSpine(e, null);
                                }
                            }
                            return res;
                        };
                    }
                }

                // 2. BatteSpineManager Hook
                let bsm = (gm && gm.BatteSpineManager) || window.BatteSpineManager;
                if (!bsm && typeof window.__require === "function") {
                    try { bsm = window.__require("BatteSpineManager"); } catch (e) { }
                    if (!bsm) {
                        try { bsm = window.__require("./Game/Manager/BatteSpineManager"); } catch (e) { }
                    }
                }
                if (bsm && !bsm.__QA_MOD_SPINE__) {
                    bsm.__QA_MOD_SPINE__ = true;
                    const origCreateBatteSpineById = bsm.createBatteSpineById;
                    bsm.createBatteSpineById = function (heroId, isLeft, type, viewBelong) {
                        if (bot.state.mod_skin !== false && isLeft !== false && heroId) {
                            try {
                                const customFid = bot.settings.hero_skins && (bot.settings.hero_skins[heroId] || bot.settings.hero_skins[String(heroId)]);
                                const fid = customFid || bot.getBestFashionIdForHero(heroId);
                                if (fid && typeof bsm.creatHeroModelByFashionId === "function") {
                                    return bsm.creatHeroModelByFashionId(fid, null);
                                }
                            } catch (e) { }
                        }
                        return origCreateBatteSpineById.apply(this, arguments);
                    };
                }

                // 3. SpineManager Hook
                let sm = (gm && gm.SpineManager) || window.SpineManager;
                if (!sm && typeof window.__require === "function") {
                    try { sm = window.__require("SpineManager"); } catch (e) { }
                }
                if (sm && !sm.__QA_MOD_SPINE__) {
                    sm.__QA_MOD_SPINE__ = true;
                    const origCreatSpineByBaseId = sm.creatSpineByBaseId;
                    sm.creatSpineByBaseId = function (heroBaseId, viewBelong) {
                        if (bot.state.mod_skin !== false && heroBaseId) {
                            try {
                                const customFid = bot.settings.hero_skins && (bot.settings.hero_skins[heroBaseId] || bot.settings.hero_skins[String(heroBaseId)]);
                                const fid = customFid || bot.getBestFashionIdForHero(heroBaseId);
                                if (fid) {
                                    const hc = (gm && gm.HeroConfiger) || window.HeroConfiger;
                                    if (hc && typeof hc.getHeroFashionData === "function") {
                                        const fData = hc.getHeroFashionData(fid, false);
                                        if (fData && fData.base_id) {
                                            return origCreatSpineByBaseId.call(this, fData.base_id, viewBelong);
                                        }
                                    }
                                }
                            } catch (e) { }
                        }
                        return origCreatSpineByBaseId.apply(this, arguments);
                    };
                }
            } catch (e) { }
        },

        refreshBattleMainCopySkins: function () {
            try {
                if (typeof bot.ensureHeroItemHooks === "function") {
                    bot.ensureHeroItemHooks();
                }

                const gm = window.G_Mapping || {};
                const fm = gm.FightManager || window.FightManager;
                const bfm = gm.BattleFastManager || window.BattleFastManager;
                const vm = gm.ViewManager || window.ViewManager;

                const arrayComs = new Set();

                // 1. Lấy từ FightManager.arayHeroComs
                if (fm && fm.arayHeroComs) {
                    for (let k in fm.arayHeroComs) {
                        if (fm.arayHeroComs[k]) arrayComs.add(fm.arayHeroComs[k]);
                    }
                }

                // 2. Lấy từ BattleFastManager
                if (bfm) {
                    if (bfm.bindView && bfm.bindView.arrayHeroCom) arrayComs.add(bfm.bindView.arrayHeroCom);
                    if (bfm.bindViewClass && bfm.bindViewClass.arrayHeroCom) arrayComs.add(bfm.bindViewClass.arrayHeroCom);
                }

                // 3. Lấy từ ViewManager._openingViews & _residentViews
                if (vm) {
                    if (vm._openingViews) {
                        for (let k in vm._openingViews) {
                            const v = vm._openingViews[k];
                            if (v && v.arrayHeroCom) arrayComs.add(v.arrayHeroCom);
                        }
                    }
                    if (vm._residentViews) {
                        for (let k in vm._residentViews) {
                            const v = vm._residentViews[k];
                            if (v && v.arrayHeroCom) arrayComs.add(v.arrayHeroCom);
                        }
                    }
                }

                const applyToHeroItem = (heroItem) => {
                    if (!heroItem || !heroItem.baseData || typeof heroItem.restHeroSpine !== "function") return;
                    const bd = heroItem.baseData;
                    const isPlayer = (bd._pos !== 2 && bd._camp !== 2);
                    if (!isPlayer || !bd._hero_id) return;

                    if (bot.state.mod_skin !== false) {
                        const customFid = bot.settings.hero_skins && (bot.settings.hero_skins[bd._hero_id] || bot.settings.hero_skins[String(bd._hero_id)]);
                        const fid = customFid || bot.getBestFashionIdForHero(bd._hero_id);
                        if (fid) {
                            const curFid = (bd._fashion && bd._fashion[0] && bd._fashion[0]._fashion_id);
                            if (curFid === fid && heroItem.lastHaveSkin === true && heroItem.skeletonNode) {
                                return; // Đang mang đúng skin rồi, không cần load lại
                            }
                            bd._fashion = [{ _fashion_id: fid, _val: fid }];
                            heroItem.lastHaveSkin = true;
                            heroItem.restHeroSpine(bd, function () {
                                try {
                                    if (heroItem.battleState && heroItem.skeletonNode) {
                                        heroItem.battleState.skeletonNode = heroItem.skeletonNode;
                                    }
                                    if (typeof heroItem.toStand === "function") {
                                        heroItem.toStand();
                                    }
                                } catch (err) { }
                            });
                        }
                    } else {
                        if (heroItem.lastHaveSkin) {
                            bd._fashion = [];
                            heroItem.lastHaveSkin = false;
                            heroItem.restHeroSpine(bd, null);
                        }
                    }
                };

                for (let com of arrayComs) {
                    if (!com) continue;
                    if (typeof com.getHeroItemById === "function") {
                        for (let idx = 0; idx <= 10; idx++) {
                            try { applyToHeroItem(com.getHeroItemById(1, idx)); } catch (e) { }
                        }
                    }
                    if (typeof com.getLifeHero === "function") {
                        try {
                            const life = com.getLifeHero(1);
                            if (life) {
                                for (let k in life) applyToHeroItem(life[k]);
                            }
                        } catch (e) { }
                    }
                    if (com.anyBatteList && com.anyBatteList[1]) {
                        try {
                            for (let pos in com.anyBatteList[1]) {
                                applyToHeroItem(com.anyBatteList[1][pos]);
                            }
                        } catch (e) { }
                    }
                }
            } catch (e) { }
        },

        applyModCosmetics: function () {
            try {
                const gm = window.G_Mapping || {};
                const mm = window.ModelManager;
                const pm = (gm && gm.PlayerModel) || (mm && mm.PlayerModel);
                const pmInst = pm && (pm.prototype ? (mm && mm.PlayerModel) : pm);
                if (!pmInst || !pmInst.getRoleInfo) return;
                const ri = pmInst.getRoleInfo();
                if (!ri || !ri.attrList) return;

                if (bot.settings.mod_headframe && typeof pmInst.setRoleTitle === "function") {
                    if (ri.getHeadFrame && ri.getHeadFrame() !== bot.settings.mod_headframe) {
                        pmInst.setRoleTitle(bot.settings.mod_headframe);
                    }
                }
                if (bot.settings.mod_title && typeof pmInst.setRoleTitle === "function") {
                    if (ri.getTitle && ri.getTitle() !== bot.settings.mod_title) {
                        pmInst.setRoleTitle(bot.settings.mod_title);
                    }
                }
                if (bot.settings.mod_avatar && typeof pmInst.setRoleIcon === "function") {
                    if (ri.getHead && ri.getHead() !== bot.settings.mod_avatar) {
                        pmInst.setRoleIcon(bot.settings.mod_avatar);
                    }
                }
            } catch (e) { }
        },

        formatNumber: function (num) {
            if (num == null) return "0";
            try { return Number(num).toLocaleString(); } catch (e) { return String(num); }
        },

        getCandidatePower: function (roleObj) {
            if (!roleObj) return 0;
            try {
                if (typeof roleObj.getPower === "function") return Number(roleObj.getPower()) || 0;
                if (roleObj.attrList && roleObj.attrList[105]) return Number(roleObj.attrList[105]) || 0;
                if (Array.isArray(roleObj._p_64)) {
                    for (let item of roleObj._p_64) {
                        if (item && item._key === 105) return Number(item._val) || 0;
                    }
                }
                if (Array.isArray(roleObj._p_32)) {
                    for (let item of roleObj._p_32) {
                        if (item && item._key === 105) return Number(item._val) || 0;
                    }
                }
                if (roleObj._power) return Number(roleObj._power) || 0;
            } catch (e) { }
            return 0;
        },

        getCandidateRid: function (roleObj) {
            if (!roleObj) return 0;
            try {
                if (typeof roleObj.getRoleId === "function") return Number(roleObj.getRoleId()) || 0;
                if (roleObj._rid) return Number(roleObj._rid) || 0;
                if (roleObj._roleId) return Number(roleObj._roleId) || 0;
                if (roleObj.attrList && roleObj.attrList[101]) return Number(roleObj.attrList[101]) || 0;
            } catch (e) { }
            return 0;
        },

        getCandidateName: function (roleObj) {
            if (!roleObj) return "";
            try {
                if (typeof roleObj.getName === "function") return String(roleObj.getName());
                if (roleObj.attrList && roleObj.attrList[102]) return String(roleObj.attrList[102]);
                if (Array.isArray(roleObj._p_str)) {
                    for (let item of roleObj._p_str) {
                        if (item && item._key === 102) return String(item._val);
                    }
                }
                if (roleObj._name) return String(roleObj._name);
            } catch (e) { }
            return "";
        },

        isReady: function () {
            try {
                if (bot.state.kickedByOtherDevice) return false;
                const vm = bot.getViewManager();
                if (!vm) return false;
                if (vm.getView && vm.getView("LoginView")) {
                    const lv = vm.getView("LoginView");
                    if (lv && (lv.visible !== false && (!lv.node || lv.node.active !== false))) {
                        return false;
                    }
                }
                if (vm.isOpenView && vm.isOpenView("LoginView")) return false;
                if (vm.getView && (vm.getView("MainUIView") || vm.getView("MainUI_2025View"))) {
                    bot.state.hasLoggedInOnce = true;
                    return true;
                }
                if (vm.isOpenView && (vm.isOpenView("MainUIView") || vm.isOpenView("MainUI_2025View"))) {
                    bot.state.hasLoggedInOnce = true;
                    return true;
                }
            } catch (e) { }
            return false;
        },

        triggerEmergencyYield: function (reason) {
            if (bot.state.kickedByOtherDevice) return;
            bot.state.kickedByOtherDevice = true;
            window.__BOT_HARD_STOPPED__ = true;
            bot.log("📱 [Nhường Máy] Phát hiện tài khoản đăng nhập từ Điện thoại/PC khác (" + (reason || "Kick") + ")! Cắt mạng & dừng hoạt động ngay...");

            // 1. Dừng mọi vòng lặp và scheduler
            try { bot.stopScheduleLoop(); } catch (e) { }
            if (window.__AUTO_RESCUE_INTERVAL__) {
                try { clearInterval(window.__AUTO_RESCUE_INTERVAL__); } catch (e) { }
                window.__AUTO_RESCUE_INTERVAL__ = null;
            }
            if (window.__QA_PENDING_MAIN_START__) {
                try { clearTimeout(window.__QA_PENDING_MAIN_START__); } catch (e) { }
                window.__QA_PENDING_MAIN_START__ = null;
            }

            // 2. Cắt đứt kết nối mạng ngay lập tức để giải phóng hoàn toàn socket máy chủ cho điện thoại
            try {
                const gm = window.G_Mapping;
                const nw = (gm && gm.NetWork && gm.NetWork.Ins) || (window.NetWork && window.NetWork.Ins);
                if (nw) {
                    nw.isManualClose = true;
                    nw._isCanReconnect = false;
                    nw.isReconnecting = false;
                    if (nw.heartBeat && typeof nw.heartBeat.stop === 'function') nw.heartBeat.stop();
                    if (nw.socket && typeof nw.socket.close === 'function') nw.socket.close();
                    if (nw._wsClient && typeof nw._wsClient.close === 'function') nw._wsClient.close();
                }
            } catch (e) { }

            // 3. Gửi callback khẩn cấp ra runner.js để đóng cửa sổ Chromium lập tức (<50ms)
            if (typeof window.pyOnBotLog === 'function') {
                try {
                    window.pyOnBotLog({
                        kickNow: true,
                        time: new Date().toLocaleTimeString(),
                        msg: "📱 [Nhường Máy] Khẩn cấp: Đóng browser ngay lập tức (" + (reason || "kick") + ")"
                    });
                } catch (e) { }
            }
        },

        scheduleSafeReconnect: function (nw, reason, delayMs) {
            try {
                if (bot.state.kickedByOtherDevice || window.__BOT_HARD_STOPPED__) return false;
                const gm = window.G_Mapping;
                const net = nw || (gm && gm.NetWork && gm.NetWork.Ins) || (window.NetWork && window.NetWork.Ins);
                if (!net || !bot.state.hasLoggedInOnce) return false;

                const isWsConnected = !!(net._wsClient && typeof net._wsClient.isConnected === "function" && net._wsClient.isConnected());
                if (isWsConnected) return false;

                const isWsConnecting = !!(net._wsClient && typeof net._wsClient.isConnecting === "function" && net._wsClient.isConnecting());
                const now = Date.now();
                if (bot.state._reconnectPending) return false;
                // Nếu socket đang trong quá trình bắt tay (isConnecting) hoặc vừa mới gọi reconnect trong 6.5s qua -> tuyệt đối không ngắt ngang!
                if (now - (bot.state._lastReconnectAttemptTime || 0) < 6500) return false;
                if (isWsConnecting && now - (bot.state._lastReconnectAttemptTime || 0) < 10000) return false;

                bot.state._reconnectPending = true;
                const waitMs = Math.max(1200, Number(delayMs) || 1800);
                setTimeout(() => {
                    bot.state._reconnectPending = false;
                    if (bot.state.kickedByOtherDevice || window.__BOT_HARD_STOPPED__) return;
                    try {
                        const stillConnected = !!(net._wsClient && typeof net._wsClient.isConnected === "function" && net._wsClient.isConnected());
                        if (stillConnected) return;
                        const stillConnecting = !!(net._wsClient && typeof net._wsClient.isConnecting === "function" && net._wsClient.isConnecting());
                        if (stillConnecting && Date.now() - (bot.state._lastReconnectAttemptTime || 0) < 10000) return;

                        bot.state._lastReconnectAttemptTime = Date.now();
                        net._isCanReconnect = true;
                        net.isManualClose = false;
                        net.isError = false;
                        net._reconnectCount = 0;
                        // Bắt buộc đưa isReconnecting = false trước khi gọi net.reconnect() vì net.reconnect() sẽ bỏ qua nếu isReconnecting đang true!
                        net.isReconnecting = false;

                        if (net._needFullRelogin) {
                            bot.log(`🛡️ [Anti-Kick] Đang tái xác thực phiên đăng nhập ngầm (${reason || "relogin"})...`);
                        } else {
                            bot.log(`🛡️ [Anti-Kick] Đang tự động kết nối lại WebSocket ngầm (${reason || "reconnect"})...`);
                        }
                        if (typeof net.reconnect === "function") {
                            net.reconnect();
                            try { net.setShowLoading(false); } catch (e) { }
                        } else if (typeof net.connect === "function") {
                            net.connect();
                            try { net.setShowLoading(false); } catch (e) { }
                        }
                    } catch (e) { }
                }, waitMs);
                return true;
            } catch (e) { }
            return false;
        },

        handleStageDefeat: function (forcedStage, forcedNth) {
            try {
                const mm = window.ModelManager;
                const prog = mm && mm.MainUIModel && (mm.MainUIModel.getMainCopyProgress ? mm.MainUIModel.getMainCopyProgress() : mm.MainUIModel.mainCopyProgress);
                const curStage = forcedStage || (prog ? prog._id : (bot.stats.stage || 0));
                const curNth = forcedNth || (prog ? (prog._nth || 1) : 1);
                bot.state.stageFailCount = (bot.state.stageFailCount || 0) + 1;
                bot.state.lastStageFailTime = Date.now();
                bot.state.lastStageFailPower = bot.stats.power || 0;
                bot.state.lastStageFailStage = curStage;
                const pStr = (bot.stats.power && bot.stats.power.toLocaleString) ? bot.stats.power.toLocaleString() : bot.stats.power;
                const maxRetries = 10;
                if (bot.state.stageFailCount < maxRetries) {
                    bot.log(`⚔️ Vượt Ải [${curStage}]: Chưa thắng Boss (Lần ${bot.state.stageFailCount}/${maxRetries}). Tự động thử lại câu bạo kích/RNG sau 3.8s...`);
                } else {
                    bot.log(`🛑 [Defeat Guard] Lực chiến [${pStr}] chưa đủ vượt Boss Ải [${curStage}] (Đợt ${curNth}) sau ${maxRetries} lần thử. Tạm dừng khiêu chiến 60s (hoặc đến khi tăng lực chiến)!`);
                }
            } catch (e) { }
        },

        // Watchdog kẹt Ải chính tuyến: nếu trạng thái trận treo ở "chờ đóng trận"(3) / "chờ dữ liệu trận"(4)
        // quá 20s -> chạy đúng quy trình khôi phục gốc của game (giống evt_LoginReconnectSc): đóng trận treo + kéo trận mới.
        checkMainCopyStall: function () {
            try {
                if (!bot.isAutoStageOn()) {
                    bot.state._mcStallSince = 0;
                    return;
                }
                const gm = window.G_Mapping || {};
                const bfm = gm.BattleFastManager || window.BattleFastManager;
                if (!bfm) return;
                const st = bfm.batteStatus;
                const now = Date.now();
                if (st !== 3 && st !== 4) {
                    bot.state._mcStallSince = 0;
                    return;
                }
                if (!bot.state._mcStallSince || bot.state._mcStallStatus !== st) {
                    bot.state._mcStallSince = now;
                    bot.state._mcStallStatus = st;
                    return;
                }
                if (now - bot.state._mcStallSince < 20000) return;
                if (!bot.tryDo("main_copy_stall_fix", 30)) return;
                const vm = bot.getViewManager();
                const mainUI = vm && vm.getView && (vm.getView("MainUI_2025View") || vm.getView("MainUIView"));
                const bView = mainUI && mainUI.ctlView && (mainUI.ctlView["BattleMainCopyView"] || (mainUI.loadBatteViewName && mainUI.ctlView[mainUI.loadBatteViewName]));
                const mm = window.ModelManager;
                const prog = mm && mm.MainUIModel && mm.MainUIModel.getMainCopyProgress ? mm.MainUIModel.getMainCopyProgress() : null;
                const hang = mm && mm.BattleModel && mm.BattleModel.getHangupBattleInfo ? mm.BattleModel.getHangupBattleInfo() : null;
                const fm = bot.getFightManager ? bot.getFightManager() : null;
                if (!bView || !prog || typeof bView.pullBatteData !== "function") return;
                bot.log(`🔧 [Vượt Ải] Trận chính tuyến bị treo (trạng thái ${st === 3 ? "chờ đóng trận" : "chờ dữ liệu trận"}) > 20s -> Khôi phục theo quy trình gốc của game...`);
                if (hang && hang._id && fm && typeof fm.requestMainCopyWarClose === "function") {
                    bView.newBattleData = hang;
                    fm.requestMainCopyWarClose(hang._id);
                }
                bView.pullBatteData(prog);
                bot.state._mcStallSince = now;
            } catch (e) { }
        },

        _cachedViewManager: null,

        getViewManager: function () {
            if (bot._cachedViewManager) return bot._cachedViewManager;
            try {
                if (window.ViewManager) return (bot._cachedViewManager = window.ViewManager);
                const gm = window.G_Mapping;
                if (gm && gm.ViewManager) return (bot._cachedViewManager = gm.ViewManager);
                if (typeof ViewManager !== "undefined") return (bot._cachedViewManager = ViewManager);
                if (typeof window.__require === "function") {
                    const m = window.__require("ViewManager");
                    if (m) {
                        const res = m.ViewManager || m;
                        if (res && res.open) return (bot._cachedViewManager = res);
                    }
                }
            } catch (e) { }
            return null;
        },

        isViewVisible: function (v) {
            if (!v) return false;
            try {
                if (typeof v.isShowing === "function") return v.isShowing();
                if (typeof v.isShowing === "boolean") return v.isShowing;
                if (v.isOpen === true) return true;
                if (v.view) {
                    if (v.view.visible === false) return false;
                    if (typeof v.view.onStage !== "undefined") return !!v.view.onStage;
                    return true;
                }
            } catch (e) { }
            return false;
        },

        lastBattleData: null,

        openLastBattleData: function () {
            try {
                const vm = bot.getViewManager();
                const bData = bot.lastBattleData || (window.ModelManager && window.ModelManager.BattleModel && window.ModelManager.BattleModel.getHangupBattleInfo());
                if (vm && bData) {
                    bot.log("📊 Đang mở bảng thống kê dữ liệu thông số trận vừa đánh (BattledataView)...");
                    vm.open("BattledataView", bData);
                } else {
                    bot.log("⚠️ Chưa có dữ liệu trận đấu gần nhất để hiển thị.");
                }
            } catch (e) {
                console.error("[openLastBattleData Error]", e);
            }
        },

        closeBattleViews: function () {
            try {
                const vm = bot.getViewManager();
                if (!vm) return;
                // 1. Tuyệt đối KHÔNG đóng bất kỳ cửa sổ nào nếu người chơi đang mở xem thống kê thông số trận đấu
                if (bot.state.viewingBattleData) return;
                if (typeof vm.isOpenView === "function" && (vm.isOpenView("BattledataView") || vm.isOpenView("PanelBattleData"))) {
                    return;
                }
                // 2. Tuyệt đối KHÔNG tự động đóng BattleResultView nếu người chơi đang mở giao diện Tháp (ClimbtowerView)
                if (typeof vm.isOpenView === "function" && vm.isOpenView("ClimbtowerView")) {
                    return;
                }
                if (typeof vm.isOpenView === "function" && vm.isOpenView("BattleResultView")) {
                    const brv = typeof vm.getView === "function" ? vm.getView("BattleResultView") : null;
                    if (brv) {
                        const bType = (brv.battleData && brv.battleData._type) || (brv._args && brv._args.battleData && brv._args.battleData._type) || (brv._args && brv._args.arrayType) || 0;
                        // Tự động dập tắt ngay lập tức nếu là trận Giải Cứu Gia Viên (Revolt = 106 / CityFight = 105) kể cả khi tắt auto_stage
                        if (Number(bType) === 106 || Number(bType) === 105) {
                            try {
                                if (brv.view) { brv.view.visible = false; brv.view.alpha = 0; }
                                if (brv.node) brv.node.active = false;
                            } catch (eHide) { }
                            if (brv._curPageClass && typeof brv._curPageClass.okClick === "function") {
                                brv._curPageClass.okClick();
                            } else if (typeof brv.closeView === "function") {
                                brv.closeView();
                            }
                            return;
                        }
                    }
                }
                // 3. Tuyệt đối KHÔNG tự động đóng BattleResultView nếu người chơi đang thao tác thủ công (không bật auto chạy ngầm)
                if (!bot.isAutoStageOn() && !bot.state.isAutoTowerActive) {
                    return;
                }
                if (typeof vm.isOpenView === "function" && vm.isOpenView("BattleResultView")) {
                    const brv = typeof vm.getView === "function" ? vm.getView("BattleResultView") : null;
                    if (brv) {
                        const bType = (brv.battleData && brv.battleData._type) || (brv._args && brv._args.battleData && brv._args.battleData._type) || (brv._args && brv._args.arrayType) || 0;
                        // Không đóng các trận cần xem kết quả hoặc không skip native: Boss (4, 6, 10), Tần Lĩnh (9), Tháp (2, 12..16 khi người chơi mở giao diện)
                        const isBossOrDefJz = bType === 9 || bType === 4 || bType === 6 || bType === 10 || bType === 103 || bType === 104 || !canNativeSkipBattle(bType);
                        if (isBossOrDefJz) return;
                        // Nếu là trận Tháp (2 hoặc 12..16) và người chơi đang trên màn hình Tháp -> Giữ nguyên để xem data
                        if ((bType === 2 || (bType >= 12 && bType <= 16)) && vm.isOpenView("ClimbtowerView")) return;

                        if (brv._curPageClass && typeof brv._curPageClass.okClick === "function") {
                            brv._curPageClass.okClick();
                        } else if (typeof brv.closeView === "function") {
                            brv.closeView();
                        }
                    } else if (vm.close) {
                        vm.close("BattleResultView");
                    }
                }
                // Tuyệt đối không đóng BattleBeginView ở đây để các trận Boss, Tần Lĩnh, v.v. diễn ra bình thường
            } catch (e) { }
        },

        _cachedModelManager: null,

        getModelManager: function () {
            if (bot._cachedModelManager) return bot._cachedModelManager;
            try {
                if (window.ModelManager) return (bot._cachedModelManager = window.ModelManager);
                const gm = window.G_Mapping;
                if (gm && gm.ModelManager) return (bot._cachedModelManager = gm.ModelManager);
                if (typeof ModelManager !== "undefined") return (bot._cachedModelManager = ModelManager);
                if (typeof window.__require === "function") {
                    const m = window.__require("ModelManager");
                    if (m) {
                        const res = m.ModelManager || m.default || m;
                        if (res) {
                            window.ModelManager = res;
                            return (bot._cachedModelManager = res);
                        }
                    }
                }
            } catch (e) { }
            return null;
        },

        _cachedFightManager: null,

        getFightManager: function () {
            if (bot._cachedFightManager) return bot._cachedFightManager;
            try {
                if (window.FightManager) return (bot._cachedFightManager = window.FightManager);
                const gm = window.G_Mapping;
                if (gm && gm.FightManager) return (bot._cachedFightManager = gm.FightManager);
                if (typeof window.__require === "function") {
                    const m = window.__require("FightManager");
                    if (m) return (bot._cachedFightManager = (m.FightManager || m));
                }
            } catch (e) { }
            return null;
        },

        _cachedRedManager: null,

        getRedManager: function () {
            if (bot._cachedRedManager) return bot._cachedRedManager;
            try {
                if (window.RedManager) return (bot._cachedRedManager = window.RedManager);
                const gm = window.G_Mapping;
                if (gm && gm.RedManager) return (bot._cachedRedManager = gm.RedManager);
                if (typeof RedManager !== "undefined") return (bot._cachedRedManager = RedManager);
                if (typeof window.__require === "function") {
                    const m = window.__require("RedManager");
                    if (m) {
                        const res = m.RedManager || m;
                        if (res && res.getTips) return (bot._cachedRedManager = res);
                    }
                }
            } catch (e) { }
            return null;
        },

        // Chống "Thao tác quá nhanh": Kiểm tra xem game có trận đấu nào chưa kết thúc không
        isBattling: function (type) {
            try {
                const now = Date.now();
                const vm = bot.getViewManager();
                const isBattleViewOpen = !!(vm && typeof vm.isOpenView === "function" && (vm.isOpenView("BattleBeginView") || vm.isOpenView("BatteJingzhouView")));

                // Tự động giải phóng các cờ trạng thái bị treo nếu giao diện trận đấu đã đóng
                if (bot.state.defjzInProgress && !isBattleViewOpen && now - (bot.state.lastDefJzActionTime || 0) > 5000) {
                    bot.state.defjzInProgress = false;
                }
                if (bot.state.towerInProgress && !isBattleViewOpen && now - (bot.state.lastTowerActionTime || 0) > 8000) {
                    bot.state.towerInProgress = false;
                }
                if (bot.state.battleInProgress && !bot.state.rescueFightActive && !isBattleViewOpen && now - (bot.state.lastBattleStartTime || 0) > 10000) {
                    bot.state.battleInProgress = false;
                }

                if (bot.state.battleInProgress || bot.state.towerInProgress || bot.state.defjzInProgress) return true;
                if (now - (bot.state.lastBattleEndTime || 0) < 1200) return true;

                if (isBattleViewOpen) return true;

                // Nếu BattleBeginView / BatteJingzhouView đều đã đóng, dọn dẹp tham chiếu BattleSecnesView cũ để không chặn nhầm
                if (window.__CURRENT_BATTLE_SCENES_VIEW__) {
                    window.__CURRENT_BATTLE_SCENES_VIEW__ = null;
                }

                const fm = bot.getFightManager();
                if (fm && type !== undefined && typeof fm.haveFight === "function") {
                    return fm.haveFight(type);
                }
            } catch (e) { }
            return false;
        },

        doBattleSkip: function (battleSecnesView) {
            const self = battleSecnesView || window.__CURRENT_BATTLE_SCENES_VIEW__;
            if (!self || !self.view) return false;
            try {
                const aType = (self._args && self._args.arrayType) || 0;
                const gm = window.G_Mapping;
                const disp = (gm && gm.Dispatcher) || window.Dispatcher;
                const evType = (gm && gm.EventType) || window.EventType;
                const fm = bot.getFightManager();

                if (!self.fightDate && fm && typeof fm.getFightState === "function") {
                    self.fightDate = fm.getFightState(aType);
                }
                const fd = self.fightDate;
                if (fd) {
                    if (!fd.battleData && self.battleData) fd.battleData = self.battleData;
                    if (!fd._args && self._args) fd._args = self._args;
                    if (fd.battleData && fd.battleData._id) {
                        window.__LAST_WAR_ID__ = fd.battleData._id;
                    }
                }

                // Luôn mở trạng thái normal cho quickEnd để có thể click / skip
                if (self.quickEndState && typeof self.quickEndState.setSelectedPage === "function") {
                    try { self.quickEndState.setSelectedPage("normal"); } catch (e) { }
                }
                if (self.quickEnd) {
                    try { self.quickEnd.setVisible(true); } catch (e) { }
                }

                if (self.checkSkip) {
                    try {
                        const res = self.checkSkip();
                        if (res && res[1] === false && !self._args?.isRecord) {
                            if (self.quickEndState) self.quickEndState.setSelectedPage("normal");
                            if (self.quickEnd) self.quickEnd.setTouchable(true);
                        }
                    } catch (e) {
                        if (self.quickEndState) self.quickEndState.setSelectedPage("normal");
                        if (self.quickEnd) self.quickEnd.setTouchable(true);
                    }
                }

                // Với DefJz (9) và Yyzq (17), game gốc KHÔNG gọi changeSkip(true) vì sẽ đổi state sang 'lock'
                // mà chỉ setTouchable(false)
                if (aType === 9 || aType === 17) {
                    if (self.quickEnd && typeof self.quickEnd.setTouchable === "function") {
                        try { self.quickEnd.setTouchable(false); } catch (e) { }
                    }
                } else {
                    if (self.changeSkip) {
                        try { self.changeSkip(true); } catch (e) { }
                    }
                    if (self.quickEnd && typeof self.quickEnd.setTouchable === "function") {
                        try { self.quickEnd.setTouchable(true); } catch (e) { }
                    }
                }

                const warId = (fd && fd.battleData && fd.battleData._id) || (self.battleData && self.battleData._id);
                window.__LAST_OTHER_WAR_TIME__ = Date.now();
                bot.state.lastBattleEndTime = Date.now() + 2500;
                bot.log(`⚔️ [Skip-Battle] Bỏ qua trận đấu (Type: ${aType || "unknown"}, WarID: ${warId || "unknown"})`);

                if (disp && evType && evType.battle_Next && fd) {
                    disp.dispatchEvent(evType.battle_Next, fd);
                    return true;
                }
            } catch (eSkip) {
                console.warn("[doBattleSkip error]", eSkip);
            }
            return false;
        },

        checkBattleWatchdog: function () {
            try {
                if (bot.isDisconnected() || !bot.isReady()) return;

                // 1. Tìm instance BattleSecnesView đang active trên màn hình
                let bsv = window.__CURRENT_BATTLE_SCENES_VIEW__;
                if (!bsv || !bsv.view || !bsv.view.parent || bsv.view.visible === false) {
                    const jzView = window.__CURRENT_BATTLE_JZ_VIEW__;
                    if (jzView && jzView.ctlView && jzView.ctlView.BattleSecnesView) {
                        bsv = jzView.ctlView.BattleSecnesView;
                    }
                }

                // Nếu không có trận đấu nào đang hiển thị trên foreground
                if (!bsv || !bsv.view || !bsv.view.parent || bsv.view.visible === false) {
                    bot.state.battleStuckTimer = 0;
                    bot.state.lastWatchdogWarId = null;
                    return;
                }

                const fm = bot.getFightManager();
                const fd = bsv.fightDate || (fm && fm.getFightState && fm.getFightState(bsv._args && bsv._args.arrayType));
                const aType = (bsv._args && bsv._args.arrayType) || (fd && fd.battleData && fd.battleData._type) || 0;
                const warId = (fd && fd.battleData && fd.battleData._id) || (bsv.battleData && bsv.battleData._id);

                // 2. Tự Động Kích Hoạt Tốc Độ x3
                try {
                    const mm = window.ModelManager;
                    if (mm && mm.BattleModel && typeof mm.BattleModel.changeSpeedIndex === "function") {
                        const curSpeed = mm.BattleModel.getGameSpeed ? mm.BattleModel.getGameSpeed() : 1;
                        if (curSpeed < 3) {
                            mm.BattleModel.changeSpeedIndex(3, true);
                            if (typeof bsv.setSpeedBtnState === "function") bsv.setSpeedBtnState(3);
                        }
                    }
                } catch (eSpd) { }

                // 3. Tự Động Bỏ Qua Trận Đấu nếu bật skip_battle
                if (bot.settings.skip_battle) {
                    if (bsv.quickEndState && typeof bsv.quickEndState.setSelectedPage === "function") {
                        try { bsv.quickEndState.setSelectedPage("normal"); } catch (e) { }
                    }
                    if (bsv.quickEnd) {
                        try { bsv.quickEnd.setVisible(true); } catch (e) { }
                        try { bsv.quickEnd.setTouchable(true); } catch (e) { }
                    }

                    if (bot.canDo("auto_battle_watchdog_skip", 1.2)) {
                        bot.markDone("auto_battle_watchdog_skip");
                        bot.doBattleSkip(bsv);
                    }
                }

                // 4. Cơ chế chống kẹt / Watchdog Timeout cho trận đấu (đặc biệt là Tần Lĩnh Bí Cảnh aType === 9)
                const now = Date.now();
                if (warId && warId === bot.state.lastWatchdogWarId) {
                    const stuckDuration = (now - (bot.state.watchdogWarStartTime || now)) / 1000;

                    // Nếu kẹt trên 8 giây: Thử re-skip khẩn cấp
                    if (stuckDuration >= 8 && bot.canDo("battle_rescue_reskip", 3)) {
                        bot.markDone("battle_rescue_reskip");
                        bot.log(`⚠️ [Battle-Watchdog] Trận đấu ${warId} (Type: ${aType}) đứng im > ${stuckDuration.toFixed(0)}s -> Kích hoạt bỏ qua khẩn cấp...`);
                        bot.doBattleSkip(bsv);
                    }

                    // Nếu kẹt trên 18 giây: Giải cứu thoát trận an toàn
                    if (stuckDuration >= 18 && bot.canDo("battle_rescue_force_exit", 10)) {
                        bot.markDone("battle_rescue_force_exit");
                        bot.log(`🚨 [Battle-Watchdog] Trận đấu ${warId} (Type: ${aType}) bị kẹt > 18s -> Đang kích hoạt giải cứu trở về...`);
                        if (aType === 9) {
                            // Tần Lĩnh: Dùng giao thức WarGiveUpCs / requestQuitJob chính thức của game
                            const mm = window.ModelManager;
                            const djm = mm && mm.DefJzModel;
                            if (djm && typeof djm.requestQuitJob === "function" && warId) {
                                djm.requestQuitJob(warId);
                            }
                            const gm = window.G_Mapping;
                            const disp = (gm && gm.Dispatcher) || window.Dispatcher;
                            const evType = (gm && gm.EventType) || window.EventType;
                            if (disp && evType) {
                                if (evType.battle_Lock_play) disp.dispatchEvent(evType.battle_Lock_play, { lockNext: false });
                                if (evType.battle_end && fd) {
                                    const argsInfo = (typeof fd.getArgsInfo === "function") ? fd.getArgsInfo() : fd;
                                    if (argsInfo && argsInfo.battleData) argsInfo.battleData._winner = 2;
                                    disp.dispatchEvent(evType.battle_end, argsInfo);
                                }
                            }
                            bot.state.lastWatchdogWarId = null;
                            bot.state.watchdogWarStartTime = 0;
                        } else {
                            bot.rescueUnsettledBattle(`Trận ${warId} (Type ${aType}) kẹt > 18s`);
                        }
                    }
                } else {
                    bot.state.lastWatchdogWarId = warId;
                    bot.state.watchdogWarStartTime = now;
                }
            } catch (eWatch) {
                console.warn("[checkBattleWatchdog error]", eWatch);
            }
        },

        rescueUnsettledBattle: function (reason) {
            try {
                bot.log(`🛡️ [Auto-Rescue] Phát hiện lỗi: "${reason || 'Trận đấu chưa tổng kết'}" -> Đang tự động giải cứu và đồng bộ server...`);
                const gm = window.G_Mapping;
                const fm = bot.getFightManager();
                let rescued = false;

                if (fm && fm.fightList) {
                    for (const k in fm.fightList) {
                        const f = fm.fightList[k];
                        const warId = (f && f.battleData && f.battleData._id) || (f && f._args && f._args.battleData && f._args.battleData._id);
                        if (warId) {
                            if (fm.closeWarId) delete fm.closeWarId[warId];
                            if (typeof fm.requestWarClose === "function") {
                                fm.requestWarClose(warId);
                            }
                            bot.log(`🛡️ [Auto-Rescue] Đã gửi khẩn cấp WarCloseCs cho warId: ${warId} (Type: ${k})`);
                            rescued = true;
                        }
                    }
                }

                if (!rescued) {
                    const warId = window.__LAST_WAR_ID__ || (bot.lastBattleData && bot.lastBattleData._id);
                    if (warId) {
                        if (fm && fm.closeWarId) delete fm.closeWarId[warId];
                        if (fm && typeof fm.requestWarClose === "function") {
                            fm.requestWarClose(warId);
                        } else if (gm && gm.RPCReq && gm.WarCloseCs) {
                            gm.RPCReq.send(gm.WarCloseCs.protocol, { _war_id: warId });
                        }
                        bot.log(`🛡️ [Auto-Rescue] Đã gửi khẩn cấp WarCloseCs cho lastWarId: ${warId}`);
                        rescued = true;
                    }
                }

                if (fm && fm.copyRequstStatus) {
                    for (const k in fm.copyRequstStatus) {
                        delete fm.copyRequstStatus[k];
                    }
                }
                const bfm = window.BatteFastManager || (gm && gm.BatteFastManager);
                if (bfm) bfm.batteStatus = 0;

                const mm = bot.getModelManager();
                if (mm && mm.DefJzModel && typeof mm.DefJzModel.requestDefJzInfo === "function") {
                    setTimeout(() => {
                        try { mm.DefJzModel.requestDefJzInfo(); } catch (e) { }
                    }, 300);
                }
            } catch (eRescue) {
                console.warn("[rescueUnsettledBattle error]", eRescue);
            }
        },

        canDo: function (key, cooldownSec) {
            const now = Date.now();
            const last = bot.state.cooldowns[key] || 0;
            return (now - last) >= (cooldownSec * 1000);
        },

        markDone: function (key) {
            bot.state.cooldowns[key] = Date.now();
        },

        // Kiểm tra cooldown và đánh dấu luôn (tránh quên markDone gây spam request)
        tryDo: function (key, cooldownSec) {
            if (!bot.canDo(key, cooldownSec)) return false;
            bot.markDone(key);
            return true;
        },

        sleep: function (ms) {
            return new Promise(function (resolve) { setTimeout(resolve, ms); });
        },

        log: function (msg, data) {
            const timeStr = new Date().toLocaleTimeString();
            const logEntry = { time: timeStr, msg: msg, data: data || null };
            bot.logs.push(logEntry);
            if (bot.logs.length > 200) bot.logs.shift();
            if (typeof window !== "undefined" && window.__UPDATE_HUD_LOG__) { window.__UPDATE_HUD_LOG__(logEntry); }
            console.log(`[AutoBot ${timeStr}] ${msg}`, data ? JSON.stringify(data) : "");
            if (window.pyOnBotLog) {
                try { window.pyOnBotLog(logEntry); } catch (e) { }
            }
        },

        showToast: function (msg) {
            try {
                const gm = window.G_Mapping;
                const rt = (gm && gm.RollTips) || window.RollTips;
                if (rt && typeof rt.show === "function") {
                    rt.show(msg);
                }
                if (typeof window !== "undefined" && window.ModernQAUI && typeof window.ModernQAUI.showToast === "function") {
                    window.ModernQAUI.showToast(msg);
                }
            } catch (e) { }
        },

        notifyNativeStatus: function (status, stats, error) {
            try {
                if (typeof window !== "undefined" && window.__UPDATE_HUD__) {
                    window.__UPDATE_HUD__(bot);
                }
            } catch (e) { }
        },

        hasRed: function (key) {
            try {
                const rm = bot.getRedManager();
                if (rm) {
                    if (typeof rm.getTips === "function" && rm.getTips(key)) return true;
                    if (typeof rm.getRedValue === "function" && rm.getRedValue(key)) return true;
                    if (rm._tipsValue && rm._tipsValue[key]) return true;
                }
            } catch (e) { }
            return false;
        },

        // Helper: Thực thi tác vụ an toàn
        runWithSilentRewards: async function (fn) {
            try {
                return await fn();
            } catch (e) {
                bot.log("Lỗi thực thi: " + e.toString());
            }
        },

        // Mở Khóa Đội 2 Mỏ (CrossMine Team 2 - Bypass Triệt Để Lv.75, Ngày Mở SV & Sửa Lỗi Nút Chiếm Đội 2)
        enforceMineTeam2Unlock: function () {
            try {
                const gm = window.G_Mapping;
                const mm = window.ModelManager;

                // 1. Bypass Module 164 (MineTeam2 - Mỏ Đội Hình 2) trên ModuleUtil
                let mu = (gm && gm.ModuleUtil) || window.ModuleUtil;
                if (!mu && typeof window.__require === "function") {
                    try {
                        const m = window.__require("ModuleUtil");
                        mu = m && (m.ModuleUtil || m.default || m);
                    } catch (e) { }
                }
                if (mu) {
                    if (!mu._hasOpen) mu._hasOpen = {};
                    mu._hasOpen[164] = 164;
                    if (!mu.__QA_MINE_T2_ENFORCED__) {
                        mu.__QA_MINE_T2_ENFORCED__ = true;
                        const origHas = mu.hasModuleOpen;
                        mu.hasModuleOpen = function (t) {
                            if (+t === 164) return true;
                            return origHas ? origHas.apply(this, arguments) : true;
                        };
                        const origTips = mu.getModuleOpenTips;
                        mu.getModuleOpenTips = function (t) {
                            if (+t === 164) return "";
                            return origTips ? origTips.apply(this, arguments) : "";
                        };
                    }
                }

                // 2. Chặn RollTips thông báo sai về Lv.75
                let rt = (gm && gm.RollTips) || window.RollTips;
                if (!rt && typeof window.__require === "function") {
                    try {
                        const m = window.__require("RollTips");
                        rt = m && (m.RollTips || m.default || m);
                    } catch (e) { }
                }
                if (rt && !rt.__QA_MINE_T2_SUPPRESS__) {
                    rt.__QA_MINE_T2_SUPPRESS__ = true;
                    const origRollShow = rt.show;
                    rt.show = function (msg) {
                        if (typeof msg === "string") {
                            const lower = msg.toLowerCase();
                            if (msg.includes("75") || msg.includes("Lv.75") || lower.includes("cấp 75") ||
                                lower.includes("đã nhận") || lower.includes("không xác định") ||
                                lower.includes("chưa hoàn thành") || lower.includes("nhận trùng") ||
                                msg.includes("已领取") || msg.includes("未知错误")) {
                                return;
                            }
                        }
                        return origRollShow ? origRollShow.apply(this, arguments) : null;
                    };
                }

                // Helper bảo đảm mineInfo._team luôn có dữ liệu Đội 2 tránh crash reading _power
                const ensureTeam2Data = function (mineInfo) {
                    if (!mineInfo || !Array.isArray(mineInfo._team)) return;
                    let t2 = mineInfo._team.find(t => t && t._idx === 2);
                    if (!t2) {
                        const p0 = (mineInfo._team[0] && mineInfo._team[0]._power) || 120;
                        mineInfo._team.push({
                            _idx: 2,
                            _hole: 0,
                            _room: 0,
                            _loot_time: 0,
                            _loot_score: 0,
                            _power: p0,
                            _array: []
                        });
                    }
                };

                // 3. Can thiệp trực tiếp vào instance ModelManager.CrossMineModel
                if (mm && mm.CrossMineModel) {
                    mm.CrossMineModel.getTeam2IsUnlock = function () {
                        return true;
                    };
                    if (mm.CrossMineModel.mineInfo) {
                        ensureTeam2Data(mm.CrossMineModel.mineInfo);
                    }
                }

                // 4. Can thiệp vào prototype CrossMineModel
                let cmm = (gm && gm.CrossMineModel) || (mm && mm.CrossMineModel);
                let cmmProto = cmm && (cmm.prototype || Object.getPrototypeOf(cmm));
                if (!cmmProto && typeof window.__require === "function") {
                    try {
                        const m = window.__require("CrossMineModel");
                        const cls = m && (m.CrossMineModel || m.default || m);
                        if (cls) cmmProto = cls.prototype;
                    } catch (e) { }
                }
                if (cmmProto) {
                    cmmProto.getTeam2IsUnlock = function () {
                        return true;
                    };
                    if (!cmmProto.__QA_MINE_T2_DESC_HOOKED__) {
                        cmmProto.__QA_MINE_T2_DESC_HOOKED__ = true;
                        const desc = Object.getOwnPropertyDescriptor(cmmProto, "mineInfo");
                        if (desc && desc.set) {
                            const origSet = desc.set;
                            const origGet = desc.get;
                            Object.defineProperty(cmmProto, "mineInfo", {
                                get: function () {
                                    const val = origGet ? origGet.call(this) : this._mineInfo;
                                    ensureTeam2Data(val);
                                    return val;
                                },
                                set: function (val) {
                                    ensureTeam2Data(val);
                                    return origSet.call(this, val);
                                },
                                configurable: true,
                                enumerable: true
                            });
                        }
                    }
                }

                // 5. Hook CrossMineUtil (Bypass checkCrossMineTeamCanFight cho Đội 2 & checkShowReplaceTips)
                let cmu = (gm && gm.CrossMineUtil) || window.CrossMineUtil;
                if (!cmu && typeof window.__require === "function") {
                    try {
                        const m = window.__require("CrossMineUtil");
                        cmu = m && (m.CrossMineUtil || m.default || m);
                    } catch (e) { }
                }
                if (cmu && !cmu.__QA_MINE_T2_CAN_FIGHT_HOOKED__) {
                    cmu.__QA_MINE_T2_CAN_FIGHT_HOOKED__ = true;
                    const origCanFight = cmu.checkCrossMineTeamCanFight;
                    cmu.checkCrossMineTeamCanFight = function (teamIdx) {
                        const curMm = window.ModelManager;
                        if (curMm && curMm.CrossMineModel && curMm.CrossMineModel.mineInfo) {
                            ensureTeam2Data(curMm.CrossMineModel.mineInfo);
                        }
                        if (+teamIdx === 2) {
                            const mInfo = curMm && curMm.CrossMineModel && curMm.CrossMineModel.mineInfo;
                            if (mInfo && Array.isArray(mInfo._team)) {
                                let t2 = mInfo._team.find(t => t && t._idx === 2);
                                if (t2 && t2._power <= 0) {
                                    if (typeof origCanFight === "function") return origCanFight.call(this, teamIdx);
                                }
                            }
                            return true;
                        }
                        return origCanFight ? origCanFight.apply(this, arguments) : true;
                    };
                }

                // 6. Hook HeroBagModel: Cung cấp đội hình mặc định cho Đội 2 nếu chưa xếp trận
                let hbm = (gm && gm.HeroBagModel) || (mm && mm.HeroBagModel);
                let hbmProto = hbm && (hbm.prototype || Object.getPrototypeOf(hbm));
                if (!hbmProto && typeof window.__require === "function") {
                    try {
                        const m = window.__require("HeroBagModel");
                        const cls = m && (m.HeroBagModel || m.default || m);
                        if (cls) hbmProto = cls.prototype;
                    } catch (e) { }
                }
                if (hbmProto && !hbmProto.__QA_MINE_T2_HERO_HOOKED__) {
                    hbmProto.__QA_MINE_T2_HERO_HOOKED__ = true;
                    const origSort = hbmProto.getSortHeroInfoByArrayNew;
                    hbmProto.getSortHeroInfoByArrayNew = function (teamType, subType) {
                        let res = origSort ? origSort.apply(this, arguments) : null;
                        // teamType 5 is GuildMine (e_GameplayDataTeamType.GuildMine)
                        if (+teamType === 5 && +subType === 2) {
                            if (!res || !res.ArrayHero || res.ArrayHero.length === 0) {
                                const t1 = origSort.call(this, teamType, 1);
                                if (t1 && t1.ArrayHero && t1.ArrayHero.length > 0) {
                                    return t1;
                                }
                            }
                        }
                        return res;
                    };
                }

                // 7. Hook prototype CrossMineMainView
                let cmmMainMod = null;
                if (typeof window.__require === "function") {
                    try { cmmMainMod = window.__require("CrossMineMainView"); } catch (e) { }
                }
                const CrossMineMainViewClass = (cmmMainMod && (cmmMainMod.CrossMineMainView || cmmMainMod.default || cmmMainMod)) || (gm && gm.CrossMineMainView) || window.CrossMineMainView;
                if (CrossMineMainViewClass && CrossMineMainViewClass.prototype && !CrossMineMainViewClass.prototype.__QA_T2_VIEW_ENFORCED__) {
                    CrossMineMainViewClass.prototype.__QA_T2_VIEW_ENFORCED__ = true;
                    const origUpdateTeam = CrossMineMainViewClass.prototype.updateTeam;
                    CrossMineMainViewClass.prototype.updateTeam = function (teams) {
                        try {
                            if (teams && Array.isArray(teams)) {
                                let t2 = teams.find(t => t && t._idx === 2);
                                if (!t2) {
                                    teams.push({
                                        _idx: 2,
                                        _hole: 0,
                                        _room: 0,
                                        _loot_time: 0,
                                        _loot_score: 0,
                                        _power: (teams[0] && teams[0]._power) || 120,
                                        _array: []
                                    });
                                }
                            }
                        } catch (e) { }
                        if (origUpdateTeam) origUpdateTeam.apply(this, arguments);
                        try {
                            if (this.T2LockNode) this.T2LockNode.setVisible(false);
                            if (this.barNode2) this.barNode2.setVisible(true);
                        } catch (e) { }
                    };
                }

                // 8. Hook prototype CrossMineHoleInfoView (Nút chọn Đội 1 & Đội 2 + Nút Chiếm)
                let cmhMod = null;
                if (typeof window.__require === "function") {
                    try { cmhMod = window.__require("CrossMineHoleInfoView"); } catch (e) { }
                }
                const CrossMineHoleInfoViewClass = (cmhMod && (cmhMod.CrossMineHoleInfoView || cmhMod.default || cmhMod)) || (gm && gm.CrossMineHoleInfoView) || window.CrossMineHoleInfoView;
                if (CrossMineHoleInfoViewClass && CrossMineHoleInfoViewClass.prototype && !CrossMineHoleInfoViewClass.prototype.__QA_T2_HOLE_ENFORCED__) {
                    CrossMineHoleInfoViewClass.prototype.__QA_T2_HOLE_ENFORCED__ = true;

                    const bindHoleButtons = function (viewInst) {
                        if (!viewInst) return;
                        try {
                            if (viewInst.subBtn2) {
                                const lCtrl = viewInst.subBtn2.getController && viewInst.subBtn2.getController("lock");
                                if (lCtrl) lCtrl.setSelectedIndex(0);
                                const lockChild = viewInst.subBtn2.getChild && viewInst.subBtn2.getChild("lock");
                                if (lockChild) lockChild.setVisible(false);

                                if (typeof viewInst.subBtn2.removeClickListener === "function") viewInst.subBtn2.removeClickListener();
                                if (typeof viewInst.subBtn2.clearClick === "function") viewInst.subBtn2.clearClick();
                                const onT2Click = function () {
                                    viewInst.selectTeamIdx = 2;
                                    if (typeof viewInst.refreshSubBtn === "function") viewInst.refreshSubBtn();
                                    if (typeof viewInst.refreshArray === "function") viewInst.refreshArray();
                                };
                                viewInst.subBtn2.addClickListener(onT2Click);
                                if (typeof viewInst.subBtn2.onClick === "function") viewInst.subBtn2.onClick(onT2Click, viewInst);
                            }
                            if (viewInst.subBtn1) {
                                if (typeof viewInst.subBtn1.removeClickListener === "function") viewInst.subBtn1.removeClickListener();
                                if (typeof viewInst.subBtn1.clearClick === "function") viewInst.subBtn1.clearClick();
                                const onT1Click = function () {
                                    viewInst.selectTeamIdx = 1;
                                    if (typeof viewInst.refreshSubBtn === "function") viewInst.refreshSubBtn();
                                    if (typeof viewInst.refreshArray === "function") viewInst.refreshArray();
                                };
                                viewInst.subBtn1.addClickListener(onT1Click);
                                if (typeof viewInst.subBtn1.onClick === "function") viewInst.subBtn1.onClick(onT1Click, viewInst);
                            }
                            if (viewInst.fightBtn) {
                                if (typeof viewInst.fightBtn.removeClickListener === "function") viewInst.fightBtn.removeClickListener();
                                if (typeof viewInst.fightBtn.clearClick === "function") viewInst.fightBtn.clearClick();
                                const onFightClick = function () {
                                    const curMm = window.ModelManager;
                                    if (curMm && curMm.CrossMineModel && curMm.CrossMineModel.mineInfo) {
                                        ensureTeam2Data(curMm.CrossMineModel.mineInfo);
                                    }
                                    let util = (window.G_Mapping && window.G_Mapping.CrossMineUtil) || window.CrossMineUtil;
                                    if (!util && typeof window.__require === "function") {
                                        try { const m = window.__require("CrossMineUtil"); util = m && (m.CrossMineUtil || m.default || m); } catch (e) { }
                                    }
                                    if (util && typeof util.checkShowReplaceTips === "function") {
                                        util.checkShowReplaceTips(viewInst.selectTeamIdx, function () {
                                            viewInst.clickFightBtn();
                                        });
                                    } else {
                                        viewInst.clickFightBtn();
                                    }
                                };
                                viewInst.fightBtn.addClickListener(onFightClick);
                                if (typeof viewInst.fightBtn.onClick === "function") viewInst.fightBtn.onClick(onFightClick, viewInst);
                            }
                        } catch (e) { }
                    };

                    const origInitUI = CrossMineHoleInfoViewClass.prototype._initUI;
                    CrossMineHoleInfoViewClass.prototype._initUI = function () {
                        if (origInitUI) origInitUI.apply(this, arguments);
                        bindHoleButtons(this);
                    };

                    const origShowView = CrossMineHoleInfoViewClass.prototype.showView;
                    CrossMineHoleInfoViewClass.prototype.showView = function () {
                        if (origShowView) origShowView.apply(this, arguments);
                        bindHoleButtons(this);
                    };

                    const origClickFight = CrossMineHoleInfoViewClass.prototype.clickFightBtn;
                    CrossMineHoleInfoViewClass.prototype.clickFightBtn = function () {
                        try {
                            const curMm = window.ModelManager;
                            if (curMm && curMm.CrossMineModel && curMm.CrossMineModel.mineInfo) {
                                ensureTeam2Data(curMm.CrossMineModel.mineInfo);
                            }
                        } catch (e) { }
                        if (origClickFight) return origClickFight.apply(this, arguments);
                    };
                }

                // 9. Hook prototype CrossMineMyTeamView (Giao diện Xếp Trận Đội 2 Mỏ)
                let cmmvMod = null;
                if (typeof window.__require === "function") {
                    try { cmmvMod = window.__require("CrossMineMyTeamView"); } catch (e) { }
                }
                const CrossMineMyTeamViewClass = (cmmvMod && (cmmvMod.CrossMineMyTeamView || cmmvMod.default || cmmvMod)) || (gm && gm.CrossMineMyTeamView) || window.CrossMineMyTeamView;
                if (CrossMineMyTeamViewClass && CrossMineMyTeamViewClass.prototype && !CrossMineMyTeamViewClass.prototype.__QA_T2_MYTEAM_ENFORCED__) {
                    CrossMineMyTeamViewClass.prototype.__QA_T2_MYTEAM_ENFORCED__ = true;
                    const origMyTeamShow = CrossMineMyTeamViewClass.prototype.showView;
                    CrossMineMyTeamViewClass.prototype.showView = function () {
                        if (origMyTeamShow) origMyTeamShow.apply(this, arguments);
                        try {
                            if (this.teamItem2) {
                                const ctrl = this.teamItem2.getController && this.teamItem2.getController("lock");
                                if (ctrl) ctrl.setSelectedIndex(0);
                            }
                        } catch (e) { }
                    };
                }

                // 10. Cưỡng chế mở khóa trực tiếp ngay trên màn hình CrossMineMainView, CrossMineHoleInfoView đang hiển thị
                const vm = (gm && gm.ViewManager) || window.ViewManager || (bot.getViewManager && bot.getViewManager());
                if (vm && typeof vm.getView === "function") {
                    const activeMain = vm.getView("CrossMineMainView");
                    if (activeMain) {
                        if (activeMain.T2LockNode && typeof activeMain.T2LockNode.setVisible === "function") {
                            activeMain.T2LockNode.setVisible(false);
                        }
                        if (activeMain.barNode2 && typeof activeMain.barNode2.setVisible === "function") {
                            activeMain.barNode2.setVisible(true);
                        }
                        const curTeams = mm && mm.CrossMineModel && mm.CrossMineModel.mineInfo && mm.CrossMineModel.mineInfo._team;
                        if (curTeams && Array.isArray(curTeams) && typeof activeMain.updateTeam === "function") {
                            ensureTeam2Data(mm.CrossMineModel.mineInfo);
                            activeMain.updateTeam(curTeams);
                        }
                    }
                    const activeHole = vm.getView("CrossMineHoleInfoView");
                    if (activeHole) {
                        if (activeHole.subBtn2) {
                            const lCtrl = activeHole.subBtn2.getController && activeHole.subBtn2.getController("lock");
                            if (lCtrl) lCtrl.setSelectedIndex(0);
                            const lockChild = activeHole.subBtn2.getChild && activeHole.subBtn2.getChild("lock");
                            if (lockChild) lockChild.setVisible(false);
                        }
                    }
                    const activeMyTeam = vm.getView("CrossMineMyTeamView");
                    if (activeMyTeam && activeMyTeam.teamItem2) {
                        const ctrl = activeMyTeam.teamItem2.getController && activeMyTeam.teamItem2.getController("lock");
                        if (ctrl) ctrl.setSelectedIndex(0);
                    }
                }
            } catch (err) { }
        },

        // Bypass Giới Hạn Tầng & Lực Chiến Gia Nhập Tổ Đội Cấm Địa (Bảo toàn 100% Avatar & Giao diện)
        hookTeamRestrictionBypass: function () {
            try {
                const gm = window.G_Mapping;

                // 1. Hook window.Dispatcher: Xóa sạch _apply_limit ngay khi nhận danh sách phòng từ server
                try {
                    const disp = window.Dispatcher || (gm && gm.Dispatcher);
                    if (disp && !disp.__QA_TEAM_DISPATCH_HOOKED__) {
                        disp.__QA_TEAM_DISPATCH_HOOKED__ = true;
                        const origDispatch = disp.dispatchEvent;
                        disp.dispatchEvent = function (event, type, list, chatArg) {
                            if ((event === "team_list_update" || event === 95440) && Array.isArray(list)) {
                                list.forEach(team => {
                                    if (team) team._apply_limit = [];
                                });
                            }
                            if (event === "update_chat_msg" || event === "evt_ChatChatSc") {
                                try {
                                    let msgs = [];
                                    if (event === "update_chat_msg") {
                                        const cObj = arguments[3] || chatArg || list || type;
                                        if (cObj && cObj._text) msgs.push(cObj);
                                    } else if (event === "evt_ChatChatSc") {
                                        const rData = type || list || arguments[1];
                                        if (rData) {
                                            if (rData._chat && rData._chat._text) msgs.push(rData._chat);
                                            if (Array.isArray(rData._chat_list)) msgs.push(...rData._chat_list);
                                        }
                                    }
                                    for (let i = 0; i < msgs.length; i++) {
                                        const mItem = msgs[i];
                                        const cText = mItem && mItem._text;
                                        if (cText && typeof cText === "string") {
                                            const match = cText.match(/\{6,\s*(\d+)\}/);
                                            if (match && match[1]) {
                                                const hRid = Number(match[1]);
                                                const mm = window.ModelManager;
                                                const myId = (mm && mm.PlayerModel && mm.PlayerModel.getRid) ? Number(mm.PlayerModel.getRid()) : 0;
                                                if (hRid > 0 && hRid !== myId) {
                                                    if (!bot.state.priorityRescueQueue) bot.state.priorityRescueQueue = [];
                                                    if (!bot.state.priorityRescueQueue.some(x => Number(x.rid) === hRid)) {
                                                        const rs = mItem._role_show;
                                                        const sName = (rs && (rs.getName ? rs.getName() : (rs._name || rs.name))) || `ID ${hRid}`;
                                                        bot.state.priorityRescueQueue.unshift({
                                                            rid: hRid,
                                                            name: sName,
                                                            source: "Cầu Cứu Chat Realtime"
                                                        });
                                                        bot.log(`📡 [Farm KNB • Chat Realtime] Bắt được tín hiệu Cầu Cứu từ [${sName}] (ID: ${hRid})! Đang giải cứu ngay (+50 KNB)...`);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                } catch (eChatEv) { }
                            }
                            return origDispatch.apply(this, arguments);
                        };
                    }
                } catch (e) { }

                // 2. Hook ViewManager: Bắt sự kiện cập nhật danh sách phòng của TeamRestricteTeamListView & DẬP TẮT POPUP THƯỞNG KHI CHẠY ẨN
                try {
                    const vm = window.ViewManager || (gm && gm.ViewManager);
                    if (vm && !vm.__QA_TEAM_VIEW_HOOKED__) {
                        vm.__QA_TEAM_VIEW_HOOKED__ = true;

                        // CHỈ DẬP TẮT POPUP THÔNG BÁO VẬT PHẨM (ItemGetView / RewardTipsView) KHI BOT TỰ ĐỘNG THU HOẠCH MỎ HOẶC NHẬN QUÀ BXH
                        // TUYỆT ĐỐI KHÔNG DẬP TẮT CÁC MÀN HÌNH CHÍNH (CrossMineRankRewardView, RankRewardView...) ĐỂ NGƯỜI CHƠI BẤM NHẬN VÀ XEM BÌNH THƯỜNG!
                        const GENERIC_REWARD_VIEWS = new Set([
                            "ItemGetView",
                            "RewardTipPopView",
                            "CommonRewardConfirmView",
                            "RewardTipsView"
                        ]);

                        const isMineOrRankRewardToSuppress = function (viewName) {
                            if (!viewName) return false;
                            // Popup thông báo vật phẩm: CHỈ ẩn khi đang trong phiên bot tự động thu hoạch mỏ, nhận quà BXH hoặc giải cứu gia viên (+50 KNB)
                            if (GENERIC_REWARD_VIEWS.has(viewName)) {
                                const isMineActive = Date.now() < (bot.state.suppressMineRewardUntil || 0);
                                const isRankActive = Date.now() < (bot.state.suppressRankRewardUntil || 0);
                                const isRescueActive = (Date.now() < (bot.state.suppressRescueRewardUntil || 0)) || bot.state.rescueFightActive;
                                if (isMineActive || isRankActive || isRescueActive) return true;
                            }
                            return false;
                        };

                        const origOpen = vm.open;
                        vm.open = function (viewName) {
                            if (viewName === "CrossMineMainView" || viewName === "CrossMineMyTeamView" || viewName === "CrossMineHoleInfoView") {
                                try {
                                    bot.enforceMineTeam2Unlock();
                                    setTimeout(() => { try { bot.enforceMineTeam2Unlock(); } catch (e) { } }, 100);
                                    setTimeout(() => { try { bot.enforceMineTeam2Unlock(); } catch (e) { } }, 500);
                                } catch (e) { }
                            }
                            const isSilentReward = isMineOrRankRewardToSuppress(viewName);
                            const res = origOpen.apply(this, arguments);
                            if (isSilentReward) {
                                try {
                                    if (res) {
                                        if (typeof res.closeView === "function") res.closeView();
                                        else if (typeof vm.close === "function") vm.close(viewName);
                                        else if (res.view && res.view.node) res.view.node.active = false;
                                    }
                                } catch (eClose) { }
                                bot.log(`🤫 [Ẩn Quà Mỏ/BXH] Đã thu nhận quà & tự động dập tắt popup [${viewName}] trong nền.`);
                                return res;
                            }
                            try {
                                if (viewName === "TeamRestricteTeamListView") {
                                    const win = vm.getView("TeamRestricteTeamListView");
                                    if (win) {
                                        const winProto = Object.getPrototypeOf(win);
                                        if (winProto && !winProto.__QA_LIST_UPDATE_HOOKED__) {
                                            winProto.__QA_LIST_UPDATE_HOOKED__ = true;
                                            const origListUpdate = winProto.team_list_update;
                                            winProto.team_list_update = function (e, t, i) {
                                                if (Array.isArray(i)) {
                                                    i.forEach(team => { if (team) team._apply_limit = []; });
                                                }
                                                if (origListUpdate) origListUpdate.apply(this, arguments);
                                            };
                                        }
                                        if (Array.isArray(win.teamDatas)) {
                                            win.teamDatas.forEach(team => { if (team) team._apply_limit = []; });
                                        }
                                    }
                                }
                            } catch (e) { }
                            return res;
                        };

                        if (typeof vm.showView === "function" && !vm.__QA_SILENT_SHOWVIEW_HOOKED__) {
                            vm.__QA_SILENT_SHOWVIEW_HOOKED__ = true;
                            const origShowView = vm.showView;
                            vm.showView = function (viewName) {
                                if (viewName === "CrossMineMainView" || viewName === "CrossMineMyTeamView" || viewName === "CrossMineHoleInfoView") {
                                    try {
                                        bot.enforceMineTeam2Unlock();
                                        setTimeout(() => { try { bot.enforceMineTeam2Unlock(); } catch (e) { } }, 100);
                                    } catch (e) { }
                                }
                                if (isMineOrRankRewardToSuppress(viewName)) {
                                    const res = origShowView.apply(this, arguments);
                                    try {
                                        if (res && typeof res.closeView === "function") res.closeView();
                                        else if (typeof vm.close === "function") vm.close(viewName);
                                    } catch (eClose) { }
                                    bot.log(`🤫 [Ẩn Quà Mỏ/BXH] Đã dập tắt popup showView [${viewName}] trong nền.`);
                                    return res;
                                }
                                return origShowView.apply(this, arguments);
                            };
                        }
                    }
                } catch (e) { }

                // 3. Hook TeamRestricteTeamListItem: Mở khóa nút Tham Gia và ẩn dòng giới hạn tầng/LC
                try {
                    const itemCls = (gm && gm.TeamRestricteTeamListItem) || window.TeamRestricteTeamListItem;
                    if (itemCls && itemCls.prototype && !itemCls.prototype.__QA_TEAM_ITEM_HOOKED__) {
                        itemCls.prototype.__QA_TEAM_ITEM_HOOKED__ = true;
                        const origSetData = itemCls.prototype.setData;
                        itemCls.prototype.setData = function (teamData) {
                            if (teamData) teamData._apply_limit = [];
                            if (origSetData) origSetData.apply(this, arguments);
                            try {
                                if (this.limitTxt) this.limitTxt.setVisible(false);
                                const tpm = (window.ModelManager && window.ModelManager.TeamPlayModel) || (gm && gm.TeamPlayModel);
                                const hasApplied = tpm && tpm.hasApplyTeamId && teamData && tpm.hasApplyTeamId[teamData._id];
                                if (!hasApplied && this.addBtn) {
                                    this.addBtn.setGrayed(false);
                                    this.addBtn.setTouchable(true);
                                }
                            } catch (err) { }
                        };
                    }

                    const bm = window.BindManager || (gm && gm.BindManager);
                    if (bm && typeof bm.bindTeamRestricteTeamListItem === "function" && !bm.__QA_TEAM_BIND_PROTOSPY__) {
                        bm.__QA_TEAM_BIND_PROTOSPY__ = true;
                        const origBind = bm.bindTeamRestricteTeamListItem;
                        bm.bindTeamRestricteTeamListItem = function (node) {
                            const item = origBind.apply(this, arguments);
                            if (item) {
                                const proto = Object.getPrototypeOf(item);
                                if (proto && !proto.__QA_TEAM_ITEM_HOOKED__) {
                                    proto.__QA_TEAM_ITEM_HOOKED__ = true;
                                    const origSet = proto.setData;
                                    proto.setData = function (teamData) {
                                        if (teamData) teamData._apply_limit = [];
                                        if (origSet) origSet.apply(this, arguments);
                                        try {
                                            if (this.limitTxt) this.limitTxt.setVisible(false);
                                            const tpm = (window.ModelManager && window.ModelManager.TeamPlayModel) || (gm && gm.TeamPlayModel);
                                            const hasApplied = tpm && tpm.hasApplyTeamId && teamData && tpm.hasApplyTeamId[teamData._id];
                                            if (!hasApplied && this.addBtn) {
                                                this.addBtn.setGrayed(false);
                                                this.addBtn.setTouchable(true);
                                            }
                                        } catch (err) { }
                                    };
                                }
                            }
                            return item;
                        };
                    }
                } catch (e) { }

                // 4. Hook TeamPlayModel.reqJoinTeam: Ghi log an toàn, tuyệt đối không đệ quy hay treo luồng
                try {
                    const tpm = (window.ModelManager && window.ModelManager.TeamPlayModel) || (gm && gm.TeamPlayModel);
                    const tpmProto = (tpm && Object.getPrototypeOf(tpm)) || (gm && gm.TeamPlayModel && gm.TeamPlayModel.prototype);
                    if (tpmProto && !tpmProto.__QA_JOIN_SAFE_HOOKED__) {
                        tpmProto.__QA_JOIN_SAFE_HOOKED__ = true;
                        const origReqJoin = tpmProto.reqJoinTeam;
                        tpmProto.reqJoinTeam = function (type, teamId) {
                            try {
                                bot.log(`🤝 [Tổ Đội] Đang gửi yêu cầu gia nhập Đội [${teamId}]...`);
                            } catch (e) { }
                            if (origReqJoin) return origReqJoin.apply(this, arguments);
                        };
                    }
                } catch (e) { }
            } catch (err) { }
        },

        // Hook 2.71: Cho phép đóng/thoát 1-chạm bảng chọn Lõi Bí Cảnh Tần Lĩnh (YyzqBuffSelectView & YyzqBuffReplaceView)
        hookYyzqBuffViews: function () {
            try {
                const gm = window.G_Mapping;

                // 1. Hook YyzqBuffSelectView: Cho phép click nền đen hoặc bấm Hủy để thoát trực tiếp
                try {
                    let bsvMod = null;
                    if (typeof window.__require === "function") {
                        try { bsvMod = window.__require("YyzqBuffSelectView"); } catch (e) { }
                    }
                    const ViewClass = (bsvMod && (bsvMod.YyzqBuffSelectView || bsvMod.default || bsvMod)) || (gm && gm.YyzqBuffSelectView) || window.YyzqBuffSelectView;
                    if (ViewClass && ViewClass.prototype && !ViewClass.prototype.__QA_YYZQ_BUFF_HOOKED__) {
                        ViewClass.prototype.__QA_YYZQ_BUFF_HOOKED__ = true;
                        const origInitUI = ViewClass.prototype._initUI;
                        ViewClass.prototype._initUI = function () {
                            if (origInitUI) origInitUI.apply(this, arguments);
                            try {
                                const self = this;
                                const doExit = function () {
                                    bot.log("🔮 [Bí Cảnh Tần Lĩnh] Thoát bảng chọn Lõi -> Đóng giao diện và gửi bỏ qua buff!");
                                    const ym = (window.ModelManager && window.ModelManager.YyzqModel) || (gm && gm.YyzqModel);
                                    if (ym && typeof ym.reqSelectBuff === "function") {
                                        try { ym.reqSelectBuff(0); } catch (e) { }
                                    }
                                    if (typeof self.closeView === "function") {
                                        try { self.closeView(); } catch (e) { }
                                    }
                                };
                                if (this.blackBg) {
                                    this.blackBg.setTouchable(true);
                                    this.blackBg.addClickListener(doExit);
                                }
                                if (this.blackbg) {
                                    this.blackbg.setTouchable(true);
                                    this.blackbg.addClickListener(doExit);
                                }
                                if (this.cancelBtn) {
                                    if (typeof this.cancelBtn.clearClickList === "function") {
                                        this.cancelBtn.clearClickList();
                                    }
                                    this.cancelBtn.addClickListener(doExit);
                                }
                            } catch (err) { }
                        };
                    }
                } catch (e) { }

                // 2. Hook YyzqBuffReplaceView: Cho phép thoát 1 chạm và click nền đen
                try {
                    let brvMod = null;
                    if (typeof window.__require === "function") {
                        try { brvMod = window.__require("YyzqBuffReplaceView"); } catch (e) { }
                    }
                    const RepViewClass = (brvMod && (brvMod.YyzqBuffReplaceView || brvMod.default || brvMod)) || (gm && gm.YyzqBuffReplaceView) || window.YyzqBuffReplaceView;
                    if (RepViewClass && RepViewClass.prototype && !RepViewClass.prototype.__QA_YYZQ_REP_HOOKED__) {
                        RepViewClass.prototype.__QA_YYZQ_REP_HOOKED__ = true;
                        const origInitUI = RepViewClass.prototype._initUI;
                        RepViewClass.prototype._initUI = function () {
                            if (origInitUI) origInitUI.apply(this, arguments);
                            try {
                                const self = this;
                                const doExitReplace = function () {
                                    bot.log("🔮 [Bí Cảnh Tần Lĩnh] Thoát bảng đổi Lõi -> Đóng toàn bộ popup chọn Lõi!");
                                    const ym = (window.ModelManager && window.ModelManager.YyzqModel) || (gm && gm.YyzqModel);
                                    if (ym && typeof ym.reqSelectBuff === "function") {
                                        try { ym.reqSelectBuff(0); } catch (e) { }
                                    }
                                    if (typeof self.closeView === "function") {
                                        try { self.closeView(); } catch (e) { }
                                    }
                                    const vm = (bot.getViewManager && bot.getViewManager()) || window.ViewManager || (gm && gm.ViewManager);
                                    if (vm && typeof vm.closeView === "function") {
                                        try { vm.closeView("YyzqBuffSelectView"); } catch (e) { }
                                    }
                                };
                                if (this.blackBg) {
                                    this.blackBg.setTouchable(true);
                                    this.blackBg.addClickListener(doExitReplace);
                                }
                                if (this.blackbg) {
                                    this.blackbg.setTouchable(true);
                                    this.blackbg.addClickListener(doExitReplace);
                                }
                                if (this.cancelBtn) {
                                    if (typeof this.cancelBtn.clearClickList === "function") {
                                        this.cancelBtn.clearClickList();
                                    }
                                    this.cancelBtn.addClickListener(doExitReplace);
                                }
                            } catch (err) { }
                        };
                    }
                } catch (e) { }
            } catch (err) { }
        },

        // Hook Engine: Bỏ qua QC 0s, Speed hack & Chặn tuyệt đối màn hình Xếp Trận
        hookGameEngine: function () {
            try {
                const gm = window.G_Mapping;
                if (gm) {
                    if (!window.ModelManager && gm.ModelManager) window.ModelManager = gm.ModelManager;
                    if (!window.ViewManager && gm.ViewManager) window.ViewManager = gm.ViewManager;
                    if (!window.BattleFastManager && (gm.BattleFastManager || gm.BatteFastManager)) window.BattleFastManager = gm.BattleFastManager || gm.BatteFastManager;
                    if (!window.BatteFastManager && (gm.BatteFastManager || gm.BattleFastManager)) window.BatteFastManager = gm.BatteFastManager || gm.BattleFastManager;
                    if (!window.FightManager && gm.FightManager) window.FightManager = gm.FightManager;
                    if (!window.RedManager && gm.RedManager) window.RedManager = gm.RedManager;
                    if (!window.ConfigManager && gm.ConfigManager) window.ConfigManager = gm.ConfigManager;
                }

                // Tẩy sạch ô nhiễm stageView trong BattleModel (ngăn chặn triệt để lỗi bấm chat tự mở Gia Viên)
                try {
                    const bm = (window.ModelManager && window.ModelManager.BattleModel) || (gm && gm.BattleModel);
                    if (bm && Array.isArray(bm._stageViewArray) && (bm._stageViewArray.includes('HomeLandOtherView') || bm._stageViewArray.includes('HomeLandView'))) {
                        if (typeof bm.clearStageView === "function") bm.clearStageView();
                        else bm._stageViewArray = [];
                    }
                } catch (eBm) { }

                // Feature 1: Bỏ qua quảng cáo 0s toàn diện (Native Privilege2 + SDKUtil + PlatformManager + AdPopView)
                try {
                    // 1.1 Kích hoạt Đặc Quyền Tác Chiến (Privilege2 = Miễn QC vĩnh viễn) trong Game Engine
                    let rsmMod = null;
                    if (typeof window.__require === "function") {
                        try { rsmMod = window.__require("RechargeShopModel"); } catch (e) { }
                    }
                    const rsmModel = (window.ModelManager && window.ModelManager.RechargeShopModel) || (gm && gm.RechargeShopModel);
                    const rsmClass = (rsmMod && (rsmMod.RechargeShopModel || rsmMod.default || rsmMod)) || (rsmModel && rsmModel.constructor) || (gm && gm.RechargeShopModel);
                    const rsmProto = (rsmClass && rsmClass.prototype) || (rsmModel && Object.getPrototypeOf(rsmModel));
                    if (rsmProto && !rsmProto.__QA_PRIVILEGE_HOOKED__) {
                        rsmProto.__QA_PRIVILEGE_HOOKED__ = true;

                        // Lưu giữ dữ liệu đặc quyền thực tế từ server
                        const origUpdatePriv = rsmProto.updatePrivilegeHis;
                        rsmProto.updatePrivilegeHis = function (e) {
                            if (e && Array.isArray(e._list)) {
                                if (!this._realPrivilegeData) this._realPrivilegeData = {};
                                for (let item of e._list) {
                                    if (item && item._id) this._realPrivilegeData[item._id] = item;
                                }
                            }
                            if (origUpdatePriv) return origUpdatePriv.apply(this, arguments);
                        };

                        rsmProto.havePrivilegeById = function (id) {
                            // 1. Đặc Quyền 2: Bỏ qua QC 0s & Treo máy (client-side) -> Luôn mở
                            if (id === 2) {
                                return bot.settings.skip_ads !== false;
                            }
                            // 2. Đặc Quyền 1: Mở khóa Đào 50 rương (PrivilegeOpenBoxCnt)
                            // CHỈ trả về true khi tài khoản THỰC SỰ có Đặc Quyền 1 từ server (hoặc còn hạn sử dụng).
                            // Nếu chưa mua/hết hạn, trả về false để game tính đúng số lượng hợp pháp của VIP và cấp Rương (VD: VIP 4 đào 40 rương/lần).
                            if (id === 1) {
                                const real = this._realPrivilegeData && this._realPrivilegeData[1];
                                if (real) {
                                    const stm = (window.ModelManager && window.ModelManager.ServerTimeModel) || (gm && gm.ServerTimeModel);
                                    const now = stm && stm.getServerTime ? stm.getServerTime() : Math.floor(Date.now() / 1000);
                                    return (real._e_sec === 0 || real._e_sec > now);
                                }
                                return false;
                            }
                            // 3. Đặc Quyền 3: Thêm Thợ Gia Viên (PrivilegeHostWoker)
                            if (id === 3) {
                                const real = this._realPrivilegeData && this._realPrivilegeData[3];
                                if (real) {
                                    const stm = (window.ModelManager && window.ModelManager.ServerTimeModel) || (gm && gm.ServerTimeModel);
                                    const now = stm && stm.getServerTime ? stm.getServerTime() : Math.floor(Date.now() / 1000);
                                    return (real._e_sec === 0 || real._e_sec > now);
                                }
                                return false;
                            }
                            // 4. Các đặc quyền khác (4..8): kiểm tra dữ liệu server thực tế
                            const real = this._realPrivilegeData && this._realPrivilegeData[id];
                            if (real) {
                                const stm = (window.ModelManager && window.ModelManager.ServerTimeModel) || (gm && gm.ServerTimeModel);
                                const now = stm && stm.getServerTime ? stm.getServerTime() : Math.floor(Date.now() / 1000);
                                return (real._e_sec === 0 || real._e_sec > now);
                            }
                            return false;
                        };

                        const origGetPrivilege = rsmProto.getPrivilegeHisById;
                        rsmProto.getPrivilegeHisById = function (id) {
                            // Chỉ bypass client cho Đặc Quyền 2 (Bỏ qua QC 0s)
                            if (id === 2) {
                                if (!this._privilegeData) this._privilegeData = {};
                                if (!this._privilegeData[id]) {
                                    this._privilegeData[id] = { _id: id, _e_sec: 0, _is_forever: 1, _state: 1, _is_fake: true };
                                }
                                return this._privilegeData[id];
                            }
                            if (this._realPrivilegeData && this._realPrivilegeData[id]) {
                                return this._realPrivilegeData[id];
                            }
                            if (origGetPrivilege) return origGetPrivilege.apply(this, arguments);
                            return null;
                        };
                    }

                    // 1.15 Hook ComAdvert.prototype.checkAdPrivilege - Bỏ qua trực tiếp từ nút bấm giao diện
                    let caMod = null;
                    if (typeof window.__require === "function") {
                        try { caMod = window.__require("ComAdvert"); } catch (e) { }
                    }
                    const ComAdvertClass = (caMod && (caMod.ComAdvert || caMod.default || caMod)) || (gm && gm.ComAdvert) || window.ComAdvert;
                    if (ComAdvertClass && ComAdvertClass.prototype && !ComAdvertClass.prototype.__QA_AD_HOOKED__) {
                        ComAdvertClass.prototype.__QA_AD_HOOKED__ = true;
                        const origCheckAdPrivilege = ComAdvertClass.prototype.checkAdPrivilege;
                        ComAdvertClass.prototype.checkAdPrivilege = function () {
                            if (bot.settings.skip_ads) {
                                const mm = window.ModelManager;
                                const am = mm && mm.AdvertModel;
                                const ac = window.AdvertConfiger || (gm && gm.AdvertConfiger);
                                const dur = (ac && typeof ac.getAdModuleDataByAdId === "function" && ac.getAdModuleDataByAdId(this.id)) ? ac.getAdModuleDataByAdId(this.id).duration : 30;
                                bot.log(`🎬 [ComAdvert] Tự động bỏ qua quảng cáo ID: ${this.id} -> Nhận thưởng 0s!`);
                                if (am && typeof am.reqJumpAd === "function") {
                                    am.reqJumpAd(this.id, dur || 30);
                                }
                                return;
                            }
                            if (origCheckAdPrivilege) return origCheckAdPrivilege.apply(this, arguments);
                        };
                    }

                    // 1.2 Hook SDKUtil.showRewardAd - Bỏ qua hiển thị SDK video, gọi trực tiếp reqJumpAd
                    let suMod = null;
                    if (typeof window.__require === "function") {
                        try { suMod = window.__require("SDKUtil"); } catch (e) { }
                    }
                    const sdkUtil = (suMod && (suMod.SDKUtil || suMod.default || suMod)) || (gm && gm.SDKUtil) || window.SDKUtil;
                    if (sdkUtil && !sdkUtil.__QA_SKIP_AD__) {
                        sdkUtil.__QA_SKIP_AD__ = true;
                        const origShowRewardAd = sdkUtil.showRewardAd;
                        sdkUtil.showRewardAd = function (adId, callback) {
                            if (bot.settings.skip_ads) {
                                bot.log(`🎬 [Skip-Ads] Tự động bỏ qua quảng cáo ID: ${adId} -> Nhận thưởng 0s!`);
                                const mm = window.ModelManager;
                                const am = mm && mm.AdvertModel;
                                if (am && typeof am.reqJumpAd === "function") {
                                    am.reqJumpAd(adId, 30);
                                } else if (am && typeof am.reqSystemAdUseCs === "function") {
                                    am.reqSystemAdUseCs(adId, true);
                                    setTimeout(() => {
                                        try { am.reqSystemAdUseCs(adId, false); } catch (e) { }
                                    }, 50);
                                }
                                if (typeof callback === "function") callback(0);
                                return;
                            }
                            if (origShowRewardAd) return origShowRewardAd.apply(this, arguments);
                        };
                    }

                    // 1.3 Hook PlatformManager / Platform Native
                    const pm = (gm && gm.PlatformManager && gm.PlatformManager.instance) || window.platform_interface;
                    if (pm && !pm.__HOOKED_AD__) {
                        pm.__HOOKED_AD__ = true;
                        const orig = pm.showRewardAd;
                        pm.showRewardAd = function (adId, callback) {
                            if (bot.settings.skip_ads) {
                                bot.log(`🎬 [Skip-Ads] Tự động bỏ qua quảng cáo Platform: ${adId} -> Nhận thưởng 0s!`);
                                if (typeof callback === "function") callback(0);
                                return;
                            }
                            if (orig) orig.apply(this, arguments);
                        };
                    }

                    // 1.4 Hook AdPopView - Tự động nhận thưởng và đóng ngay nếu popup xuất hiện
                    let apvMod = null;
                    if (typeof window.__require === "function") {
                        try { apvMod = window.__require("AdPopView"); } catch (e) { }
                    }
                    const AdPopViewClass = (apvMod && (apvMod.AdPopView || apvMod.default || apvMod)) || (gm && gm.AdPopView) || window.AdPopView;
                    if (AdPopViewClass && AdPopViewClass.prototype && !AdPopViewClass.prototype.__QA_SKIP_AD__) {
                        AdPopViewClass.prototype.__QA_SKIP_AD__ = true;
                        const origShowView = AdPopViewClass.prototype.showView;
                        AdPopViewClass.prototype.showView = function (args) {
                            if (origShowView) origShowView.apply(this, arguments);
                            if (bot.settings.skip_ads) {
                                const self = this;
                                setTimeout(() => {
                                    try {
                                        bot.log(`🎬 [AdPopView] Tự động nhận thưởng và đóng popup QC ID: ${self.id}`);
                                        const mm = window.ModelManager;
                                        const am = mm && mm.AdvertModel;
                                        if (am && typeof am.reqJumpAd === "function") {
                                            am.reqJumpAd(self.id, 30);
                                        }
                                        if (self.closeView) self.closeView();
                                    } catch (e) { }
                                }, 100);
                            }
                        };
                    }
                } catch (eAd) {
                    console.error("[AutoBot Skip-Ads Hook Error]", eAd);
                }

                // Anti-Spam: Tự động điều tiết giãn cách an toàn giữa mọi gói tin socket & chặn trùng lặp WarStartCs
                let netMod = null;
                if (typeof window.__require === "function") {
                    try { netMod = window.__require("NetWork"); } catch (e) { }
                }
                const NetWorkClass = (netMod && (netMod.NetWork || netMod)) || (gm && gm.NetWork) || window.NetWork;
                const nwProto = NetWorkClass && (NetWorkClass.prototype || (NetWorkClass.Ins && Object.getPrototypeOf(NetWorkClass.Ins)));
                if (nwProto && nwProto.sendMessage && !nwProto.__QA_THROTTLE__) {
                    nwProto.__QA_THROTTLE__ = true;
                    const origSendMsg = nwProto.sendMessage;
                    let lastSendTime = 0;
                    const lastProtoTimes = window.__LAST_PROTO_TIMES__ = window.__LAST_PROTO_TIMES__ || {};
                    nwProto.sendMessage = function (t, e, o) {
                        if (bot.state.kickedByOtherDevice || window.__BOT_HARD_STOPPED__) return;
                        window.__LAST_OUT_PROTO__ = t;
                        const now = Date.now();

                        // Ghi nhận thời điểm đóng trận (WarCloseCs - 10413) trên socket thô & Chống spam trùng lặp cùng 1 trận
                        if (t === 10413) {
                            const warId = (e && e._war_id) || (typeof o === "object" && o && o._war_id) || 0;
                            if (warId) {
                                const lastWarTime = lastProtoTimes[`10413_${warId}`] || 0;
                                if (now - lastWarTime < 600) {
                                    return; // Chỉ chặn spam đúp cùng 1 war_id trong 600ms
                                }
                                lastProtoTimes[`10413_${warId}`] = now;
                            }
                            lastProtoTimes[10413] = now;
                            window.__LAST_WAR_CLOSE_TIME__ = now;
                        }

                        // 1. Giãn cách gói tin WarStartCs (10401) của Ải Cốt Truyện (Type = 1) để chống Error 66
                        // QUAN TRỌNG: KHÔNG ĐƯỢC BỎ gói tin (game sẽ đợi phản hồi mãi -> kẹt ải). Chỉ HOÃN gửi
                        // tới khi đủ giãn cách; nếu có nhiều gói chờ thì chỉ giữ gói mới nhất.
                        // Với Tháp (2), Tần Lĩnh (9), Arena (101): Không bao giờ chặn
                        if (t === 10401) {
                            const bType = (e && e._type) || 1;
                            if (bType === 1) {
                                const mm = window.ModelManager || (gm && gm.ModelManager);
                                const bm = mm && mm.BattleModel;
                                const hasHangupBattle = !!(bm && typeof bm.getHangupBattleInfo === "function" && bm.getHangupBattleInfo());
                                const tm = (window.LoginUtil && window.LoginUtil.TransitionModel) || (gm && gm.LoginUtil && gm.LoginUtil.TransitionModel) || (mm && mm.TransitionModel);
                                const isTransitionDone = !(tm && typeof tm.isComplete === "function") || !!tm.isComplete();
                                const vm = bot.getViewManager ? bot.getViewManager() : window.ViewManager;
                                const isLoadingOpen = !!(vm && typeof vm.isOpenView === "function" && vm.isOpenView("LoadingView"));
                                const isLoginPreload = !window.__ENTER_GAME__ || !bot.state.hasLoggedInOnce || !hasHangupBattle || !isTransitionDone || isLoadingOpen;

                                // GIAI ĐOẠN ĐĂNG NHẬP / TẢI GAME (80-90% Transition Loading):
                                // BẮT BUỘC cho phép gói 10401 (Copy _type: 1) đi qua ngay lập tức để Server gửi dữ liệu trận treo ban đầu,
                                // kích hoạt BattleModel.preloadMainCopyRes() và Dispatcher.dispatchEvent("TransitionDegree_Update", { batteLevelRes: 1 })
                                // đưa thanh tiến trình từ 80-90% lên 100% hoàn tất vào game!
                                if (isLoginPreload) {
                                    lastProtoTimes[`10401_${bType}`] = now;
                                    lastProtoTimes[10401] = now;
                                    return origSendMsg.apply(this, arguments);
                                }

                                // SAU KHI ĐÃ VÀO GAME HOÀN TẤT:
                                // Nếu người chơi TẮT tính năng Vượt Ải trong bot, chặn gửi lặp gói đánh ải để không xung đột với Farm KNB
                                if (!bot.isAutoStageOn()) {
                                    if (window.__QA_PENDING_MAIN_START__) {
                                        clearTimeout(window.__QA_PENDING_MAIN_START__);
                                        window.__QA_PENDING_MAIN_START__ = null;
                                    }
                                    return;
                                }
                                const lastWarTime = lastProtoTimes[`10401_${bType}`] || 0;
                                const lastClose = window.__LAST_WAR_CLOSE_TIME__ || 0;
                                const lastOther = window.__LAST_OTHER_WAR_TIME__ || 0;
                                const lastFail = window.__LAST_WAR_FAIL_COOLDOWN__ || 0;
                                const busyUntil = (bot.state.battleInProgress || bot.state.rescueFightActive) ? (now + 2600) : 0;
                                const readyAt = Math.max(lastWarTime + 2200, lastClose + 350, lastOther + 2600, lastFail, busyUntil);
                                if (window.__QA_PENDING_MAIN_START__) {
                                    clearTimeout(window.__QA_PENDING_MAIN_START__);
                                    window.__QA_PENDING_MAIN_START__ = null;
                                }
                                if (now < readyAt) {
                                    const self = this, args = arguments;
                                    window.__QA_PENDING_MAIN_START__ = setTimeout(function () {
                                        window.__QA_PENDING_MAIN_START__ = null;
                                        if (!bot.isAutoStageOn()) return;
                                        try { self.sendMessage.apply(self, args); } catch (eSend) { }
                                    }, readyAt - now);
                                    return;
                                }
                                lastProtoTimes[`10401_${bType}`] = now;
                                lastProtoTimes[10401] = now;
                            } else {
                                if (window.__QA_PENDING_MAIN_START__) {
                                    clearTimeout(window.__QA_PENDING_MAIN_START__);
                                    window.__QA_PENDING_MAIN_START__ = null;
                                }
                                window.__LAST_OTHER_WAR_TIME__ = now;
                                lastProtoTimes[`10401_${bType}`] = now;
                                lastProtoTimes[10401] = now;
                            }
                        }

                        return origSendMsg.apply(this, arguments);
                    };
                }

                // ====================================================================
                // ANTI-KICK & NHƯỜNG MÁY THÔNG MINH (Không tranh chấp khi Điện thoại đăng nhập)
                // ====================================================================
                if (nwProto && !nwProto.__QA_KICK_GUARD__) {
                    nwProto.__QA_KICK_GUARD__ = true;

                    // 1. Hook onLoginKickSc: Khi máy chủ gửi mã kick (_res: 3 hoặc 0 do đăng nhập từ thiết bị khác)
                    const origKick = nwProto.onLoginKickSc;
                    nwProto.onLoginKickSc = function (event, data) {
                        const resCode = data && data._res != null ? data._res : 0;
                        bot.log(`🛡️ [Anti-Kick] Nhận thông điệp kick từ máy chủ: ${JSON.stringify(data || {})}`);

                        // Nếu tài khoản bị đăng nhập từ thiết bị khác (Điện thoại / PC khác):
                        // Server game gửi _res: 3 hoặc 0 khi có thiết bị khác đăng nhập
                        const isPhoneLogin = (resCode === 3 || resCode === 0);
                        if (isPhoneLogin) {
                            this.kickData = data;
                            bot.triggerEmergencyYield("Mã kick " + resCode);
                            return;
                        }

                        if (!bot.state.hasLoggedInOnce) {
                            if (origKick) return origKick.apply(this, arguments);
                            return;
                        }
                        this.kickData = data;
                        this._needFullRelogin = true;
                        this._isCanReconnect = true;
                        this.isManualClose = false;
                        this.isEnterGame = false;
                        this.isReconnecting = false;
                        bot.scheduleSafeReconnect(this, "kick_" + resCode, 2200);
                    };

                    // 1b. Hook onLoginTimeSc: Bảo đảm khi _needFullRelogin bật thì gửi LoginLoginCs (10101) trực tiếp không bị kẹt ở _waitingList
                    const origLoginTimeSc = nwProto.onLoginTimeSc;
                    if (origLoginTimeSc) {
                        nwProto.onLoginTimeSc = function (event, data) {
                            if (this._needFullRelogin && bot.state.hasLoggedInOnce && !bot.state.kickedByOtherDevice) {
                                this.isEnterGame = false;
                                this.isReconnecting = false;
                            }
                            return origLoginTimeSc.apply(this, arguments);
                        };
                    }

                    // 1c. Hook onLoginLoginSc: Hoàn tất tái xác thực phiên ngầm mà không làm đứng màn hình game
                    const origLoginLoginSc = nwProto.onLoginLoginSc;
                    if (origLoginLoginSc) {
                        nwProto.onLoginLoginSc = function (event, data) {
                            const wasRelogin = !!this._needFullRelogin;
                            this._needFullRelogin = false;
                            this._reconnectFailStreak = 0;
                            this.isReconnecting = false;
                            this.isEnterGame = true;
                            this._isCanReconnect = true;
                            this._reconnectCount = 0;
                            try { this.setShowLoading(false); } catch (e) { }
                            const res = origLoginLoginSc.apply(this, arguments);
                            if (wasRelogin && bot.state.hasLoggedInOnce) {
                                bot.log("✅ [Anti-Kick] Đã tái xác thực phiên đăng nhập ngầm thành công!");
                                const disp = (gm && gm.Dispatcher) || window.Dispatcher;
                                if (disp && typeof disp.dispatchEvent === "function") {
                                    try { disp.dispatchEvent("evt_LoginReconnectSc"); } catch (e) { }
                                }
                            }
                            return res;
                        };
                    }

                    // 1d. Hook onLoginReconnectSc: Đồng bộ cờ kết nối khi reconnect thường thành công
                    const origLoginReconnectSc = nwProto.onLoginReconnectSc;
                    if (origLoginReconnectSc) {
                        nwProto.onLoginReconnectSc = function (event, data) {
                            this._needFullRelogin = false;
                            this._reconnectFailStreak = 0;
                            this.isReconnecting = false;
                            this.isEnterGame = true;
                            this._isCanReconnect = true;
                            this._reconnectCount = 0;
                            try { this.setShowLoading(false); } catch (e) { }
                            bot.log("✅ [Anti-Kick] Đã kết nối lại WebSocket ngầm thành công!");
                            return origLoginReconnectSc.apply(this, arguments);
                        };
                    }

                    // 2. Hook onClose: Tự động khôi phục ngầm, nhưng nếu bị Điện thoại kick thì nhường ngay
                    const origOnClose = nwProto.onClose;
                    nwProto.onClose = function () {
                        if (bot.state.kickedByOtherDevice) {
                            this._isCanReconnect = false;
                            this.isManualClose = true;
                            this.isReconnecting = false;
                            try { if (this.heartBeat && typeof this.heartBeat.stop === "function") this.heartBeat.stop(); } catch (e) { }
                            return;
                        }
                        if (bot.state.hasLoggedInOnce) {
                            this._reconnectFailStreak = (this._reconnectFailStreak || 0) + 1;
                            const hadKick = !!this.kickData || !!this._needFullRelogin || (this._reconnectFailStreak >= 2);
                            this.kickData = null;
                            this._isCanReconnect = true;
                            this.isManualClose = false;
                            this.isReconnecting = false;
                            try { if (this.heartBeat && typeof this.heartBeat.stop === "function") this.heartBeat.stop(); } catch (e) { }
                            if (hadKick) {
                                this._needFullRelogin = true;
                                bot.scheduleSafeReconnect(this, "close_after_kick", 2200);
                            } else {
                                bot.scheduleSafeReconnect(this, "socket_close", 1800);
                            }
                            return;
                        }
                        this.kickData = null;
                        if (origOnClose) return origOnClose.apply(this, arguments);
                    };

                    // 2b. Hook onMaxReconnect: Chặn hiển thị lỗi khi vượt quá 3 lần thử, tự động reset bộ đếm và thử lại
                    const origMaxReconnect = nwProto.onMaxReconnect;
                    if (origMaxReconnect) {
                        nwProto.onMaxReconnect = function () {
                            if (bot.state.kickedByOtherDevice) return;
                            if (bot.state.hasLoggedInOnce) {
                                this._reconnectCount = 0;
                                this.isReconnecting = false;
                                this._isCanReconnect = true;
                                this._needFullRelogin = true;
                                try { this.setShowLoading(false); } catch (e) { }
                                bot.scheduleSafeReconnect(this, "max_reconnect", 2500);
                                return;
                            }
                            return origMaxReconnect.apply(this, arguments);
                        };
                    }

                    // 3. Hook showErrorTips: Nếu là thông báo kick/đăng nhập khác thì Nhường Máy ngay, nếu lỗi rớt mạng thì kết nối lại ngầm
                    const origShowErrorTips = nwProto.showErrorTips;
                    nwProto.showErrorTips = function (tip) {
                        const tipStr = String(tip || "");
                        const isKickTip = tipStr.includes("vui lòng đăng nhập lại") || 
                                          tipStr.includes("thiết bị khác") || 
                                          tipStr.includes("trùng lặp") || 
                                          tipStr.includes("phiên khác");
                        if (isKickTip) {
                            bot.triggerEmergencyYield("Thông báo lỗi: " + tipStr);
                            return;
                        }

                        if (!bot.state.hasLoggedInOnce) {
                            if (origShowErrorTips) return origShowErrorTips.apply(this, arguments);
                            return;
                        }
                        bot.log(`🛡️ [Anti-Kick] Đã chặn hộp thoại thông báo mạng: "${tipStr}" -> Tự động kết nối lại ngầm!`);
                        this._isCanReconnect = true;
                        this.isManualClose = false;
                        this.isReconnecting = false;
                        bot.scheduleSafeReconnect(this, "error_tips", 2000);
                    };
                }

                // 4. Hook LoginController & LoginUtil: Ngăn chặn Scheduler.unscheduleAll(), LoadingView đè giao diện và ModelManager.clear()
                try {
                    let lcMod = null;
                    if (typeof window.__require === "function") {
                        try { lcMod = window.__require("LoginController"); } catch (e) { }
                    }
                    const LoginControllerClass = (lcMod && (lcMod.LoginController || lcMod.default || lcMod)) || (gm && gm.LoginController) || window.LoginController;
                    const lcProto = LoginControllerClass && (LoginControllerClass.prototype || Object.getPrototypeOf(LoginControllerClass));
                    if (lcProto && !lcProto.__QA_KICK_GUARD__) {
                        lcProto.__QA_KICK_GUARD__ = true;

                        const origEvtLoginLoginSc = lcProto.evt_LoginLoginSc;
                        if (origEvtLoginLoginSc) {
                            lcProto.evt_LoginLoginSc = function () {
                                if (bot.state.hasLoggedInOnce && bot.isReady()) {
                                    const vm = bot.getViewManager();
                                    if (vm && typeof vm.close === "function") {
                                        try { vm.close("LoadingView"); } catch (e) { }
                                        try { vm.close("LoginView"); } catch (e) { }
                                    }
                                    if (vm && typeof vm.showReconnectWait === "function") {
                                        try { vm.showReconnectWait(false); } catch (e) { }
                                    }
                                    return;
                                }
                                return origEvtLoginLoginSc.apply(this, arguments);
                            };
                        }

                        const origLoginTips = lcProto.login_show_tips;
                        lcProto.login_show_tips = function (evt, tip, flag) {
                            if (!bot.state.hasLoggedInOnce) {
                                return origLoginTips ? origLoginTips.apply(this, arguments) : null;
                            }
                            bot.log(`🛡️ [Anti-Kick] Đã triệt tiêu popup ngắt kết nối từ LoginController (${tip || "no_tip"})!`);
                            const nw = (gm && gm.NetWork && gm.NetWork.Ins) || (window.NetWork && window.NetWork.Ins);
                            if (nw) {
                                if (this.clickData || (nw._reconnectFailStreak || 0) >= 2) nw._needFullRelogin = true;
                                bot.scheduleSafeReconnect(nw, "login_show_tips", 2000);
                            }
                        };
                    }

                    let luMod = null;
                    if (typeof window.__require === "function") {
                        try { luMod = window.__require("LoginUtil"); } catch (e) { }
                    }
                    const LoginUtilClass = (luMod && (luMod.LoginUtil || luMod.default || luMod)) || (gm && gm.LoginUtil) || window.LoginUtil;
                    if (LoginUtilClass && !LoginUtilClass.__QA_BACKTOLOGIN_GUARD__) {
                        LoginUtilClass.__QA_BACKTOLOGIN_GUARD__ = true;
                        const origBackToLogin = LoginUtilClass.backToLogin;
                        LoginUtilClass.backToLogin = function () {
                            if (bot.state.hasLoggedInOnce && !window.__ALLOW_MANUAL_LOGOUT__) {
                                bot.log("🛡️ [Anti-Kick] Đã chặn lệnh backToLogin/game_restart (Bảo vệ dữ liệu Model & Giao diện)!");
                                const nw = (gm && gm.NetWork && gm.NetWork.Ins) || (window.NetWork && window.NetWork.Ins);
                                if (nw) {
                                    if ((nw._reconnectFailStreak || 0) >= 2) nw._needFullRelogin = true;
                                    bot.scheduleSafeReconnect(nw, "block_backToLogin", 2000);
                                }
                                return;
                            }
                            if (origBackToLogin) return origBackToLogin.apply(this, arguments);
                        };
                    }
                } catch (e) { }

                // 5. Hook AlertUtil.show: Chặn đứng mọi hộp thoại yêu cầu khởi động lại / mất kết nối
                try {
                    let auMod = null;
                    if (typeof window.__require === "function") {
                        try { auMod = window.__require("AlertUtil"); } catch (e) { }
                    }
                    const AlertUtilClass = (auMod && (auMod.AlertUtil || auMod.default || auMod)) || (gm && gm.AlertUtil) || window.AlertUtil;
                    if (AlertUtilClass && !AlertUtilClass.__QA_ALERT_GUARD__) {
                        AlertUtilClass.__QA_ALERT_GUARD__ = true;
                        const origAlertShow = AlertUtilClass.show;
                        AlertUtilClass.show = function (opt) {
                            if (!bot.state.hasLoggedInOnce) {
                                return origAlertShow ? origAlertShow.apply(this, arguments) : null;
                            }
                            const txt = String((opt && (opt.text || opt.content || opt.title)) || "").toLowerCase();
                            const isKickOrNetAlert = (opt && opt.key === "relink1") ||
                                txt.includes("nội dung mới") ||
                                txt.includes("khởi động lại") ||
                                txt.includes("mất kết nối") ||
                                txt.includes("kết nối lại") ||
                                txt.includes("đăng nhập lại") ||
                                txt.includes("bảo trì");
                            if (isKickOrNetAlert) {
                                bot.log("🛡️ [Anti-Kick] Đã chặn hộp thoại ngắt kết nối/khởi động lại từ AlertUtil.show!");
                                const nw = (gm && gm.NetWork && gm.NetWork.Ins) || (window.NetWork && window.NetWork.Ins);
                                if (nw) bot.scheduleSafeReconnect(nw, "alert_intercept", 2000);
                                return [null, ""];
                            }
                            return origAlertShow ? origAlertShow.apply(this, arguments) : null;
                        };
                    }
                } catch (e) { }

                // Anti-Spam Hook cho RPCReq.send (Bảo vệ tất cả gói tin socket cấp cao)
                const rpc = (gm && gm.RPCReq) || window.RPCReq;
                if (rpc && rpc.send && !rpc.__QA_RPC_HOOKED__) {
                    rpc.__QA_RPC_HOOKED__ = true;
                    const origRpcSend = rpc.send;
                    const lastProtoTimes = window.__LAST_PROTO_TIMES__ = window.__LAST_PROTO_TIMES__ || {};
                    rpc.send = function (proto, data) {
                        window.__LAST_OUT_PROTO__ = proto;
                        window.__LAST_OUT_DATA__ = data;
                        const now = Date.now();
                        lastProtoTimes[proto] = now;
                        if (data && data._type != null) {
                            lastProtoTimes[`${proto}_${data._type}`] = now;
                        }


                        // 2. Ghi nhận thời điểm đóng trận (WarCloseCs - 10413) & Chống spam trùng lặp cùng 1 trận
                        if (proto === 10413) {
                            const warId = (data && data._war_id) || 0;
                            if (warId) {
                                const lastWarTime = lastProtoTimes[`10413_${warId}`] || 0;
                                if (now - lastWarTime < 600) {
                                    return; // Chỉ chặn spam đúp cùng 1 war_id trong 600ms
                                }
                                lastProtoTimes[`10413_${warId}`] = now;
                            }
                            lastProtoTimes[10413] = now;
                            window.__LAST_WAR_CLOSE_TIME__ = now;
                        }

                        // 3. Chống "Lỗi tham số": Chặn tuyệt đối RankLikeCs với RoleID <= 1
                        if (data && data._k !== undefined && data._v !== undefined) {
                            if (gm && gm.RankLikeCs && proto === gm.RankLikeCs.protocol) {
                                if (Number(data._v) <= 1) {
                                    console.warn("[RPC Guard] Chặn gói tin RankLikeCs với RoleID không hợp lệ:", data);
                                    return;
                                }
                            }
                        }

                        // 4. Bypass Kích Hoạt Khung Đại Diện & Danh Hiệu (TitleTitleActCs - 11927 / 11926)
                        if (proto === 11927 || proto === 11926 || (gm && gm.TitleTitleActCs && proto === gm.TitleTitleActCs.protocol)) {
                            const titleId = data && data._id;
                            if (titleId) {
                                const mm = window.ModelManager;
                                const pmInst = (mm && mm.PlayerModel) || ((gm && gm.PlayerModel && !gm.PlayerModel.prototype) ? gm.PlayerModel : null);
                                if (pmInst && typeof pmInst.setTitleTitleAct === "function") {
                                    pmInst.setTitleTitleAct({ _id: titleId });
                                }
                                const disp = (gm && gm.Dispatcher) || window.Dispatcher;
                                if (disp && typeof disp.dispatchEvent === "function") disp.dispatchEvent("title_info_update");
                                const tips = (gm && gm.RollTips) || window.RollTips;
                                if (tips && typeof tips.show === "function") tips.show("Kích hoạt thành công (Mod Client)!");
                            }
                            return; // Tuyệt đối không gửi gói 11927 lên server để tránh mã 4 (Thao tác quá nhanh)
                        }

                        // 4.1 Bypass Chọn Khung Đại Diện (Headframe) & Danh Hiệu (RoleTitle) (TitleTitleUseCs - 11923)
                        if (proto === 11923 || (gm && gm.TitleTitleUseCs && proto === gm.TitleTitleUseCs.protocol)) {
                            const titleId = data && data._id;
                            if (titleId) {
                                const mm = window.ModelManager;
                                const pmInst = (mm && mm.PlayerModel) || ((gm && gm.PlayerModel && !gm.PlayerModel.prototype) ? gm.PlayerModel : null);
                                const sc = (gm && gm.ShowConfiger) || window.ShowConfiger;
                                const cfg = sc && typeof sc.getShowCfgById === "function" ? sc.getShowCfgById(titleId) : null;

                                if (pmInst && typeof pmInst.setRoleTitle === "function") {
                                    pmInst.setRoleTitle(titleId);
                                }
                                if (cfg) {
                                    if (cfg.type === 2) {
                                        bot.settings.mod_headframe = titleId;
                                        bot.log(`🎨 [Mod Avatar] Đã kích hoạt Khung đại diện (Bypass): [ID ${titleId}] ${cfg.name || ""}`);
                                    } else if (cfg.type === 3) {
                                        bot.settings.mod_title = titleId;
                                        bot.log(`🎖️ [Mod Danh Hiệu] Đã kích hoạt Danh hiệu (Bypass): [ID ${titleId}] ${cfg.name || ""}`);
                                    }
                                }
                                if (typeof bot.saveSettings === "function") bot.saveSettings();
                                const disp = (gm && gm.Dispatcher) || window.Dispatcher;
                                if (disp && typeof disp.dispatchEvent === "function") disp.dispatchEvent("title_info_update");
                                const tips = (gm && gm.RollTips) || window.RollTips;
                                if (tips && typeof tips.show === "function") tips.show("Sử dụng thành công (Mod Client)!");

                                let isLegallyOwned = false;
                                try {
                                    if (pmInst && pmInst._origGetTitleTitleById) {
                                        isLegallyOwned = !!pmInst._origGetTitleTitleById(titleId);
                                    }
                                } catch (e) { }
                                if (!isLegallyOwned) return;
                            }
                        }

                        // 5. Bypass Chọn Ảnh Đại Diện (Avatar Head)
                        if (proto === 11904 || (gm && gm.TitleIconUseCs && proto === gm.TitleIconUseCs.protocol)) {
                            const iconStr = data && data._id;
                            if (iconStr) {
                                const mm = window.ModelManager;
                                const pmInst = (mm && mm.PlayerModel) || ((gm && gm.PlayerModel && !gm.PlayerModel.prototype) ? gm.PlayerModel : null);
                                if (pmInst && typeof pmInst.setRoleIcon === "function") {
                                    pmInst.setRoleIcon(iconStr);
                                }
                                bot.settings.mod_avatar = iconStr;
                                if (typeof bot.saveSettings === "function") bot.saveSettings();
                                bot.log(`🖼️ [Mod Avatar] Đã kích hoạt Ảnh đại diện (Bypass): [${iconStr}]`);
                                const disp = (gm && gm.Dispatcher) || window.Dispatcher;
                                if (disp && typeof disp.dispatchEvent === "function") disp.dispatchEvent("head_info_update");
                                const tips = (gm && gm.RollTips) || window.RollTips;
                                if (tips && typeof tips.show === "function") tips.show("Sử dụng ảnh đại diện thành công (Mod Client)!");

                                let isLegallyOwned = false;
                                try {
                                    if (pmInst && pmInst._origGetTitleIconByIdStr) {
                                        isLegallyOwned = !!pmInst._origGetTitleIconByIdStr(iconStr);
                                    }
                                } catch (e) { }
                                if (!isLegallyOwned) return;
                            }
                        }

                        // 6. Bypass Chọn Ngoại Trang (Hero Fashion Skin) trong CardFashionView
                        if (proto === 11964 || (gm && gm.TitleUseSkinCs && proto === gm.TitleUseSkinCs.protocol)) {
                            const hid = data && data._hid;
                            const skinId = data && data._skin_id;
                            if (hid && skinId) {
                                if (!bot.settings.hero_skins) bot.settings.hero_skins = {};
                                bot.settings.hero_skins[hid] = skinId;
                                if (typeof bot.saveSettings === "function") bot.saveSettings();
                                const disp = (gm && gm.Dispatcher) || window.Dispatcher;
                                if (disp && typeof disp.dispatchEvent === "function") {
                                    disp.dispatchEvent("evt_TitleUseSkinSc", { _hid: hid, _skin_id: skinId });
                                }
                                if (typeof bot.refreshBattleMainCopySkins === "function") {
                                    bot.refreshBattleMainCopySkins();
                                }
                                const tips = (gm && gm.RollTips) || window.RollTips;
                                if (tips && typeof tips.show === "function") tips.show("Trang bị ngoại trang thành công (Mod Client)!");
                                return;
                            }
                        }

                        return origRpcSend.apply(this, arguments);
                    };
                }



                // Hook 1: ViewManager.open - Cho phép mở đầy đủ BattlePrepareView / TeamArrayView / BattleBeginView
                const vm = bot.getViewManager();
                if (vm && vm.open && !vm.__QA_HOOKED__) {
                    vm.__QA_HOOKED__ = true;
                    const origOpen = vm.open;
                    vm.open = function (viewName, args, cb) {
                        // Màn hình chuẩn bị trận và xếp trận của người chơi KHÔNG BAO GIỜ bị chặn
                        if (viewName === "BattlePrepareView" || viewName === "TeamArrayView" || (args && args.isSelfArray)) {
                            return origOpen.apply(this, arguments);
                        }
                        // BattleBeginView: LUÔN LUÔN cho phép mở để trận đấu diễn ra và kết thúc bình thường (Boss, Tần Lĩnh, v.v.)
                        return origOpen.apply(this, arguments);
                    };
                }

                // Helper: Hỗ trợ Native SkipBattle trực tiếp từ engine Cocos (kết thúc ngay tức thì 0s, không vào cảnh chiến đấu)
                // Chỉ áp dụng cho các chế độ game CÓ HỖ TRỢ SKIP NATIVE:
                // Tháp Thông Thiên (2), Tháp Trận Doanh (12..16), Phụ bản ngày (3), Đấu trường (101)
                // Tuyệt đối KHÔNG gộp Bí Cảnh Tần Lĩnh (9), Ải Chính Tuyến (1), Leo Hạng Liên Server / Lôi Đài (105), và các loại Boss (4, 6, 10, v.v.) vào đây!
                function canNativeSkipBattle(gameplayType) {
                    const t = Number(gameplayType);
                    return (
                        t === 2 ||                           // Tower (Leo tháp)
                        (t >= 12 && t <= 16) ||              // YsTower 1..5 (Tháp nguyên tố / trận doanh)
                        t === 3 ||                           // DailyDungeon (Phụ bản hằng ngày)
                        t === 101 ||                         // Arena (Đấu trường)
                        t === 106 ||                         // Revolt (Giải cứu gia viên)
                        t === 105                            // CityFight (Đánh cướp gia viên)
                    );
                }

                // Hook 2: BattleController & FightManager - Quản lý cờ skipBattle, triệt tiêu toast "Hãy chờ tổng kết trận này"
                bot.hookBattleController = function () {
                    try {
                        let bcMod = null;
                        if (typeof window.__require === "function") {
                            try { bcMod = window.__require("BattleController"); } catch (e) { }
                        }
                        const BattleControllerClass = (bcMod && (bcMod.BattleController || bcMod.default || bcMod)) ||
                            (window.ControllerManager && window.ControllerManager.allPath && window.ControllerManager.allPath.BattleController) ||
                            (gm && gm.BattleController) || window.BattleController;

                        const bcProto = (BattleControllerClass && BattleControllerClass.prototype) ||
                            (window.ControllerManager && window.ControllerManager._controllers && window.ControllerManager._controllers.BattleController && Object.getPrototypeOf(window.ControllerManager._controllers.BattleController));

                        if (bcProto && !bcProto.__QA_HOOKED__) {
                            bcProto.__QA_HOOKED__ = true;

                            const origStartBttle = bcProto.startBttle;
                            bcProto.startBttle = function (battleData) {
                                if (battleData) {
                                    if (battleData._id) {
                                        window.__LAST_WAR_ID__ = battleData._id;
                                    }
                                    if (battleData._type != null) {
                                        if (battleData._type !== 1 && battleData._type !== 106 && battleData._type !== 105) {
                                            window.__LAST_OTHER_WAR_TIME__ = Date.now();
                                            bot.state.lastBattleEndTime = Date.now() + 2500;
                                        }
                                        if (!bot.state.lastBattleByType) bot.state.lastBattleByType = {};
                                        const bEntry = {
                                            warId: battleData._id,
                                            type: battleData._type,
                                            copyId: battleData._copy_id,
                                            winner: battleData._winner,
                                            roles: battleData._data_role,
                                            time: Date.now(),
                                            closed: false
                                        };
                                        bot.state.lastBattleByType[battleData._type] = bEntry;
                                        bot.state.lastAnyBattle = bEntry;
                                    }
                                }
                                if (origStartBttle) return origStartBttle.apply(this, arguments);
                            };

                            const origWarCloseSc = bcProto.evt_WarCloseSc;
                            if (origWarCloseSc) {
                                bcProto.evt_WarCloseSc = function (e, t) {
                                    try {
                                        const bType = t && t._type;
                                        if (bType != null) {
                                            if (bot.state.lastBattleByType && bot.state.lastBattleByType[bType]) {
                                                bot.state.lastBattleByType[bType].closed = true;
                                                bot.state.lastBattleByType[bType].closeData = t;
                                            }
                                            const fmInst = window.FightManager || (gm && gm.FightManager);
                                            if (fmInst && fmInst.copyRequstStatus) {
                                                fmInst.copyRequstStatus[bType] = 0;
                                            }
                                        }
                                    } catch (err) { }
                                    return origWarCloseSc.apply(this, arguments);
                                };
                            }

                            const origOpenPrepare = bcProto.openPrepareView;
                            bcProto.openPrepareView = function (e) {
                                if (Number(e) === 105) {
                                    const fmInst = window.FightManager || (gm && gm.FightManager);
                                    if (fmInst && typeof fmInst.removeFight === "function" && fmInst.haveFight && fmInst.haveFight(105)) {
                                        try { fmInst.removeFight(105); } catch (err) { }
                                    }
                                }
                                if (origOpenPrepare) return origOpenPrepare.apply(this, arguments);
                            };

                            const origCheckConfig = bcProto.checkBattleConfigFun;
                            bcProto.checkBattleConfigFun = function (e, t) {
                                if (canNativeSkipBattle(e) && bot.settings.skip_battle) {
                                    if (!this.BattleConfigs) this.BattleConfigs = {};
                                    this.BattleConfigs[e] = this.BattleConfigs[e] || {};
                                    this.BattleConfigs[e].skipBattle = true;
                                    this.BattleConfigs[e].quickNext = false;
                                    if (t) {
                                        t.isBackGroud = true;
                                        t.hideMainBottom = false;
                                        let res;
                                        if (origCheckConfig) {
                                            res = origCheckConfig.apply(this, arguments);
                                        }
                                        const fmInst = window.FightManager || (gm && gm.FightManager);
                                        const vmInst = bot.getViewManager();
                                        if (fmInst) {
                                            if (t.battleData && t.battleData._id && typeof fmInst.requestWarClose === "function") {
                                                fmInst.requestWarClose(t.battleData._id);
                                            }
                                            if (typeof fmInst.removeFight === "function") {
                                                try { fmInst.removeFight(e); } catch (err) { }
                                            }
                                            if (fmInst.fightList && fmInst.fightList[e]) {
                                                delete fmInst.fightList[e];
                                            }
                                            if (fmInst.copyRequstStatus) {
                                                fmInst.copyRequstStatus[e] = 0;
                                            }
                                        }
                                        if (vmInst && typeof vmInst.close === "function") {
                                            vmInst.close("BattlePrepareView");
                                            vmInst.close("TeamArrayView");
                                        }
                                        return res;
                                    }
                                }
                                if (origCheckConfig) return origCheckConfig.apply(this, arguments);
                            };

                            const origHasSkip = bcProto.hasSkipBattle;
                            bcProto.hasSkipBattle = function (e) {
                                if (canNativeSkipBattle(e) && bot.settings.skip_battle) return true;
                                if (origHasSkip) return origHasSkip.apply(this, arguments);
                                return false;
                            };

                            const origBattleReset = bcProto.battle_reset;
                            bcProto.battle_reset = function (e, t) {
                                if (Number(e) === 105) {
                                    const fmInst = window.FightManager || (gm && gm.FightManager);
                                    if (fmInst && typeof fmInst.removeFight === "function" && fmInst.haveFight && fmInst.haveFight(105)) {
                                        try { fmInst.removeFight(105); } catch (err) { }
                                    }
                                }
                                if (origBattleReset) return origBattleReset.apply(this, arguments);
                            };

                            const origBattleReqFunc = bcProto.battle_requestFunc;
                            bcProto.battle_requestFunc = function (e, t, i) {
                                const gType = (i && i.arrayType != null) ? i.arrayType : (typeof e === "number" ? e : 0);
                                const isSkip = canNativeSkipBattle(gType) && bot.settings.skip_battle;

                                const fmInst = window.FightManager || (gm && gm.FightManager);
                                const vmInst = window.ViewManager || (gm && gm.ViewManager);
                                const isBattleOpen = vmInst && typeof vmInst.isOpenView === "function" && (vmInst.isOpenView("BattleBeginView") || vmInst.isOpenView("BatteJingzhouView"));
                                if (!isBattleOpen && isSkip) {
                                    if (fmInst && fmInst.fightList) {
                                        for (let k in fmInst.fightList) {
                                            if (canNativeSkipBattle(k) || Number(k) === 105) {
                                                if (typeof fmInst.removeFight === "function") {
                                                    try { fmInst.removeFight(Number(k)); } catch (err) { }
                                                }
                                                if (fmInst.fightList && fmInst.fightList[k]) {
                                                    delete fmInst.fightList[k];
                                                }
                                            }
                                        }
                                    }
                                }

                                if (i && isSkip) {
                                    i.skipBattle = true;
                                }
                                if (origBattleReqFunc) return origBattleReqFunc.apply(this, arguments);
                            };

                            const origClickNext = bcProto.battle_ClickNext;
                            bcProto.battle_ClickNext = function (e, t, i) {
                                const gType = (i && i.arrayType != null) ? i.arrayType : (typeof e === "number" ? e : 0);
                                if (i && canNativeSkipBattle(gType) && bot.settings.skip_battle) {
                                    i.skipBattle = true;
                                }
                                if (origClickNext) return origClickNext.apply(this, arguments);
                            };

                            const origTryToOpen = bcProto.tryToOpen;
                            bcProto.tryToOpen = function (e, t) {
                                if (Number(e) === 105) {
                                    const fmInst = window.FightManager || (gm && gm.FightManager);
                                    if (fmInst && typeof fmInst.removeFight === "function" && fmInst.haveFight && fmInst.haveFight(105)) {
                                        try { fmInst.removeFight(105); } catch (err) { }
                                    }
                                }
                                const fmInst = window.FightManager || (gm && gm.FightManager);
                                if (fmInst && typeof fmInst.haveFightOnPlay === "function") {
                                    const a = fmInst.haveFightOnPlay();
                                    if (a && typeof a.getArgsInfo === "function") {
                                        const args = a.getArgsInfo();
                                        if (args && args.hideMainBottom) {
                                            const vmInst = window.ViewManager || (gm && gm.ViewManager);
                                            const isBattleOpen = vmInst && typeof vmInst.isOpenView === "function" && vmInst.isOpenView("BattleBeginView");
                                            if (!isBattleOpen) {
                                                args.hideMainBottom = false;
                                            }
                                        }
                                    }
                                }
                                if (origTryToOpen) return origTryToOpen.apply(this, arguments);
                            };
                        }
                    } catch (eBc) { }
                };
                bot.hookBattleController();

                // Hook 2.1: FightManager.haveFightOnPlay - Chống kẹt trận ngầm chiếm foreground gây chặn thao tác
                let fmMod = null;
                if (typeof window.__require === "function") {
                    try { fmMod = window.__require("FightManager"); } catch (e) { }
                }
                const fmClass = (fmMod && (fmMod.FightManager || fmMod.default || fmMod)) || (gm && gm.FightManager) || window.FightManager;
                if (fmClass && typeof fmClass.haveFightOnPlay === "function" && !fmClass.__QA_PLAY_HOOKED__) {
                    fmClass.__QA_PLAY_HOOKED__ = true;
                    const origHaveFightOnPlay = fmClass.haveFightOnPlay;
                    fmClass.haveFightOnPlay = function () {
                        const vmInst = window.ViewManager || (gm && gm.ViewManager);
                        const isBattleOpen = vmInst && typeof vmInst.isOpenView === "function" && (vmInst.isOpenView("BattleBeginView") || vmInst.isOpenView("BatteJingzhouView"));
                        if (!isBattleOpen) {
                            if (this.fightList) {
                                for (let k in this.fightList) {
                                    const f = this.fightList[k];
                                    if (f && typeof f.getArgsInfo === "function") {
                                        const args = f.getArgsInfo();
                                        if (args) {
                                            args.isBackGroud = true;
                                            args.hideMainBottom = false;
                                        }
                                    }
                                }
                            }
                            return undefined;
                        }
                        const activeFight = origHaveFightOnPlay ? origHaveFightOnPlay.apply(this, arguments) : undefined;
                        return activeFight;
                    };
                }

                // Hook 2.5: FubenManager - Quản lý cờ skipBattle đúng chế độ hỗ trợ
                const fm = (gm && gm.FubenManager) || window.FubenManager;
                if (fm && fm.prototype && !fm.prototype.__QA_HOOKED__) {
                    fm.prototype.__QA_HOOKED__ = true;
                    const origReqWar = fm.prototype.reqWar;
                    fm.prototype.reqWar = function (e) {
                        if (bot.settings.skip_battle && this.param && canNativeSkipBattle(this.param.arrayType)) {
                            this.param.skipBattle = true;
                        }
                        if (origReqWar) return origReqWar.apply(this, arguments);
                    };

                    const origEnter = fm.prototype.enter;
                    fm.prototype.enter = function (e, t, i, a, o, n, r, s) {
                        const isSkip = canNativeSkipBattle(e) && bot.settings.skip_battle;
                        const res = origEnter ? origEnter.call(this, e, t, i, a, o, n, r, isSkip ? true : s) : null;
                        if (this.param && isSkip) {
                            this.param.skipBattle = true;
                        }
                        return res;
                    };

                    const origEnterNew = fm.prototype.enterNew;
                    fm.prototype.enterNew = function (e, t, i) {
                        if (t && canNativeSkipBattle(e) && bot.settings.skip_battle) {
                            t.skipBattle = true;
                        }
                        if (origEnterNew) return origEnterNew.apply(this, arguments);
                    };
                }

                // Hook 2.6: ArenaModel - Ép GetArenaSkipBattle = true
                const am = (gm && gm.ArenaModel) || (window.ModelManager && window.ModelManager.ArenaModel);
                if (am && am.prototype && !am.prototype.__QA_SKIP_HOOKED__) {
                    am.prototype.__QA_SKIP_HOOKED__ = true;
                    const origArenaSkip = am.prototype.GetArenaSkipBattle;
                    am.prototype.GetArenaSkipBattle = function () {
                        if (bot.settings.skip_battle) return true;
                        if (origArenaSkip) return origArenaSkip.apply(this, arguments);
                        return false;
                    };
                }

                // Hook 2.65: BattleModel - Tua nhanh tốc độ trận đấu an toàn, mượt mà (60fps), không làm giật lag game
                try {
                    const bm = (gm && gm.BattleModel) || (window.ModelManager && window.ModelManager.BattleModel);
                    if (bm && bm.prototype && !bm.prototype.__QA_SPEED_HOOKED__) {
                        bm.prototype.__QA_SPEED_HOOKED__ = true;
                        const origGetSpeedVal = bm.prototype.getBatteSpeedVal;
                        bm.prototype.getBatteSpeedVal = function (e) {
                            const base = origGetSpeedVal ? origGetSpeedVal.apply(this, arguments) : 1;
                            const spd = (bot.settings && bot.settings.speed_hack) || 1;
                            return Math.min(3.0, base * spd);
                        };

                        const origChangeSpeed = bm.prototype.changeSpeedIndex;
                        bm.prototype.changeSpeedIndex = function (e, t) {
                            if (origChangeSpeed) origChangeSpeed.apply(this, arguments);
                            const spd = (bot.settings && bot.settings.speed_hack) || 1;
                            if (spd > 1 && window.cc && window.cc.director) {
                                const s = window.cc.director.getScheduler();
                                if (s && s.setTimeScale) s.setTimeScale(Math.min(2.5, spd));
                            }
                        };

                        const origResetSpeed = bm.prototype.resetGameSpeed;
                        bm.prototype.resetGameSpeed = function () {
                            if (origResetSpeed) origResetSpeed.apply(this, arguments);
                            // KHI HẾT TRẬN: BẮT BUỘC TRẢ LẠI TỐC ĐỘ 1.0 CHO TOÀN BỘ GIAO DIỆN GAME ĐỂ CHỐNG GIẬT LAG!
                            try {
                                if (window.cc && window.cc.director) {
                                    const s = window.cc.director.getScheduler();
                                    if (s && s.setTimeScale) s.setTimeScale(1.0);
                                }
                            } catch (e) { }
                        };
                    }
                } catch (e) { }

                // Hook CameraController.fguiShakeView - Triệt tiêu rung giật màn hình khi đánh nhanh / bỏ qua trận để đồ họa mượt mà không bị giật
                try {
                    let ccMod = null;
                    if (typeof window.__require === "function") {
                        try { ccMod = window.__require("CameraController"); } catch (e) { }
                    }
                    const CameraClass = (ccMod && (ccMod.CameraController || ccMod)) || (gm && gm.CameraController) || window.CameraController;
                    if (CameraClass && !CameraClass.__QA_SHAKE_HOOKED__) {
                        CameraClass.__QA_SHAKE_HOOKED__ = true;
                        const origFguiShake = CameraClass.fguiShakeView;
                        CameraClass.fguiShakeView = function (e) {
                            if ((bot.settings && bot.settings.skip_battle) || bot.isAutoStageOn()) {
                                return; // Chống rung giật màn hình khi đang tua nhanh / auto
                            }
                            if (origFguiShake) return origFguiShake.apply(this, arguments);
                        };
                    }
                } catch (e) { }

                // Hook 2.66: ClimbtowerView - Chống kẹt trạng thái "Đang chiến đấu" (com_is_battle) và khôi phục nút Khiêu chiến
                try {
                    let ctvMod = null;
                    if (typeof window.__require === "function") {
                        try { ctvMod = window.__require("ClimbtowerView"); } catch (e) { }
                    }
                    const ClimbtowerViewClass = (ctvMod && (ctvMod.ClimbtowerView || ctvMod.default || ctvMod)) || (gm && gm.ClimbtowerView) || window.ClimbtowerView;
                    if (ClimbtowerViewClass && ClimbtowerViewClass.prototype && !ClimbtowerViewClass.prototype.__QA_CLEAN_HOOKED__) {
                        ClimbtowerViewClass.prototype.__QA_CLEAN_HOOKED__ = true;
                        const origCheckInBattle = ClimbtowerViewClass.prototype.checkIsInbattle;
                        ClimbtowerViewClass.prototype.checkIsInbattle = function () {
                            try {
                                const fm = window.FightManager || (gm && gm.FightManager);
                                const vm = window.ViewManager || (gm && gm.ViewManager);
                                if (fm && typeof fm.haveFight === "function" && fm.haveFight(2)) {
                                    const isBattleOpen = vm && typeof vm.isOpenView === "function" && vm.isOpenView("BattleBeginView");
                                    if (!isBattleOpen && typeof fm.removeFight === "function") {
                                        fm.removeFight(2);
                                    }
                                }
                            } catch (err) { }
                            if (origCheckInBattle) return origCheckInBattle.apply(this, arguments);
                        };

                        const origFight = ClimbtowerViewClass.prototype.fight;
                        ClimbtowerViewClass.prototype.fight = function () {
                            try {
                                const fm = window.FightManager || (gm && gm.FightManager);
                                const vm = window.ViewManager || (gm && gm.ViewManager);
                                if (fm && typeof fm.haveFight === "function" && fm.haveFight(2)) {
                                    const isBattleOpen = vm && typeof vm.isOpenView === "function" && vm.isOpenView("BattleBeginView");
                                    if (!isBattleOpen && typeof fm.removeFight === "function") {
                                        fm.removeFight(2);
                                    }
                                }
                            } catch (err) { }
                            const now = Date.now();
                            if (now - (this.__lastFightClickTime || 0) < 600) {
                                return;
                            }
                            this.__lastFightClickTime = now;
                            if (origFight) return origFight.apply(this, arguments);
                        };
                    }
                } catch (e) { }

                // Hook 2.68: VIP & Module Unlocker - Bypass Toàn Diện Tính Năng Khóa & Mở Mỏ Đội Hình 2 (Lv.75)
                try {
                    const mu = (gm && gm.ModuleUtil) || window.ModuleUtil;
                    if (mu && !mu.__QA_VIP_UNLOCK_HOOKED__) {
                        mu.__QA_VIP_UNLOCK_HOOKED__ = true;

                        // 1. Mở khóa nút Skip (quickEnd) trong tất cả các giao diện trận đấu
                        const origSkipOpen = mu.skipOpen;
                        mu.skipOpen = function (t, i) {
                            if (bot.settings && bot.settings.skip_battle) {
                                return ["", true];
                            }
                            if (origSkipOpen) {
                                const res = origSkipOpen.apply(this, arguments);
                                if (res && res[1]) return res;
                            }
                            return ["", true];
                        };

                        // 2. Mở trước và bypass toàn diện mọi module tiện ích, tự động, đội hình mỏ 2
                        const VIP_CONVENIENCE_IDS = [
                            12,  // NextCopy (Ải kế tiếp)
                            13,  // FightSkip (Bỏ qua trận đấu)
                            14,  // FightWhack (Đánh nhanh)
                            15,  // FightData (Xem thông số / số liệu dữ liệu trận đấu)
                            18,  // BoxAuto (Tự động mở rương)
                            37,  // FightSpeed2 (Tốc độ x2)
                            38,  // FightSpeed3 (Tốc độ x3)
                            39,  // FightSpeed4 (Tốc độ x4)
                            42,  // Rune (Phù Văn)
                            73,  // ArenaSkip (Bỏ qua đấu trường)
                            76,  // LotteryJump (Bỏ qua hoạt ảnh chiêu mộ gacha)
                            80,  // Privilege (VIP)
                            81,  // PrivilegeBox (Đặc quyền rương)
                            82,  // PrivilegeHook (Đặc quyền nhận nhanh treo máy)
                            83,  // PrivilegeBuild (Đặc quyền xây gia viên)
                            86,  // NoticeAuto (Tự động thông báo)
                            87,  // MenuBarAuto (Tự động thanh công cụ)
                            89,  // Pet (Linh Thú)
                            91,  // PetLottery (Chiêu Mộ Linh Thú)
                            95,  // PrivilegePet (Đặc quyền linh thú)
                            100, // DefenseJZTeam (Đội hình thủ thành Diễn Võ)
                            103, // MasterAcce (Phụ Kiện Quan Chức / Căn Cốt)
                            105, // MasterCareer (Quan Chức / Chức Nghiệp)
                            106, // MasterDrug (Đan Dược Tăng Thuộc Tính)
                            114, // Artifact (Thần Khí)
                            115, // ArtifactUpStar (Tăng Sao Thần Khí)
                            116, // ArtifactJl (Giác Ngộ Thần Khí)
                            119, // DrawHreo (Chiêu Mộ Danh Tướng)
                            120, // DrawGodweapon (Chiêu Mộ Thần Binh)
                            122, // PrivilegeFlip (Đặc quyền lật bài)
                            129, // RuneBuild (Ghép Phù Văn)
                            135, // EquipStrong (CƯỜNG HÓA TRANG BỊ TƯỚNG)
                            136, // RuneRecast (Đúc Lại Phù Văn)
                            140, // GodEquip (Thần Trang)
                            141, // Forge (LÒ RÈN & ĐÚC TRANG BỊ)
                            152, // GuildMine (Chiếm Mỏ Bang Hội)
                            153, // Magic (Ma Tinh)
                            154, // MagicLottery (TÀNG BẢO CÁC / RƯƠNG GIÁM BẢO - PHÁP BẢO & BÙA PHÙ)
                            155, // Treasure (BẢO VẬT PHỤ KIỆN TƯỚNG)
                            157, // RefineEquip (TẨY LUYỆN TRANG BỊ TƯỚNG)
                            158, // ShopMine (Shop Mỏ)
                            160, // Equip (MỞ KHÓA TOÀN BỘ Ô TRANG BỊ TƯỚNG: VŨ KHÍ, GIÁP, MŨ, HÀI)
                            164, // MineTeam2 (MỞ KHÓA MỎ ĐỘI HÌNH 2 - BYPASS LV.75)
                            165, // PrivilegeMine (Đặc quyền Chiếm Mỏ)
                            167, // ManualAuto (Tự kích hoạt đồ giám)
                            172, // TeamSet (Thiết lập đội hình)
                            174, // HeroBag2 (Túi tướng mở rộng)
                            177, // BoxEqBtn (Lọc trang bị rương)
                            178, // BoxEqSave (Lưu cấu hình lọc trang bị)
                            179, // BoxEqTime (Mở rương theo thời gian)
                            180, // EquipStone (Khảm Đá Trang Bị)
                            182, // EquipStoneLan (Khảm Đá Lam)
                            183, // EquipStoneLv (Khảm Đá Lục)
                            184, // EquipStoneZi (Khảm Đá Tím)
                            185, // EquipStoneHong (Khảm Đá Đỏ)
                            187, // HookQuick (Thu hoạch nhanh treo máy)
                            192, // PrivilegeForver (Đặc quyền vĩnh viễn)
                            195, // RankOneKey (Bái kiến 1 chạm tất cả BXH)
                            198, // ManualFashion (Thời Trang Tướng)
                            201, // ExploreAuto (Tự động thám hiểm)
                            203, // ShopAutobuy1 (Tự động mua đồ shop)
                            206, // FlipAuto (Tự động lật bài)
                            208, // DefaultTeam (Thiết lập đội hình)
                            209, // DefaultTeam1 (Mở khóa đội hình 1)
                            210, // DefaultTeam2 (Mở khóa đội hình 2)
                            211, // DefaultTeam3 (Mở khóa đội hình 3)
                            212, // GameTeam2 (Mở khóa đội hình chiến đấu 2)
                            213, // DailyDungeonAuto (Càn quét Phụ bản ngày 1-chạm)
                            214, // CityRewardAuto (Tự động nhận quà thành trì)
                            216, // FriendTeamMake (Tạo đội bạn bè)
                            218, // CrossArenaAdSkip (Bỏ qua QC đấu trường liên server)
                            220, // StarAuto (Tự động tăng sao)
                            225, // QuickHired (Thuê nhanh)
                            226, // GodEquipStrong (Cường Hóa Thần Trang)
                            230, // Yinfu (ÂM PHÙ & CHIÊU MỘ ÂM PHÙ)
                            231, // YinfuQuick (Đánh nhanh Âm Phù)
                            233, // Rides (HỆ THỐNG THÚ CƯỠI / TOẠ KỴ)
                            234, // RidesMainview (Giao Diện Thú Cưỡi)
                            235, // RidesEmbattle (Trận hình Thú Cưỡi)
                            236, // RidesEquip (PHỤ KIỆN & TRANG BỊ THÚ CƯỠI)
                            237, // RidesManual (Đồ Giám Thú Cưỡi)
                            238, // RidesDec (Chi Tiết Thú Cưỡi)
                            239, // DrawCard (Rút Thẻ)
                            240, // DrawFriend (Chiêu Mộ Bạn Bè)
                            241, // DrawCamp (Chiêu Mộ Trận Doanh)
                            245, // HeroTransferSet (Chuyển giao trận hình nhanh)
                            246, // HeroStarPlus (Sao Tướng Thần)
                            267, // SiegeAutoFight (Tự động công thành)
                            268, // SiegeAutoFarm (Tự động farm công thành)
                            269, // SiegeFastTraining (Huấn luyện nhanh công thành)
                            310, // HeroAddScore (Cộng điểm tướng)
                            311, // QuickHelp (Nút Trợ Thủ - HelperMainView trên Màn hình chính)
                            312, // YinfuBossQuick (Đánh nhanh Boss Âm Phù)
                            314, // ArtifactFuling (Phù linh thần khí)
                            315  // BoxRecycle (Tái chế rương)
                        ];

                        const VIP_SET = new Set(VIP_CONVENIENCE_IDS.map(Number));

                        // Helper kiểm tra xem modId có phải là mốc Xem Trước Tính Năng (FunPre / ModuleNotice) nhận 50 Vàng không
                        const isNoticeMilestone = function (modId) {
                            if (!modId) return false;
                            try {
                                const mc = (gm && gm.ModuleConfiger) || window.ModuleConfiger;
                                if (mc) {
                                    if (typeof mc.getModuleNoticeCfg === "function" && mc.getModuleNoticeCfg(modId)) return true;
                                    if (typeof mc.getFunPreIds === "function") {
                                        const funIds = mc.getFunPreIds();
                                        if (Array.isArray(funIds) && funIds.indexOf(+modId) !== -1) return true;
                                    }
                                }
                            } catch (e) { }
                            return false;
                        };

                        // CHỈ nạp trước các module tiện ích VIP vào _hasOpen
                        // TUYỆT ĐỐI KHÔNG nạp 1..1000 để tránh kích hoạt kiểm tra gói tài nguyên chưa tải (subpackage hot-update)
                        if (!mu._hasOpen) mu._hasOpen = {};
                        for (let id of VIP_CONVENIENCE_IDS) {
                            mu._hasOpen[id] = id;
                        }

                        // Hook mu.moduleOpen:
                        // - ModuleNotice (mốc thưởng 50 Vàng): BẮT BUỘC gọi logic gốc kiểm tra cấp độ thật của server để chống lỗi 66
                        // - VIP Convenience (bao gồm 164 MineTeam2 mở mỏ đội hình 2): Luôn bypass mở (true)
                        // - Các module khác: Gọi logic gốc để bảo đảm không bị lỗi reload do thiếu tài nguyên subpackage
                        const origModuleOpen = mu.moduleOpen;
                        mu.moduleOpen = function (t, i) {
                            if (mu._closeModuleId && mu._closeModuleId[t]) return false;
                            if (isNoticeMilestone(t)) {
                                return origModuleOpen ? origModuleOpen.apply(this, arguments) : false;
                            }
                            if (VIP_SET.has(+t)) {
                                return true;
                            }
                            return origModuleOpen ? origModuleOpen.apply(this, arguments) : true;
                        };

                        // Hook mu.hasModuleOpen:
                        const origHasModuleOpen = mu.hasModuleOpen;
                        mu.hasModuleOpen = function (t, i) {
                            if (mu._closeModuleId && mu._closeModuleId[t]) return false;
                            if (isNoticeMilestone(t)) {
                                return origHasModuleOpen ? origHasModuleOpen.apply(this, arguments) : false;
                            }
                            if (VIP_SET.has(+t)) {
                                return true;
                            }
                            return origHasModuleOpen ? origHasModuleOpen.apply(this, arguments) : true;
                        };

                        // Hook mu.getModuleOpenTips:
                        const origGetTips = mu.getModuleOpenTips;
                        mu.getModuleOpenTips = function (t, i) {
                            if (mu._closeModuleId && mu._closeModuleId[t]) {
                                return origGetTips ? origGetTips.apply(this, arguments) : "Chưa mở";
                            }
                            if (VIP_SET.has(+t)) {
                                return "";
                            }
                            return origGetTips ? origGetTips.apply(this, arguments) : "";
                        };

                        // Hook mu.getConditionTip: Chỉ trả về thỏa mãn cho các module VIP tiện ích
                        const origGetConditionTip = mu.getConditionTip;
                        mu.getConditionTip = function (t) {
                            const modId = t && (typeof t === "object" ? t.id : t);
                            if (modId && VIP_SET.has(+modId)) {
                                return ["", true, false];
                            }
                            return origGetConditionTip ? origGetConditionTip.apply(this, arguments) : ["", true, false];
                        };

                        const origGetModuleOpenState = mu.getModuleOpenState;
                        mu.getModuleOpenState = function (t, i) {
                            const modId = t && (typeof t === "object" ? t.id : t);
                            if (modId && VIP_SET.has(+modId)) {
                                return ["", true, false];
                            }
                            return origGetModuleOpenState ? origGetModuleOpenState.apply(this, arguments) : ["", true, false];
                        };

                        // Guard FunPreModel: Ngăn chặn gửi RPC nhận thưởng 50 Vàng khi thực tế nhân vật chưa đủ cấp
                        try {
                            const fpm = (gm && gm.FunPreModel) || (window.ModelManager && window.ModelManager.FunPreModel);
                            const fpmProto = fpm && (fpm.prototype || Object.getPrototypeOf(fpm));
                            if (fpmProto && !fpmProto.__QA_GUARD_HOOKED__) {
                                fpmProto.__QA_GUARD_HOOKED__ = true;
                                const origReqPick = fpmProto.reqPickModuleNotice;
                                fpmProto.reqPickModuleNotice = function (id) {
                                    try {
                                        if (origModuleOpen && !origModuleOpen.call(mu, id, false)) {
                                            bot.log(`[FunPre] Bỏ qua gửi nhận mốc ${id} do nhân vật chưa đạt cấp/điều kiện thực tế.`);
                                            return;
                                        }
                                    } catch (e) { }
                                    if (origReqPick) return origReqPick.apply(this, arguments);
                                };
                            }
                        } catch (e) { }
                    }

                    // 3. Đặc Quyền VIP (Privilege 1..8 - Đào 50 rương, Treo máy, Thêm Thợ Gia Viên, Giảm giá Pet, Lật Thẻ Flip...)
                    const rsm = (gm && gm.RechargeShopModel) || (window.ModelManager && window.ModelManager.RechargeShopModel);
                    const rsmProto = rsm && (rsm.prototype || Object.getPrototypeOf(rsm));
                    if (rsmProto && !rsmProto.__QA_PRIV_HOOKED__) {
                        rsmProto.__QA_PRIV_HOOKED__ = true;

                        const origUpdatePriv = rsmProto.updatePrivilegeHis;
                        rsmProto.updatePrivilegeHis = function (e) {
                            if (e && Array.isArray(e._list)) {
                                if (!this._realPrivilegeData) this._realPrivilegeData = {};
                                for (let item of e._list) {
                                    if (item && item._id) this._realPrivilegeData[item._id] = item;
                                }
                            }
                            if (origUpdatePriv) return origUpdatePriv.apply(this, arguments);
                        };

                        rsmProto.havePrivilegeById = function (id) {
                            // 1. Đặc Quyền 2: Bỏ qua QC 0s & Treo máy (client-side) -> Luôn mở
                            if (id === 2) {
                                return bot.settings.skip_ads !== false;
                            }
                            // 2. Đặc Quyền 1: Mở khóa Đào 50 rương (PrivilegeOpenBoxCnt)
                            // CHỈ trả về true khi tài khoản THỰC SỰ có Đặc Quyền 1 từ server (hoặc còn hạn sử dụng).
                            // Nếu chưa mua/hết hạn, trả về false để game tính đúng số lượng hợp pháp của VIP và cấp Rương (VD: VIP 4 đào 40 rương/lần).
                            if (id === 1) {
                                const real = this._realPrivilegeData && this._realPrivilegeData[1];
                                if (real) {
                                    const stm = (window.ModelManager && window.ModelManager.ServerTimeModel) || (gm && gm.ServerTimeModel);
                                    const now = stm && stm.getServerTime ? stm.getServerTime() : Math.floor(Date.now() / 1000);
                                    return (real._e_sec === 0 || real._e_sec > now);
                                }
                                return false;
                            }
                            // 3. Đặc Quyền 3: Thêm Thợ Gia Viên (PrivilegeHostWoker)
                            if (id === 3) {
                                const real = this._realPrivilegeData && this._realPrivilegeData[3];
                                if (real) {
                                    const stm = (window.ModelManager && window.ModelManager.ServerTimeModel) || (gm && gm.ServerTimeModel);
                                    const now = stm && stm.getServerTime ? stm.getServerTime() : Math.floor(Date.now() / 1000);
                                    return (real._e_sec === 0 || real._e_sec > now);
                                }
                                return false;
                            }
                            // 4. Các đặc quyền khác (4..8): kiểm tra dữ liệu server thực tế
                            const real = this._realPrivilegeData && this._realPrivilegeData[id];
                            if (real) {
                                const stm = (window.ModelManager && window.ModelManager.ServerTimeModel) || (gm && gm.ServerTimeModel);
                                const now = stm && stm.getServerTime ? stm.getServerTime() : Math.floor(Date.now() / 1000);
                                return (real._e_sec === 0 || real._e_sec > now);
                            }
                            return false;
                        };

                        const origGetPrivilege = rsmProto.getPrivilegeHisById;
                        rsmProto.getPrivilegeHisById = function (id) {
                            // Chỉ bypass client cho Đặc Quyền 2 (Bỏ qua QC 0s)
                            if (id === 2) {
                                if (!this._privilegeData) this._privilegeData = {};
                                if (!this._privilegeData[id]) {
                                    this._privilegeData[id] = { _id: id, _e_sec: 0, _is_forever: 1, _state: 1, _is_fake: true };
                                }
                                return this._privilegeData[id];
                            }
                            if (this._realPrivilegeData && this._realPrivilegeData[id]) {
                                return this._realPrivilegeData[id];
                            }
                            if (origGetPrivilege) return origGetPrivilege.apply(this, arguments);
                            return null;
                        };
                    }

                    // 4. Mở khóa Càn Quét Phụ Bản Ngày (Daily Copy Sweep)
                    const cpm = (gm && gm.CopyModel) || (window.ModelManager && window.ModelManager.CopyModel);
                    const cpmProto = cpm && (cpm.prototype || Object.getPrototypeOf(cpm));
                    if (cpmProto && !cpmProto.__QA_SWEEP_HOOKED__) {
                        cpmProto.__QA_SWEEP_HOOKED__ = true;
                        cpmProto.bOpenDailyCopySweep = function () {
                            return true;
                        };
                    }

                    // 5. Mở rộng sức chứa hiển thị túi tướng (chống popup túi đầy khi chiêu mộ)
                    const hbm = (gm && gm.HeroBagModel) || (window.ModelManager && window.ModelManager.HeroBagModel);
                    const hbmProto = hbm && (hbm.prototype || Object.getPrototypeOf(hbm));
                    if (hbmProto && !hbmProto.__QA_BAGMAX_HOOKED__) {
                        hbmProto.__QA_BAGMAX_HOOKED__ = true;
                        hbmProto.getBagMaxNum = function () {
                            return 9999;
                        };
                    }

                    // 6. MỞ KHÓA MỎ ĐỘI HÌNH 2 (CROSS MINE TEAM 2 - BYPASS LV.75)
                    const cmm = (gm && gm.CrossMineModel) || (window.ModelManager && window.ModelManager.CrossMineModel);
                    const cmmProto = cmm && (cmm.prototype || Object.getPrototypeOf(cmm));
                    if (cmmProto && !cmmProto.__QA_MINE_T2_HOOKED__) {
                        cmmProto.__QA_MINE_T2_HOOKED__ = true;
                        cmmProto.getTeam2IsUnlock = function () {
                            return true;
                        };

                        // Helper bảo đảm mineInfo._team luôn có dữ liệu Đội hình 2 chống crash undefined
                        const ensureMineTeam2 = function (mineInfo) {
                            if (!mineInfo || !Array.isArray(mineInfo._team)) return;
                            let t2 = mineInfo._team.find(t => t && t._idx === 2);
                            if (!t2) {
                                const p0 = (mineInfo._team[0] && mineInfo._team[0]._power) || 120;
                                mineInfo._team.push({
                                    _idx: 2,
                                    _hole: 0,
                                    _room: 0,
                                    _loot_time: 0,
                                    _loot_score: 0,
                                    _power: p0,
                                    _array: []
                                });
                            }
                        };

                        const desc = Object.getOwnPropertyDescriptor(cmmProto, "mineInfo");
                        if (desc && desc.set) {
                            const origSet = desc.set;
                            const origGet = desc.get;
                            Object.defineProperty(cmmProto, "mineInfo", {
                                get: function () {
                                    const val = origGet ? origGet.call(this) : this._mineInfo;
                                    ensureMineTeam2(val);
                                    return val;
                                },
                                set: function (val) {
                                    ensureMineTeam2(val);
                                    return origSet.call(this, val);
                                },
                                configurable: true,
                                enumerable: true
                            });
                        }

                        // Đồng bộ dữ liệu hiện tại nếu model đã có sẵn
                        if (window.ModelManager && window.ModelManager.CrossMineModel && window.ModelManager.CrossMineModel.mineInfo) {
                            ensureMineTeam2(window.ModelManager.CrossMineModel.mineInfo);
                        }
                    }

                    // 7. Mở khóa Đội hình 2 & 3 Công Thành (Siege City) & Thiên Sư (Tianshi Rank)
                    const cwm = (gm && gm.CountryWarModel) || (window.ModelManager && window.ModelManager.CountryWarModel);
                    const cwmProto = cwm && (cwm.prototype || Object.getPrototypeOf(cwm));
                    if (cwmProto && !cwmProto.__QA_SIEGE_TEAM_HOOKED__) {
                        cwmProto.__QA_SIEGE_TEAM_HOOKED__ = true;
                        cwmProto.isTeamUnlockByIdx = function () {
                            return true;
                        };
                    }

                    const tsm = (gm && gm.TianshiModel) || (window.ModelManager && window.ModelManager.TianshiModel);
                    const tsmProto = tsm && (tsm.prototype || Object.getPrototypeOf(tsm));
                    if (tsmProto && !tsmProto.__QA_TIANSHI_TEAM_HOOKED__) {
                        tsmProto.__QA_TIANSHI_TEAM_HOOKED__ = true;
                        tsmProto.isTeamUnlockByIdx = function () {
                            return true;
                        };
                    }

                    // 7.5. MỞ KHÓA TOÀN BỘ Ô TRANG BỊ & PHỤ KIỆN TƯỚNG (RuneSystemModel.posUnlock)
                    // Mở khóa: Ô Trang Bị 4 món (Vũ khí/Giáp/Mũ/Hài), Ô Phù Văn, Ô Thiên Phú, Ô Thần Khí
                    const runesm = (gm && gm.RuneSystemModel) || (window.ModelManager && window.ModelManager.RuneSystemModel);
                    const runesmProto = runesm && (runesm.prototype || Object.getPrototypeOf(runesm));
                    if (runesmProto && !runesmProto.__QA_POS_UNLOCK_HOOKED__) {
                        runesmProto.__QA_POS_UNLOCK_HOOKED__ = true;
                        runesmProto.posUnlock = function (e, t, i) {
                            return [true, "", ""];
                        };
                    }

                    // 8. Hook View Chiếm Mỏ: Mở khóa giao diện và nút chọn Đội hình 2
                    try {
                        let cmmvMod = null;
                        if (typeof window.__require === "function") {
                            try { cmmvMod = window.__require("CrossMineMyTeamView"); } catch (e) { }
                        }
                        const CrossMineMyTeamViewClass = (cmmvMod && (cmmvMod.CrossMineMyTeamView || cmmvMod.default || cmmvMod)) || (gm && gm.CrossMineMyTeamView) || window.CrossMineMyTeamView;
                        if (CrossMineMyTeamViewClass && CrossMineMyTeamViewClass.prototype && !CrossMineMyTeamViewClass.prototype.__QA_T2_HOOKED__) {
                            CrossMineMyTeamViewClass.prototype.__QA_T2_HOOKED__ = true;
                            const origShowView = CrossMineMyTeamViewClass.prototype.showView;
                            CrossMineMyTeamViewClass.prototype.showView = function () {
                                if (origShowView) origShowView.apply(this, arguments);
                                try {
                                    if (this.teamItem2) {
                                        const ctrl = this.teamItem2.getController && this.teamItem2.getController("lock");
                                        if (ctrl) ctrl.setSelectedIndex(0);
                                    }
                                } catch (e) { }
                            };
                        }
                    } catch (e) { }

                    try {
                        let cmmMainMod = null;
                        if (typeof window.__require === "function") {
                            try { cmmMainMod = window.__require("CrossMineMainView"); } catch (e) { }
                        }
                        const CrossMineMainViewClass = (cmmMainMod && (cmmMainMod.CrossMineMainView || cmmMainMod.default || cmmMainMod)) || (gm && gm.CrossMineMainView) || window.CrossMineMainView;
                        if (CrossMineMainViewClass && CrossMineMainViewClass.prototype && !CrossMineMainViewClass.prototype.__QA_T2_HOOKED__) {
                            CrossMineMainViewClass.prototype.__QA_T2_HOOKED__ = true;
                            const origUpdateTeam = CrossMineMainViewClass.prototype.updateTeam;
                            CrossMineMainViewClass.prototype.updateTeam = function (e) {
                                try {
                                    if (e && Array.isArray(e) && !e.some(t => t && t._idx === 2)) {
                                        e.push({
                                            _idx: 2,
                                            _hole: 0,
                                            _room: 0,
                                            _loot_time: 0,
                                            _loot_score: 0,
                                            _power: (e[0] && e[0]._power) || 120,
                                            _array: []
                                        });
                                    }
                                } catch (err) { }
                                if (origUpdateTeam) origUpdateTeam.apply(this, arguments);
                                try {
                                    if (this.T2LockNode) this.T2LockNode.setVisible(false);
                                    if (this.barNode2) this.barNode2.setVisible(true);
                                } catch (err) { }
                            };
                        }
                    } catch (e) { }

                    // Áp dụng mở khóa toàn diện Đội 2 Mỏ (CrossMine Team 2 - Bypass Lv.75)
                    try {
                        if (typeof bot.enforceMineTeam2Unlock === "function") {
                            bot.enforceMineTeam2Unlock();
                        }
                    } catch (e) { }
                } catch (e) { }

            // Hook 2.70: Bypass Giới Hạn Tầng & Lực Chiến Gia Nhập Tổ Đội Cấm Địa (Multi-Layer Super Bypass)
            bot.hookTeamRestrictionBypass();
            bot.hookYyzqBuffViews();

                // Hook 2.69: BattleSecnesView - Mở khóa nút Bỏ Qua và tự động kết thúc trận đấu sau 350ms
                try {
                    let bsvMod = null;
                    if (typeof window.__require === "function") {
                        try { bsvMod = window.__require("BattleSecnesView"); } catch (e) { }
                    }
                    const BattleSecnesViewClass = (bsvMod && (bsvMod.BattleSecnesView || bsvMod.default || bsvMod)) || (gm && gm.BattleSecnesView) || window.BattleSecnesView;
                    if (BattleSecnesViewClass && BattleSecnesViewClass.prototype && !BattleSecnesViewClass.prototype.__QA_BSV_HOOKED__) {
                        BattleSecnesViewClass.prototype.__QA_BSV_HOOKED__ = true;

                        const origCheckSkip = BattleSecnesViewClass.prototype.checkSkip;
                        BattleSecnesViewClass.prototype.checkSkip = function () {
                            if (this.quickEndState) this.quickEndState.setSelectedPage("normal");
                            if (this.quickEnd) {
                                this.quickEnd.setVisible(true);
                                this.quickEnd.setTouchable(true);
                            }
                            return ["", true];
                        };

                        const origChangeSkip = BattleSecnesViewClass.prototype.changeSkip;
                        BattleSecnesViewClass.prototype.changeSkip = function (lock) {
                            if (bot.settings && bot.settings.skip_battle) {
                                if (this.quickEndState) this.quickEndState.setSelectedPage("normal");
                                if (this.quickEnd) {
                                    this.quickEnd.setVisible(true);
                                    this.quickEnd.setTouchable(true);
                                }
                                return;
                            }
                            if (origChangeSkip) return origChangeSkip.apply(this, arguments);
                        };

                        const origBattleSetData = BattleSecnesViewClass.prototype.battle_setData;
                        BattleSecnesViewClass.prototype.battle_setData = function () {
                            if (origBattleSetData) origBattleSetData.apply(this, arguments);
                            const self = this;
                            window.__CURRENT_BATTLE_SCENES_VIEW__ = self;
                            if (self.battleData && self.battleData._id) {
                                window.__LAST_WAR_ID__ = self.battleData._id;
                            }
                            if (self.quickEndState) self.quickEndState.setSelectedPage("normal");
                            if (self.quickEnd) {
                                self.quickEnd.setVisible(true);
                                self.quickEnd.setTouchable(true);
                            }
                            if (bot.settings && bot.settings.skip_battle) {
                                setTimeout(() => {
                                    try {
                                        if (self.view && self.view.parent && (self.view.visible !== false)) {
                                            bot.doBattleSkip(self);
                                        }
                                    } catch (err) { }
                                }, 350);
                            }
                        };

                        const origInitUI = BattleSecnesViewClass.prototype._initUI;
                        BattleSecnesViewClass.prototype._initUI = function () {
                            if (origInitUI) origInitUI.apply(this, arguments);
                            const self = this;
                            window.__CURRENT_BATTLE_SCENES_VIEW__ = self;
                            if (this.quickEndState) this.quickEndState.setSelectedPage("normal");
                            if (this.quickEnd) {
                                this.quickEnd.setVisible(true);
                                this.quickEnd.setTouchable(true);
                                if (!this.quickEnd.__QA_CLICK_HOOKED__) {
                                    this.quickEnd.__QA_CLICK_HOOKED__ = true;
                                    this.quickEnd.addClickListener(() => {
                                        bot.doBattleSkip(self);
                                    });
                                }
                            }
                            try {
                                const mm = window.ModelManager;
                                if (mm && mm.BattleModel && typeof mm.BattleModel.changeSpeedIndex === "function") {
                                    mm.BattleModel.changeSpeedIndex(3, true);
                                    if (typeof this.setSpeedBtnState === "function") this.setSpeedBtnState(3);
                                }
                            } catch (eSpd) { }
                        };

                        const origBsvDestroy = BattleSecnesViewClass.prototype.onDestroy;
                        BattleSecnesViewClass.prototype.onDestroy = function () {
                            if (window.__CURRENT_BATTLE_SCENES_VIEW__ === this) {
                                window.__CURRENT_BATTLE_SCENES_VIEW__ = null;
                            }
                            if (origBsvDestroy) return origBsvDestroy.apply(this, arguments);
                        };
                    }
                } catch (e) { }

                // Hook 2.68: BatteJingzhouView - Đảm bảo bỏ qua trận đấu Bí Cảnh Tần Lĩnh an toàn 100% không văng lỗi
                try {
                    let bjvMod = null;
                    if (typeof window.__require === "function") {
                        try { bjvMod = window.__require("BatteJingzhouView"); } catch (e) { }
                    }
                    const BatteJingzhouViewClass = (bjvMod && (bjvMod.BatteJingzhouView || bjvMod.default || bjvMod)) || (gm && gm.BatteJingzhouView) || window.BatteJingzhouView;
                    if (BatteJingzhouViewClass && BatteJingzhouViewClass.prototype && !BatteJingzhouViewClass.prototype.__QA_HOOKED__) {
                        BatteJingzhouViewClass.prototype.__QA_HOOKED__ = true;

                        const origJzBattleNext = BatteJingzhouViewClass.prototype.battle_Next;
                        BatteJingzhouViewClass.prototype.battle_Next = function (ev, data) {
                            if (!data) data = this.fightDate || (bot.getFightManager() && bot.getFightManager().getFightState(9));
                            if (data) {
                                if (!data.battleData && this.battleData) {
                                    data.battleData = this.battleData;
                                }
                                if (data.battleData && data.battleData._id) {
                                    window.__LAST_WAR_ID__ = data.battleData._id;
                                }
                            }
                            if (origJzBattleNext) {
                                try {
                                    return origJzBattleNext.call(this, ev, data);
                                } catch (eJz) {
                                    console.warn("[BatteJingzhouView battle_Next safe]", eJz);
                                }
                            }
                        };

                        const origJzInitUI = BatteJingzhouViewClass.prototype._initUI;
                        BatteJingzhouViewClass.prototype._initUI = function () {
                            if (origJzInitUI) origJzInitUI.apply(this, arguments);
                            window.__CURRENT_BATTLE_JZ_VIEW__ = this;
                            if (this.battleData && this.battleData._id) {
                                window.__LAST_WAR_ID__ = this.battleData._id;
                            }
                        };

                        const origJzUpdate = BatteJingzhouViewClass.prototype.updateData;
                        BatteJingzhouViewClass.prototype.updateData = function (data) {
                            if (origJzUpdate) origJzUpdate.apply(this, arguments);
                            window.__CURRENT_BATTLE_JZ_VIEW__ = this;
                            if (this.battleData && this.battleData._id) {
                                window.__LAST_WAR_ID__ = this.battleData._id;
                            }
                        };

                        const origJzExit = BatteJingzhouViewClass.prototype.__onExit;
                        BatteJingzhouViewClass.prototype.__onExit = function () {
                            if (window.__CURRENT_BATTLE_JZ_VIEW__ === this) {
                                window.__CURRENT_BATTLE_JZ_VIEW__ = null;
                            }
                            if (origJzExit) return origJzExit.apply(this, arguments);
                        };
                    }
                } catch (e) { }

                // Đảm bảo các instance BattleConfigs hiện tại được cập nhật cờ skipBattle đúng chế độ
                try {
                    let bcCls = null;
                    if (typeof window.__require === "function") {
                        try {
                            const bcM = window.__require("BattleController");
                            bcCls = bcM && (bcM.BattleController || bcM.default || bcM);
                        } catch (e) { }
                    }
                    bcCls = bcCls || (window.G_Mapping && window.G_Mapping.BattleController) || window.BattleController;
                    const ctlInst = window.ControllerManager && window.ControllerManager._controllers && window.ControllerManager._controllers.BattleController;
                    const bcInst = ctlInst || (bcCls && (bcCls.I || bcCls.instance));
                    if (bcInst && bcInst.BattleConfigs) {
                        for (const k in bcInst.BattleConfigs) {
                            if (bcInst.BattleConfigs[k]) {
                                if (canNativeSkipBattle(k) && bot.settings.skip_battle) {
                                    bcInst.BattleConfigs[k].skipBattle = true;
                                } else {
                                    bcInst.BattleConfigs[k].skipBattle = false;
                                }
                            }
                        }
                    }
                } catch (e) { }

                // Hook 2.7: BattleResultView & BattleResult - SỬA TRIỆT ĐỂ LỖI TREO KHI BẤM XÁC NHẬN LEO THÁP / PHỤ BẢN
                try {
                    let brvMod = null;
                    if (typeof window.__require === "function") {
                        try { brvMod = window.__require("BattleResultView"); } catch (e) { }
                    }
                    const BattleResultViewClass = (brvMod && (brvMod.BattleResultView || brvMod.default || brvMod)) || (gm && gm.BattleResultView) || window.BattleResultView;
                    if (BattleResultViewClass && BattleResultViewClass.prototype && !BattleResultViewClass.prototype.__QA_SAFE_EXIT__) {
                        BattleResultViewClass.prototype.__QA_SAFE_EXIT__ = true;

                        // Chống crash TypeError: Cannot read property '_type' of null khi closeView() bị gọi trùng lặp
                        const origExit = BattleResultViewClass.prototype._exit;
                        BattleResultViewClass.prototype._exit = function () {
                            bot.state.viewingBattleData = false;
                            bot.state.towerInProgress = false;
                            bot.state.defjzInProgress = false;
                            bot.state.battleInProgress = false;
                            if (!this.battleData && !this._args) {
                                return;
                            }
                            try {
                                const bType = (this.battleData && this.battleData._type) || (this._args && this._args.battleData && this._args.battleData._type) || (this._args && this._args.arrayType) || 0;
                                const fmInst = window.FightManager || (gm && gm.FightManager);
                                if (fmInst && bType) {
                                    if (typeof fmInst.removeFight === "function") {
                                        try { fmInst.removeFight(bType); } catch (eRm) { }
                                    }
                                    if (fmInst.fightList && fmInst.fightList[bType]) {
                                        delete fmInst.fightList[bType];
                                    }
                                    if (fmInst.copyRequstStatus) {
                                        fmInst.copyRequstStatus[bType] = 0;
                                    }
                                }
                                const compName = this._compName;
                                if (this._curPageClass) {
                                    this._curPageClass.bindObj = null;
                                    this._curPageClass = null;
                                }
                                const disp = (gm && gm.Dispatcher) || (window.G_Mapping && window.G_Mapping.Dispatcher) || window.Dispatcher;
                                const evType = (gm && gm.EventType) || (window.G_Mapping && window.G_Mapping.EventType) || window.EventType;
                                if (disp) {
                                    disp.dispatchEvent("queue_pop_next", compName);
                                    if (bType && evType && evType.close_battle_result) {
                                        disp.dispatchEvent(evType.close_battle_result, bType);
                                    }
                                }
                                this.battleData = null;
                                if (this._args) {
                                    this._args.battleData = null;
                                    this._args.battleFunc = null;
                                    this._args = null;
                                }
                                const mm = window.ModelManager || (gm && gm.ModelManager);
                                if (mm && mm.RewardModel && typeof mm.RewardModel.playRewardInQue === "function") {
                                    mm.RewardModel.playRewardInQue();
                                }
                                if (mm && mm.TaskModel && typeof mm.TaskModel.showNextPopup === "function") {
                                    mm.TaskModel.showNextPopup();
                                }
                            } catch (eExit) {
                                console.warn("[BattleResultView _exit Guard]", eExit);
                            }
                        };

                        const origShowView = BattleResultViewClass.prototype.showView;
                        BattleResultViewClass.prototype.showView = function () {
                            if (origShowView) origShowView.apply(this, arguments);
                            try {
                                if (this.battleData) bot.lastBattleData = this.battleData;
                                // Giữ nguyên _bgClose = false theo thiết kế game gốc để click ngoài màn hình không làm mất bảng kết quả
                                this._bgClose = false;
                                if (this._closeBtn && typeof this._closeBtn.addClickListener === "function") {
                                    this._closeBtn.addClickListener(() => {
                                        bot.state.viewingBattleData = false;
                                        this.closeView();
                                    });
                                }
                            } catch (e) { }

                            // KHÔNG tự động đóng khi người chơi đang xem kết quả hoặc muốn xem dữ liệu thông số!
                            // Tuyệt đối KHÔNG tự động đóng nếu người chơi đang mở giao diện Tháp (ClimbtowerView) hoặc đang xem bảng dữ liệu
                            const bType = (this.battleData && this.battleData._type) || (this._args && this._args.battleData && this._args.battleData._type) || (this._args && this._args.arrayType) || 0;

                            // TẮT HOÀN TOÀN BẢNG THẮNG/THUA & QUÀ 50 KNB CỦA GIẢI CỨU GIA VIÊN (Revolt = 106 / CityFight = 105)
                            if (Number(bType) === 106 || Number(bType) === 105) {
                                try {
                                    if (this.view) {
                                        this.view.visible = false;
                                        this.view.alpha = 0;
                                    }
                                    if (this.node) this.node.active = false;
                                } catch (eHide) { }
                                const self = this;
                                setTimeout(() => {
                                    try {
                                        if (self._curPageClass && typeof self._curPageClass.okClick === "function") {
                                            self._curPageClass.okClick();
                                        } else if (typeof self.closeView === "function") {
                                            self.closeView();
                                        }
                                    } catch (eOk) { }
                                }, 20);
                                return;
                            }

                            const isBossOrDefJz = bType === 9 || bType === 4 || bType === 6 || bType === 10 || bType === 103 || bType === 104 || !canNativeSkipBattle(bType);
                            const vm = bot.getViewManager();
                            const isTowerUIOpen = vm && typeof vm.isOpenView === "function" && vm.isOpenView("ClimbtowerView");

                            // Chỉ tự động đóng trễ nếu ĐANG CHẠY AUTO THÁP NGẦM và NGƯỜI CHƠI KHÔNG MỞ GIAO DIỆN THÁP và KHÔNG xem dữ liệu
                            if (!isBossOrDefJz && !isTowerUIOpen && bot.state.towerInProgress && bot.state.isAutoTowerActive) {
                                const self = this;
                                setTimeout(() => {
                                    try {
                                        if (bot.state.viewingBattleData) return;
                                        const curVm = bot.getViewManager();
                                        if (curVm && typeof curVm.isOpenView === "function" && (curVm.isOpenView("BattledataView") || curVm.isOpenView("PanelBattleData") || curVm.isOpenView("ClimbtowerView"))) {
                                            return;
                                        }
                                        if (bot.isViewVisible(self)) {
                                            bot.log("⚔️ Tự động đóng bảng kết quả trận đấu (BattleResultView)");
                                            if (self._curPageClass && typeof self._curPageClass.okClick === "function") {
                                                self._curPageClass.okClick();
                                            } else if (typeof self.closeView === "function") {
                                                self.closeView();
                                            }
                                        }
                                    } catch (e) { }
                                }, 3000);
                            }
                        };
                    }

                    // Hook BattleResult: Cho phép xem đầy đủ thông số / dữ liệu trận đấu (BattledataView) và xử lý click an toàn
                    let brMod = null;
                    if (typeof window.__require === "function") {
                        try { brMod = window.__require("BattleResult"); } catch (e) { }
                    }
                    const BattleResultClass = (brMod && (brMod.BattleResult || brMod.default || brMod)) || (gm && gm.BattleResult) || window.BattleResult;
                    if (BattleResultClass && BattleResultClass.prototype && !BattleResultClass.prototype.__QA_SAFE_CLICK__) {
                        BattleResultClass.prototype.__QA_SAFE_CLICK__ = true;

                        // 1. Cho phép xem data thông số trận đấu bất kỳ lúc nào cho mọi loại trận (kể cả ải chính)
                        const origDataClick = BattleResultClass.prototype.dataClick;
                        BattleResultClass.prototype.dataClick = function () {
                            try {
                                bot.state.viewingBattleData = true;
                                const vm = bot.getViewManager();
                                if (vm && typeof vm.open === "function") {
                                    const bData = this._battleData || this.battleData || (this._curPageClass && this._curPageClass._battleData) || (this._parentTarget && (this._parentTarget.battleData || this._parentTarget._battleData)) || this._args || bot.lastBattleData || (window.ModelManager && window.ModelManager.BattleModel && window.ModelManager.BattleModel.getHangupBattleInfo());
                                    if (bData) {
                                        bot.log("📊 Đang mở bảng thống kê dữ liệu thông số trận đấu (BattledataView)...");
                                        vm.open("BattledataView", bData);
                                        return;
                                    }
                                }
                            } catch (e) {
                                console.warn("[BattleResult dataClick Guard]", e);
                            }
                            if (origDataClick) return origDataClick.apply(this, arguments);
                        };

                        // 2. Luôn hiển thị nút "Dữ liệu" (btn_data) và "Xem lại" (btn_replay) trong mọi kết quả trận đấu
                        const origRefreshUI = BattleResultClass.prototype.refreshUI;
                        BattleResultClass.prototype.refreshUI = function (e, t, i) {
                            if (origRefreshUI) origRefreshUI.apply(this, arguments);
                            try {
                                if (e) bot.lastBattleData = e;
                                if (this.battle_handler) {
                                    this.battle_handler.setVisible(true);
                                }
                                if (this.btn_data) {
                                    this.btn_data.setVisible(true);
                                    this.btn_data.setTouchable(true);
                                }
                                if (this.btn_replay) {
                                    this.btn_replay.setVisible(true);
                                    this.btn_replay.setTouchable(true);
                                }
                            } catch (err) { }
                        };

                        BattleResultClass.prototype.okClick = function () {
                            bot.state.viewingBattleData = false;
                            try {
                                if (typeof this._okCall === "function") {
                                    this._okCall();
                                } else if (this._args) {
                                    // Khi game không gán callback cho nút Xác nhận (như ở BattleTowerEx), tự động gọi setBackCall để quay về giao diện Tháp và làm mới
                                    const mm = window.ModelManager || (gm && gm.ModelManager);
                                    if (mm && mm.RewardModel && typeof mm.RewardModel.setBackCall === "function") {
                                        mm.RewardModel.setBackCall(this._args);
                                    }
                                }
                            } catch (e) {
                                console.error("[BattleResult okClick Error]", e);
                            }

                            // Đóng view an toàn (chỉ gọi 1 lần qua ViewManager)
                            try {
                                const vm = bot.getViewManager();
                                if (vm && typeof vm.isOpenView === "function" && vm.isOpenView("BattleResultView")) {
                                    vm.close("BattleResultView");
                                } else if (this._parentTarget && !this._parentTarget.isDisposed && typeof this._parentTarget.closeView === "function") {
                                    this._parentTarget.closeView();
                                }
                            } catch (e) { }
                        };

                        BattleResultClass.prototype.nextClick = function () {
                            bot.state.viewingBattleData = false;
                            try {
                                if (typeof this._nextCall === "function") {
                                    this._nextCall();
                                } else if (this._args) {
                                    const mm = window.ModelManager || (gm && gm.ModelManager);
                                    if (mm && mm.RewardModel && typeof mm.RewardModel.setBackCall === "function") {
                                        mm.RewardModel.setBackCall(this._args);
                                    }
                                }
                            } catch (e) {
                                console.error("[BattleResult nextClick Error]", e);
                            }

                            try {
                                const vm = bot.getViewManager();
                                if (vm && typeof vm.isOpenView === "function" && vm.isOpenView("BattleResultView")) {
                                    vm.close("BattleResultView");
                                } else if (this._parentTarget && !this._parentTarget.isDisposed && typeof this._parentTarget.closeView === "function") {
                                    this._parentTarget.closeView();
                                }
                            } catch (e) { }
                        };
                    }

                    // Hook PanelBattleData (Giao diện hiển thị thống kê dữ liệu thông số DPS / Sát thương / Trị liệu): Chống crash và cho phép đóng mở mượt mà
                    try {
                        let pbdMod = null;
                        if (typeof window.__require === "function") {
                            try { pbdMod = window.__require("PanelBattleData"); } catch (e) { }
                        }
                        const PanelBattleDataClass = (pbdMod && (pbdMod.PanelBattleData || pbdMod.default || pbdMod)) || (gm && gm.PanelBattleData) || window.PanelBattleData;
                        if (PanelBattleDataClass && PanelBattleDataClass.prototype && !PanelBattleDataClass.prototype.__QA_SAFE_DATA__) {
                            PanelBattleDataClass.prototype.__QA_SAFE_DATA__ = true;
                            const origInitPbdUI = PanelBattleDataClass.prototype._initUI;
                            PanelBattleDataClass.prototype._initUI = function () {
                                try {
                                    bot.state.viewingBattleData = true;
                                    if (this._args && this._args.battleData) {
                                        this._args = this._args.battleData;
                                    }
                                    if (!this._args && bot.lastBattleData) {
                                        this._args = bot.lastBattleData;
                                    }
                                    if (this._args && !this._args.rounds) {
                                        this._args.rounds = [];
                                    }
                                } catch (err) {
                                    console.warn("[PanelBattleData _initUI Guard]", err);
                                }
                                if (origInitPbdUI) origInitPbdUI.apply(this, arguments);
                                try {
                                    const closeBtn = this.view && (this.view.getChild("btn_close") || this.view.getChild("closeBtn") || this.view.getChild("btn_back"));
                                    if (closeBtn && typeof closeBtn.addClickListener === "function") {
                                        closeBtn.addClickListener(() => {
                                            bot.state.viewingBattleData = false;
                                            this.closeView();
                                        });
                                    }
                                } catch (e) { }
                            };

                            const origClosePbd = PanelBattleDataClass.prototype.closeView;
                            PanelBattleDataClass.prototype.closeView = function () {
                                bot.state.viewingBattleData = false;
                                if (origClosePbd) return origClosePbd.apply(this, arguments);
                            };
                        }
                    } catch (e) { }

                    // Hook BattledataView: Tự động reset viewingBattleData khi đóng giao diện
                    try {
                        let bdvMod = null;
                        if (typeof window.__require === "function") {
                            try { bdvMod = window.__require("BattledataView"); } catch (e) { }
                        }
                        const BattledataViewClass = (bdvMod && (bdvMod.BattledataView || bdvMod.default || bdvMod)) || (gm && gm.BattledataView) || window.BattledataView;
                        if (BattledataViewClass && BattledataViewClass.prototype && !BattledataViewClass.prototype.__QA_CLOSE_HOOKED__) {
                            BattledataViewClass.prototype.__QA_CLOSE_HOOKED__ = true;
                            const origCloseBdv = BattledataViewClass.prototype.closeView;
                            BattledataViewClass.prototype.closeView = function () {
                                bot.state.viewingBattleData = false;
                                if (origCloseBdv) return origCloseBdv.apply(this, arguments);
                            };
                        }
                    } catch (e) { }

                    // Hook BattleTowerEx (Thắng Tháp Thông Thiên): Gán trực tiếp callback an toàn cho nút btn_ok ("Xác nhận")
                    let bteMod = null;
                    if (typeof window.__require === "function") {
                        try { bteMod = window.__require("BattleTowerEx"); } catch (e) { }
                    }
                    const BattleTowerExClass = (bteMod && (bteMod.BattleTowerEx || bteMod.default || bteMod)) || (gm && gm.BattleTowerEx) || window.BattleTowerEx;
                    if (BattleTowerExClass && BattleTowerExClass.prototype && !BattleTowerExClass.prototype.__QA_OK_HOOKED__) {
                        BattleTowerExClass.prototype.__QA_OK_HOOKED__ = true;
                        const origTowerSetCall = BattleTowerExClass.prototype.setCall;
                        BattleTowerExClass.prototype.setCall = function () {
                            if (origTowerSetCall) origTowerSetCall.apply(this, arguments);
                            const self = this;
                            if (typeof this.setOkBtn === "function") {
                                this.setOkBtn("Xác nhận", function () {
                                    const mm = window.ModelManager || (gm && gm.ModelManager);
                                    if (mm && mm.RewardModel && typeof mm.RewardModel.setBackCall === "function") {
                                        mm.RewardModel.setBackCall(self._args);
                                    }
                                });
                            }
                        };
                    }

                    // Hook BattleTowerFail & BattleFail (Thua Tháp): Gán callback an toàn cho nút btn_ok ("Xác nhận")
                    let btfMod = null;
                    if (typeof window.__require === "function") {
                        try { btfMod = window.__require("BattleTowerFail"); } catch (e) { }
                    }
                    const BattleTowerFailClass = (btfMod && (btfMod.BattleTowerFail || btfMod.default || btfMod)) || (gm && gm.BattleTowerFail) || window.BattleTowerFail;
                    if (BattleTowerFailClass && BattleTowerFailClass.prototype && !BattleTowerFailClass.prototype.__QA_OK_HOOKED__) {
                        BattleTowerFailClass.prototype.__QA_OK_HOOKED__ = true;
                        const origTowerFailDesc = BattleTowerFailClass.prototype.showDefaultDesc;
                        BattleTowerFailClass.prototype.showDefaultDesc = function () {
                            if (origTowerFailDesc) origTowerFailDesc.apply(this, arguments);
                            const self = this;
                            if (typeof this.setOkBtn === "function") {
                                this.setOkBtn("Xác nhận", function () {
                                    const mm = window.ModelManager || (gm && gm.ModelManager);
                                    if (mm && mm.RewardModel && typeof mm.RewardModel.setBackCall === "function") {
                                        mm.RewardModel.setBackCall(self._args);
                                    }
                                });
                            }
                        };
                    }

                    let bfMod = null;
                    if (typeof window.__require === "function") {
                        try { bfMod = window.__require("BattleFail"); } catch (e) { }
                    }
                    const BattleFailClass = (bfMod && (bfMod.BattleFail || bfMod.default || bfMod)) || (gm && gm.BattleFail) || window.BattleFail;
                    if (BattleFailClass && BattleFailClass.prototype && !BattleFailClass.prototype.__QA_OK_HOOKED__) {
                        BattleFailClass.prototype.__QA_OK_HOOKED__ = true;
                        const origFailSetBackCall = BattleFailClass.prototype.setBackCall;
                        BattleFailClass.prototype.setBackCall = function () {
                            if (origFailSetBackCall) origFailSetBackCall.apply(this, arguments);
                            const self = this;
                            if (typeof this.setOkBtn === "function") {
                                this.setOkBtn("Xác nhận", function () {
                                    const mm = window.ModelManager || (gm && gm.ModelManager);
                                    if (mm && mm.RewardModel && typeof mm.RewardModel.setBackCall === "function") {
                                        mm.RewardModel.setBackCall(self._args);
                                    }
                                });
                            }
                        };
                    }

                    // Hook ClimbtowerView: Tự động làm mới UI tháp và nút khiêu chiến khi trận chiến kết thúc
                    let ctvMod = null;
                    if (typeof window.__require === "function") {
                        try { ctvMod = window.__require("ClimbtowerView"); } catch (e) { }
                    }
                    const ClimbtowerViewClass = (ctvMod && (ctvMod.ClimbtowerView || ctvMod.default || ctvMod)) || (gm && gm.ClimbtowerView) || window.ClimbtowerView;
                    if (ClimbtowerViewClass && ClimbtowerViewClass.prototype && !ClimbtowerViewClass.prototype.__QA_REFRESH_HOOKED__) {
                        ClimbtowerViewClass.prototype.__QA_REFRESH_HOOKED__ = true;
                        const origCloseBattle = ClimbtowerViewClass.prototype.close_battle_result;
                        ClimbtowerViewClass.prototype.close_battle_result = function () {
                            if (origCloseBattle) origCloseBattle.apply(this, arguments);
                            try {
                                if (this._isBattleTip) this._isBattleTip.setVisible(false);
                                if (this.btn_fight) this.btn_fight.setVisible(true);
                                if (typeof this.refreshUI === "function") {
                                    this.refreshUI();
                                }
                            } catch (e) { }
                        };
                    }
                } catch (e) { }

                // Hook 3: Bổ sung song song 2 nút [LƯU TRẬN] và [KHIÊU CHIẾN] cho BattlePrepareView / TeamArrayView
                function hookArrayDualButtons(targetClass) {
                    if (!targetClass || !targetClass.prototype || targetClass.prototype.__QA_DUAL_BTN__) return;
                    targetClass.prototype.__QA_DUAL_BTN__ = true;

                    const origInitData = targetClass.prototype.initData;
                    targetClass.prototype.initData = function () {
                        if (origInitData) origInitData.apply(this, arguments);
                        try {
                            if (this._args && Number(this._args.arrayType) === 105) {
                                const fmInst = window.FightManager || (gm && gm.FightManager);
                                if (fmInst && typeof fmInst.removeFight === "function" && fmInst.haveFight && fmInst.haveFight(105)) {
                                    try { fmInst.removeFight(105); } catch (err) { }
                                }
                            }
                            if (this._args && this._args.isSelfArray) {
                                if (this.enterBtn && this.saveBt) {
                                    this.saveBt.visible = true;
                                    this.enterBtn.visible = true;
                                    if (Math.abs(this.enterBtn.x - this.saveBt.x) < 20) {
                                        this.enterBtn.x = this.saveBt.x - this.saveBt.width - 25;
                                        this.enterBtn.y = this.saveBt.y;
                                    }
                                    if (typeof this.enterBtn.setTitle === "function") {
                                        this.enterBtn.setTitle("Khiêu Chiến");
                                    }
                                    if (typeof this.saveBt.setTitle === "function") {
                                        this.saveBt.setTitle("Lưu Trận");
                                    }
                                    const mm = window.ModelManager || (gm && gm.ModelManager);
                                    if (this._args.arrayType === 1 && !this._args.copyId && mm && mm.MainUIModel) {
                                        const prog = mm.MainUIModel.getMainCopyProgress ? mm.MainUIModel.getMainCopyProgress() : mm.MainUIModel.mainCopyProgress;
                                        if (prog && prog._id) this._args.copyId = prog._id;
                                    } else if (this._args.arrayType === 2 && !this._args.copyId && mm && mm.ClimbTowerModel) {
                                        const floor = mm.ClimbTowerModel.getCurFloor ? mm.ClimbTowerModel.getCurFloor(1) : 1;
                                        const tc = window.TowerConfiger || (gm && gm.TowerConfiger);
                                        const cfg = tc && tc.getTowerCfgByTypeFloor ? tc.getTowerCfgByTypeFloor(1, floor) : null;
                                        this._args.copyId = (cfg && cfg.id) ? cfg.id : floor;
                                    }
                                }
                            }
                        } catch (err) { }
                    };

                    const origUpdateEnterBtn = targetClass.prototype.updateEnterBtn;
                    targetClass.prototype.updateEnterBtn = function () {
                        if (origUpdateEnterBtn) origUpdateEnterBtn.apply(this, arguments);
                        try {
                            const mm = window.ModelManager || (gm && gm.ModelManager);
                            const bm = mm && mm.BattleModel;
                            const needBuff = (bm && bm.needSelectBuff && this._args) ? bm.needSelectBuff(this._args) : false;
                            if (!needBuff && this.enterBtn && typeof this.enterBtn.setTitle === "function") {
                                const lc = window.LanguageConfiger || (gm && gm.LanguageConfiger);
                                const fightText = (lc && lc.getModuleDataLangCh) ? lc.getModuleDataLangCh("button91") : "Khiêu Chiến";
                                this.enterBtn.setTitle(fightText);
                            }
                        } catch (err) { }
                    };

                    const origEnterBtnFunc = targetClass.prototype.enterBtnFunc;
                    targetClass.prototype.enterBtnFunc = function () {
                        try {
                            const mm = window.ModelManager || (gm && gm.ModelManager);
                            if (this._args) {
                                if (this._args.arrayType === 1 && !this._args.copyId && mm && mm.MainUIModel) {
                                    const prog = mm.MainUIModel.getMainCopyProgress ? mm.MainUIModel.getMainCopyProgress() : mm.MainUIModel.mainCopyProgress;
                                    if (prog && prog._id) this._args.copyId = prog._id;
                                } else if (this._args.arrayType === 2 && !this._args.copyId && mm && mm.ClimbTowerModel) {
                                    const floor = mm.ClimbTowerModel.getCurFloor ? mm.ClimbTowerModel.getCurFloor(1) : 1;
                                    const tc = window.TowerConfiger || (gm && gm.TowerConfiger);
                                    const cfg = tc && tc.getTowerCfgByTypeFloor ? tc.getTowerCfgByTypeFloor(1, floor) : null;
                                    this._args.copyId = (cfg && cfg.id) ? cfg.id : floor;
                                }
                                if (canNativeSkipBattle(this._args.arrayType) && bot.settings && bot.settings.skip_battle) {
                                    this._args.skipBattle = true;
                                }
                            }

                            if (origEnterBtnFunc) {
                                return origEnterBtnFunc.apply(this, arguments);
                            }

                            const bm = mm && mm.BattleModel;
                            const needBuff = (bm && bm.needSelectBuff && this._args) ? bm.needSelectBuff(this._args) : false;
                            const canQuick = (bm && bm.canQuickFight && this._args) ? bm.canQuickFight(this._args) : false;
                            const isQuick = (bm && bm.getQuickFight && this._args) ? bm.getQuickFight(this._args.arrayType) : false;

                            if (needBuff) {
                                if (typeof this.doSelectBuff === "function") return this.doSelectBuff();
                            } else if (canQuick && isQuick && typeof this.requestBuff === "function") {
                                if (this.checkEnter && !this.checkEnter()) return;
                                if (this.saveArrayInfoAndCloseSelf && !this.saveArrayInfoAndCloseSelf()) return;
                                return this.requestBuff();
                            } else {
                                if (this.checkEnter && !this.checkEnter()) return;
                                if (this.saveArrayInfoAndCloseSelf && !this.saveArrayInfoAndCloseSelf()) return;
                                if (typeof this.requestBatte === "function") {
                                    return this.requestBatte();
                                }
                            }
                        } catch (e) { }

                        return origEnterBtnFunc ? origEnterBtnFunc.apply(this, arguments) : null;
                    };
                }

                const abv = (gm && gm.ArrayBaseView) || window.ArrayBaseView;
                if (abv) hookArrayDualButtons(abv);
                const bpv = (gm && gm.BattlePrepareView) || window.BattlePrepareView;
                if (bpv) hookArrayDualButtons(bpv);
                const tav = (gm && gm.TeamArrayView) || window.TeamArrayView;
                if (tav) hookArrayDualButtons(tav);

                // Hook 3.5: TeamArrayView - Tự động xếp đội hình Tank (Hàng trước) / Dame (Hàng sau) cho Bí Cảnh Tần Lĩnh (DefJz = 9)
                try {
                    let tavMod = null;
                    if (typeof window.__require === "function") {
                        try { tavMod = window.__require("TeamArrayView"); } catch (e) { }
                    }
                    const TeamArrayViewClass = (tavMod && (tavMod.TeamArrayView || tavMod.default || tavMod)) || (gm && gm.TeamArrayView) || window.TeamArrayView;
                    if (TeamArrayViewClass && TeamArrayViewClass.prototype && !TeamArrayViewClass.prototype.__QA_DEFJZ_TEAM__) {
                        TeamArrayViewClass.prototype.__QA_DEFJZ_TEAM__ = true;
                        const origInitData = TeamArrayViewClass.prototype.initData;
                        TeamArrayViewClass.prototype.initData = function () {
                            if (origInitData) origInitData.apply(this, arguments);
                            try {
                                if (this._args && this._args.arrayType === 9) { // DefJz (Bí Cảnh Tần Lĩnh)
                                    const self = this;
                                    setTimeout(() => {
                                        try {
                                            bot.autoSetupDefJzFormation(self);
                                            if (bot.settings && (bot.settings.auto_defjz || (bot.toggles && bot.toggles.auto_defjz !== false))) {
                                                setTimeout(() => {
                                                    try {
                                                        if (bot.isViewVisible(self)) {
                                                            if (typeof self.enterBtnFunc === "function") {
                                                                self.enterBtnFunc();
                                                            }
                                                        }
                                                    } catch (errFight) { }
                                                }, 350);
                                            }
                                        } catch (errForm) { }
                                    }, 80);
                                }
                            } catch (e) { }
                        };
                    }
                } catch (e) { }

                // Hook 4: BattleModel.getQuickFight - Giữ nguyên phương thức gốc của game, không ép true
                // để tránh gây xung đột logic vào trận của TeamArrayView và Bí Cảnh Tần Lĩnh.

                // Hook 5: RollTips.show & RollTipsUtil.show - Chặn spam toast và xử lý cảnh báo thao tác nhanh
                const hookRollTipsTarget = function (rtTarget) {
                    if (!rtTarget || !rtTarget.show || rtTarget.__QA_HOOKED__) return;
                    rtTarget.__QA_HOOKED__ = true;
                    const origShow = rtTarget.show;
                    rtTarget.show = function (msg) {
                        if (typeof msg === "string") {
                            const lower = msg.toLowerCase();
                            if (lower.includes("chưa tổng kết") || lower.includes("tổng kết") || msg.includes("未结算")) {
                                bot.rescueUnsettledBattle(msg);
                                return;
                            }
                            if (lower.includes("quá nhanh") || lower.includes("thao tác") || msg.includes("频繁") || msg.includes("过快")) {
                                bot.state.lastBattleEndTime = Date.now() + 2500;
                                bot.log(`⚠️ [Anti-Spam] Game cảnh báo: "${msg}" -> Tự động giãn cách an toàn 2.5s.`);
                                return;
                            }
                            if (lower.includes("thời gian có hiệu lực") || msg.includes("未到生效时间")) {
                                const now = Date.now();
                                if (bot.state.lastEffTimeWarn && (now - bot.state.lastEffTimeWarn < 4000)) {
                                    return; // Chặn spam đè nhiều toast liên tục
                                }
                                bot.state.lastEffTimeWarn = now;
                            }
                            if (lower.includes("đã nhận") || lower.includes("chưa hoàn thành") || lower.includes("không xác định") || lower.includes("nhận trùng") || msg.includes("已领取") || msg.includes("未知错误")) {
                                return; // Chặn 100% thông báo "Đã nhận hết" / "Lỗi không xác định" không hiện lên màn hình
                            }
                            if (lower.includes("nông dân") || lower.includes("thợ rảnh")) {
                                bot.log(`⚠️ [Gia Viên] Game cảnh báo: "${msg}". Đang tự động kiểm tra và đồng bộ lại nông dân rảnh...`);
                            }
                        }
                        return origShow.apply(this, arguments);
                    };
                };

                hookRollTipsTarget(window.RollTips || (gm && gm.RollTips));
                hookRollTipsTarget(window.RollTipsUtil || (gm && gm.RollTipsUtil));
                if (typeof window.__require === "function") {
                    try {
                        const rtMod = window.__require("RollTips");
                        hookRollTipsTarget(rtMod && (rtMod.RollTips || rtMod.default || rtMod));
                    } catch (e) { }
                    try {
                        const rtuMod = window.__require("RollTipsUtil");
                        hookRollTipsTarget(rtuMod && (rtuMod.RollTipsUtil || rtuMod.default || rtuMod));
                    } catch (e) { }
                }

                // Hook 6: ErrorCodeConfiger.showErroCode & showErroCodeArgs - Bắt error code cảnh báo thao tác nhanh & Chặn triệt để Lỗi không xác định / Đã nhận hết
                let ecc = (gm && gm.ErrorCodeConfiger) || window.ErrorCodeConfiger;
                if (!ecc && typeof window.__require === "function") {
                    try {
                        const eccMod = window.__require("ErrorCodeConfiger");
                        ecc = eccMod && (eccMod.ErrorCodeConfiger || eccMod.default || eccMod);
                    } catch (e) { }
                }
                if (ecc && ecc.showErroCode && !ecc.__QA_HOOKED__) {
                    ecc.__QA_HOOKED__ = true;
                    const origShowErr = ecc.showErroCode;
                    ecc.showErroCode = function (code) {
                        try {
                            const line = gm && gm.DynamicConfigDataNew && gm.DynamicConfigDataNew.NoticeDataNotice && gm.DynamicConfigDataNew.NoticeDataNotice.readConfigLine(code);
                            const content = line ? (line.content || "") : "";
                            const lower = content.toLowerCase();
                            if (lower.includes("chưa tổng kết") || lower.includes("tổng kết") || content.includes("未结算")) {
                                bot.rescueUnsettledBattle(content);
                                return;
                            }
                            const isEffTime = lower.includes("thời gian có hiệu lực") || content.includes("未到生效时间");
                            if (isEffTime) {
                                const now = Date.now();
                                if (bot.state.lastEffTimeWarn && (now - bot.state.lastEffTimeWarn < 4000)) {
                                    return;
                                }
                                bot.state.lastEffTimeWarn = now;
                            }
                            const proto = window.__LAST_OUT_PROTO__ || 'N/A';
                            if (proto === 13110 || proto === 13130) {
                                bot.state.quickDigExhausted = true;
                                bot.state.treasureFailCooldown = Date.now() + 5000;
                                const trm = window.ModelManager && window.ModelManager.TreasureRewardModel;
                                if (trm && trm._temp_equip && trm._temp_equip.length > 0 && typeof trm.checkAutoTempSell === "function") {
                                    trm.checkAutoTempSell();
                                }
                                if (code === 311) {
                                    bot.log(`⚠️ [Đào Bảo] Đã hết số lượt Đào Nhanh hôm nay (Mã 311) -> Tự động chuyển sang Đào Thường 40 rương/lần.`);
                                } else {
                                    bot.log(`⚠️ [Đào Bảo] Server phản hồi [${code}: ${content || 'Lỗi thao tác đào bảo'}] (Gói ${proto}) -> Đã tự động dọn kho tạm và giãn cách an toàn.`);
                                }
                                return;
                            }
                            if (code === 2 || code === 142 || code === 191 || code === 152 || code === 161 ||
                                lower.includes("đã nhận") || lower.includes("chưa hoàn thành") || lower.includes("không xác định") || lower.includes("nhận trùng") ||
                                content.includes("已领取") || content.includes("未知错误")) {
                                if (proto === 11210) {
                                    bot.state.actTaskFailCooldown = Date.now() + 15 * 60000;
                                } else if (proto === 11320) {
                                    bot.state.rankMileCooldown = Date.now() + 30 * 60000;
                                }
                                return; // Chặn triệt để thông báo Lỗi không xác định / Đã nhận hết
                            }
                            const isTooFast = (code === 4 || code === 66 || content.includes("quá nhanh") || content.includes("thao tác") || content.includes("频繁") || content.includes("过快"));
                            if (isTooFast) {
                                if (proto === 11210) {
                                    bot.state.actTaskFailCooldown = Date.now() + 15 * 60000;
                                    bot.log(`⚠️ [Anti-Spam] Nhiệm vụ Sự Kiện báo [${code}: ${content || 'Thao tác quá nhanh'}] -> Tạm hoãn nhận thưởng sự kiện 15 phút.`);
                                    return;
                                } else if (proto === 12105 || proto === 12111) {
                                    bot.state.lastBattleEndTime = Date.now() + 3500;
                                    bot.state.exploreCoolDownUntil = Date.now() + 90000;
                                    bot.log(`⚠️ [Anti-Spam] Phái Tướng báo lỗi [${code}: ${content || 'Thao tác quá nhanh'}] -> Tạm dừng phái tướng 90s để đồng bộ trạng thái.`);
                                } else if (proto === 10544) {
                                    bot.state.manorFlowerFailCount = (bot.state.manorFlowerFailCount || 0) + 1;
                                    const coolMin = bot.state.manorFlowerFailCount === 1 ? 15 : (bot.state.manorFlowerFailCount === 2 ? 30 : 120);
                                    bot.state.manorFlowerCooldown = Date.now() + coolMin * 60000;
                                    bot.log(`⚠️ [Anti-Spam] Thưởng Hoa Gia Viên báo lỗi [${code}: ${content || 'Thao tác quá nhanh'}] (Lần ${bot.state.manorFlowerFailCount}) -> Tạm hoãn nhận thưởng hoa ${coolMin} phút để tránh spam.`);
                                } else if (proto === 12692) {
                                    bot.state.lastBattleEndTime = Date.now() + 3500;
                                    bot.state.guildWishFailCooldown = Date.now() + 60000;
                                    bot.log(`⚠️ [Anti-Spam] Ước Nguyện báo lỗi [${code}: ${content || 'Thao tác quá nhanh'}] -> Tạm hoãn 60s.`);
                                } else if (proto === 10401 || code === 66) {
                                    const now = Date.now();
                                    const cool = now + 5000;
                                    bot.state.lastBattleEndTime = cool;
                                    bot.state.lastWarError66Time = now;
                                    window.__LAST_WAR_FAIL_COOLDOWN__ = cool;
                                    window.__LAST_WAR_CLOSE_TIME__ = cool;
                                    if (window.__LAST_PROTO_TIMES__) window.__LAST_PROTO_TIMES__['10401_1'] = cool;
                                    try {
                                        const fmInst = window.FightManager || (gm && gm.FightManager);
                                        if (fmInst && fmInst.copyRequstStatus) {
                                            for (let k in fmInst.copyRequstStatus) {
                                                fmInst.copyRequstStatus[k] = 0;
                                            }
                                        }
                                    } catch (eFm) { }
                                    if (bot.isAutoStageOn() && (!bot.state.last10401WarnTime || (now - bot.state.last10401WarnTime > 5000))) {
                                        bot.state.last10401WarnTime = now;
                                        bot.log(`⚠️ [Anti-Spam] Vượt Ải báo [${code}: ${content || 'Thao tác quá nhanh'}] -> Tự động giãn cách an toàn 5.0s.`);
                                    }
                                    return;
                                } else if (proto === 10413) {
                                    bot.state.lastBattleEndTime = Date.now() + 3500;
                                    return;
                                } else if (proto === 12930) {
                                    bot.state.lastBattleEndTime = Date.now() + 3500;
                                    bot.state.mineFailUntil = Date.now() + 5 * 60000;
                                    bot.log(`⚠️ [Chiếm Mỏ] Server từ chối thu hoạch [${code}: ${content || 'Thao tác quá nhanh'}] -> Tạm hoãn thu hoạch mỏ 5 phút.`);
                                } else {
                                    bot.state.lastBattleEndTime = Date.now() + 3500;
                                    bot.log(`⚠️ [Anti-Spam] Server báo lỗi [${code}: ${content || 'Thao tác quá nhanh'}] (Gói tin: ${proto}) -> Giãn cách an toàn 3.5s.`);
                                }
                                return;
                            }
                        } catch (err) { }
                        return origShowErr.apply(this, arguments);
                    };
                    if (typeof ecc.showErroCodeArgs === "function") {
                        const origShowErrArgs = ecc.showErroCodeArgs;
                        ecc.showErroCodeArgs = function (code, args) {
                            if (code === 2 || code === 142 || code === 191 || code === 152 || code === 161) {
                                return;
                            }
                            return origShowErrArgs.apply(this, arguments);
                        };
                    }
                }

                // Hook 7: Main Copy Skip Battle & Ultra-Fast Engine
                // A. BattleMainCopyView - Tăng tốc di chuyển cảnh và bảo vệ Defeat Guard
                let bmvMod = null;
                if (typeof window.__require === "function") {
                    try { bmvMod = window.__require("BattleMainCopyView"); } catch (e) { }
                }
                const bmv = (bmvMod && (bmvMod.BattleMainCopyView || bmvMod)) || (gm && gm.BattleMainCopyView) || window.BattleMainCopyView;
                if (bmv && bmv.prototype && !bmv.prototype.__QA_TEST_MOVE__) {
                    bmv.prototype.__QA_TEST_MOVE__ = true;
                    // Giữ isTestMove = false để quy trình kết toán của game diễn ra tự nhiên theo event
                    Object.defineProperty(bmv.prototype, "isTestMove", {
                        get: function () {
                            return false;
                        },
                        set: function (v) { },
                        configurable: true
                    });

                    // 1. Hook setGameMap & resetAndLoadBattelObj: Rút ngắn thời gian chuyển cảnh mượt mà (chỉ khi BẬT Vượt Ải)
                    const origSetGameMap = bmv.prototype.setGameMap;
                    if (origSetGameMap && !bmv.prototype.__QA_SETMAP_HOOKED__) {
                        bmv.prototype.__QA_SETMAP_HOOKED__ = true;
                        bmv.prototype.setGameMap = function () {
                            origSetGameMap.apply(this, arguments);
                            if (bot.isAutoStageOn()) {
                                this.moveTime = 0.45;
                                this.chapterCrossTime = 0.45;
                            }
                        };
                    }

                    const origResetAndLoad = bmv.prototype.resetAndLoadBattelObj;
                    if (origResetAndLoad && !bmv.prototype.__QA_RESETLOAD_HOOKED__) {
                        bmv.prototype.__QA_RESETLOAD_HOOKED__ = true;
                        bmv.prototype.resetAndLoadBattelObj = function (e, t) {
                            if (bot.isAutoStageOn()) {
                                if (t > 0.45) t = 0.45;
                                this.moveTime = 0.45;
                                this.chapterCrossTime = 0.45;
                            }
                            return origResetAndLoad.call(this, e, t);
                        };
                    }

                    // 2. Hook moveNext: Bắt thất bại trận ải, kích hoạt Defeat Guard và khóa màn hình an toàn
                    const origMoveNext = bmv.prototype.moveNext;
                    if (origMoveNext && !bmv.prototype.__QA_MOVENEXT_HOOKED__) {
                        bmv.prototype.__QA_MOVENEXT_HOOKED__ = true;
                        bmv.prototype.moveNext = function () {
                            window.__BMV_INSTANCE__ = this;
                            if (!bot.isAutoStageOn()) {
                                this.isEnterGame = false;
                                if (this.copyAnimState && typeof this.copyAnimState.onLockState === "function") {
                                    this.copyAnimState.onLockState();
                                }
                                return;
                            }
                            try {
                                if (this.playData && this.playData._winner !== 1) {
                                    bot.handleStageDefeat();
                                    if (this.copyAnimState && this.copyAnimState.onLockState) {
                                        this.copyAnimState.onLockState();
                                    }
                                } else if (this.playData && this.playData._winner === 1) {
                                    bot.state.stageFailCount = 0;
                                    bot.state.stage10401ErrCount = 0;
                                }
                            } catch (e) { }
                            return origMoveNext.apply(this, arguments);
                        };
                    }

                    // 3. Hook initBattleData, enterBattle & pullBatteData: Khóa an toàn ải chính tuyến khi TẮT Vượt Ải
                    const origInitBattleData = bmv.prototype.initBattleData;
                    if (origInitBattleData && !bmv.prototype.__QA_INITBATTLE_HOOKED__) {
                        bmv.prototype.__QA_INITBATTLE_HOOKED__ = true;
                        bmv.prototype.initBattleData = function () {
                            window.__BMV_INSTANCE__ = this;
                            return origInitBattleData.apply(this, arguments);
                        };
                    }

                    const origEnterBattle = bmv.prototype.enterBattle;
                    if (origEnterBattle && !bmv.prototype.__QA_ENTERBATTLE_HOOKED__) {
                        bmv.prototype.__QA_ENTERBATTLE_HOOKED__ = true;
                        bmv.prototype.enterBattle = function () {
                            window.__BMV_INSTANCE__ = this;
                            if (!bot.isAutoStageOn()) {
                                this.isEnterGame = false;
                                if (this.copyAnimState) {
                                    this.copyAnimState.lockState = 6;
                                    this.copyAnimState.stateUpdate = null;
                                }
                                const bfmInst = (gm && gm.BattleFastManager) || window.BattleFastManager;
                                if (bfmInst) bfmInst.batteStatus = 6;
                                return;
                            }
                            return origEnterBattle.apply(this, arguments);
                        };
                    }

                    const origPullBattleData = bmv.prototype.pullBatteData;
                    if (origPullBattleData && !bmv.prototype.__QA_PULLBATTLE_HOOKED__) {
                        bmv.prototype.__QA_PULLBATTLE_HOOKED__ = true;
                        bmv.prototype.pullBatteData = function () {
                            window.__BMV_INSTANCE__ = this;
                            const mm = window.ModelManager || (gm && gm.ModelManager);
                            const hasHangup = !!(mm && mm.BattleModel && typeof mm.BattleModel.getHangupBattleInfo === "function" && mm.BattleModel.getHangupBattleInfo());
                            if (!bot.isAutoStageOn() && window.__ENTER_GAME__ && hasHangup) {
                                this.isEnterGame = false;
                                if (this.copyAnimState) {
                                    this.copyAnimState.lockState = 6;
                                    this.copyAnimState.stateUpdate = null;
                                }
                                return;
                            }
                            return origPullBattleData.apply(this, arguments);
                        };
                    }
                }

                // B. Hook CopyAnimState - Tăng tốc lướt cảnh và mở khóa Boss lập tức khi tới Boss
                let casMod = null;
                if (typeof window.__require === "function") {
                    try { casMod = window.__require("CopyAnimState"); } catch (e) { }
                }
                const cas = (casMod && (casMod.CopyAnimState || casMod)) || (gm && gm.CopyAnimState) || window.CopyAnimState;
                if (cas && cas.prototype && !cas.prototype.__QA_WAIT_HOOKED__) {
                    cas.prototype.__QA_WAIT_HOOKED__ = true;

                    const origOnEnterState = cas.prototype.onEnterState;
                    if (origOnEnterState && !cas.prototype.__QA_ENTERSTATE_HOOKED__) {
                        cas.prototype.__QA_ENTERSTATE_HOOKED__ = true;
                        cas.prototype.onEnterState = function () {
                            window.__CAS_INSTANCE__ = this;
                            if (!bot.isAutoStageOn()) {
                                if (this.bindViewClass) this.bindViewClass.isEnterGame = false;
                                if (this.lockState !== 6 && typeof this.onLockState === "function") {
                                    return this.onLockState();
                                }
                                return;
                            }
                            return origOnEnterState.apply(this, arguments);
                        };
                    }

                    const origPushMove = cas.prototype.pushMoveWithBg;
                    if (origPushMove && !cas.prototype.__QA_PUSHMOVE_HOOKED__) {
                        cas.prototype.__QA_PUSHMOVE_HOOKED__ = true;
                        cas.prototype.pushMoveWithBg = function (cb) {
                            if (bot.isAutoStageOn()) {
                                if (this.bindViewClass) {
                                    this.bindViewClass.moveTime = 0.45;
                                    this.bindViewClass.chapterCrossTime = 0.45;
                                }
                            }
                            return origPushMove.call(this, cb);
                        };
                    }

                    const origUnlockMove = cas.prototype.unLockMoveWithBg;
                    if (origUnlockMove && !cas.prototype.__QA_UNLOCKMOVE_HOOKED__) {
                        cas.prototype.__QA_UNLOCKMOVE_HOOKED__ = true;
                        cas.prototype.unLockMoveWithBg = function (cb) {
                            if (bot.isAutoStageOn()) {
                                if (this.bindViewClass) {
                                    this.bindViewClass.moveTime = 0.45;
                                    this.bindViewClass.chapterCrossTime = 0.45;
                                }
                            }
                            return origUnlockMove.call(this, cb);
                        };
                    }

                    const origOnLockState = cas.prototype.onLockState;
                    if (origOnLockState && !cas.prototype.__QA_LOCKSTATE_HOOKED__) {
                        cas.prototype.__QA_LOCKSTATE_HOOKED__ = true;
                        cas.prototype.onLockState = function () {
                            origOnLockState.apply(this, arguments);
                            window.__CAS_INSTANCE__ = this;
                            if (this.__enterBattleTimer) {
                                clearTimeout(this.__enterBattleTimer);
                                this.__enterBattleTimer = null;
                            }
                            // CHẶN TUYỆT ĐỐI NẾU KHÔNG BẬT AUTO ĐI ẢI
                            if (!bot.isAutoStageOn()) return;

                            const maxRetries = 10;
                            if ((bot.state.stageFailCount || 0) < maxRetries) {
                                const self = this;
                                // Giãn cách an toàn: sau khi thua 4.2s, bình thường 3.2s để Server đóng phiên trận cũ & tránh Error 66
                                const delay = (bot.state.stageFailCount || 0) > 0 ? 4200 : 3200;
                                let waits = 0;
                                const tryEnter = function () {
                                    self.__enterBattleTimer = null;
                                    // KIỂM TRA LẠI: NẾU TRONG LÚC CHỜ MÀ AUTO ĐI ẢI BỊ TẮT THÌ HỦY NGAY
                                    if (!bot.isAutoStageOn()) return;
                                    try {
                                        const now = Date.now();
                                        // Đang trong giãn cách (trận khác vừa kết thúc) -> HẸN LẠI thay vì bỏ cuộc (tránh kẹt khóa ải vĩnh viễn)
                                        if (bot.state.lastBattleEndTime && now < bot.state.lastBattleEndTime && waits < 20) {
                                            waits++;
                                            self.__enterBattleTimer = setTimeout(tryEnter, Math.min(5000, bot.state.lastBattleEndTime - now + 300));
                                            return;
                                        }
                                        const bfmNow = (gm && gm.BattleFastManager) || window.BattleFastManager;
                                        if (bfmNow && bfmNow.batteStatus !== 6) return; // Đã thoát trạng thái khóa
                                        if ((bot.state.stageFailCount || 0) < maxRetries && self.bindViewClass && typeof self.bindViewClass.btn_enterBattle === "function") {
                                            const attempt = (bot.state.stageFailCount || 0) + 1;
                                            bot.log(`⚔️ Vượt Ải: Tự động vào trận khiêu chiến (Lần ${attempt}/${maxRetries})...`);
                                            self.bindViewClass.btn_enterBattle();
                                        }
                                    } catch (e) { }
                                };
                                self.__enterBattleTimer = setTimeout(tryEnter, delay);
                            }
                        };
                    }

                    // Giữ nguyên logic gốc của game cho onRequestWait (đóng trận cũ + kéo trận mới khi chờ quá lâu).
                    // Đóng băng khi TẮT Vượt Ải hoặc khi Defeat Guard đã kích hoạt (thua >= 10 lần).
                    const origOnRequestWait = cas.prototype.onRequestWait;
                    if (origOnRequestWait && !cas.prototype.__QA_REQWAIT_HOOKED__) {
                        cas.prototype.__QA_REQWAIT_HOOKED__ = true;
                        cas.prototype.onRequestWait = function () {
                            if (!bot.isAutoStageOn()) {
                                return this.onLockState();
                            }
                            origOnRequestWait.apply(this, arguments);
                            const nativeUpdate = this.stateUpdate;
                            const e = this;
                            this.stateUpdate = function (t) {
                                const autoStageOn = bot.isAutoStageOn();
                                if (!autoStageOn) {
                                    if (e.bindViewClass) e.bindViewClass.longTimeNoBatte = 0;
                                    e.onLockState();
                                    return;
                                }
                                if (
                                    (autoStageOn && (bot.state.stageFailCount || 0) >= 10) ||
                                    window.__QA_PENDING_MAIN_START__ ||
                                    bot.state.battleInProgress ||
                                    bot.state.rescueFightActive ||
                                    (window.__LAST_WAR_FAIL_COOLDOWN__ && Date.now() < window.__LAST_WAR_FAIL_COOLDOWN__)
                                ) {
                                    if (e.bindViewClass) e.bindViewClass.longTimeNoBatte = 0;
                                    return;
                                }
                                if (typeof nativeUpdate === "function") return nativeUpdate.call(this, t);
                            };
                        };
                    }

                    const origCasModuleOpen = cas.prototype.module_open;
                    if (origCasModuleOpen && !cas.prototype.__QA_CAS_MODOPEN__) {
                        cas.prototype.__QA_CAS_MODOPEN__ = true;
                        cas.prototype.module_open = function (e, t) {
                            if (!bot.isAutoStageOn()) {
                                return;
                            }
                            return origCasModuleOpen.apply(this, arguments);
                        };
                    }
                }

                // C. BattleFastManager - Tăng tốc xử lý lượt và nền mượt mà 60fps (chỉ khi BẬT Vượt Ải)
                const bfm = (gm && gm.BattleFastManager) || window.BattleFastManager;
                if (bfm) {
                    if (bot.isAutoStageOn()) {
                        bfm.roundInerVal = 0.08;
                    }
                    const origResetTick = bfm.resetRoundTick;
                    if (origResetTick && !bfm.__QA_TICK_HOOKED__) {
                        bfm.__QA_TICK_HOOKED__ = true;
                        bfm.resetRoundTick = function () {
                            if (origResetTick) origResetTick.apply(this, arguments);
                            if (bot.isAutoStageOn()) {
                                this.roundInerVal = 0.08;
                            }
                        };
                    }

                    const origOffect = bfm.offectInBaground;
                    if (origOffect && !bfm.__QA_OFFECT_HOOKED__) {
                        bfm.__QA_OFFECT_HOOKED__ = true;
                        bfm.offectInBaground = function (e, t, i, a) {
                            if (bot.isAutoStageOn()) {
                                var o = this;
                                this.acttakStar = true;
                                var n = this.getEffectRoundData(t);
                                for (var r in n) {
                                    var s = n[r];
                                    var num = gm.TableUtil ? gm.TableUtil.nums(n) : Object.keys(n).length;
                                    if (this.getTgListAction) {
                                        this.getTgListAction(e, t, s, i, num, Number(r)).hit(null);
                                    }
                                }
                                this.affterSkillEffect(i, a);
                                this.schedule(function () {
                                    o.acttakStar = false;
                                    o.attackFinished = true;
                                    o.checkMoveNext();
                                }, 0.08, 1);
                                return;
                            }
                            return origOffect.apply(this, arguments);
                        };
                    }

                    const origPlayAttack = bfm.playAttack;
                    if (origPlayAttack && !bfm.__QA_PLAYATTACK_HOOKED__) {
                        bfm.__QA_PLAYATTACK_HOOKED__ = true;
                        bfm.playAttack = function (e, t, i, a) {
                            const shouldFast = bot.isAutoStageOn();
                            if (shouldFast && (2 == e._type || 4 == e._type)) {
                                var n = [];
                                this.beAttackers = [];
                                for (var r in e.effectList) {
                                    var s = e.effectList[r];
                                    var l = i && i.getHeroItemById ? i.getHeroItemById(s._pos, s._idx) : null;
                                    if (l) {
                                        this.beAttackers[l.index] = l;
                                        if (s._hp <= 0) n[l.index] = l;
                                    }
                                }
                                this.offectInBaground(t, e, i, n);
                                return;
                            }
                            return origPlayAttack.apply(this, arguments);
                        };
                    }
                }

                // D. MainUIModel.prototype.islockBatteLevel - Kiểm soát Vượt Ải chính xác tuyệt đối theo nút bấm người dùng
                const mum = (gm && gm.MainUIModel) || (window.ModelManager && window.ModelManager.MainUIModel);
                const mumProto = mum && (mum.prototype || Object.getPrototypeOf(mum));
                if (mumProto && !mumProto.__QA_LOCK_HOOKED__) {
                    mumProto.__QA_LOCK_HOOKED__ = true;
                    mumProto.islockBatteLevel = function (e) {
                        const autoStageOn = bot.isAutoStageOn();
                        if (!autoStageOn) {
                            // KHI TẮT VƯỢT ẢI TRONG BOT:
                            // Khóa tuyệt đối mọi đợt (Đợt 1..5 và Boss), không cho Cocos tự động đánh hay đẩy ải ngầm
                            return true;
                        }
                        // KHI BẬT VƯỢT ẢI TRONG BOT:
                        // Defeat Guard: Nếu đã thua liên tục >= 10 lần thì khóa lại tạm nghỉ để tránh spam lỗi 66
                        if ((bot.state.stageFailCount || 0) >= 10) {
                            return true;
                        }
                        // Đang bật Vượt Ải và chưa chạm mốc Defeat Guard -> Cho phép vào trận tự động
                        return false;
                    };
                }

                // Đảm bảo nếu đang TẮT Vượt Ải thì khóa an toàn BattleMainCopyView sau khi đã vào game
                if (!bot.isAutoStageOn() && window.__ENTER_GAME__) {
                    try {
                        const vmNow = bot.getViewManager();
                        const mainUINow = vmNow && typeof vmNow.getView === "function" && (vmNow.getView("MainUI_2025View") || vmNow.getView("MainUIView"));
                        const bViewNow = window.__BMV_INSTANCE__ || (mainUINow && mainUINow.ctlView && (mainUINow.ctlView["BattleMainCopyView"] || (mainUINow.loadBatteViewName && mainUINow.ctlView[mainUINow.loadBatteViewName])));
                        if (bViewNow && bViewNow.copyAnimState) {
                            bViewNow.isEnterGame = false;
                            bViewNow.copyAnimState.lockState = 6;
                            bViewNow.copyAnimState.stateUpdate = null;
                            const bfmNow = (gm && gm.BattleFastManager) || window.BattleFastManager;
                            if (bfmNow) bfmNow.batteStatus = 6;
                        }
                    } catch (eLockNow) { }
                }

                // E. HeroDataItem - Mod Full Skin (Client-side Visual & Bag/Preview)
                let hdiMod = null;
                if (typeof window.__require === "function") {
                    try { hdiMod = window.__require("HeroDataItem"); } catch (e) { }
                }
                const hdi = (hdiMod && (hdiMod.HeroDataItem || hdiMod)) || (gm && gm.HeroDataItem) || window.HeroDataItem;
                if (hdi && hdi.prototype && !hdi.prototype.__QA_MOD_SKIN__) {
                    hdi.prototype.__QA_MOD_SKIN__ = true;
                    const origGetSkinOnWear = hdi.prototype.getSkinOnWear;
                    hdi.prototype.getSkinOnWear = function () {
                        if (bot.state.mod_skin !== false) {
                            try {
                                if ((!this.skinSortDatas || this.skinSortDatas.length === 0) && typeof this.setSkinDefautData === "function" && this.getSkinCount && this.getSkinCount() > 0) {
                                    this.setSkinDefautData(false, false);
                                }
                                if (this.skinSortDatas && this.skinSortDatas.length > 1) {
                                    const baseId = this.getHeroBaseId ? this.getHeroBaseId() : null;
                                    if (baseId && bot.settings.hero_skins && bot.settings.hero_skins[baseId]) {
                                        const chosenId = bot.settings.hero_skins[baseId];
                                        for (let s of this.skinSortDatas) {
                                            if (s && (s.id === chosenId || s.baseId === chosenId)) return s;
                                        }
                                    }
                                    for (let i = this.skinSortDatas.length - 1; i >= 1; i--) {
                                        const skin = this.skinSortDatas[i];
                                        if (skin && !skin.isNormal) {
                                            return skin;
                                        }
                                    }
                                }
                            } catch (e) { }
                        }
                        return origGetSkinOnWear ? origGetSkinOnWear.apply(this, arguments) : null;
                    };

                    const origGetHeroFashionData = hdi.prototype.getHeroFashionData;
                    if (origGetHeroFashionData) {
                        hdi.prototype.getHeroFashionData = function () {
                            const res = origGetHeroFashionData.apply(this, arguments);
                            if (bot.state.mod_skin !== false && Array.isArray(res)) {
                                for (let s of res) {
                                    if (s && s.useIndex === 2) {
                                        s.useIndex = 0; // Unlock in CardFashionView
                                    }
                                }
                            }
                            return res;
                        };
                    }
                }

                // F, G: Hook HeroItem & BatteSpineManager toàn diện (Combat, Skill & Main Screen)
                if (typeof bot.ensureHeroItemHooks === "function") {
                    bot.ensureHeroItemHooks();
                }

                // H. PlayerModel - Bypass Mở Khóa Khung Đại Diện (Headframe) & Danh Hiệu (RoleTitle) & Avatar
                const pm = (gm && gm.PlayerModel) || (window.ModelManager && window.ModelManager.PlayerModel);
                const pmProto = pm && (pm.prototype || Object.getPrototypeOf(pm));
                if (pmProto && !pmProto.__QA_BYPASS_FRAME_TITLE__) {
                    pmProto.__QA_BYPASS_FRAME_TITLE__ = true;

                    const origGetTitleTitleById = pmProto.getTitleTitleById;
                    pmProto._origGetTitleTitleById = origGetTitleTitleById;
                    pmProto.getTitleTitleById = function (id) {
                        const real = origGetTitleTitleById ? origGetTitleTitleById.apply(this, arguments) : null;
                        if (real) return real;
                        if (bot.state.mod_headframe_title !== false) {
                            return { _id: id, _state: 0, _e_sec: 0 };
                        }
                        return null;
                    };

                    const origGetTitleIconByIdStr = pmProto.getTitleIconByIdStr;
                    pmProto._origGetTitleIconByIdStr = origGetTitleIconByIdStr;
                    pmProto.getTitleIconByIdStr = function (idStr) {
                        const real = origGetTitleIconByIdStr ? origGetTitleIconByIdStr.apply(this, arguments) : null;
                        if (real) return real;
                        if (bot.state.mod_headframe_title !== false) {
                            return { _icon: idStr, _state: 0 };
                        }
                        return null;
                    };
                }

                // Hook 8: Lắng nghe sự kiện quà mốc BXH, Gia viên & Chiến đấu từ Dispatcher trung tâm
                const disp = (gm && gm.Dispatcher) || window.Dispatcher;
                if (disp && disp.addEventListener && !window.__QA_DISPATCHER_HOOKED__) {
                    window.__QA_DISPATCHER_HOOKED__ = true;
                    try {
                        disp.addEventListener("evt_RankMileGainSc", function (e, t) {
                            const rType = t ? (t._type || t.type) : null;
                            if (rType && bot.state.rankMileAttempts) {
                                bot.state.rankMileAttempts[rType] = 0;
                            }
                        }, { uuid: "__QA_RANK_MILE_CTX__" });

                        disp.addEventListener("evt_HostFlowerRewardSc", function (e, t) {
                            bot.state.manorFlowerFailCount = 0;
                            bot.state.manorFlowerCooldown = 0;
                        }, { uuid: "__QA_HOST_FLOWER_CTX__" });

                        // 8.1: Bắt trực tiếp kết quả chiến đấu từ WebSocket/Event Dispatcher (WarWarLogSc - 10402)
                        disp.addEventListener("evt_WarWarLogSc", function (e, t) {
                            try {
                                const rawWar = (t && t._war !== undefined) ? t._war : (e && e._war !== undefined ? e._war : t);
                                if (!rawWar) return;

                                let warData = rawWar;
                                if (rawWar && typeof rawWar === "object" && rawWar._type === undefined) {
                                    try {
                                        const decMod = (typeof window.__require === "function" && window.__require("BattleDataDecoder")) || (gm && gm.BattleDataDecoder);
                                        const DecoderCls = (decMod && (decMod.BattleDataDecoder || decMod.default || decMod));
                                        if (DecoderCls) {
                                            warData = (new DecoderCls()).decode(rawWar);
                                        }
                                    } catch (errDec) { }
                                }

                                const bType = Number(warData && (warData._type != null ? warData._type : warData.type));
                                const warId = warData && (warData._id != null ? warData._id : warData.id);
                                const winner = Number(warData && (warData._winner != null ? warData._winner : warData.winner));

                                if (bType) {
                                    if (warId) window.__LAST_WAR_ID__ = warId;
                                    if (!bot.state.lastBattleByType) bot.state.lastBattleByType = {};
                                    const bEntry = {
                                        warId: warId,
                                        type: bType,
                                        copyId: warData._copy_id,
                                        winner: winner,
                                        roles: warData._data_role,
                                        time: Date.now(),
                                        closed: false,
                                        raw: warData
                                    };
                                    bot.state.lastBattleByType[bType] = bEntry;
                                    bot.state.lastAnyBattle = bEntry;

                                    // Nếu là trận giải cứu gia viên (106) và đang bật skip_battle, chốt đóng trận ngay lập tức
                                    if (bType === 106 && bot.settings.skip_battle !== false && warId) {
                                        setTimeout(() => {
                                            try {
                                                const fmInst = window.FightManager || (gm && gm.FightManager);
                                                if (fmInst && typeof fmInst.requestWarClose === "function") {
                                                    fmInst.requestWarClose(warId);
                                                } else if (gm && gm.RPCReq && gm.WarCloseCs) {
                                                    gm.RPCReq.send(gm.WarCloseCs.protocol, { _war_id: warId });
                                                }
                                            } catch (err) { }
                                        }, 50);
                                    }
                                }
                            } catch (eLog) { }
                        }, { uuid: "__QA_WARLOG_CTX__" });

                        // 8.2: Bắt trực tiếp thông báo lỗi từ server (LoginNoticeSc - 10104 / LoginNoticeArgSc - 10105)
                        const handleServerNotice = function (e, t) {
                            try {
                                const data = (t && t._code !== undefined) ? t : (e && e._code !== undefined ? e : t);
                                if (!data || data._code == null) return;
                                const code = Number(data._code);
                                const args = data._args || "";
                                let desc = "";
                                try {
                                    const ec = (gm && gm.ErrorCodeConfiger) || window.ErrorCodeConfiger;
                                    if (ec && typeof ec.getErrorCodeById === "function") {
                                        const line = ec.getErrorCodeById(code);
                                        if (line && line.content) desc = line.content;
                                    }
                                } catch (eDesc) { }

                                bot.state.lastServerNotice = {
                                    code: code,
                                    args: args,
                                    desc: desc,
                                    time: Date.now()
                                };
                                if (code === 66) {
                                    bot.state.lastWarError66Time = Date.now();
                                }
                                if (bot.state.rescueFightActive) {
                                    bot.log(`⚠️ [Farm KNB] Server thông báo từ chối trận [mã ${code}]${desc ? `: "${desc}"` : ""}!`);
                                }
                            } catch (eNotice) { }
                        };
                        disp.addEventListener("evt_LoginNoticeSc", handleServerNotice, { uuid: "__QA_NOTICE_CTX_1__" });
                        disp.addEventListener("evt_LoginNoticeArgSc", handleServerNotice, { uuid: "__QA_NOTICE_CTX_2__" });

                        // 8.3: Bắt trực tiếp khi trận đóng và nhận thưởng (WarCloseSc - 10414)
                        disp.addEventListener("evt_WarCloseSc", function (e, t) {
                            try {
                                const data = (t && t._type !== undefined) ? t : (e && e._type !== undefined ? e : t);
                                if (data && data._type != null) {
                                    const bType = Number(data._type);
                                    if (bot.state.lastBattleByType && bot.state.lastBattleByType[bType]) {
                                        bot.state.lastBattleByType[bType].closed = true;
                                        bot.state.lastBattleByType[bType].closeData = data;
                                    }
                                    const fmInst = window.FightManager || (gm && gm.FightManager);
                                    if (fmInst && fmInst.copyRequstStatus) {
                                        fmInst.copyRequstStatus[bType] = 0;
                                    }
                                }
                            } catch (eClose) { }
                        }, { uuid: "__QA_WARCLOSE_CTX__" });
                    } catch (eEvt) { }
                }

                // Hook 9: DefJzSkillSelectView & DefJzModel - TỰ ĐỘNG CHỌN THẺ BUFF MẠNH NHẤT BÍ CẢNH TẢN LĨNH
                let dsvMod = null;
                if (typeof window.__require === "function") {
                    try { dsvMod = window.__require("DefJzSkillSelectView"); } catch (e) { }
                }
                const dsv = (dsvMod && (dsvMod.DefJzSkillSelectView || dsvMod.default || dsvMod)) || (gm && gm.DefJzSkillSelectView) || window.DefJzSkillSelectView;
                if (dsv && dsv.prototype && !dsv.prototype.__QA_AUTO_BUFF__) {
                    dsv.prototype.__QA_AUTO_BUFF__ = true;

                    // Thoát khẩn cấp khi ấn phím ESC trên bàn phím
                    if (!window.__QA_DEFJZ_ESC_BOUND__) {
                        window.__QA_DEFJZ_ESC_BOUND__ = true;
                        window.addEventListener("keydown", function (e) {
                            if (e.key === "Escape" || e.keyCode === 27) {
                                const vm = bot.getViewManager();
                                const curV = vm && vm.getView && vm.getView("DefJzSkillSelectView");
                                if (curV && bot.isViewVisible(curV)) {
                                    bot.log("🛡️ Phím ESC: Thoát / Đóng popup Chọn Buff Bí Cảnh!");
                                    bot.state.suppressDefJzUntil = Date.now() + 600000;
                                    bot.settings.auto_defjz = false;
                                    if (typeof curV.closeView === "function") curV.closeView();
                                }
                            }
                        });
                    }

                    // Helper gắn sự kiện đóng khi bấm ra ngoài nền đen (blackbg)
                    const bindEscapeBlackBg = function (view) {
                        if (!view) return;
                        try {
                            const doClose = function () {
                                bot.log("🛡️ Click vùng ngoài (blackbg): Đóng popup Chọn Buff Bí Cảnh!");
                                bot.state.suppressDefJzUntil = Date.now() + 600000;
                                bot.settings.auto_defjz = false;
                                if (typeof view.closeView === "function") view.closeView();
                            };
                            if (view.blackbg) {
                                if (typeof view.blackbg.setTouchable === "function") {
                                    view.blackbg.setTouchable(true);
                                }
                                if (!view.blackbg.__QA_ESC_BOUND__) {
                                    view.blackbg.__QA_ESC_BOUND__ = true;
                                    if (typeof view.blackbg.addClickListener === "function") {
                                        view.blackbg.addClickListener(doClose);
                                    }
                                }
                            }
                            if (view.blackBg) {
                                if (typeof view.blackBg.setTouchable === "function") {
                                    view.blackBg.setTouchable(true);
                                }
                                if (!view.blackBg.__QA_ESC_BOUND__) {
                                    view.blackBg.__QA_ESC_BOUND__ = true;
                                    if (typeof view.blackBg.addClickListener === "function") {
                                        view.blackBg.addClickListener(doClose);
                                    }
                                }
                            }
                        } catch (e) { }
                    };

                    const origInitUI = dsv.prototype._initUI;
                    dsv.prototype._initUI = function () {
                        if (origInitUI) origInitUI.apply(this, arguments);
                        bindEscapeBlackBg(this);
                    };

                    // onComRequset: Đảm bảo index luôn hợp lệ, gửi thông suốt không bao giờ bị deadlock
                    const origOnComReq = dsv.prototype.onComRequset;
                    dsv.prototype.onComRequset = function () {
                        const curIdx = this.showSkillsIndex || 0;
                        const curGroup = this.deFjInfo && this.deFjInfo._pre_skills && this.deFjInfo._pre_skills[curIdx];
                        const skillsList = curGroup && curGroup._pre_skills;
                        const numSkills = (skillsList && skillsList.length) || 3;

                        // 1. Kiểm tra selectedIndex của skillList
                        let sIdx = this.skillList ? this.skillList.getSelectedIndex() : -1;
                        if (sIdx < 0 || sIdx >= numSkills) {
                            sIdx = (typeof bot.getBestDefJzBuffIndex === "function")
                                ? bot.getBestDefJzBuffIndex(this, curIdx)
                                : 0;
                            if (this.skillList && typeof this.skillList.setSelectedIndex === "function") {
                                this.skillList.setSelectedIndex(sIdx);
                            }
                        }

                        // 2. Lấy skill_id hợp lệ
                        const chosenSkillItem = skillsList && skillsList[sIdx];
                        const chosenSkillVal = chosenSkillItem ? chosenSkillItem._val : 0;

                        // 3. Debounce: Chỉ chặn nếu bấm spam cùng 1 skill trong < 350ms
                        const now = Date.now();
                        if (this.__lastSentSkillVal === chosenSkillVal && (now - (this.__lastSubmitTime || 0)) < 350) {
                            return;
                        }
                        this.__lastSentSkillVal = chosenSkillVal;
                        this.__lastSubmitTime = now;

                        if (typeof this.clearAutoCloseTimer === "function") {
                            this.clearAutoCloseTimer();
                        }

                        let calledOrig = false;
                        if (origOnComReq) {
                            try {
                                origOnComReq.apply(this, arguments);
                                calledOrig = true;
                            } catch (errOrig) {
                                console.error("[DefJz] Lỗi origOnComReq:", errOrig);
                            }
                        }

                        // 4. Fallback trực tiếp qua DefJzModel nếu origOnComReq chưa gửi được
                        if (!calledOrig && chosenSkillVal && this.deFjInfo) {
                            const mm = bot.getModelManager();
                            const djm = (mm && mm.DefJzModel) || (window.G_Mapping && window.G_Mapping.DefJzModel);
                            if (djm && typeof djm.requsetPreSkill === "function") {
                                djm.requsetPreSkill(this.deFjInfo._type, chosenSkillVal);
                            }
                        }
                    };

                    const origSetAutoCloseTimer = dsv.prototype.setAutoCloseTimer;
                    dsv.prototype.setAutoCloseTimer = function () {
                        if (origSetAutoCloseTimer) origSetAutoCloseTimer.apply(this, arguments);
                        bindEscapeBlackBg(this);
                        if (bot.settings && bot.settings.auto_defjz && Date.now() >= (bot.state.suppressDefJzUntil || 0)) {
                            const self = this;
                            setTimeout(() => {
                                try {
                                    if (bot.isViewVisible(self)) {
                                        bot.autoSelectBestDefJzSkill(self);
                                    }
                                } catch (e) { }
                            }, 80);
                        }
                    };

                    const origRefreshUI = dsv.prototype.refreshUI;
                    dsv.prototype.refreshUI = function () {
                        this.__lastSentSkillVal = null;
                        if (origRefreshUI) origRefreshUI.apply(this, arguments);
                        bindEscapeBlackBg(this);
                        if (bot.settings && bot.settings.auto_defjz && Date.now() >= (bot.state.suppressDefJzUntil || 0)) {
                            const self = this;
                            setTimeout(() => {
                                try {
                                    if (bot.isViewVisible(self)) {
                                        bot.autoSelectBestDefJzSkill(self);
                                    }
                                } catch (e) { }
                            }, 100);
                        }
                    };

                    const origOnUIShowAgain = dsv.prototype._onUIShowAgain;
                    dsv.prototype._onUIShowAgain = function (args) {
                        this.__lastSentSkillVal = null;
                        if (origOnUIShowAgain) origOnUIShowAgain.apply(this, arguments);
                        bindEscapeBlackBg(this);
                        if (bot.settings && bot.settings.auto_defjz && Date.now() >= (bot.state.suppressDefJzUntil || 0)) {
                            const self = this;
                            setTimeout(() => {
                                try {
                                    if (bot.isViewVisible(self)) {
                                        bot.autoSelectBestDefJzSkill(self);
                                    }
                                } catch (e) { }
                            }, 100);
                        }
                    };

                    const origEvtSelect = dsv.prototype.evt_DefJzSelectSkillSc;
                    dsv.prototype.evt_DefJzSelectSkillSc = function () {
                        this.__lastSentSkillVal = null;
                        if (origEvtSelect) origEvtSelect.apply(this, arguments);
                        bindEscapeBlackBg(this);
                        if (bot.settings && bot.settings.auto_defjz && Date.now() >= (bot.state.suppressDefJzUntil || 0)) {
                            const self = this;
                            setTimeout(() => {
                                try {
                                    if (bot.isViewVisible(self)) {
                                        bot.autoSelectBestDefJzSkill(self);
                                    }
                                } catch (e) { }
                            }, 100);
                        }
                    };
                }

                const djm = (gm && gm.DefJzModel) || (window.ModelManager && window.ModelManager.DefJzModel);
                const djmProto = djm && (djm.prototype || Object.getPrototypeOf(djm));
                if (djmProto && !djmProto.__QA_AUTO_BUFF__) {
                    djmProto.__QA_AUTO_BUFF__ = true;
                    djmProto.isFastAutoSelect = function () {
                        return true;
                    };
                    const origAutoSelect = djmProto.autoSelectPreSkill;
                    djmProto.autoSelectPreSkill = function (type, preSkills, doRequest) {
                        if (typeof doRequest === "undefined") doRequest = false;
                        if (!preSkills || preSkills.length === 0) {
                            if (origAutoSelect) return origAutoSelect.apply(this, arguments);
                            return 0;
                        }
                        let bestIndex = 0;
                        let highestScore = -999999;
                        let bestSkillVal = null;
                        let bestBuffInfo = null;

                        for (let i = 0; i < preSkills.length; i++) {
                            const sVal = preSkills[i]._val;
                            const evalResult = bot.evaluateDefJzBuff(sVal);
                            if (evalResult.score > highestScore) {
                                highestScore = evalResult.score;
                                bestIndex = i;
                                bestSkillVal = sVal;
                                bestBuffInfo = evalResult;
                            }
                        }

                        if (doRequest && bestBuffInfo) {
                            bot.log(`🛡️ Bí Cảnh (Model): Tự động chọn Thẻ Buff mạnh nhất [${bestBuffInfo.name}] (${bestBuffInfo.desc}) - Điểm: ${bestBuffInfo.score}`);
                        }
                        if (doRequest && bestSkillVal !== null && this.requsetPreSkill) {
                            this.requsetPreSkill(type, bestSkillVal);
                        }
                        return bestIndex;
                    };
                }

                // Hook HomeLandChapterView: Tự động bấm nhận thưởng nhiệm vụ và thưởng giai đoạn nếu popup đang mở
                try {
                    let hcvMod = null;
                    if (typeof window.__require === "function") {
                        try { hcvMod = window.__require("HomeLandChapterView"); } catch (e) { }
                    }
                    const HomeLandChapterViewClass = (hcvMod && (hcvMod.HomeLandChapterView || hcvMod.default || hcvMod)) || (gm && gm.HomeLandChapterView) || window.HomeLandChapterView;
                    if (HomeLandChapterViewClass && HomeLandChapterViewClass.prototype && !HomeLandChapterViewClass.prototype.__QA_AUTO_CLAIM__) {
                        HomeLandChapterViewClass.prototype.__QA_AUTO_CLAIM__ = true;
                        const origUpdateTask = HomeLandChapterViewClass.prototype.updateTask;
                        HomeLandChapterViewClass.prototype.updateTask = function () {
                            if (origUpdateTask) origUpdateTask.apply(this, arguments);
                            const self = this;
                            setTimeout(() => {
                                try {
                                    if (bot.isViewVisible(self)) {
                                        // 1. Nhận thưởng các nhiệm vụ con
                                        const tm = window.ModelManager && window.ModelManager.TaskModel;
                                        if (tm && self.taskIds && Array.isArray(self.taskIds)) {
                                            for (let tid of self.taskIds) {
                                                if (tid == null) continue;
                                                try {
                                                    const isDone = tm.isCompleted ? tm.isCompleted(12, tid) : false;
                                                    if (!isDone) {
                                                        const tData = tm.getTaskData ? tm.getTaskData(12, tid) : null;
                                                        if (tData && Array.isArray(tData)) {
                                                            const cur = tData[0] || 0;
                                                            const cfg = tData[1];
                                                            const need = (cfg && cfg.task && cfg.task[3]) || 1;
                                                            if (cur >= need && tm.reqTaskComplete) {
                                                                tm.reqTaskComplete(12, tid);
                                                            }
                                                        }
                                                    }
                                                } catch (eTid) {}
                                            }
                                        }
                                        // 2. Nhận thưởng Giai Đoạn nếu nút sáng
                                        if (self.btnGet && self.btnGet.touchable && !self.btnGet.grayed) {
                                            bot.log("🎉 [Gia Viên] Tự động bấm nút [Nhận] thưởng Giai Đoạn Tái Thiết!");
                                            const hlModel = (window.ModelManager && window.ModelManager.HomeLandModel) || (gm && gm.HomeLandModel);
                                            const hlClass = (hlModel && hlModel.constructor) || gm.HomeLandModel;
                                            if (hlClass && typeof hlClass.reqGetHostGroupReward === "function") {
                                                hlClass.reqGetHostGroupReward();
                                            } else if (hlModel && typeof hlModel.reqGetHostGroupReward === "function") {
                                                hlModel.reqGetHostGroupReward();
                                            } else {
                                                const rpc = gm.RPCReq || (window.G_Mapping && window.G_Mapping.RPCReq);
                                                const proto = gm.HostTaskGainCs || (window.G_Mapping && window.G_Mapping.HostTaskGainCs);
                                                if (rpc) rpc.send((proto && proto.protocol) || 10520, {});
                                            }
                                        }
                                    }
                                } catch (e) { }
                            }, 200);
                        };
                    }
                } catch (e) { }

                                // Hook 9.5: BuildingUtil.GetFreeWorker - Đồng bộ chính xác số nông dân rảnh với tooltip hiển thị
                let buMod = null;
                if (typeof window.__require === "function") {
                    try { buMod = window.__require("BuildingUtil"); } catch (e) { }
                }
                const BuildingUtilClass = (buMod && (buMod.BuildingUtil || buMod.default || buMod)) || (gm && gm.BuildingUtil) || window.BuildingUtil;
                if (BuildingUtilClass && typeof BuildingUtilClass.GetWorkerData === "function" && !BuildingUtilClass.__QA_WORKER_HOOKED__) {
                    BuildingUtilClass.__QA_WORKER_HOOKED__ = true;
                    BuildingUtilClass.GetFreeWorker = function () {
                        try {
                            const res = BuildingUtilClass.GetWorkerData();
                            if (Array.isArray(res)) {
                                const total = Number(res[0]) || 0;
                                const busyList = Array.isArray(res[1]) ? res[1] : [];
                                return Math.max(0, total - busyList.length);
                            }
                        } catch (eW) { }
                        return 0;
                    };
                }

// Hook 10: TreasureBoxView & TreasureRewardModel - Debounce chống lỗi "Mạng không ổn định, không nhấp trùng" (code 7) khi bấm Đào
                try {
                    let tbvMod = null;
                    if (typeof window.__require === "function") {
                        try { tbvMod = window.__require("TreasureBoxView"); } catch (e) { }
                    }
                    const TreasureBoxViewClass = (tbvMod && (tbvMod.TreasureBoxView || tbvMod.default || tbvMod)) || (gm && gm.TreasureBoxView) || window.TreasureBoxView;
                    if (TreasureBoxViewClass && TreasureBoxViewClass.prototype && !TreasureBoxViewClass.prototype.__QA_DEBOUNCE_HOOKED__) {
                        TreasureBoxViewClass.prototype.__QA_DEBOUNCE_HOOKED__ = true;
                        const origOpenBox = TreasureBoxViewClass.prototype.openBox;
                        TreasureBoxViewClass.prototype.openBox = function () {
                            const now = Date.now();
                            if (this.__lastOpenBoxClick && (now - this.__lastOpenBoxClick < 400)) {
                                console.warn("[TreasureBoxView] Bỏ qua nhấp trùng < 400ms");
                                return;
                            }
                            this.__lastOpenBoxClick = now;
                            if (origOpenBox) return origOpenBox.apply(this, arguments);
                        };
                    }

                    const trmModel = (window.ModelManager && window.ModelManager.TreasureRewardModel) || (gm && gm.TreasureRewardModel);
                    const trmClass = (trmModel && trmModel.constructor) || (gm && gm.TreasureRewardModel);
                    if (trmClass && trmClass.prototype && !trmClass.prototype.__QA_DEBOUNCE_HOOKED__) {
                        trmClass.prototype.__QA_DEBOUNCE_HOOKED__ = true;
                        const origReqOpen = trmClass.prototype.reqEquipBoxOpen;
                        trmClass.prototype.reqEquipBoxOpen = function (cnt, type) {
                            type = (typeof type !== "undefined") ? type : 3;
                            const now = Date.now();
                            if (this.__lastBoxReqTime && (now - this.__lastBoxReqTime < 250)) {
                                console.warn("[TreasureRewardModel] Chặn gửi trùng reqEquipBoxOpen < 250ms");
                                return;
                            }
                            this.__lastBoxReqTime = now;

                            // Tự động dọn kho tạm nếu có trang bị chờ xử lý trước khi mở tiếp
                            try {
                                if (this._temp_equip && this._temp_equip.length > 0 && typeof this.checkAutoTempSell === "function") {
                                    this.checkAutoTempSell();
                                }
                            } catch (eSell) { }

                            // Nếu mở >= 50 và còn lượt Đào Nhanh trong ngày -> dùng reqQuickDig native của server (chỉ khi chưa hết lượt)
                            try {
                                const leftQuick = (typeof this.getLeftQuickDigNum === "function") ? (this.getLeftQuickDigNum() || 0) : 0;
                                if (cnt >= 50 && leftQuick > 0 && bot.state.quickDigExhausted !== true && typeof this.reqQuickDig === "function") {
                                    return this.reqQuickDig(cnt, type || 3);
                                }
                            } catch (eQD) { }

                            // 1. Kiểm tra tài khoản có sở hữu Privilege 1 thực tế trên server không
                            const rsm = (window.ModelManager && window.ModelManager.RechargeShopModel) || (window.G_Mapping && window.G_Mapping.RechargeShopModel);
                            const hasRealPriv1 = (function () {
                                try {
                                    if (rsm && rsm._realPrivilegeData && rsm._realPrivilegeData[1]) {
                                        const p1 = rsm._realPrivilegeData[1];
                                        const stm = (window.ModelManager && window.ModelManager.ServerTimeModel) || (window.G_Mapping && window.G_Mapping.ServerTimeModel);
                                        const now = (stm && stm.getServerTime ? stm.getServerTime() : 0) || Math.floor(Date.now() / 1000);
                                        return (p1._e_sec === 0 || p1._e_sec > now);
                                    }
                                } catch (eP) { }
                                return false;
                            })();

                            // 2. Lấy giới hạn số lượng mở hợp lệ mà server cho phép trong 1 gói (VIP 4 mở được 40 rương/lần)
                            let legalCnt = 40;
                            try {
                                if (typeof this.geBoxOpenRealyNumByType === "function") {
                                    legalCnt = this.geBoxOpenRealyNumByType(type || 3);
                                } else if (typeof this.geBoxOpenNumByType === "function") {
                                    legalCnt = this.geBoxOpenNumByType(type || 3);
                                }
                            } catch (eCnt) { }
                            if (!hasRealPriv1 && legalCnt > 40) {
                                legalCnt = 40;
                            }
                            legalCnt = Math.max(1, legalCnt || 40);

                            // 3. Nếu tài khoản có VIP 1 thật hoặc số lượng gửi <= legalCnt: Gửi thẳng
                            if (hasRealPriv1 || cnt <= legalCnt) {
                                if (origReqOpen) return origReqOpen.call(this, cnt, type);
                                return;
                            }

                            // 4. Nếu người chơi bấm Mở vượt quá legalCnt (ví dụ 50 rương khi legalCnt là 40):
                            // Tự động chia nhỏ thành các đợt mở legalCnt (40 rương/lần, đợt sau 10) gửi cách nhau 500ms
                            const self = this;
                            let remaining = cnt;
                            const sendChunk = function () {
                                if (remaining <= 0) return;
                                try {
                                    const costInfo = (typeof self.geBoxCostByType === "function") ? self.geBoxCostByType(type) : null;
                                    if (costInfo && costInfo.length >= 3) {
                                        const pm = (window.ModelManager && window.ModelManager.PlayerModel) || (window.G_Mapping && window.G_Mapping.PlayerModel);
                                        const curMoney = pm ? pm.getMoneyNum(costInfo[1]) : 999;
                                        const costPerBox = costInfo[2] || 1;
                                        if (curMoney < costPerBox) {
                                            console.log("[TreasureRewardModel] Hết xẻng, dừng chuỗi mở rương.");
                                            return;
                                        }
                                    }
                                } catch (eChk) { }

                                const thisBatch = Math.min(remaining, legalCnt);
                                remaining -= thisBatch;
                                self.__lastBoxReqTime = Date.now();
                                if (origReqOpen) origReqOpen.call(self, thisBatch, type);

                                if (remaining > 0 && bot.state.quickDigExhausted !== true) {
                                    setTimeout(sendChunk, 500);
                                }
                            };
                            sendChunk();
                        };

                        // Tương tự cho reqQuickDig (Đào nhanh)
                        if (typeof trmClass.prototype.reqQuickDig === "function") {
                            const origReqQuickDig = trmClass.prototype.reqQuickDig;
                            trmClass.prototype.reqQuickDig = function (cnt, type) {
                                type = (typeof type !== "undefined") ? type : 3;
                                // Nếu đã báo hết lượt đào nhanh (311) -> chuyển thẳng sang reqEquipBoxOpen
                                if (bot.state.quickDigExhausted === true) {
                                    return this.reqEquipBoxOpen(cnt, type);
                                }
                                const rsm = (window.ModelManager && window.ModelManager.RechargeShopModel) || (window.G_Mapping && window.G_Mapping.RechargeShopModel);
                                const hasRealPriv1 = (function () {
                                    try {
                                        if (rsm && rsm._realPrivilegeData && rsm._realPrivilegeData[1]) {
                                            const p1 = rsm._realPrivilegeData[1];
                                            const stm = (window.ModelManager && window.ModelManager.ServerTimeModel) || (window.G_Mapping && window.G_Mapping.ServerTimeModel);
                                            const now = (stm && stm.getServerTime ? stm.getServerTime() : 0) || Math.floor(Date.now() / 1000);
                                            return (p1._e_sec === 0 || p1._e_sec > now);
                                        }
                                    } catch (eP) { }
                                    return false;
                                })();

                                let legalCnt = 40;
                                try {
                                    if (typeof this.geBoxOpenRealyNumByType === "function") {
                                        legalCnt = this.geBoxOpenRealyNumByType(type || 3);
                                    } else if (typeof this.geBoxOpenNumByType === "function") {
                                        legalCnt = this.geBoxOpenNumByType(type || 3);
                                    }
                                } catch (eCnt) { }
                                if (!hasRealPriv1 && legalCnt > 40) {
                                    legalCnt = 40;
                                }
                                legalCnt = Math.max(1, legalCnt || 40);

                                let targetCnt = cnt;
                                if (!targetCnt) {
                                    try {
                                        targetCnt = (typeof this.geBoxOpenRealyNumByType === "function") ? this.geBoxOpenRealyNumByType(type || 3) : 40;
                                    } catch (eC) { targetCnt = 40; }
                                }

                                if (hasRealPriv1 || targetCnt <= legalCnt) {
                                    if (origReqQuickDig) return origReqQuickDig.call(this, targetCnt, type);
                                    return;
                                }

                                const self = this;
                                let remaining = targetCnt;
                                const sendQuickChunk = function () {
                                    if (remaining <= 0) return;
                                    const thisBatch = Math.min(remaining, legalCnt);
                                    remaining -= thisBatch;
                                    self.__lastBoxReqTime = Date.now();
                                    if (origReqQuickDig) origReqQuickDig.call(self, thisBatch, type);
                                    if (remaining > 0 && bot.state.quickDigExhausted !== true) {
                                        setTimeout(sendQuickChunk, 500);
                                    }
                                };
                                sendQuickChunk();
                            };
                        }
                    }
                } catch (eTbv) { }

                // Hook 11: TouhuArrowCollider - Bách phát bách trúng 100% (Aim-bot Thần Xạ Đoạt Bảo)
                try {
                    let tacMod = null;
                    if (typeof window.__require === "function") {
                        try { tacMod = window.__require("TouhuArrowCollider"); } catch (e) { }
                    }
                    const tacClass = (tacMod && (tacMod.TouhuArrowCollider || tacMod.default || tacMod)) || (gm && gm.TouhuArrowCollider) || window.TouhuArrowCollider;
                    if (tacClass && tacClass.prototype && !tacClass.prototype.__QA_AIMBOT_HOOKED__) {
                        tacClass.prototype.__QA_AIMBOT_HOOKED__ = true;
                        const origOnCollision = tacClass.prototype.onCollisionEnter;
                        tacClass.prototype.onCollisionEnter = function (e) {
                            if (bot.settings.auto_touhu || bot.settings.touhu_aimbot) {
                                try {
                                    if (this.rigidBody) {
                                        this.rigidBody.enabledContactListener = false;
                                        this.rigidBody.linearVelocity = cc.v2(0, 0);
                                        this.rigidBody.unscheduleAllCallbacks();
                                        this.rigidBody.angularVelocity = 0;
                                        this.rigidBody.type = cc.RigidBodyType.Static;
                                    }
                                    const disp = (gm && gm.Dispatcher) || window.Dispatcher;
                                    const evType = (gm && gm.EventType) || window.EventType;
                                    if (disp && evType && evType.touhu_win) {
                                        disp.dispatchEvent(evType.touhu_win);
                                        return;
                                    }
                                } catch (err) { }
                            }
                            if (origOnCollision) return origOnCollision.apply(this, arguments);
                        };
                    }
                } catch (e) { }

                // Hook 12: TouhuGameView & DjTouhuGameView - Tự động bắn trúng hoàn hảo (Auto-Aim 100%)
                try {
                    const hookTouhuGame = function (targetClass) {
                        if (!targetClass || !targetClass.prototype || targetClass.prototype.__QA_TOUHU_HOOKED__) return;
                        targetClass.prototype.__QA_TOUHU_HOOKED__ = true;
                        const origLoadLevel = targetClass.prototype.loadLevel;
                        targetClass.prototype.loadLevel = function () {
                            if (origLoadLevel) origLoadLevel.apply(this, arguments);
                            if (bot.settings.auto_touhu || bot.settings.touhu_aimbot) {
                                const self = this;
                                setTimeout(() => {
                                    try {
                                        const vm = bot.getViewManager();
                                        const isOpen = vm && typeof vm.isOpenView === "function" && (vm.isOpenView("TouhuGameView") || vm.isOpenView("DjTouhuGameView"));
                                        if (isOpen && self.view && self.view.visible && !self.isEnd) {
                                            bot.log("🎯 [Thần Xạ] Tự động bắn trúng hoàn hảo (Auto-Aim 100%)!");
                                            if (typeof self.touhu_win === "function") {
                                                self.touhu_win();
                                            }
                                        }
                                    } catch (err) { }
                                }, 600);
                            }
                        };
                    };

                    let tgvMod = null;
                    if (typeof window.__require === "function") {
                        try { tgvMod = window.__require("TouhuGameView"); } catch (e) { }
                    }
                    const TouhuGameViewClass = (tgvMod && (tgvMod.TouhuGameView || tgvMod.default || tgvMod)) || (gm && gm.TouhuGameView) || window.TouhuGameView;
                    hookTouhuGame(TouhuGameViewClass);

                    let djTgvMod = null;
                    if (typeof window.__require === "function") {
                        try { djTgvMod = window.__require("DjTouhuGameView"); } catch (e) { }
                    }
                    const DjTouhuGameViewClass = (djTgvMod && (djTgvMod.DjTouhuGameView || djTgvMod.default || djTgvMod)) || (gm && gm.DjTouhuGameView) || window.DjTouhuGameView;
                    hookTouhuGame(DjTouhuGameViewClass);
                } catch (e) { }

                // Hook 13: TouhuResultView - Tự động đóng bảng kết quả để tiếp tục
                try {
                    let trvMod = null;
                    if (typeof window.__require === "function") {
                        try { trvMod = window.__require("TouhuResultView"); } catch (e) { }
                    }
                    const TouhuResultViewClass = (trvMod && (trvMod.TouhuResultView || trvMod.default || trvMod)) || (gm && gm.TouhuResultView) || window.TouhuResultView;
                    if (TouhuResultViewClass && TouhuResultViewClass.prototype && !TouhuResultViewClass.prototype.__QA_TOUHU_CLOSE__) {
                        TouhuResultViewClass.prototype.__QA_TOUHU_CLOSE__ = true;
                        const origInitResultUI = TouhuResultViewClass.prototype._initUI;
                        TouhuResultViewClass.prototype._initUI = function () {
                            if (origInitResultUI) origInitResultUI.apply(this, arguments);
                            if (bot.settings.auto_touhu || bot.settings.touhu_aimbot) {
                                const self = this;
                                setTimeout(() => {
                                    try {
                                        if (typeof self.closeView === "function") {
                                            bot.log("🏆 [Thần Xạ] Đóng bảng tổng kết điểm.");
                                            self.closeView();
                                        }
                                    } catch (e) { }
                                }, 1200);
                            }
                        };
                    }
                } catch (e) { }

                // Hook 13.1: FeiDaoGameView - Tự động vượt ải Phi Kiếm hoàn hảo (Auto-Win)
                try {
                    let fdgMod = null;
                    if (typeof window.__require === "function") {
                        try { fdgMod = window.__require("FeiDaoGameView"); } catch (e) { }
                    }
                    const FeiDaoGameViewClass = (fdgMod && (fdgMod.FeiDaoGameView || fdgMod.default || fdgMod)) || (gm && gm.FeiDaoGameView) || window.FeiDaoGameView;
                    if (FeiDaoGameViewClass && FeiDaoGameViewClass.prototype && !FeiDaoGameViewClass.prototype.__QA_FEIDAO_HOOKED__) {
                        FeiDaoGameViewClass.prototype.__QA_FEIDAO_HOOKED__ = true;
                        const origStartGame = FeiDaoGameViewClass.prototype.startGame;
                        FeiDaoGameViewClass.prototype.startGame = function () {
                            if (origStartGame) origStartGame.apply(this, arguments);
                            if (bot.settings.auto_feidao !== false) {
                                const self = this;
                                setTimeout(() => {
                                    try {
                                        const vm = bot.getViewManager();
                                        const isOpen = vm && typeof vm.isOpenView === "function" && vm.isOpenView("FeiDaoGameView");
                                        if (isOpen && self.isGameRunning && typeof self.onGameWin === "function") {
                                            bot.log("🗡️ [Phi Đao] Tự động vượt ải Phi Kiếm hoàn hảo (Auto-Win)!");
                                            self.onGameWin();
                                        }
                                    } catch (err) { }
                                }, 500);
                            }
                        };
                    }
                } catch (e) { }

                // Hook 13.2: FeiDaoResultView & FeiDaoFirstResultView - Tự động qua màn kế tiếp
                try {
                    const hookFeiDaoResult = function (targetClass, name) {
                        if (!targetClass || !targetClass.prototype || targetClass.prototype.__QA_RESULT_HOOKED__) return;
                        targetClass.prototype.__QA_RESULT_HOOKED__ = true;
                        const origInitUI = targetClass.prototype._initUI;
                        targetClass.prototype._initUI = function () {
                            if (origInitUI) origInitUI.apply(this, arguments);
                            if (bot.settings.auto_feidao !== false) {
                                const self = this;
                                setTimeout(() => {
                                    try {
                                        bot.log("🗡️ [Phi Đao] Vượt màn thành công -> Tự động chuyển tiếp...");
                                        if (self.nextBtn) {
                                            if (typeof self.nextBtn.onClick === "function") self.nextBtn.onClick();
                                            else if (self.nextBtn.callClickListener) self.nextBtn.callClickListener();
                                            else if (self.nextBtn.click) self.nextBtn.click();
                                        } else if (self.btn_next) {
                                            if (typeof self.btn_next.onClick === "function") self.btn_next.onClick();
                                            else if (self.btn_next.callClickListener) self.btn_next.callClickListener();
                                            else if (self.btn_next.click) self.btn_next.click();
                                        } else if (typeof self.closeSelf === "function") {
                                            self.closeSelf();
                                        }
                                    } catch (err) { }
                                }, 800);
                            }
                        };
                    };

                    let resMod = null, firstResMod = null;
                    if (typeof window.__require === "function") {
                        try { resMod = window.__require("FeiDaoResultView"); } catch (e) { }
                        try { firstResMod = window.__require("FeiDaoFirstResultView"); } catch (e) { }
                    }
                    const ResClass = (resMod && (resMod.FeiDaoResultView || resMod.default || resMod)) || (gm && gm.FeiDaoResultView) || window.FeiDaoResultView;
                    const FirstResClass = (firstResMod && (firstResMod.FeiDaoFirstResultView || firstResMod.default || firstResMod)) || (gm && gm.FeiDaoFirstResultView) || window.FeiDaoFirstResultView;
                    hookFeiDaoResult(ResClass, "FeiDaoResultView");
                    hookFeiDaoResult(FirstResClass, "FeiDaoFirstResultView");
                } catch (e) { }

                // Hook 13.3: HongBaoActView - Tự động mở & giật Lì Xì hoạt động
                try {
                    let hbMod = null;
                    if (typeof window.__require === "function") {
                        try { hbMod = window.__require("HongBaoActView"); } catch (e) { }
                    }
                    const HongBaoClass = (hbMod && (hbMod.HongBaoActView || hbMod.default || hbMod)) || (gm && gm.HongBaoActView) || window.HongBaoActView;
                    if (HongBaoClass && HongBaoClass.prototype && !HongBaoClass.prototype.__QA_HONGBAO_HOOKED__) {
                        HongBaoClass.prototype.__QA_HONGBAO_HOOKED__ = true;
                        const origInitData = HongBaoClass.prototype.initData || HongBaoClass.prototype._initUI;
                        HongBaoClass.prototype.initData = function () {
                            if (origInitData) origInitData.apply(this, arguments);
                            if (bot.settings.auto_hongbao !== false) {
                                const self = this;
                                setTimeout(() => {
                                    try {
                                        if (self.times > 0 && typeof self.openHongbao === "function") {
                                            bot.log(`🧧 [Lì Xì] Phát hiện ${self.times} lượt mở -> Tự động giật Lì Xì (chạy ẩn)...`);
                                            self.openHongbao();
                                        }
                                        // Đóng ngay giao diện Lì Xì để chạy ẩn hoàn toàn không chiếm màn hình
                                        setTimeout(() => {
                                            try {
                                                if (typeof self.closeView === "function") self.closeView();
                                                else {
                                                    const vm = bot.getViewManager();
                                                    if (vm && typeof vm.close === "function") vm.close("HongBaoActView");
                                                }
                                            } catch (eClose) { }
                                        }, 180);
                                    } catch (err) { }
                                }, 150);
                            }
                        };
                    }
                } catch (e) { }

                // Hook 13.4: ActivityTaskView & ActivityPageTaskView - Đã vô hiệu hóa auto-click UI để loại bỏ hoàn toàn toast "Đã nhận hết"
                // Việc nhận thưởng sự kiện / hoạt động đã được xử lý 100% ngầm và an toàn qua giao thức RPC trong runAutoDailyRewardsSmart.

                // Hook 14: SkVsModel, TianshiModel & Dispatcher - Bắt dữ liệu Long Hổ Tranh Bá & Ép Cược MAX 100% Xu Đang Có
                try {
                    const disp = (gm && gm.Dispatcher) || window.Dispatcher;
                    if (disp && typeof disp.dispatchEvent === "function" && !disp.__QA_SKVS_DISP_HOOKED__) {
                        disp.__QA_SKVS_DISP_HOOKED__ = true;
                        const origDispatch = disp.dispatchEvent;
                        disp.dispatchEvent = function (evt, ...args) {
                            try {
                                const evType = (gm && gm.EventType) || window.EventType || {};
                                if (evt === "skvs_pre_guess_role_update" || evt === evType.skvs_pre_guess_role_update) {
                                    const data = args[0];
                                    if (data && Array.isArray(data._shows)) {
                                        if (data._page === 1 || !bot.state._skvsCandidates) {
                                            bot.state._skvsCandidates = data._shows.slice();
                                        } else {
                                            const existingRids = new Set(bot.state._skvsCandidates.map(c => bot.getCandidateRid(c)));
                                            for (let item of data._shows) {
                                                const rId = bot.getCandidateRid(item);
                                                if (rId && !existingRids.has(rId)) {
                                                    bot.state._skvsCandidates.push(item);
                                                    existingRids.add(rId);
                                                }
                                            }
                                        }
                                    }
                                } else if (evt === "skvs_vsing_guess_update" || evt === evType.skvs_vsing_guess_update) {
                                    const vsData = args[0];
                                    if (vsData) {
                                        bot.state._skvsVsingData = vsData;
                                        if (bot.state.isAutoSkVsActive && (vsData._side || 0) === 0 && (vsData._chip || 0) >= 10) {
                                            setTimeout(() => {
                                                if (typeof bot.runAutoSkVsSmart === "function") {
                                                    bot.runAutoSkVsSmart(true);
                                                }
                                            }, 250);
                                        }
                                    }
                                } else if (evt === "skvs_chip_update" || evt === evType.skvs_chip_update) {
                                    if (bot.state._skvsVsingData && args[0]) {
                                        if (typeof args[0]._chip !== "undefined") {
                                            bot.state._skvsVsingData._chip = args[0]._chip;
                                        }
                                        if (typeof args[0]._side !== "undefined") {
                                            bot.state._skvsVsingData._side = args[0]._side;
                                        }
                                    }
                                } else if (evt === "tianshi_war_guess_update" || evt === evType.tianshi_war_guess_update) {
                                    const tsWarData = args[0];
                                    if (tsWarData) {
                                        bot.state._tianshiWarGuessData = tsWarData;
                                        if (bot.state.isAutoSkVsActive && (tsWarData._side || 0) === 0) {
                                            setTimeout(() => {
                                                if (typeof bot.runAutoSkVsSmart === "function") {
                                                    bot.runAutoSkVsSmart(true);
                                                }
                                            }, 250);
                                        }
                                    }
                                }
                            } catch (e) { }
                            return origDispatch.apply(this, [evt, ...args]);
                        };
                    }

                    // 14.1: Hook SkVsModel - Tự động chạy khi có dữ liệu & Ép reqVsingGuess luôn cược MAX 100% số xu đang có
                    let skMod = null;
                    if (typeof window.__require === "function") {
                        try { skMod = window.__require("SkVsModel"); } catch (e) { }
                    }
                    const skClass = (skMod && (skMod.SkVsModel || skMod.default || skMod)) || (gm && gm.SkVsModel);
                    const skProto = (skClass && skClass.prototype) || (window.ModelManager && window.ModelManager.SkVsModel && Object.getPrototypeOf(window.ModelManager.SkVsModel));
                    if (skProto && !skProto.__QA_SKVS_HOOKED__) {
                        skProto.__QA_SKVS_HOOKED__ = true;
                        const origInitMyGuess = skProto.initMyGuessData;
                        if (typeof origInitMyGuess === "function") {
                            skProto.initMyGuessData = function (list) {
                                const ret = origInitMyGuess.apply(this, arguments);
                                try {
                                    if (bot.state.isAutoSkVsActive) {
                                        setTimeout(() => {
                                            if (typeof bot.runAutoSkVsSmart === "function") {
                                                bot.runAutoSkVsSmart();
                                            }
                                        }, 300);
                                    }
                                } catch (e) { }
                                return ret;
                            };
                        }

                        const origReqVsingGuess = skProto.reqVsingGuess;
                        if (typeof origReqVsingGuess === "function") {
                            skProto.reqVsingGuess = function (side, chip) {
                                try {
                                    let maxAvail = Number(chip) || 0;
                                    if (bot.state._skvsVsingData && (Number(bot.state._skvsVsingData._chip) || 0) > maxAvail) {
                                        maxAvail = Number(bot.state._skvsVsingData._chip) || 0;
                                    }
                                    const vm = (gm && gm.ViewManager) || window.ViewManager;
                                    if (vm && typeof vm.getView === "function") {
                                        const moneyView = vm.getView("SkVsGuessMoneyView");
                                        if (moneyView && moneyView._args && (Number(moneyView._args[1]) || 0) > maxAvail) {
                                            maxAvail = Number(moneyView._args[1]) || 0;
                                        }
                                        const guessView = vm.getView("SkVsGuessView");
                                        if (guessView && guessView.SkVsGuessingComp && (Number(guessView.SkVsGuessingComp.hasChip) || 0) > maxAvail) {
                                            maxAvail = Number(guessView.SkVsGuessingComp.hasChip) || 0;
                                        }
                                    }
                                    const pm = window.ModelManager && window.ModelManager.PlayerModel;
                                    if (pm && typeof pm.getItemNum === "function") {
                                        const bagChip = Number(pm.getItemNum(26)) || 0;
                                        if (bagChip > maxAvail) maxAvail = bagChip;
                                    }
                                    const maxBet = Math.floor(maxAvail / 10) * 10;
                                    if (maxBet >= 10 && maxBet !== (Number(chip) || 0)) {
                                        bot.log(`🔥 [Long Hổ] Ép mức cược 1v1 lên MAX: ${maxBet} xu (thay vì ${chip} xu)`);
                                        chip = maxBet;
                                    }
                                } catch (e) { }
                                return origReqVsingGuess.call(this, side, chip);
                            };
                        }
                    }

                    // 14.2: Hook SkVsGuessMoneyView - Sửa lỗi game mặc định kéo thanh trượt cược 1 nửa (i / 2) thành MAX 100% (i)
                    let skMoneyMod = null;
                    if (typeof window.__require === "function") {
                        try { skMoneyMod = window.__require("SkVsGuessMoneyView"); } catch (e) { }
                    }
                    const SkVsGuessMoneyViewClass = (skMoneyMod && (skMoneyMod.SkVsGuessMoneyView || skMoneyMod.default || skMoneyMod)) || (gm && gm.SkVsGuessMoneyView) || window.SkVsGuessMoneyView;
                    if (SkVsGuessMoneyViewClass && SkVsGuessMoneyViewClass.prototype && !SkVsGuessMoneyViewClass.prototype.__QA_SKVS_MAX_HOOKED__) {
                        SkVsGuessMoneyViewClass.prototype.__QA_SKVS_MAX_HOOKED__ = true;
                        const origShowView = SkVsGuessMoneyViewClass.prototype.showView;
                        if (typeof origShowView === "function") {
                            SkVsGuessMoneyViewClass.prototype.showView = function (e) {
                                const ret = origShowView.apply(this, arguments);
                                try {
                                    if (e && this.slider && typeof this.slider.setData === "function") {
                                        const self = this;
                                        let totalChip = Number(e[1]) || 0;
                                        if (bot.state._skvsVsingData && (Number(bot.state._skvsVsingData._chip) || 0) > totalChip) {
                                            totalChip = Number(bot.state._skvsVsingData._chip) || 0;
                                        }
                                        const maxStep = Math.floor(totalChip / 10);
                                        this.slider.setData(0, maxStep, maxStep, function (val) {
                                            if (self.slider && self.slider.selectNum) {
                                                self.slider.selectNum.setText(10 * val);
                                            }
                                        });
                                        if (this.slider.selectNum) {
                                            this.slider.selectNum.setText(10 * maxStep);
                                        }
                                    }
                                } catch (err) { }
                                return ret;
                            };
                        }
                    }

                    // 14.3: Hook TianshiModel & TianshiGuessMoneyView - Sửa lỗi mặc định cược 10 xu thành MAX 100% số xu đang có
                    let tsMod = null;
                    if (typeof window.__require === "function") {
                        try { tsMod = window.__require("TianshiModel"); } catch (e) { }
                    }
                    const tsClass = (tsMod && (tsMod.TianshiModel || tsMod.default || tsMod)) || (gm && gm.TianshiModel);
                    const tsProto = (tsClass && tsClass.prototype) || (window.ModelManager && window.ModelManager.TianshiModel && Object.getPrototypeOf(window.ModelManager.TianshiModel));
                    if (tsProto && !tsProto.__QA_TS_HOOKED__) {
                        tsProto.__QA_TS_HOOKED__ = true;
                        const origReqTsWarGuess = tsProto.reqTianshiSetWarGuess;
                        if (typeof origReqTsWarGuess === "function") {
                            tsProto.reqTianshiSetWarGuess = function (side, chip) {
                                try {
                                    let maxAvail = Number(chip) || 0;
                                    const mine = typeof this.getTianshiMine === "function" ? this.getTianshiMine() : this._tianshiMine;
                                    if (mine && (Number(mine._chip) || 0) > maxAvail) {
                                        maxAvail = Number(mine._chip) || 0;
                                    }
                                    const maxBet = Math.floor(maxAvail / 10) * 10;
                                    if (maxBet >= 10 && maxBet !== (Number(chip) || 0)) {
                                        bot.log(`🔥 [Long Hổ Liên SV] Ép mức cược 1v1 lên MAX: ${maxBet} xu (thay vì ${chip} xu)`);
                                        chip = maxBet;
                                    }
                                } catch (e) { }
                                return origReqTsWarGuess.call(this, side, chip);
                            };
                        }
                    }

                    let tsMoneyMod = null;
                    if (typeof window.__require === "function") {
                        try { tsMoneyMod = window.__require("TianshiGuessMoneyView"); } catch (e) { }
                    }
                    const TianshiGuessMoneyViewClass = (tsMoneyMod && (tsMoneyMod.TianshiGuessMoneyView || tsMoneyMod.default || tsMoneyMod)) || (gm && gm.TianshiGuessMoneyView) || window.TianshiGuessMoneyView;
                    if (TianshiGuessMoneyViewClass && TianshiGuessMoneyViewClass.prototype && !TianshiGuessMoneyViewClass.prototype.__QA_TS_MAX_HOOKED__) {
                        TianshiGuessMoneyViewClass.prototype.__QA_TS_MAX_HOOKED__ = true;
                        const origTsShowView = TianshiGuessMoneyViewClass.prototype.showView;
                        if (typeof origTsShowView === "function") {
                            TianshiGuessMoneyViewClass.prototype.showView = function (e, t) {
                                const ret = origTsShowView.apply(this, arguments);
                                try {
                                    if (t && this.slider && typeof this.slider.setData === "function") {
                                        const self = this;
                                        const totalChip = Number(t._chip) || 0;
                                        const maxStep = Math.floor(totalChip / 10);
                                        this.slider.setData(0, maxStep, maxStep, function (val) {
                                            if (self.slider && self.slider.selectNum) {
                                                self.slider.selectNum.setText(10 * val);
                                            }
                                        });
                                        if (this.slider.selectNum) {
                                            this.slider.selectNum.setText(10 * maxStep);
                                        }
                                    }
                                } catch (err) { }
                                return ret;
                            };
                        }
                    }
                } catch (eSk) { }

                // Hook 15: HelperMainView & HelperFinishView - Mở khóa danh sách Trợ Thủ Tiện Lợi (Không bị trắng trơn / 0/0 do chặn cấp 85 / ngày 32)
                try {
                    let hmvMod = null;
                    if (typeof window.__require === "function") {
                        try { hmvMod = window.__require("HelperMainView"); } catch (e) { }
                    }
                    const HelperMainViewClass = (hmvMod && (hmvMod.HelperMainView || hmvMod.default || hmvMod)) || (gm && gm.HelperMainView) || window.HelperMainView;
                    if (HelperMainViewClass && HelperMainViewClass.prototype && !HelperMainViewClass.prototype.__QA_HELPER_HOOKED__) {
                        HelperMainViewClass.prototype.__QA_HELPER_HOOKED__ = true;
                        const origSetList = HelperMainViewClass.prototype.setList;
                        HelperMainViewClass.prototype.setList = function () {
                            if (origSetList) {
                                try { origSetList.apply(this, arguments); } catch (e) { }
                            }
                            // Nếu danh sách bị rỗng hoặc 0 mục do chưa đạt Ngày 32 / Cấp 85, tự động nạp toàn bộ danh sách trợ thủ
                            if (!this.listData || this.listData.length === 0) {
                                try {
                                    let hcMod = null;
                                    if (typeof window.__require === "function") {
                                        try { hcMod = window.__require("HelperConfiger"); } catch (e) { }
                                    }
                                    const HelperConfiger = (hcMod && (hcMod.HelperConfiger || hcMod.default || hcMod)) || (gm && gm.HelperConfiger) || window.HelperConfiger;
                                    const mm = window.ModelManager || (gm && gm.ModelManager);
                                    let fcmMod = null;
                                    if (typeof window.__require === "function") {
                                        try { fcmMod = window.__require("FileCacheManager"); } catch (e) { }
                                    }
                                    const FileCacheManager = (fcmMod && (fcmMod.FileCacheManager || fcmMod.default || fcmMod)) || (gm && gm.FileCacheManager) || window.FileCacheManager;
                                    
                                    if (HelperConfiger && HelperConfiger.getAllHelperData) {
                                        const e = HelperConfiger.getAllHelperData();
                                        const t = {};
                                        let i = 0;
                                        for (const a in e) {
                                            const o = e[a];
                                            const r = t[o.type];
                                            if (r) {
                                                r.cfgList.push(o);
                                            } else {
                                                t[o.type] = { type: o.type, selSubType: o.subtype, cfgList: [o], isSel: false };
                                            }
                                        }
                                        const rid = (mm && mm.PlayerModel && mm.PlayerModel.getRid) ? mm.PlayerModel.getRid() : "";
                                        for (const a in t) {
                                            const d = t[a];
                                            let c = false;
                                            for (let h = 0; h < d.cfgList.length; h++) {
                                                const o = d.cfgList[h];
                                                const u = (mm && mm.HelperModel && mm.HelperModel.getHelperDataById) ? mm.HelperModel.getHelperDataById(o.id) : null;
                                                if (u && u._times) {
                                                    d.selSubType = o.subtype;
                                                    i++;
                                                    c = true;
                                                    break;
                                                }
                                            }
                                            if (!c && FileCacheManager && FileCacheManager.getIntForKey) {
                                                const p = FileCacheManager.getIntForKey(rid + "HELPER_TYPE_KEY" + d.type, 0);
                                                if (p) d.selSubType = p;
                                            }
                                        }
                                        this.listData = Object.values(t);
                                        if (this.itemList && this.itemList.setNumItems) {
                                            this.itemList.setNumItems(this.listData.length);
                                        }
                                        if (this.progressBar) {
                                            if (this.progressBar.setMax) this.progressBar.setMax(this.listData.length);
                                            if (this.progressBar.setValue) this.progressBar.setValue(i);
                                        }
                                        this._hasInit = true;
                                    }
                                } catch (errHelper) {
                                    console.error("[QA Helper Hook Error]", errHelper);
                                }
                            }
                        };
                    }

                    // Tối ưu HelperFinishView: Timeout 2.5s khi gặp tác vụ server không phản hồi
                    let hfvMod = null;
                    if (typeof window.__require === "function") {
                        try { hfvMod = window.__require("HelperFinishView"); } catch (e) { }
                    }
                    const HelperFinishViewClass = (hfvMod && (hfvMod.HelperFinishView || hfvMod.default || hfvMod)) || (gm && gm.HelperFinishView) || window.HelperFinishView;
                    if (HelperFinishViewClass && HelperFinishViewClass.prototype && !HelperFinishViewClass.prototype.__QA_TIMEOUT_HOOKED__) {
                        HelperFinishViewClass.prototype.__QA_TIMEOUT_HOOKED__ = true;
                        HelperFinishViewClass.prototype.scheduleTimeout = function () {
                            const self = this;
                            if (this.clearTimeout) this.clearTimeout();
                            this._timeoutHandle = setTimeout(function () {
                                if (!self._hasExit && 0 !== self._requestId) {
                                    console.warn("[HelperFinishView] Tác vụ " + self._requestId + " quá thời gian phản hồi, tự động bỏ qua.");
                                    if (self.evt_HelperFinishSkipSc) {
                                        self.evt_HelperFinishSkipSc(null, { _id: self._requestId });
                                    }
                                }
                            }, 2500);
                        };
                    }
                } catch (eHmv) { }


                } catch (e) {
                console.error("[AutoBot Hook Error]", e);
            }
        },

        setSpeed: function (val) {
            bot.settings.speed_hack = val;
            if (bot.isBattling() && window.cc && window.cc.director) {
                const scheduler = window.cc.director.getScheduler();
                if (scheduler && scheduler.setTimeScale) scheduler.setTimeScale(Math.min(2.5, val));
            }
            bot.log(`⚡ [Speed] Đã đặt hệ số tốc độ trận đấu: x${val}`);
        },

        setSkipAds: function (val) {
            bot.settings.skip_ads = val;
        },

        setSkipBattle: function (val) {
            bot.settings.skip_battle = !!val;
        },

        // Giữ nguyên tỷ lệ chuẩn của Cocos2d-js để giao diện Full màn hình sắc nét tự nhiên
        enhanceCanvasResolution: function () {
        },

        setAutoStageActive: function (val) {
            val = !!val;
            const changed = (bot.state.isAutoStageActive !== val);
            bot.state.isAutoStageActive = val;
            bot.settings.auto_stage = val;
            window.__AUTO_STAGE_ENABLED__ = val;
            if (window.__DAUTO_CONFIG) window.__DAUTO_CONFIG.FEAT_AUTO_STAGE = val;
            if (val) {
                if (!changed) return;
                bot.state.stageFailCount = 0;
                bot.closeBattleViews();
                try {
                    const vm = bot.getViewManager();
                    const mainUI = vm && (vm.getView("MainUI_2025View") || vm.getView("MainUIView"));
                    const bView = window.__BMV_INSTANCE__ || (mainUI && mainUI.ctlView && (mainUI.ctlView["BattleMainCopyView"] || (mainUI.loadBatteViewName && mainUI.ctlView[mainUI.loadBatteViewName])));
                    if (bView) {
                        const mm = window.ModelManager;
                        const prog = mm && mm.MainUIModel && mm.MainUIModel.getMainCopyProgress ? mm.MainUIModel.getMainCopyProgress() : null;
                        if (!bView.playData && !bView.newBattleData && prog && typeof bView.pullBatteData === "function") {
                            bView.pullBatteData(prog);
                        }
                        if (typeof bView.btn_enterBattle === "function") {
                            bView.btn_enterBattle();
                        }
                    }
                } catch (e) { }
            } else {
                try {
                    if (window.__QA_PENDING_MAIN_START__) {
                        clearTimeout(window.__QA_PENDING_MAIN_START__);
                        window.__QA_PENDING_MAIN_START__ = null;
                    }
                    if (window.__CAS_INSTANCE__ && window.__CAS_INSTANCE__.__enterBattleTimer) {
                        clearTimeout(window.__CAS_INSTANCE__.__enterBattleTimer);
                        window.__CAS_INSTANCE__.__enterBattleTimer = null;
                    }
                    const vm = bot.getViewManager();
                    const mainUI = vm && (vm.getView("MainUI_2025View") || vm.getView("MainUIView"));
                    const bView = window.__BMV_INSTANCE__ || (mainUI && mainUI.ctlView && (mainUI.ctlView["BattleMainCopyView"] || (mainUI.loadBatteViewName && mainUI.ctlView[mainUI.loadBatteViewName])));
                    if (bView) {
                        bView.isEnterGame = false;
                        if (bView.copyAnimState && typeof bView.copyAnimState.onLockState === "function") {
                            bView.copyAnimState.onLockState();
                        }
                    }
                } catch (e) { }
            }
            try {
                if (typeof window !== "undefined" && window.localStorage) {
                    window.localStorage.setItem("3qdao_bot_settings", JSON.stringify(bot.settings));
                }
            } catch (e) { }
        },

        setAutoTowerActive: function (val) {
            val = !!val;
            const changed = (bot.state.isAutoTowerActive !== val);
            bot.state.isAutoTowerActive = val;
            bot.settings.auto_tower = val;
            if (changed && val) {
                bot.state.towerFailCount = 0;
                bot.closeBattleViews();
            }
        },

        // Cập nhật chỉ số thời gian thực
        updateStats: function () {
            try {
                const mm = window.ModelManager || bot.getModelManager() || (window.G_Mapping && window.G_Mapping.ModelManager);
                if (mm && mm.PlayerModel) {
                    const pm = mm.PlayerModel;
                    if (pm.getRoleInfo) {
                        const ri = pm.getRoleInfo();
                        if (ri) {
                            bot.stats.power = (ri.getPower ? ri.getPower() : ri.power) || bot.stats.power;
                            bot.stats.roleName = (ri._name || (ri.getName ? ri.getName() : "")) || bot.stats.roleName;
                            bot.stats.level = (ri._level || (ri.getLevel ? ri.getLevel() : 0)) || bot.stats.level;
                            if (typeof bot.applyModCosmetics === "function") {
                                bot.applyModCosmetics();
                            }
                            if (bot.state.mod_skin !== false && typeof bot.refreshBattleMainCopySkins === "function") {
                                if (!bot.state._lastSkinRefresh || Date.now() - bot.state._lastSkinRefresh > 5000) {
                                    bot.state._lastSkinRefresh = Date.now();
                                    bot.refreshBattleMainCopySkins();
                                }
                            }
                        }
                    }
                    if (pm.getMoneyNum) {
                        bot.stats.gold = pm.getMoneyNum(1) || 0;
                        bot.stats.jade = pm.getMoneyNum(2) || 0;
                    }
                    if (pm.getItemNum) {
                        if (!bot.stats.gold) bot.stats.gold = pm.getItemNum(1) || 0;
                        if (!bot.stats.jade) bot.stats.jade = pm.getItemNum(2) || 0;
                    }
                }
                if (mm && mm.TreasureRewardModel && mm.PlayerModel) {
                    const trm = mm.TreasureRewardModel;
                    const pm = mm.PlayerModel;
                    const c3 = (trm.geBoxCostByType ? trm.geBoxCostByType(3) : []) || [];
                    const c2 = (trm.geBoxCostByType ? trm.geBoxCostByType(2) : []) || [];
                    const c1 = (trm.geBoxCostByType ? trm.geBoxCostByType(1) : []) || [];
                    const id3 = c3[1] || trm.costId3 || 1001;
                    const id2 = c2[1] || trm.costId2 || 1002;
                    const id1 = c1[1] || trm.costId1 || 1003;
                    bot.stats.shovels = pm.getMoneyNum ? pm.getMoneyNum(id3) : 0;
                    bot.stats.shovelsAdv = pm.getMoneyNum ? pm.getMoneyNum(id2) : 0;
                    bot.stats.shovelsMyth = pm.getMoneyNum ? pm.getMoneyNum(id1) : 0;
                }
                if (mm && mm.MainUIModel) {
                    const prog = mm.MainUIModel.getMainCopyProgress ? mm.MainUIModel.getMainCopyProgress() : (mm.MainUIModel.mainCopyProgress || mm.MainUIModel.ainCopyProgress);
                    if (prog && prog._id) bot.stats.stage = prog._id;
                    if (typeof window !== "undefined" && window.__UPDATE_HUD_STATS__) { window.__UPDATE_HUD_STATS__(bot.stats); }
                }
                if (mm && mm.ClimbTowerModel) {
                    bot.stats.towerFloor = mm.ClimbTowerModel.getCurFloor ? mm.ClimbTowerModel.getCurFloor(1) : bot.stats.towerFloor;
                }
                if (mm && mm.RechargeShopModel) {
                    const rsm = mm.RechargeShopModel;
                    // Dọn dẹp triệt để bất kỳ dữ liệu fake nào của Privilege 1 & 3 để giao diện và tính toán về chuẩn xác thực tế của server
                    if (rsm._privilegeData) {
                        if (rsm._privilegeData[1] && (!rsm._realPrivilegeData || !rsm._realPrivilegeData[1])) {
                            delete rsm._privilegeData[1];
                        }
                        if (rsm._privilegeData[3] && (!rsm._realPrivilegeData || !rsm._realPrivilegeData[3])) {
                            delete rsm._privilegeData[3];
                        }
                    }
                }
                // Đồng bộ thống kê Farm KNB & Gia Viên sang bot.stats cho runner.js, GUI và Telegram
                bot.stats.rescuedCount = Number(bot.state.rescuedCount || 0);
                bot.stats.rescuedKnbTotal = Number(bot.state.rescuedKnbTotal || 0);
                bot.stats.inspectedHomesCount = Number(bot.state.totalRescueScanned || 0);
                bot.stats.totalRescueScanned = Number(bot.state.totalRescueScanned || 0);
                bot.stats.basePower = Number((bot.state.savedFullMainArray && bot.state.savedFullMainArray.rolePower) || bot.stats.power || 0);
            } catch (e) { }
            return bot.stats;
        },

        // ====================================================================
        // TỰ ĐỘNG XẾP TƯỚNG (ĐÃ TẮT THEO YÊU CẦU: GIỮ NGUYÊN ĐỘI HÌNH NGƯỜI CHƠI ĐÃ CÀI ĐẶT)
        // ====================================================================
        autoSelectStrongestLineup: function (teamType) {
            return false;
        },

        // ====================================================================
        // BÍ KÍP HẠ LỰC CHIẾN (LC) ĐỂ TÌM NHÀ YẾU & KHÔI PHỤC FULL ĐỘI HÌNH KHI ĐÁNH GIẢI CỨU
        // - Lưu trữ an toàn đội hình mạnh nhất 6 tướng + linh thú của người chơi (Memory + LocalStorage)
        // - Khi dò hàng xóm (HostHostListCs 10512): tự động giảm bớt tướng theo bậc (1 -> 2 -> 3 -> 4 tướng)
        //   để Server ghép các gia viên có mốc Lực Chiến thấp hơn, dễ đánh bại kẻ chiếm đóng hơn.
        // - Trước khi vào đánh Giải Cứu (Revolt 106) hoặc khi Tắt Farm KNB / Bật Vượt Ải:
        //   tự động khôi phục 100% Full Đội Hình mạnh nhất vào cả đội hình Chính (Copy) & đội hình Giải Cứu (DefCity)!
        // ====================================================================
        captureAndEnsureFullFormation: function () {
            try {
                const gm = window.G_Mapping || {};
                const mm = window.ModelManager || (gm && gm.ModelManager);
                const hbm = mm && mm.HeroBagModel;
                if (!hbm || !hbm._heroProtoArray) return bot.state.savedFullMainArray || null;

                // Chặn thông báo cộng lực chiến ảo trên màn hình khi bot đang chuyển đổi đội hình dò/đánh
                try {
                    const rt = gm.RollTips || window.RollTips || (typeof window.__require === "function" && (window.__require("RollTips")?.RollTips || window.__require("RollTips")));
                    if (rt && typeof rt.showHeroPowerup === "function" && !rt.__qa_powerup_hooked) {
                        const origShowPowerup = rt.showHeroPowerup.bind(rt);
                        rt.showHeroPowerup = function () {
                            if (window.__SUPPRESS_POWERUP_TOAST_UNTIL__ && Date.now() < window.__SUPPRESS_POWERUP_TOAST_UNTIL__) {
                                return;
                            }
                            return origShowPowerup.apply(this, arguments);
                        };
                        rt.__qa_powerup_hooked = true;
                    }
                } catch (eRt) { }

                const myRid = (mm.PlayerModel && typeof mm.PlayerModel.getRid === "function") ? Number(mm.PlayerModel.getRid() || 0) : 0;
                const storageKey = myRid > 0 ? `3qdao_saved_full_array_${myRid}` : "3qdao_saved_full_array_default";
                const elfIdxStart = (gm.GameDef && gm.GameDef.FightRowPos && gm.GameDef.FightRowPos.Elf) ? (10 * gm.GameDef.FightRowPos.Elf) : 30;

                const proto1 = (typeof hbm.getProtoArrayByType === "function")
                    ? hbm.getProtoArrayByType(1, 1)
                    : (hbm._heroProtoArray[1] && hbm._heroProtoArray[1][1]);

                let allOwned = [];
                try {
                    allOwned = (typeof hbm.getAllSortHeroInfo === "function")
                        ? (hbm.getAllSortHeroInfo() || [])
                        : (hbm._heroDataItemList || []);
                } catch (eOwn) { }
                const expectedFullCount = Math.min(6, Math.max(1, allOwned.length || 6));

                const getHeroItemPower = (heroBaseId) => {
                    try {
                        const item = (typeof hbm.getHeroDataItemByHeroBaseId === "function") ? hbm.getHeroDataItemByHeroBaseId(Number(heroBaseId)) : null;
                        return item && typeof item.getPower === "function" ? Number(item.getPower() || 0) : 0;
                    } catch (eP) {
                        return 0;
                    }
                };

                if (proto1 && Array.isArray(proto1._array)) {
                    const curHeroes = [];
                    const curPets = [];
                    for (let i = 0; i < proto1._array.length; i++) {
                        const entry = proto1._array[i];
                        if (!entry || !entry._id) continue;
                        const idxNum = Number(entry._idx || 0);
                        const idNum = Number(entry._id || 0);
                        if (idxNum >= elfIdxStart) {
                            curPets.push({ _idx: idxNum, _id: idNum });
                        } else if (idxNum > 0) {
                            curHeroes.push({ _idx: idxNum, _id: idNum });
                        }
                    }

                    // Nếu đội hình hiện tại đang có đủ tướng (ví dụ 6/6 tướng) và không phải trạng thái đang hạ LC
                    if (curHeroes.length >= expectedFullCount && !bot.state.isScoutLowPowerActive) {
                        let heroPowerSum = 0;
                        curHeroes.forEach(h => { heroPowerSum += getHeroItemPower(h._id); });
                        const ri = (mm.PlayerModel && typeof mm.PlayerModel.getRoleInfo === "function") ? mm.PlayerModel.getRoleInfo() : null;
                        const rolePower = (ri && typeof ri.getPower === "function" ? Number(ri.getPower() || 0) : 0) || Number(bot.stats.power || 0) || heroPowerSum;

                        const snap = {
                            rid: myRid,
                            _arr_type: Number(proto1._arr_type || 1),
                            heroes: curHeroes,
                            pets: curPets,
                            fullArray: curHeroes.concat(curPets),
                            heroPowerSum: heroPowerSum,
                            rolePower: rolePower,
                            savedAt: Date.now()
                        };
                        bot.state.savedFullMainArray = snap;
                        window.__SAVED_FULL_MAIN_ARRAY__ = snap;
                        bot.stats.fullPower = rolePower;
                        try {
                            if (typeof window.localStorage !== "undefined") {
                                window.localStorage.setItem(storageKey, JSON.stringify(snap));
                            }
                        } catch (eLs) { }
                        return snap;
                    }
                }

                // Nếu đang ở trạng thái ít tướng, ưu tiên khôi phục từ bộ nhớ hoặc localStorage
                let saved = bot.state.savedFullMainArray || window.__SAVED_FULL_MAIN_ARRAY__;
                if (!saved || !Array.isArray(saved.heroes) || saved.heroes.length < expectedFullCount) {
                    try {
                        if (typeof window.localStorage !== "undefined") {
                            const raw = window.localStorage.getItem(storageKey);
                            if (raw) {
                                const parsed = JSON.parse(raw);
                                if (parsed && Array.isArray(parsed.heroes) && parsed.heroes.length >= expectedFullCount) {
                                    const allExist = parsed.heroes.every(h => !hbm.getHeroDataItemByHeroBaseId || !!hbm.getHeroDataItemByHeroBaseId(Number(h._id)));
                                    if (allExist) {
                                        saved = parsed;
                                        bot.state.savedFullMainArray = saved;
                                        window.__SAVED_FULL_MAIN_ARRAY__ = saved;
                                    }
                                }
                            }
                        }
                    } catch (eLoadLs) { }
                }

                // Dự phòng: Nếu chưa từng lưu snapshot 6 tướng (ví dụ tải lại trang khi đang gỡ tướng), tự động ghép đủ 6 tướng mạnh nhất
                if ((!saved || !Array.isArray(saved.heroes) || saved.heroes.length < expectedFullCount) && allOwned.length > 0) {
                    const arrType = (proto1 && proto1._arr_type) ? Number(proto1._arr_type) : 1;
                    let validSeats = [1, 2, 3, 4, 5, 6];
                    try {
                        const fCfg = gm.BattleConfiger && gm.BattleConfiger.getFormTypeById ? gm.BattleConfiger.getFormTypeById(arrType) : null;
                        if (fCfg && Array.isArray(fCfg.item_1) && fCfg.item_1.length >= 6) {
                            validSeats = fCfg.item_1.slice(0, 6).map(x => Number(x));
                        }
                    } catch (eForm) { }

                    const rebuiltHeroes = [];
                    const usedIds = {};
                    const usedSeats = {};
                    const curPets = [];

                    if (proto1 && Array.isArray(proto1._array)) {
                        for (let item of proto1._array) {
                            if (!item || !item._id) continue;
                            const idxNum = Number(item._idx || 0);
                            const idNum = Number(item._id || 0);
                            if (idxNum >= elfIdxStart) {
                                curPets.push({ _idx: idxNum, _id: idNum });
                            } else if (idxNum > 0 && rebuiltHeroes.length < expectedFullCount) {
                                rebuiltHeroes.push({ _idx: idxNum, _id: idNum });
                                usedIds[idNum] = true;
                                usedSeats[idxNum] = true;
                                const hObj = hbm.getHeroDataItemByHeroBaseId ? hbm.getHeroDataItemByHeroBaseId(idNum) : null;
                                if (hObj && typeof hObj.getAllTJLinkId === "function") {
                                    const links = hObj.getAllTJLinkId() || [];
                                    links.forEach(lid => { usedIds[Number(lid)] = true; });
                                }
                            }
                        }
                    }

                    const sortedOwned = allOwned.slice().sort((a, b) => {
                        const pa = (a && typeof a.getPower === "function") ? Number(a.getPower() || 0) : 0;
                        const pb = (b && typeof b.getPower === "function") ? Number(b.getPower() || 0) : 0;
                        return pb - pa;
                    });

                    for (let hItem of sortedOwned) {
                        if (rebuiltHeroes.length >= expectedFullCount) break;
                        const hid = Number((hItem.getId && hItem.getId()) || (hItem.getHeroBaseId && hItem.getHeroBaseId()) || hItem._id || 0);
                        if (!hid || usedIds[hid]) continue;
                        const seat = validSeats.find(s => !usedSeats[s]) || [1, 2, 3, 4, 5, 6].find(s => !usedSeats[s]) || (rebuiltHeroes.length + 1);
                        rebuiltHeroes.push({ _idx: Number(seat), _id: hid });
                        usedIds[hid] = true;
                        usedSeats[seat] = true;
                        if (typeof hItem.getAllTJLinkId === "function") {
                            const links = hItem.getAllTJLinkId() || [];
                            links.forEach(lid => { usedIds[Number(lid)] = true; });
                        }
                    }

                    if (rebuiltHeroes.length > 0) {
                        let heroPowerSum = 0;
                        rebuiltHeroes.forEach(h => { heroPowerSum += getHeroItemPower(h._id); });
                        saved = {
                            rid: myRid,
                            _arr_type: arrType,
                            heroes: rebuiltHeroes,
                            pets: curPets,
                            fullArray: rebuiltHeroes.concat(curPets),
                            heroPowerSum: heroPowerSum,
                            rolePower: Math.max(Number(bot.stats.power || 0), heroPowerSum),
                            savedAt: Date.now()
                        };
                        bot.state.savedFullMainArray = saved;
                        window.__SAVED_FULL_MAIN_ARRAY__ = saved;
                    }
                }

                return saved || null;
            } catch (e) {
                return bot.state.savedFullMainArray || null;
            }
        },

        sendHeroArraySaveSilent: function (payload) {
            try {
                const gm = window.G_Mapping || {};
                const mm = window.ModelManager || (gm && gm.ModelManager);
                const bm = mm && mm.BattleModel;
                window.__SUPPRESS_POWERUP_TOAST_UNTIL__ = Date.now() + 8000;
                if (bm && typeof bm.requestArraySaveRaw === "function") {
                    const origReport = bm.reportHeroSetArray;
                    try {
                        bm.reportHeroSetArray = function () { };
                        bm.requestArraySaveRaw(payload);
                    } finally {
                        bm.reportHeroSetArray = origReport;
                    }
                    return true;
                }
                const protoHero = (typeof window.__require === "function") ? window.__require("ProtoHero") : null;
                const protoId = (protoHero && protoHero.HeroSetArrayCs && protoHero.HeroSetArrayCs.protocol) || (gm.HeroSetArrayCs && gm.HeroSetArrayCs.protocol);
                if (protoId && gm.RPCReq && typeof gm.RPCReq.send === "function") {
                    gm.RPCReq.send(protoId, payload);
                    return true;
                }
            } catch (e) { }
            return false;
        },

        getScoutHeroCombinations: function () {
            try {
                const snap = bot.captureAndEnsureFullFormation();
                if (!snap || !Array.isArray(snap.heroes) || snap.heroes.length <= 1) return [];

                const sig = snap.heroes.map(h => `${h._idx}:${h._id}`).join(",");
                if (Array.isArray(bot.state.cachedScoutCombos) && bot.state.cachedScoutCombosSig === sig && bot.state.cachedScoutCombos.length > 0) {
                    return bot.state.cachedScoutCombos;
                }

                const gm = window.G_Mapping || {};
                const mm = window.ModelManager || (gm && gm.ModelManager);
                const hbm = mm && mm.HeroBagModel;

                const heroesWithPow = snap.heroes.map((h, idx) => {
                    const item = (hbm && hbm.getHeroDataItemByHeroBaseId) ? hbm.getHeroDataItemByHeroBaseId(Number(h._id)) : null;
                    const pow = (item && typeof item.getPower === "function") ? Number(item.getPower() || 0) : ((idx + 1) * 10000000);
                    return { _idx: Number(h._idx), _id: Number(h._id), pow: pow > 0 ? pow : ((idx + 1) * 10000000) };
                });

                heroesWithPow.sort((a, b) => a.pow - b.pow);

                const n = heroesWithPow.length;
                const maxKeep = Math.max(1, n - 1);
                const byCount = { 1: [], 2: [], 3: [], 4: [], 5: [] };
                const totalMasks = (1 << n) - 1;

                for (let mask = 1; mask < totalMasks; mask++) {
                    const subset = [];
                    let sumPow = 0;
                    for (let i = 0; i < n; i++) {
                        if ((mask & (1 << i)) !== 0) {
                            subset.push({ _idx: heroesWithPow[i]._idx, _id: heroesWithPow[i]._id });
                            sumPow += heroesWithPow[i].pow;
                        }
                    }
                    if (subset.length >= 1 && subset.length <= maxKeep) {
                        const cObj = {
                            heroes: subset,
                            count: subset.length,
                            estPower: sumPow,
                            key: subset.map(x => x._id).sort((a, b) => a - b).join("_")
                        };
                        if (!byCount[subset.length]) byCount[subset.length] = [];
                        byCount[subset.length].push(cObj);
                    }
                }

                const sampleEvenly = (arr, limit) => {
                    if (!Array.isArray(arr) || arr.length === 0) return [];
                    arr.sort((a, b) => a.estPower - b.estPower);
                    if (arr.length <= limit) return arr.slice();
                    const res = [];
                    const used = {};
                    for (let k = 0; k < limit; k++) {
                        const idx = Math.min(arr.length - 1, Math.round((k * (arr.length - 1)) / Math.max(1, limit - 1)));
                        if (!used[idx]) {
                            used[idx] = true;
                            res.push(arr[idx]);
                        }
                    }
                    return res;
                };

                // Phân bổ 20 mốc bao phủ toàn bộ 1->5 tướng, tập trung dày nhất ở 3 tướng & 4 tướng (60M-120M LC - vùng nhiều nhà bị cướp nhất):
                // - 1 tướng (acc nhỏ): 2 mốc đại diện
                // - 2 tướng (42M-65M LC): 5 mốc
                // - 3 tướng (66M-96M LC): 6 mốc (Trọng tâm #1)
                // - 4 tướng (98M-118M LC): 5 mốc (Trọng tâm #2 - nơi Mốc 14/16 nổ 4 nhà liên tiếp)
                // - 5 tướng yếu (120M-128M LC): 2 mốc thấp nhất của 5 tướng (nơi Mốc 15/16 nổ 2 nhà)
                const fiveSorted = (byCount[5] || []).slice().sort((a, b) => a.estPower - b.estPower);
                const selected = []
                    .concat(sampleEvenly(byCount[1], 2))
                    .concat(sampleEvenly(byCount[2], 5))
                    .concat(sampleEvenly(byCount[3], 6))
                    .concat(sampleEvenly(byCount[4], 5))
                    .concat(fiveSorted.slice(0, 2));

                const fullCombo = {
                    heroes: snap.heroes.map(h => ({ _idx: Number(h._idx), _id: Number(h._id) })),
                    count: snap.heroes.length,
                    estPower: (snap && snap.rolePower) || 250000000,
                    key: "full_formation"
                };
                selected.push(fullCombo);

                selected.sort((a, b) => (a.estPower - b.estPower) || (a.count - b.count));

                bot.state.cachedScoutCombosSig = sig;
                bot.state.cachedScoutCombos = selected;
                return selected;
            } catch (e) {
                return [];
            }
        },

        pickNextScoutComboIdx: function (reason = "step") {
            const combos = bot.getScoutHeroCombinations();
            const total = combos.length;
            if (total <= 1) return 0;

            if (!bot.state.scoutComboWins) bot.state.scoutComboWins = {};
            bot.state.scoutStepCounter = (bot.state.scoutStepCounter || 0) + 1;
            const curIdx = Math.abs(Number(bot.state.scoutComboIdx || 0)) % total;

            // Nhóm Chủ Lực (Core Hotzone): 2 tướng mạnh + 3 tướng + 4 tướng + 5 tướng yếu (45M - 125M LC, nơi có nhiều người chơi thật bị cướp nhất)
            // Nhóm Phụ (Low Zone): 1 tướng (19M - 30M LC, quét lướt định kỳ)
            const hotIndices = [];
            const lowIndices = [];
            for (let i = 0; i < total; i++) {
                if (combos[i].count >= 2) hotIndices.push(i);
                else lowIndices.push(i);
            }
            const mainPool = hotIndices.length > 0 ? hotIndices : combos.map((_, i) => i);

            // 1. Cứ mỗi 3 nhịp: ưu tiên quay lại mốc (hoặc mốc sát cạnh ±1) đã từng giải cứu thành công!
            if (reason !== "lose" && bot.state.scoutStepCounter % 3 === 0) {
                const winCandidates = [];
                for (let i = 0; i < total; i++) {
                    const w = Number(bot.state.scoutComboWins[combos[i].key] || 0);
                    if (w > 0 && i !== curIdx) {
                        winCandidates.push({ idx: i, w });
                        if (i > 0 && (i - 1) !== curIdx) winCandidates.push({ idx: i - 1, w: w * 0.8 });
                        if (i + 1 < total && (i + 1) !== curIdx) winCandidates.push({ idx: i + 1, w: w * 0.8 });
                    }
                }
                if (winCandidates.length > 0) {
                    winCandidates.sort((a, b) => b.w - a.w);
                    const pickPool = winCandidates.slice(0, Math.min(4, winCandidates.length));
                    const chosen = pickPool[bot.state.scoutStepCounter % pickPool.length];
                    if (chosen && chosen.idx !== curIdx) {
                        return chosen.idx;
                    }
                }
            }

            // 2. Cứ mỗi 8 nhịp: ghé qua quét nhanh mốc 1 tướng (dành ~88% thời gian ở vùng nóng 2-3-4-5 tướng!)
            if (lowIndices.length > 0 && bot.state.scoutStepCounter % 8 === 0) {
                const lIdx = lowIndices[(bot.state.scoutStepCounter / 8 | 0) % lowIndices.length];
                if (lIdx !== curIdx) return lIdx;
            }

            // 3. Quét nhảy xen kẽ (Interleaved Stride) giống bản 15:12 qua vùng nóng 2-3-4-5 tướng để phủ nhanh cả cụm 60M-125M LC!
            const stride = Math.max(1, Math.floor(mainPool.length / 3));
            bot.state.hotPoolCursor = ((bot.state.hotPoolCursor !== undefined ? bot.state.hotPoolCursor : -stride) + stride) % mainPool.length;
            if (bot.state.scoutStepCounter % mainPool.length === 0) {
                bot.state.hotPoolCursor = (bot.state.hotPoolCursor + 1) % mainPool.length;
            }
            let nextIdx = mainPool[bot.state.hotPoolCursor];
            if (nextIdx === curIdx && mainPool.length > 1) {
                bot.state.hotPoolCursor = (bot.state.hotPoolCursor + 1) % mainPool.length;
                nextIdx = mainPool[bot.state.hotPoolCursor];
            }
            return nextIdx;
        },

        chooseNextScoutCombo: function (reason = "step") {
            return (typeof this.pickNextScoutComboIdx === "function") ? this.pickNextScoutComboIdx(reason) : 0;
        },

        applyLowPowerScoutArray: async function (comboIndexOpt) {
            try {
                if (bot.isAutoStageOn() || bot.isBattling()) return false;
                const vm = bot.getViewManager ? bot.getViewManager() : window.ViewManager;
                if (vm && typeof vm.isOpenView === "function" && vm.isOpenView("BattlePrepareView")) {
                    return false;
                }

                const snap = bot.captureAndEnsureFullFormation();
                if (!snap || !Array.isArray(snap.heroes) || snap.heroes.length <= 1) return false;

                const combos = bot.getScoutHeroCombinations();
                if (!combos || combos.length === 0) return false;

                const idx = Math.abs(Number(comboIndexOpt !== undefined ? comboIndexOpt : (bot.state.scoutComboIdx || 0))) % combos.length;
                const combo = combos[idx];
                if (!combo || !Array.isArray(combo.heroes) || combo.heroes.length === 0) return false;

                if (bot.state.isScoutLowPowerActive && bot.state.currentScoutComboKey === combo.key && Date.now() - (bot.state.lastScoutArraySetTime || 0) < 15000) {
                    return true;
                }

                const scoutArray = combo.heroes.concat(Array.isArray(snap.pets) ? snap.pets : []);
                const payloadCopy = {
                    _type: 1, // e_GameplayDataTeamType.Copy (Đội hình chính quyết định LC dò nhà)
                    _id: 1,
                    _arr_type: Number(snap._arr_type || 1),
                    _array: scoutArray
                };

                const gm = window.G_Mapping || {};
                const mm = window.ModelManager || (gm && gm.ModelManager);
                const hbm = mm && mm.HeroBagModel;
                const pm = mm && mm.PlayerModel;
                const prevPow = (pm && pm.getRoleInfo && pm.getRoleInfo() && pm.getRoleInfo().getPower) ? Number(pm.getRoleInfo().getPower() || 0) : 0;

                const sent = bot.sendHeroArraySaveSilent(payloadCopy);
                if (sent) {
                    bot.state.isScoutLowPowerActive = true;
                    bot.state.currentScoutHeroCount = combo.count;
                    bot.state.currentScoutComboKey = combo.key;
                    bot.state.currentScoutComboIdx = idx + 1;
                    bot.state.totalScoutCombos = combos.length;
                    bot.state.lastScoutArraySetTime = Date.now();
                    bot.log(`🔻 [Farm KNB • Hạ LC] Đang áp dụng đội hình dò [Mốc ${idx + 1}/${combos.length}] (${combo.count} tướng • ~${(combo.estPower / 1000000).toFixed(1)}M LC) để quét đối thủ yếu hơn!`);

                    await bot.sleep(130);
                    const waitStart = Date.now();
                    while (Date.now() - waitStart < 220) {
                        const curPow = (pm && pm.getRoleInfo && pm.getRoleInfo() && pm.getRoleInfo().getPower) ? Number(pm.getRoleInfo().getPower() || 0) : 0;
                        const protoArr = hbm && hbm._heroProtoArray && hbm._heroProtoArray[1] && hbm._heroProtoArray[1][1] && hbm._heroProtoArray[1][1]._array;
                        if ((curPow > 0 && curPow !== prevPow) || (Array.isArray(protoArr) && protoArr.length === scoutArray.length)) {
                            break;
                        }
                        await bot.sleep(35);
                    }
                    return true;
                }
            } catch (e) { }
            return false;
        },

        restoreFullCombatArray: async function (reason = "combat") {
            try {
                const snap = bot.captureAndEnsureFullFormation();
                if (!snap || !Array.isArray(snap.fullArray) || snap.fullArray.length === 0) return false;

                const gm = window.G_Mapping || {};
                const mm = window.ModelManager || (gm && gm.ModelManager);
                const hbm = mm && mm.HeroBagModel;
                const pm = mm && mm.PlayerModel;
                const elfIdxStart = (gm.GameDef && gm.GameDef.FightRowPos && gm.GameDef.FightRowPos.Elf) ? (10 * gm.GameDef.FightRowPos.Elf) : 30;

                const countHeroesInProto = (teamType, subId) => {
                    if (!hbm || !hbm._heroProtoArray || !hbm._heroProtoArray[teamType] || !hbm._heroProtoArray[teamType][subId]) return 0;
                    const arr = hbm._heroProtoArray[teamType][subId]._array || [];
                    let c = 0;
                    for (let i = 0; i < arr.length; i++) {
                        if (arr[i] && Number(arr[i]._idx) > 0 && Number(arr[i]._idx) < elfIdxStart) c++;
                    }
                    return c;
                };

                const revoltType = (gm.e_GameplayDataGameplay && gm.e_GameplayDataGameplay.Revolt) ? gm.e_GameplayDataGameplay.Revolt : 106;
                const revoltTeamType = (gm.ModuleConfiger && typeof gm.ModuleConfiger.getTeamTypeByArrayType === "function")
                    ? Number(gm.ModuleConfiger.getTeamTypeByArrayType(revoltType) || 1)
                    : 1;

                const curMainHeroCount = countHeroesInProto(1, 1);
                const curRevoltHeroCount = countHeroesInProto(revoltTeamType, 1);
                const targetFullCount = snap.heroes.length;
                const curRolePower = (pm && pm.getRoleInfo && pm.getRoleInfo() && pm.getRoleInfo().getPower) ? Number(pm.getRoleInfo().getPower() || 0) : 0;

                const needRestoreMain = bot.state.isScoutLowPowerActive
                    || (curMainHeroCount < targetFullCount)
                    || (snap.rolePower > 0 && curRolePower > 0 && curRolePower < snap.rolePower * 0.92);
                const needSyncRevolt = (reason === "rescue_fight") && (!bot.state.revoltFormationSynced || (revoltTeamType !== 1 && curRevoltHeroCount < targetFullCount));

                if (!needRestoreMain && !needSyncRevolt) {
                    return true;
                }

                let didSend = false;
                if (needRestoreMain || curMainHeroCount < targetFullCount) {
                    bot.sendHeroArraySaveSilent({
                        _type: 1,
                        _id: 1,
                        _arr_type: Number(snap._arr_type || 1),
                        _array: snap.fullArray.map(x => ({ _idx: Number(x._idx), _id: Number(x._id) }))
                    });
                    didSend = true;
                }

                if (revoltTeamType > 0 && revoltTeamType !== 1 && (reason === "rescue_fight" || needSyncRevolt)) {
                    if (didSend) await bot.sleep(150);
                    // Đồng bộ đội hình mạnh nhất sang cả nhánh đội hình Giải Cứu / Công Thành (DefCity _id: 1)
                    bot.sendHeroArraySaveSilent({
                        _type: revoltTeamType,
                        _id: 1,
                        _arr_type: Number(snap._arr_type || 1),
                        _array: snap.fullArray.map(x => ({ _idx: Number(x._idx), _id: Number(x._id) }))
                    });
                    bot.state.revoltFormationSynced = true;
                    didSend = true;
                }

                bot.state.isScoutLowPowerActive = false;
                bot.state.currentScoutHeroCount = targetFullCount;
                bot.state.currentScoutComboKey = "";
                if (snap.rolePower > 0) {
                    bot.stats.power = snap.rolePower;
                }
                if (didSend && reason === "rescue_fight") {
                    bot.log(`⚔️ [Farm KNB] Đã khôi phục 100% full đội hình (${targetFullCount} tướng • LC ${(snap.rolePower || 0).toLocaleString()}) sẵn sàng chiến đấu!`);
                }

                if (didSend) {
                    // Chờ Server xác nhận cập nhật đủ 6 tướng & khôi phục 100% Lực Chiến trước khi gửi WarStartCs (10401)
                    await bot.sleep(reason === "rescue_fight" ? 240 : 160);
                    const waitStart = Date.now();
                    const maxSyncWait = reason === "rescue_fight" ? 450 : 240;
                    while (Date.now() - waitStart < maxSyncWait) {
                        const mainOk = countHeroesInProto(1, 1) >= targetFullCount;
                        const revOk = (revoltTeamType <= 1) || (countHeroesInProto(revoltTeamType, 1) >= targetFullCount);
                        const nowPow = (pm && pm.getRoleInfo && pm.getRoleInfo() && pm.getRoleInfo().getPower) ? Number(pm.getRoleInfo().getPower() || 0) : 0;
                        const powOk = (!snap.rolePower || nowPow >= snap.rolePower * 0.95);
                        if (mainOk && revOk && powOk) break;
                        await bot.sleep(40);
                    }
                    if (reason === "rescue_fight") {
                        await bot.sleep(80);
                    }
                }
                return true;
            } catch (e) {
                return false;
            }
        },


        // ====================================================================
        // TÍNH NĂNG: TỰ ĐỘNG CHỌN THẺ BUFF MẠNH NHẤT BÍ CẢNH TẢN LĨNH (Thủ Vệ Kinh Châu)
        // ====================================================================
        evaluateDefJzBuff: function (val) {
            try {
                const gm = window.G_Mapping;
                let s = null;
                if (gm && gm.DefJzConfiger && gm.DefJzConfiger.getDefenseJzSkill) {
                    s = gm.DefJzConfiger.getDefenseJzSkill(val);
                }
                if (!s) return { score: 10, name: "Thẻ Buff #" + val, desc: "", val: val };

                let d = null;
                if (gm && gm.SkillConfiger && gm.SkillConfiger.getSkillById) {
                    d = gm.SkillConfiger.getSkillById(s.id);
                }

                let name = "";
                let desc = "";
                const lc = gm && gm.LanguageConfiger;
                if (d) {
                    if (lc && lc.getHeroDataLangCh) {
                        name = lc.getHeroDataLangCh(d.skill_name) || "";
                        desc = lc.getHeroDataLangCh(d.text) || "";
                    }
                    if (!name) name = d.skill_name || ("Buff " + s.id);
                    if (!desc) desc = d.text || "";
                }

                const textToScan = (name + " " + desc).toLowerCase();
                let score = 100;

                // 1. Nhóm Ưu Tiên Tuyệt Đối: Bỏ qua phòng thủ / Xuyên giáp & Tấn công trực tiếp
                // Ví dụ: "Lực Thấu Thiên Quân" (Bỏ qua 8% phòng thủ), "Cường Hóa Công" (+10% Công)
                if (textToScan.includes("lực thấu") || textToScan.includes("xuyên") || textToScan.includes("bỏ qua") || textToScan.includes("ignore") || (textToScan.includes("phòng thủ") && textToScan.includes("bỏ qua"))) {
                    score += 1200; // Xuyên giáp / Bỏ qua thủ là buff mạnh nhất khi leo tháp / bí cảnh
                } else if (textToScan.includes("công") || textToScan.includes("tấn công") || textToScan.includes("atk") || textToScan.includes("cường hóa công")) {
                    score += 1000; // Tăng công trực tiếp
                }

                // 2. Nhóm Bạo Kích & Sát Thương Bạo (Crit / Crit DMG)
                if (textToScan.includes("bạo") || textToScan.includes("crit") || textToScan.includes("cuồng bạo") || textToScan.includes("chí mạng")) {
                    score += 850;
                }

                // 3. Nhóm Tăng Sát Thương & Hút Máu (Damage / Lifesteal)
                if (textToScan.includes("sát thương") || textToScan.includes("damage") || textToScan.includes("dmg")) {
                    score += 700;
                }
                if (textToScan.includes("hút máu") || textToScan.includes("hồi máu") || textToScan.includes("lifesteal")) {
                    score += 600;
                }

                // 4. Nhóm Tốc Độ Đánh & Hồi Nộ
                if (textToScan.includes("tốc") || textToScan.includes("nộ") || textToScan.includes("speed")) {
                    score += 500;
                }

                // 5. Nhóm Phòng Thủ (DEF) - Ví dụ: "Cảm Giác Trì Độn" (+10% DEF)
                if (textToScan.includes("cảm giác trì độn") || textToScan.includes("phòng thủ") || textToScan.includes("thủ") || textToScan.includes("def") || textToScan.includes("giảm thương")) {
                    score += 350;
                }

                // 6. Nhóm Máu / Sinh Lực (HP)
                if (textToScan.includes("sinh lực") || textToScan.includes("máu") || textToScan.includes("hp")) {
                    score += 250;
                }

                // Điểm thưởng theo % được buff trong mô tả (Ví dụ "+10%" -> +10 điểm, "+15%" -> +15 điểm)
                const matchPercent = desc.match(/(\d+)%/);
                if (matchPercent && matchPercent[1]) {
                    score += parseInt(matchPercent[1], 10);
                }

                // Điểm ưu tiên gốc từ config của game
                if (s.priority) {
                    score += (s.priority * 10);
                }

                return {
                    score: score,
                    name: name || ("Buff #" + val),
                    desc: desc,
                    val: val,
                    id: s.id
                };
            } catch (e) {
                return { score: 10, name: "Thẻ Buff #" + val, desc: "", val: val };
            }
        },

        getBestDefJzBuffIndex: function (view, sIndex) {
            try {
                if (!view || !view.deFjInfo || !view.deFjInfo._pre_skills) return 0;
                const currentGroup = view.deFjInfo._pre_skills[sIndex || 0];
                if (!currentGroup || !currentGroup._pre_skills || currentGroup._pre_skills.length === 0) return 0;
                const skills = currentGroup._pre_skills;
                let bestIndex = 0;
                let highestScore = -999999;
                for (let idx = 0; idx < skills.length; idx++) {
                    const skillItem = skills[idx];
                    const evalResult = bot.evaluateDefJzBuff(skillItem._val);
                    if (evalResult.score > highestScore) {
                        highestScore = evalResult.score;
                        bestIndex = idx;
                    }
                }
                return bestIndex;
            } catch (e) {
                return 0;
            }
        },

        finishDefJzBuffAndStartBattle: function (view) {
            try {
                if (!view) return;
                if (typeof view.seleCompCallBack === "function") {
                    view.seleCompCallBack();
                } else {
                    const fm = bot.getFightManager();
                    const gm = window.G_Mapping;
                    const gamePlayDef = (gm && gm.e_GameplayDataGameplay) || { DefJz: 9 };
                    const fightType = (gamePlayDef && gamePlayDef.DefJz) || 9;
                    const stageId = (view.deFjInfo && (view.deFjInfo._id || view.deFjInfo._type)) || 1;
                    if (fm && fm.Ins && typeof fm.Ins.requestBatte === "function") {
                        fm.Ins.requestBatte(fightType, stageId);
                    }
                }
                if (typeof view.closeView === "function") {
                    view.closeView();
                }
            } catch (e) { }
        },

        autoSelectBestDefJzSkill: function (view) {
            try {
                if (!view || !bot.isViewVisible(view)) return false;
                if (!view.deFjInfo || !view.deFjInfo._pre_skills) return false;
                const sIndex = view.showSkillsIndex || 0;
                const totalSteps = view.deFjInfo._pre_skills.length || 3;

                // Nếu đã chọn đủ toàn bộ buff (>= totalSteps), kết thúc và vào trận ngay
                if (sIndex >= totalSteps) {
                    bot.finishDefJzBuffAndStartBattle(view);
                    return true;
                }

                const currentGroup = view.deFjInfo._pre_skills[sIndex];
                if (!currentGroup || !currentGroup._pre_skills || currentGroup._pre_skills.length === 0) {
                    bot.finishDefJzBuffAndStartBattle(view);
                    return false;
                }

                const skills = currentGroup._pre_skills;
                const bestIndex = bot.getBestDefJzBuffIndex(view, sIndex);
                const bestSkill = skills[bestIndex];
                const evalResult = bestSkill ? bot.evaluateDefJzBuff(bestSkill._val) : null;

                if (evalResult) {
                    bot.log(`🛡️ Bí Cảnh [${sIndex + 1}/${totalSteps}]: Tự động chọn Thẻ Buff [${evalResult.name}] (${evalResult.desc}) - Điểm: ${evalResult.score}`);
                }

                // Cập nhật selectedIndex trên UI FairyGUI
                if (view.skillList) {
                    if (typeof view.skillList.setSelectedIndex === "function") {
                        view.skillList.setSelectedIndex(bestIndex);
                    }
                    if (view.skillList.numChildren > bestIndex) {
                        const cardItem = view.skillList.getChildAt(bestIndex);
                        if (cardItem) {
                            if (typeof cardItem.onClick === "function") cardItem.onClick();
                            else if (cardItem.callClickListener) cardItem.callClickListener();
                        }
                    }
                }

                // Hủy timer tự chọn cũ nếu có
                if (view.__autoSelectTimer) {
                    clearTimeout(view.__autoSelectTimer);
                    view.__autoSelectTimer = null;
                }

                // Gửi xác nhận sau 100ms
                view.__autoSelectTimer = setTimeout(() => {
                    try {
                        view.__autoSelectTimer = null;
                        if (!bot.isViewVisible(view)) return;

                        if (view.skillList && typeof view.skillList.setSelectedIndex === "function") {
                            view.skillList.setSelectedIndex(bestIndex);
                        }

                        // Gọi onComRequset() của view hoặc click comfimBt
                        if (typeof view.onComRequset === "function") {
                            view.onComRequset();
                        } else if (view.comfimBt) {
                            if (typeof view.comfimBt.onClick === "function") view.comfimBt.onClick();
                            else if (view.comfimBt.callClickListener) view.comfimBt.callClickListener();
                        }

                        // WATCHDOG AN TOÀN TUYỆT ĐỐI:
                        // Nếu sau 1.5s server chưa trả phản hồi (showSkillsIndex chưa tăng), tự động kích hoạt bảo vệ
                        clearTimeout(view.__watchdogTimer);
                        const dispatchIdx = sIndex;
                        view.__watchdogTimer = setTimeout(() => {
                            try {
                                if (!bot.isViewVisible(view)) return;
                                if ((view.showSkillsIndex || 0) === dispatchIdx) {
                                    bot.log(`⚠️ Bí Cảnh: Buff [${dispatchIdx + 1}/${totalSteps}] chưa nhận phản hồi sau 1.5s, tự động kích hoạt bảo vệ...`);
                                    // Thử gửi trực tiếp qua DefJzModel
                                    const mm = bot.getModelManager();
                                    const djm = (mm && mm.DefJzModel) || (window.G_Mapping && window.G_Mapping.DefJzModel);
                                    if (djm && typeof djm.requsetPreSkill === "function" && bestSkill && view.deFjInfo) {
                                        djm.requsetPreSkill(view.deFjInfo._type, bestSkill._val);
                                    }
                                    // Nếu sau 1.2s nữa vẫn chưa chuyển, cưỡng chế chuyển tiếp evt_DefJzSelectSkillSc
                                    setTimeout(() => {
                                        try {
                                            if (!bot.isViewVisible(view)) return;
                                            if ((view.showSkillsIndex || 0) === dispatchIdx) {
                                                bot.log("⚠️ Bí Cảnh: Server không phản hồi, tự động chuyển tiếp để không kẹt màn hình!");
                                                if (typeof view.evt_DefJzSelectSkillSc === "function") {
                                                    view.evt_DefJzSelectSkillSc();
                                                }
                                            }
                                        } catch (e) { }
                                    }, 1200);
                                }
                            } catch (e) { }
                        }, 1500);

                    } catch (errReq) {
                        console.error("[AutoBot] Lỗi gửi buff Bí Cảnh:", errReq);
                    }
                }, 100);

                return true;
            } catch (e) {
                console.error("[AutoBot] Lỗi autoSelectBestDefJzSkill:", e);
                return false;
            }
        },

        updateDefJzEscapeUI: function () {
            try {
                const vm = bot.getViewManager();
                const v = vm && vm.getView && vm.getView("DefJzSkillSelectView");
                let escBtn = document.getElementById("qa-defjz-escape-btn");
                if (v && bot.isViewVisible(v)) {
                    if (!escBtn) {
                        escBtn = document.createElement("div");
                        escBtn.id = "qa-defjz-escape-btn";
                        escBtn.innerHTML = "✕ Thoát Chọn Buff (ESC)";
                        escBtn.style.cssText = "position:fixed;top:14px;right:14px;z-index:9999999;background:rgba(220,38,38,0.92);color:#fff;font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:700;padding:8px 16px;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.6);cursor:pointer;border:1px solid #f87171;transition:all 0.2s;";
                        escBtn.onmouseover = () => { escBtn.style.background = "#b91c1c"; escBtn.style.transform = "scale(1.05)"; };
                        escBtn.onmouseout = () => { escBtn.style.background = "rgba(220,38,38,0.92)"; escBtn.style.transform = "scale(1)"; };
                        escBtn.onclick = () => {
                            bot.log("🛑 Đã bấm nút Thoát Khẩn Cấp Chọn Buff!");
                            try {
                                if (v && typeof v.closeView === "function") v.closeView();
                            } catch (e) { }
                            if (escBtn) escBtn.remove();
                        };
                        document.body.appendChild(escBtn);
                    }
                } else {
                    if (escBtn) escBtn.remove();
                }

                // Nút hỗ trợ Bỏ Qua & Thoát Trận Tần Lĩnh nếu đang ở màn hình trận đấu Tần Lĩnh
                const bsv = window.__CURRENT_BATTLE_SCENES_VIEW__;
                const isBsvActive = bsv && bsv.view && bsv.view.parent && (bsv.view.visible !== false);
                const aType = (bsv && bsv._args && bsv._args.arrayType) || 0;
                let bsvSkipBtn = document.getElementById("qa-defjz-skip-btn");
                if (isBsvActive && aType === 9) {
                    if (!bsvSkipBtn) {
                        bsvSkipBtn = document.createElement("div");
                        bsvSkipBtn.id = "qa-defjz-skip-btn";
                        bsvSkipBtn.innerHTML = "⚡ Bỏ Qua Tần Lĩnh (DAuto)";
                        bsvSkipBtn.style.cssText = "position:fixed;top:14px;left:14px;z-index:9999999;background:rgba(37,99,235,0.92);color:#fff;font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:700;padding:8px 16px;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.6);cursor:pointer;border:1px solid #60a5fa;transition:all 0.2s;";
                        bsvSkipBtn.onclick = () => {
                            bot.log("⚡ Người chơi bấm nút Bỏ Qua Tần Lĩnh khẩn cấp!");
                            bot.doBattleSkip(bsv);
                        };
                        document.body.appendChild(bsvSkipBtn);
                    }
                } else {
                    if (bsvSkipBtn) bsvSkipBtn.remove();
                }
            } catch (e) { }
        },

        runAutoDefJzRewards: async function () {
            try {
                const mm = bot.getModelManager();
                if (!mm || !mm.DefJzModel) return false;
                const djm = mm.DefJzModel;
                let did = false;
                if (bot.hasRed("V_DefJzTeamCanGet")) {
                    bot.log("🛡️ Bí Cảnh: Nhận thưởng vượt tầng [Đơn]!");
                    djm.requestDefJzGetReward(1);
                    did = true;
                    await bot.sleep(600);
                }
                if (bot.hasRed("V_DefJzDuoCanGet")) {
                    bot.log("🛡️ Bí Cảnh: Nhận thưởng vượt tầng [Đội]!");
                    djm.requestDefJzGetReward(2);
                    did = true;
                    await bot.sleep(600);
                }
                return did;
            } catch (e) {
                return false;
            }
        },

        autoSetupDefJzFormation: function (view) {
            try {
                if (!view || !view.teamArrayHeroItemList || view.teamArrayHeroItemList.length === 0) return false;
                if (!view.arrayHeroCom || !view.curArrayMap || !view.curArrayMap.arrayEffet) return false;

                const limit = view.arrayHeroCom.limitCount || 2;
                const heroList = view.teamArrayHeroItemList.slice();

                const scoredHeroes = heroList.map(it => {
                    const hd = it.heroDataItem;
                    let hp = 0, def = 0, dmg = 0, pwr = 0;
                    if (hd) {
                        try { pwr = hd.getPower ? hd.getPower() : 0; } catch (e) { }
                        try { hp = hd.getAttrValue ? hd.getAttrValue(1) : 0; } catch (e) { }
                        try { dmg = hd.getAttrValue ? hd.getAttrValue(2) : 0; } catch (e) { }
                        try { def = hd.getAttrValue ? hd.getAttrValue(3) : 0; } catch (e) { }
                    }
                    return {
                        item: it,
                        power: pwr,
                        hp: hp,
                        def: def,
                        dmg: dmg,
                        tankScore: (hp * 0.1) + (def * 5.0),
                        dameScore: dmg
                    };
                });

                scoredHeroes.sort((a, b) => b.power - a.power);
                const selected = scoredHeroes.slice(0, Math.min(limit, scoredHeroes.length));

                if (selected.length === 0) return false;

                let finalSorted = [];
                if (selected.length === 1) {
                    finalSorted = selected.map(s => s.item);
                } else if (selected.length === 2) {
                    if (selected[0].tankScore >= selected[1].tankScore) {
                        finalSorted = [selected[0].item, selected[1].item];
                    } else {
                        finalSorted = [selected[1].item, selected[0].item];
                    }
                } else {
                    selected.sort((a, b) => b.tankScore - a.tankScore);
                    const tanks = selected.slice(0, Math.min(2, selected.length));
                    const remaining = selected.slice(Math.min(2, selected.length));
                    remaining.sort((a, b) => b.dameScore - a.dameScore);
                    finalSorted = tanks.concat(remaining).map(s => s.item);
                }

                view.arrayHeroCom.setFormMask(view.curArrayMap.arrayEffet._arr_type, finalSorted);
                if (typeof view.updateCardList === "function") {
                    view.updateCardList();
                }
                if (typeof view.saveArrayInfoAndCloseSelf === "function") {
                    view.saveArrayInfoAndCloseSelf();
                }

                bot.log(`🛡️ Bí Cảnh Tần Lĩnh: Tự động xếp đội hình tối ưu [${finalSorted.length} tướng] (Tank hàng trước, Dame hàng sau)!`);
                return true;
            } catch (e) {
                console.error("[AutoBot] Lỗi autoSetupDefJzFormation:", e);
                return false;
            }
        },

        runAutoDefJzSmart: async function () {
            try {
                if (!bot.settings.auto_defjz) {
                    bot.state.defjzInProgress = false;
                    return false;
                }
                if (Date.now() < (bot.state.suppressDefJzUntil || 0)) {
                    bot.state.defjzInProgress = false;
                    return false;
                }
                const mm = window.ModelManager;
                if (!mm || !mm.DefJzModel) {
                    bot.state.defjzInProgress = false;
                    return false;
                }
                const djm = mm.DefJzModel;
                const gm = window.G_Mapping;
                const vm = bot.getViewManager();

                // TUYỆT ĐỐI KHÔNG mở popup khi đang ở màn hình chính (MainUI) trừ khi người chơi chủ động vào DefJzMainView
                if (vm && typeof vm.isOpenView === "function") {
                    const isMainOpen = vm.isOpenView("MainUI_2025View") || vm.isOpenView("MainUIView");
                    const isDefJzOpen = vm.isOpenView("DefJzMainView") || vm.isOpenView("DefJzSkillSelectView") || vm.isOpenView("BatteJingzhouView");
                    if (isMainOpen && !isDefJzOpen) {
                        bot.state.defjzInProgress = false;
                        return false;
                    }
                }

                // Nếu đang trong trận đấu Bí Cảnh Tần Lĩnh, chờ trận đấu kết thúc hoặc được watchdog bỏ qua
                const fm = bot.getFightManager();
                const isDefJzFighting = (fm && typeof fm.haveFight === "function" && fm.haveFight(9)) ||
                    (vm && typeof vm.isOpenView === "function" && vm.isOpenView("BatteJingzhouView"));
                if (isDefJzFighting) {
                    bot.state.defjzInProgress = true;
                    bot.state.lastDefJzActionTime = Date.now();
                    return true;
                }

                // Nếu bảng chọn Buff hoặc bảng Kết Quả đang hiển thị, ưu tiên xử lý xong trước
                if (vm && typeof vm.isOpenView === "function") {
                    if (vm.isOpenView("DefJzSkillSelectView")) {
                        const curV = vm.getView ? vm.getView("DefJzSkillSelectView") : null;
                        if (curV && bot.isViewVisible(curV)) {
                            if (bot.canDo("defjz_auto_select_view", 2)) {
                                bot.markDone("defjz_auto_select_view");
                                bot.autoSelectBestDefJzSkill(curV);
                            }
                        }
                        bot.state.defjzInProgress = false;
                        return true;
                    }
                    if (vm.isOpenView("BattleResultView") && (vm.isOpenView("DefJzMainView") || vm.isOpenView("BatteJingzhouView"))) {
                        bot.state.defjzInProgress = true;
                        bot.state.lastDefJzActionTime = Date.now();
                        return true;
                    }
                }

                // 1. Nhận quà ngày nếu có (chỉ gửi 1 lần mỗi giờ)
                try {
                    if (bot.tryDo("defjz_daily_gift", 3600)) {
                        const rpc = (gm && gm.RPCReq) || window.RPCReq;
                        if (rpc && gm.DefJzDailyGiftCs) {
                            rpc.send(gm.DefJzDailyGiftCs.protocol, { _type: 1 });
                            rpc.send(gm.DefJzDailyGiftCs.protocol, { _type: 2 });
                        }
                    }
                } catch (e) { }

                // 2. Nhận quà mốc tầng
                await bot.runAutoDefJzRewards();

                // 3. Quét chế độ Đơn (1) và Đội (2)
                for (const mode of [1, 2]) {
                    const info = djm.getDefJzInfo ? djm.getDefJzInfo(mode) : (djm.defJzInfo && djm.defJzInfo[mode]);
                    if (!info) continue;

                    if (info._pass_floor != null && info._max_floor != null && info._pass_floor >= info._max_floor) {
                        continue;
                    }

                    let layerCfg = null;
                    if (gm && gm.DefJzConfiger && gm.DefJzConfiger.getDefenseJzFightCfgId) {
                        layerCfg = gm.DefJzConfiger.getDefenseJzFightCfgId(info._id);
                    }

                    if (layerCfg) {
                        const curNth = (info._nth || 1) - 1;
                        const dungeonId = (layerCfg.group && layerCfg.group[Math.max(0, curNth)]) || layerCfg.dungeon;
                        const param = {
                            arrayType: 9, // DefJz
                            subType: mode,
                            copyId: layerCfg.id,
                            dungeon_id: dungeonId,
                            hero_limit: layerCfg.hero_limit || 0
                        };

                        const modeName = mode === 1 ? "Đơn" : "Đội";
                        const nthStr = `${info._nth || 1}/${layerCfg.group ? layerCfg.group.length : 12}`;

                        if (djm.needSelectBuff && djm.needSelectBuff(param.subType, param.copyId)) {
                            if (!bot.canDo("defjz_select_buff_action", 10)) {
                                bot.state.defjzInProgress = false;
                                return false;
                            }
                            bot.markDone("defjz_select_buff_action");

                            // Ưu tiên chọn ngầm qua Model nếu có thể để không bật popup làm phiền người chơi
                            const preGroup = info._pre_skills && info._pre_skills[0];
                            if (preGroup && preGroup._pre_skills && typeof djm.autoSelectPreSkill === "function") {
                                bot.log(`🛡️ Bí Cảnh [${modeName}]: Tự động gửi chọn Buff ngầm...`);
                                djm.autoSelectPreSkill(param.subType, preGroup._pre_skills, true);
                                await bot.sleep(800);
                                bot.state.defjzInProgress = false;
                                return true;
                            }
                            bot.log(`🛡️ Bí Cảnh [${modeName}]: Mở giao diện chọn Buff...`);
                            djm.doSelectBuff(param.subType, param.copyId);
                            await bot.sleep(800);
                            bot.state.defjzInProgress = false;
                            return true;
                        }

                        if (djm.canChangeArray && djm.canChangeArray(param.subType)) {
                            bot.state.defjzInProgress = true;
                            bot.state.lastDefJzActionTime = Date.now();
                            bot.log(`🛡️ Bí Cảnh Tần Lĩnh [${modeName}]: Khiêu chiến Tầng [${layerCfg.floor || info._id}] (Đợt ${nthStr}) -> Tự động xếp trận Tank/Dame...`);
                            const disp = (gm && gm.Dispatcher) || window.Dispatcher;
                            const evType = (gm && gm.EventType) || window.EventType;
                            if (disp && evType && evType.battle_requestFunc) {
                                disp.dispatchEvent(evType.battle_requestFunc, function (e) {
                                    if (e === "begin") console.log("[DefJz] Bắt đầu trận", e);
                                }, param);
                                await bot.sleep(1000);
                                return true;
                            }
                        } else {
                            bot.state.defjzInProgress = true;
                            bot.state.lastDefJzActionTime = Date.now();
                            bot.log(`🛡️ Bí Cảnh Tần Lĩnh [${modeName}]: Đánh tiếp Đợt [${nthStr}]...`);
                            const fm = window.FightManager || (gm && gm.FightManager);
                            if (fm && typeof fm.requestBatte === "function") {
                                fm.requestBatte(param.arrayType, param.copyId);
                                await bot.sleep(1200);
                                return true;
                            }
                        }
                    }
                }
                bot.state.defjzInProgress = false;
            } catch (err) {
                bot.state.defjzInProgress = false;
                console.error("[AutoBot] Lỗi runAutoDefJzSmart:", err);
            }
            return false;
        },

        // ====================================================================
        // TÍNH NĂNG 1: VƯỢT ẢI CHÍNH TUYẾN (Chạy ngầm 100%, liên tục không dừng)
        // ====================================================================
        runAutoStageSmart: async function () {
            if (typeof G_Mapping === "undefined" || !G_Mapping.RPCReq) return false;
            if (!bot.isAutoStageOn()) return false;
            if (!bot.isReady()) return false;

            // Chống xung đột khi có trận chiến leo tháp hoặc Bí Cảnh Tần Lĩnh đang diễn ra
            if (bot.state.towerInProgress || bot.state.defjzInProgress) return false;

            // Chặn tuyệt đối khi có trận chiến (BattleBeginView), popup Bí Cảnh, bảng kết quả, hoặc popup chuẩn bị trận đang hiển thị
            const vm = bot.getViewManager();
            if (vm && typeof vm.isOpenView === "function") {
                if (vm.isOpenView("BattleBeginView") || vm.isOpenView("DefJzSkillSelectView") || vm.isOpenView("BattleResultView") || vm.isOpenView("TeamArrayView") || vm.isOpenView("BattlePrepareView")) {
                    return false;
                }
            }

            // DEFEAT GUARD CHO VƯỢT ẢI: Tự động thử lại đến 10 lần (RNG bạo kích/choáng), sau đó tạm nghỉ 60s
            bot.updateStats();
            const curPower = bot.stats.power || 0;
            const now = Date.now();

            if ((bot.state.stageFailCount || 0) >= 10) {
                const powerIncreased = curPower > (bot.state.lastStageFailPower || 0);
                if (powerIncreased || (now - (bot.state.lastStageFailTime || 0) > 60000)) {
                    bot.state.stageFailCount = 0;
                    if (powerIncreased) {
                        const oldP = (bot.state.lastStageFailPower || 0).toLocaleString();
                        const newP = curPower.toLocaleString();
                        bot.log(`⚔️ Vượt Ải: Lực chiến đã tăng (${oldP} ➜ ${newP}) -> Thử sức lại Ải [${bot.state.lastStageFailStage || bot.stats.stage}]!`);
                    } else {
                        bot.log(`⚔️ Vượt Ải: Hết thời gian tạm nghỉ (60s) -> Tiếp tục chu kỳ khiêu chiến Ải [${bot.state.lastStageFailStage || bot.stats.stage}]!`);
                    }
                } else {
                    return false; // Đang trong thời gian Defeat Guard
                }
            }

            if (!bot.canDo("auto_stage_cycle", 0.5)) return false;
            bot.markDone("auto_stage_cycle");

            // Đảm bảo game engine và các module luôn được hook đầy đủ
            bot.hookGameEngine();

            const mm = window.ModelManager || bot.getModelManager() || (window.G_Mapping && window.G_Mapping.ModelManager);
            let copyProg = null;
            if (mm && mm.MainUIModel) {
                copyProg = mm.MainUIModel.getMainCopyProgress ? mm.MainUIModel.getMainCopyProgress() : (mm.MainUIModel.mainCopyProgress || mm.MainUIModel.ainCopyProgress);
            }

            const curStage = copyProg ? copyProg._id : (bot.stats.stage || 1);
            const curNth = copyProg ? (copyProg._nth || 1) : 1;

            try {
                bot.closeBattleViews();


                const mainUI = vm && (vm.getView("MainUI_2025View") || vm.getView("MainUIView"));
                let bView = null;
                if (mainUI && mainUI.ctlView) {
                    bView = mainUI.ctlView["BattleMainCopyView"] || (mainUI.loadBatteViewName && mainUI.ctlView[mainUI.loadBatteViewName]);
                    if (bView) {
                        try {
                            bView.isTestMove = false;
                        } catch (e) { }
                    }
                }

                // 2. Watchdog: Can thiệp mở khóa khi game rơi vào trạng thái khóa Boss (onPlayLock = 6)
                const bfm = (G_Mapping && (G_Mapping.BattleFastManager || G_Mapping.BatteFastManager)) || window.BattleFastManager || window.BatteFastManager;
                const bStatus = bfm ? bfm.batteStatus : 0;

                // TUYỆT ĐỐI KHÔNG can thiệp nếu đang đánh (2), đang chờ đóng trận (3), hoặc đang gửi request (4)
                if (bStatus !== 2 && bStatus !== 3 && bStatus !== 4) {
                    const bossCtrl = mainUI && mainUI.homeBossBar && mainUI.homeBossBar.getController && mainUI.homeBossBar.getController("nextLevel");
                    const isBossCtrlLocked = bossCtrl && bossCtrl.selectedIndex === 1;
                    const isLocked = (bStatus === 6) || isBossCtrlLocked;

                    if (isLocked && (bot.state.stageFailCount || 0) < 10) {
                        if (bot.canDo("boss_unlock_dog", 4.0) && (!bot.state.lastBattleEndTime || now >= bot.state.lastBattleEndTime)) {
                            bot.markDone("boss_unlock_dog");
                            const attempt = (bot.state.stageFailCount || 0) + 1;
                            bot.log(`⚔️ Vượt Ải [${curStage}]: Tự động mở khóa khiêu chiến Boss (Lần ${attempt}/10)...`);
                            const disp = window.Dispatcher || (G_Mapping && G_Mapping.Dispatcher);
                            if (bView && typeof bView.btn_enterBattle === "function") {
                                try { bView.btn_enterBattle(); } catch (e) { }
                            } else if (disp && typeof disp.dispatchEvent === "function") {
                                try { disp.dispatchEvent("btn_enterBattle"); } catch (e) { }
                            } else if (mainUI && mainUI.homeBossBar) {
                                const nextBtn = mainUI.homeBossBar.getChild ? mainUI.homeBossBar.getChild("nextLevel") : null;
                                if (nextBtn) {
                                    try {
                                        if (typeof nextBtn.onClick === "function") nextBtn.onClick();
                                        else if (nextBtn.callClickListener) nextBtn.callClickListener();
                                        else if (nextBtn.click) nextBtn.click();
                                    } catch (e) { }
                                }
                            }
                        }
                    }
                }

                bot.closeBattleViews();
                bot.updateStats();

                let newProg = null;
                if (mm && mm.MainUIModel) {
                    newProg = mm.MainUIModel.getMainCopyProgress ? mm.MainUIModel.getMainCopyProgress() : (mm.MainUIModel.mainCopyProgress || mm.MainUIModel.ainCopyProgress);
                }
                const newStage = newProg ? newProg._id : bot.stats.stage;
                const newNth = newProg ? (newProg._nth || 1) : 1;

                if (bot.state.lastLoggedStage === undefined || bot.state.lastLoggedStage === null) {
                    bot.state.lastLoggedStage = newStage;
                    bot.state.lastLoggedNth = newNth;
                    return false;
                }

                if (newStage > bot.state.lastLoggedStage) {
                    bot.log(`🎉 Chiến thắng! Đã vượt lên Ải [${newStage}]!`);
                    bot.state.lastLoggedStage = newStage;
                    bot.state.lastLoggedNth = newNth;
                    bot.state.stageFailCount = 0;
                    return true;
                } else if (newStage === bot.state.lastLoggedStage && newNth > (bot.state.lastLoggedNth || 0)) {
                    bot.log(`⚔️ Vượt Ải: Vượt qua đợt [${bot.state.lastLoggedNth || curNth}] -> Tiến vào đợt [${newNth}] Ải [${newStage}]!`);
                    bot.state.lastLoggedStage = newStage;
                    bot.state.lastLoggedNth = newNth;
                    return true;
                }
                return false;
            } catch (e) {
                bot.log("Lỗi vượt ải: " + e.toString());
                return false;
            }
        },

        // ====================================================================
        // TÍNH NĂNG 2: AUTO LEO THÁP THÔNG THIÊN (Chỉ đánh khi có lượt, dừng khi kẹt/thua, thử lại khi tăng LC hoặc hồi đủ 10 lượt)
        // ====================================================================
        runAutoTowerSmart: async function () {
            if (typeof G_Mapping === "undefined" || !G_Mapping.RPCReq) return false;
            if (!bot.state.isAutoTowerActive) return false;
            if (!bot.isReady()) return false;

            // Chống "Thao tác quá nhanh": Bỏ qua nếu có trận chiến khác hoặc Bí Cảnh đang diễn ra
            if (bot.isBattling() || bot.state.defjzInProgress) return false;
            const vm = bot.getViewManager();
            if (vm && typeof vm.isOpenView === "function") {
                if (vm.isOpenView("DefJzSkillSelectView") || vm.isOpenView("BattleResultView")) {
                    return false;
                }
            }

            const mm = window.ModelManager;
            if (!mm || !mm.ClimbTowerModel) return false;
            const tm = mm.ClimbTowerModel;

            // 1. Kiểm tra đã đạt tầng tối đa chưa
            if (tm.isMaxFloor && tm.isMaxFloor(1)) return false;

            // 2. Nhận thưởng mốc ngày & thưởng nhóm tầng nếu có
            if (tm.getDailyRewardState && tm.getDailyRewardState(1) && bot.canDo("tower_daily_rew", 60)) {
                bot.markDone("tower_daily_rew");
                bot.log("🏰 Leo Tháp: Nhận thưởng ngày Tháp Thông Thiên!");
                if (tm.reqTowerDailyReward) tm.reqTowerDailyReward(1);
            }
            if (tm.getCanGetGroupReward && tm.getCanGetGroupReward(1) && bot.canDo("tower_group_rew", 60)) {
                bot.markDone("tower_group_rew");
                const grp = tm.getCurFloorGroup ? tm.getCurFloorGroup(1) : 1;
                bot.log(`🏰 Leo Tháp: Nhận thưởng mốc nhóm tầng [${grp}]!`);
                if (tm.reqTowerGetReward) tm.reqTowerGetReward(grp);
            }

            // 3. THÔNG MINH: Kiểm tra số lượt / thể lực leo tháp (TidTowerPower = 10 hoặc _revert)
            const pm = mm.PlayerModel;
            const towerPower = (pm && pm.getMoneyNum) ? pm.getMoneyNum(10) : (tm.getRevert ? tm.getRevert(1) : 0);
            if (towerPower < 1) {
                // Không có lượt -> Dừng ngay, không gửi request dư thừa
                return false;
            }

            // 4. THÔNG MINH: Cơ chế Defeat Guard / Chống kẹt tầng
            // Thua 1 lần -> Chỉ thử lại khi LỰC CHIẾN TĂNG RÕ RỆT (>=0.5%), tầng đã thay đổi,
            // hoặc ĐÃ HỒI ĐẦY 10 LƯỢT và đã qua ít nhất 30 phút kể từ lần thua trước.
            bot.updateStats();
            const curPower = bot.stats.power || 0;
            const failCount = bot.state.towerFailCount || 0;

            if (failCount >= 1) {
                const lastPow = bot.state.lastTowerFailPower || 0;
                const floorNow = tm.getCurFloor ? tm.getCurFloor(1) : 0;
                const floorChanged = bot.state.lastTowerFailFloor && floorNow && floorNow !== bot.state.lastTowerFailFloor;
                const powerIncreased = lastPow > 0 && curPower >= lastPow * 1.005;
                const fullAttempts = towerPower >= 10 && (Date.now() - (bot.state.lastTowerFailTime || 0)) >= 30 * 60000;

                if (powerIncreased || fullAttempts || floorChanged) {
                    bot.state.towerFailCount = 0;
                    if (powerIncreased) {
                        bot.log(`🏰 Leo Tháp: Lực chiến đã tăng (${lastPow.toLocaleString()} ➜ ${curPower.toLocaleString()}) -> Thử sức lại tầng tháp!`);
                    } else if (floorChanged) {
                        bot.log(`🏰 Leo Tháp: Tầng tháp đã thay đổi -> Tiếp tục leo!`);
                    } else {
                        bot.log(`🏰 Leo Tháp: Lượt leo tháp đã tích lũy đầy (${towerPower}/10) -> Thử sức lại tầng tháp!`);
                    }
                } else {
                    return false;
                }
            }

            if (!bot.canDo("auto_tower_cycle", 8)) return false;
            bot.markDone("auto_tower_cycle");

            try {
                const nowTs = Date.now();
                bot.state.battleInProgress = true;
                bot.state.towerInProgress = true;
                bot.state.lastBattleStartTime = nowTs;
                bot.state.lastTowerActionTime = nowTs;

                const curFloor = tm.getCurFloor ? tm.getCurFloor(1) : (bot.stats.towerFloor || 1);
                if (!vm || !vm.isOpenView("ClimbtowerView")) bot.closeBattleViews();


                bot.log(`🏰 Leo Tháp: Còn ${towerPower} lượt -> Đang khiêu chiến Tháp Thông Thiên tầng [${curFloor}] (Chạy ngầm)...`);

                const tc = (G_Mapping && G_Mapping.TowerConfiger) || window.TowerConfiger;
                const fm = (G_Mapping && G_Mapping.FubenManager) || window.FubenManager;
                const cfg = tc && tc.getTowerCfgByTypeFloor ? tc.getTowerCfgByTypeFloor(1, curFloor) : null;
                if (cfg && fm && fm.I) {
                    fm.I.enter(2, cfg.id, cfg.dungeon, true, null, true, null, bot.settings.skip_battle !== false);
                } else {
                    const battlePayload = { _type: 2, _id: curFloor, _cli: 1, _ext: [] };
                    G_Mapping.RPCReq.send(G_Mapping.WarStartCs.protocol, battlePayload);
                    await bot.sleep(400);
                    G_Mapping.RPCReq.send(G_Mapping.WarJumpCs.protocol, battlePayload);
                }
                if (!vm || !vm.isOpenView("ClimbtowerView")) bot.closeBattleViews();

                await bot.sleep(1500);
                if (!vm || !vm.isOpenView("ClimbtowerView")) bot.closeBattleViews();
                let newFloor = tm.getCurFloor ? tm.getCurFloor(1) : bot.stats.towerFloor;
                for (let w = 0; w < 6 && !(newFloor > curFloor); w++) {
                    await bot.sleep(500);
                    newFloor = tm.getCurFloor ? tm.getCurFloor(1) : bot.stats.towerFloor;
                }
                if (!vm || !vm.isOpenView("ClimbtowerView")) bot.closeBattleViews();
                bot.updateStats();

                if (newFloor > curFloor) {
                    bot.log(`🎉 Chiến thắng! Vượt thành công Tháp tầng [${curFloor}] ➜ Lên tầng [${newFloor}]!`);
                    bot.state.towerFailCount = 0;
                    return true;
                } else {
                    // Ghi nhận thất bại & mốc lực chiến hiện tại
                    bot.state.towerFailCount = (bot.state.towerFailCount || 0) + 1;
                    bot.state.lastTowerFailTime = Date.now();
                    bot.state.lastTowerFailPower = curPower;
                    bot.state.lastTowerFailFloor = curFloor;
                    const remPow = (pm && pm.getMoneyNum) ? pm.getMoneyNum(10) : (tm.getRevert ? tm.getRevert(1) : 0);
                    bot.log(`🛑 [Defeat Guard] Lực chiến chưa đủ vượt Tháp tầng [${curFloor}] (Thất bại lần ${bot.state.towerFailCount}). Tạm dừng leo tháp cho tới khi LC tăng hoặc hồi đủ 10 lượt (Hiện tại: ${remPow}/10)!`);
                    return false;
                }
            } catch (e) {
                bot.log("Lỗi leo tháp: " + e.toString());
                return false;
            } finally {
                bot.state.battleInProgress = false;
                bot.state.towerInProgress = false;
                bot.state.lastBattleEndTime = Date.now();
            }
        },

        // ====================================================================
        // TÍNH NĂNG 3: AUTO NÂNG TƯỚNG ĐỘI HÌNH (Chỉ nâng khi đủ điều kiện & giữ tiền dự trữ)
        // ====================================================================
        runAutoHeroUpSmart: async function () {
            const mm = window.ModelManager;
            if (!mm || !mm.HeroBagModel || !mm.PlayerModel) return false;

            // CONDITION-DRIVEN: Chỉ chạy khi có chấm đỏ thăng cấp / đột phá
            if (!bot.hasRed("V_HeroLvOrStepUp")) return false;

            // Chống "Thao tác quá nhanh": Bỏ qua nếu có trận chiến đang diễn ra hoặc đang bị khóa nâng cấp
            if (bot.isBattling()) return false;
            if (mm.HeroBagModel.haveHeroLvStepLock && mm.HeroBagModel.haveHeroLvStepLock()) return false;

            if (!bot.canDo("hero_up_cycle", 20)) return false;
            bot.markDone("hero_up_cycle");

            try {
                // 1. Kiểm tra tiền vàng dự trữ
                const curGold = mm.PlayerModel.getMoneyNum ? mm.PlayerModel.getMoneyNum(1) : 0;
                const reserve = bot.settings.reserve_gold || 500000;
                if (curGold < reserve) {
                    return false;
                }

                // 2. Quét các tướng trong đội hình chính
                const hbm = mm.HeroBagModel;
                const arrayInfo = hbm.getSortHeroInfoByArrayNew ? hbm.getSortHeroInfoByArrayNew() : null;
                const heroes = arrayInfo ? arrayInfo.ArrayHero : [];
                if (!heroes || heroes.length === 0) return false;

                for (let i = 0; i < heroes.length; i++) {
                    const h = heroes[i];
                    if (!h) continue;

                    // A. Đột phá / Thăng giai
                    if (h.isNeedUpStep && h.isNeedUpStep()) {
                        const upCheck = h.getMaxCanUpgrade ? h.getMaxCanUpgrade() : [0];
                        const limitTip = h.getStepLimitTip ? h.getStepLimitTip() : "";
                        if (upCheck[0] > 0 && limitTip.length <= 0) {
                            bot.log(`🎖️ Tướng: Đột phá thăng giai cho tướng [${h.name || h.id}]`);
                            h.stepUp();
                            await bot.sleep(800);
                            return true;
                        }
                    }

                    // B. Thăng cấp
                    if (h.isHeroMaxLv && !h.isHeroMaxLv()) {
                        const canUp = h.getMaxCanUpgrade ? h.getMaxCanUpgrade() : [0];
                        if (canUp[0] > 0) {
                            const curLv = h.getCurLv ? h.getCurLv() : (h.lv || 1);
                            const targetLv = curLv + Math.min(canUp[0], 5);
                            bot.log(`🎖️ Tướng: Thăng cấp [${h.name || h.id}] lên Lv.${targetLv}`);
                            if (typeof h.levelUP === "function") {
                                h.levelUP(targetLv);
                            } else if (typeof G_Mapping !== "undefined" && G_Mapping.HeroLvUpCs) {
                                G_Mapping.RPCReq.send(G_Mapping.HeroLvUpCs.protocol, { _id: h.id, _lv: targetLv });
                            }
                            await bot.sleep(800);
                            return true;
                        }
                    }
                }
            } catch (e) {
                bot.log("Lỗi nâng tướng: " + e.toString());
            }
            return false;
        },

        // ====================================================================
        // TÍNH NĂNG 4: NÂNG SAO TƯỚNG HÀNG LOẠT (CHỈ khi có tướng đủ mảnh)
        // ====================================================================
        runAutoStarUpSmart: async function () {
            if (typeof G_Mapping === "undefined" || !G_Mapping.RPCReq || !G_Mapping.HeroStarUpBatchCs) return false;
            const gm = G_Mapping;
            const mm = window.ModelManager;

            if (bot.isBattling()) return false;

            const canStar = bot.hasRed("V_HeroStarUp") || bot.hasRed("V_HeroOneKeyStarHavCost");
            if (!canStar || !bot.canDo("star_up_batch", 20)) return false;

            try {
                const hbm = mm && mm.HeroBagModel;
                let heroesToUp = [];
                if (hbm && hbm.getAllSortHeroInfo) {
                    const allHeroes = hbm.getAllSortHeroInfo();
                    if (allHeroes) {
                        for (let h of allHeroes) {
                            try {
                                if (h.canStarUp && h.canStarUp() && !h.isTJHero()) {
                                    heroesToUp.push({ _id: (h.getId ? h.getId() : h.id), _times: 1 });
                                }
                            } catch (err) { }
                        }
                    }
                }

                // CHỈ gửi lệnh khi thật sự có tướng đủ mảnh
                if (heroesToUp.length > 0) {
                    bot.markDone("star_up_batch");
                    bot.log(`⭐ Tướng: Có ${heroesToUp.length} tướng đủ mảnh nâng sao -> Ghép sao hàng loạt!`);
                    gm.RPCReq.send(gm.HeroStarUpBatchCs.protocol, { _list: heroesToUp });
                    bot.state.stageFailCount = 0;
                    return true;
                }
            } catch (e) {
                bot.log("Lỗi nâng sao tướng: " + e.toString());
            }
            return false;
        },

        // ====================================================================
        // TÍNH NĂNG 5: ĐỒ GIÁM (Kích hoạt tuần tự an toàn, có delay 300ms chống nghẽn)
        // ====================================================================
        runAutoManualSmart: async function () {
            if (typeof G_Mapping === "undefined" || !G_Mapping.RPCReq) return false;
            const gm = G_Mapping;
            const mm = window.ModelManager;

            // CONDITION-DRIVEN: Chỉ chạy khi có bất kỳ chấm đỏ Đồ Giám nào
            const hmm = mm && mm.HeroManualModel;
            const hasHero = bot.hasRed("V_HeroManualCanGet") || (hmm && hmm.heroManualCanGetMap && hmm.heroManualCanGetMap.size > 0);
            const hasArtifact = bot.hasRed("V_HeroManualGodWeaponCanGet") || (hmm && hmm.godWeaponManualCanGetMap && hmm.godWeaponManualCanGetMap.size > 0);
            const hasTalent = bot.hasRed("V_HeroManualTalentCanGet") || (hmm && hmm.talentManualCanGetMap && hmm.talentManualCanGetMap.size > 0);
            const hasLvUp = bot.hasRed("V_HeroManualLvUp");
            const hasPet = bot.hasRed("V_PetBookCanUnLockOrCanStarUp");
            const hasRide = bot.hasRed("M_Rides");

            if (!hasHero && !hasArtifact && !hasTalent && !hasLvUp && !hasPet && !hasRide) {
                return false;
            }

            let didSomething = false;

            if (!bot.canDo("auto_manual_check", 15)) return false;
            bot.markDone("auto_manual_check");

            try {
                if (mm && mm.HeroManualModel) {
                    const hmm = mm.HeroManualModel;

                    // A. Đồ Giám Tướng
                    if (hmm.heroManualCanGetMap && hmm.heroManualCanGetMap.size > 0) {
                        let count = 0;
                        for (let [baseId, val] of hmm.heroManualCanGetMap) {
                            if (count >= 3) break; // Giới hạn 3 tướng/lượt tránh nghẽn
                            const bId = Number(baseId);
                            if (!bId || isNaN(bId)) continue;
                            gm.RPCReq.send(gm.HeroManualPickHeroCs.protocol, { _id: bId, _is_all: 1 });
                            count++;
                            didSomething = true;
                            await bot.sleep(600);
                        }
                        if (count > 0) bot.log(`📜 Đồ Giám: Đã kích hoạt ${count} Danh Tướng mới!`);
                    }

                    // B. Đồ Giám Thần Khí
                    if (hmm.godWeaponManualCanGetMap && hmm.godWeaponManualCanGetMap.size > 0 && gm.HeroManualPickArtifactCs) {
                        let count = 0;
                        for (let [baseId, val] of hmm.godWeaponManualCanGetMap) {
                            if (count >= 3) break;
                            const bId = Number(baseId);
                            if (!bId || isNaN(bId)) continue;
                            gm.RPCReq.send(gm.HeroManualPickArtifactCs.protocol, { _id: bId, _is_all: 1 });
                            count++;
                            didSomething = true;
                            await bot.sleep(600);
                        }
                        if (count > 0) bot.log(`📜 Đồ Giám: Đã kích hoạt ${count} Thần Khí!`);
                    }

                    // C. Đồ Giám Cẩm Nang
                    if (hmm.talentManualCanGetMap && hmm.talentManualCanGetMap.size > 0 && gm.HeroManualPickTalentCs) {
                        let count = 0;
                        for (let [baseId, val] of hmm.talentManualCanGetMap) {
                            if (count >= 3) break;
                            const bId = Number(baseId);
                            if (!bId || isNaN(bId)) continue;
                            gm.RPCReq.send(gm.HeroManualPickTalentCs.protocol, { _id: bId, _is_all: 1 });
                            count++;
                            didSomething = true;
                            await bot.sleep(600);
                        }
                        if (count > 0) bot.log(`📜 Đồ Giám: Đã kích hoạt ${count} Cẩm Nang / Thiên Phú!`);
                    }

                    // D. Tăng cấp Đồ Giám tổng
                    if (bot.hasRed("V_HeroManualLvUp")) {
                        bot.log("📜 Đồ Giám: Đủ điểm tăng cấp Đồ Giám tổng -> Tăng cấp!");
                        gm.RPCReq.send(gm.HeroManualUpCs.protocol, {});
                        didSomething = true;
                        await bot.sleep(600);
                    }
                }

                // E. Đồ Giám Thần Thú
                if (mm && mm.PetModel && gm.HeroPetManualUpCs) {
                    const pm = mm.PetModel;
                    if (pm.heroPetManual && pm.heroPetManual[1]) {
                        for (let petKey in pm.heroPetManual[1]) {
                            const petInfo = pm.heroPetManual[1][petKey];
                            if (petInfo && petInfo.isShow && petInfo.isShow() && (petInfo.canUnLock() || petInfo.canStarUp())) {
                                let targetId = petInfo.petManualInfo ? petInfo.petManualInfo.id : petInfo.id;
                                if (petInfo.canStarUp() && gm.PetConfiger) {
                                    const nextCfg = gm.PetConfiger.getPetManualInfoByGroupAndStar(petInfo.group, petInfo.star + 1);
                                    if (nextCfg) targetId = nextCfg.id;
                                }
                                if (targetId) {
                                    gm.RPCReq.send(gm.HeroPetManualUpCs.protocol, { _id: targetId });
                                    bot.log(`🐾 Thần Thú: Kích hoạt / Tăng sao Đồ Giám ID [${targetId}]`);
                                    didSomething = true;
                                    await bot.sleep(600);
                                    break;
                                }
                            }
                        }
                    }
                }

                // F. Đồ Giám Tọa Kỵ
                if (mm && mm.RidesModel && gm.RidesManualCs) {
                    const rm = mm.RidesModel;
                    const ridesRaw = rm.getAllRidesData ? rm.getAllRidesData() : null;
                    const ridesList = Array.isArray(ridesRaw) ? ridesRaw : (ridesRaw && typeof ridesRaw.values === "function" ? Array.from(ridesRaw.values()) : []);
                    for (let rIdx = 0; rIdx < ridesList.length; rIdx++) {
                        const rideItem = ridesList[rIdx];
                        if (rideItem && rideItem.id) {
                            const rData = rm.getRidesManualDataByBaseId ? rm.getRidesManualDataByBaseId(rideItem.id) : null;
                            if (rData && (rData.getShowType() === 1 || (rData.canActive && rData.canActive()))) {
                                gm.RPCReq.send(gm.RidesManualCs.protocol, { _id: rideItem.id });
                                bot.log(`🐎 Tọa Kỵ: Kích hoạt Đồ Giám [${rideItem.name || rideItem.id}]`);
                                didSomething = true;
                                await bot.sleep(600);
                                break;
                            }
                        }
                    }
                }
            } catch (e) {
                bot.log("Lỗi Đồ Giám: " + e.toString());
            }
            return didSomething;
        },

        // ====================================================================
        // ====================================================================
        // TÍNH NĂNG 6: GIA VIÊN NÔNG TRẠI (Thợ rảnh mới xây, ưu tiên ô nhiệm vụ cần, chỉ cướp khi còn lượt và đối thủ còn nông sản)
        // ====================================================================
        runAutoHostSmart: async function () {
            if (typeof G_Mapping === "undefined" || !G_Mapping.RPCReq) return false;
            const gm = G_Mapping;
            const mm = window.ModelManager;
            if (!mm || !mm.HomeLandModel) return false;
            const hl = mm.HomeLandModel;
            const hlClass = (hl && hl.constructor) || (typeof window.__require === "function" && (window.__require("HomeLandModel")?.default || window.__require("HomeLandModel"))) || gm.HomeLandModel || window.HomeLandModel;

            // A. Đếm số lượt cướp tài nguyên & lượt lấy may mắn hôm nay
            let maxLuck = 10, maxRob = 10;
            try {
                const lootCfg = (gm.MaincityConfiger && gm.MaincityConfiger.getLootConfig) ? gm.MaincityConfiger.getLootConfig() : null;
                if (lootCfg && Array.isArray(lootCfg)) {
                    if (lootCfg[0] && Array.isArray(lootCfg[0])) maxLuck = lootCfg[0][0] || 10;
                    if (lootCfg[1] && Array.isArray(lootCfg[1])) maxRob = lootCfg[1][0] || 10;
                }
            } catch (eLoot) {}

            const flowerData = hl.flowerData;
            const usedRob = flowerData ? (flowerData._res_cnt || 0) : 0;
            const usedLuck = flowerData ? (flowerData._luck_cnt || 0) : 0;
            const remainRob = Math.max(0, maxRob - usedRob);
            const remainLuck = Math.max(0, maxLuck - usedLuck);

            // B. CONDITION-DRIVEN: Kiểm tra nhanh có việc trong Gia Viên không
            const hasFlowerCool = bot.state.manorFlowerCooldown && Date.now() < bot.state.manorFlowerCooldown;
            const hasHarvest = !hasFlowerCool && bot.hasRed("V_HomeReward");
            const hasLoot = (remainRob > 0 || remainLuck > 0) && bot.hasRed("V_HomeLoot");
            const bu = (gm && gm.BuildingUtil) || window.BuildingUtil || (typeof window.__require === "function" && (window.__require("BuildingUtil")?.default || window.__require("BuildingUtil")));
            let freeWorkers = 0;
            try {
                if (bu && bu.GetFreeWorker) {
                    freeWorkers = bu.GetFreeWorker();
                } else if (hl && typeof hl.getMainCityLv === "function" && typeof hl.getAllBuildingInfoMap === "function") {
                    const cLv = hl.getMainCityLv() || 1;
                    const maxW = (cLv >= 10) ? 3 : ((cLv >= 5) ? 2 : 1);
                    const bMap = hl.getAllBuildingInfoMap() || {};
                    let bCount = 0;
                    for (let bk in bMap) {
                        if (bMap[bk] && bMap[bk]._time && bMap[bk]._time > 0) bCount++;
                    }
                    freeWorkers = Math.max(0, maxW - bCount);
                }
            } catch (eFW) { freeWorkers = 0; }

            let hasAnyOutput = false;
            try {
                const sTime = (mm.ServerTimeModel && mm.ServerTimeModel.getServerTime) ? mm.ServerTimeModel.getServerTime() : Math.floor(Date.now() / 1000);
                const map0 = hl.getAllBuildingInfoMap ? hl.getAllBuildingInfoMap() : null;
                if (map0) {
                    const checkB = (b) => b && (b.hasOutput || (b.collect > 0 && sTime >= b.collect));
                    if (map0 instanceof Map) {
                        for (let [p, b] of map0) { if (checkB(b)) { hasAnyOutput = true; break; } }
                    } else if (map0.forEach) {
                        map0.forEach((b) => { if (checkB(b)) hasAnyOutput = true; });
                    } else {
                        for (let p in map0) { if (checkB(map0[p])) { hasAnyOutput = true; break; } }
                    }
                }
            } catch (eOut) { }

            const hasTask = bot.hasRed("V_HomeTask");
            const canBuild = freeWorkers > 0;
            const canGainHarvest = hasAnyOutput || bot.canDo("host_gain_harvest", 300);

            if (!hasHarvest && !hasLoot && !canBuild && !hasTask && !canGainHarvest && !bot.tryDo("cycle_host_quest", 30)) return false;

            let didSomething = false;
            let didHarvest = false;

            try {
                // 0. TỰ ĐỘNG THU HOẠCH TOÀN BỘ SẢN LƯỢNG (GỖ, VÀNG...) & BINH LÍNH & QUÀ TƯỚNG:
                // Gom toàn bộ tài nguyên (đặc biệt là Gỗ) vào kho trước khi kiểm tra nâng cấp công trình
                try {
                    if (hasAnyOutput || bot.canDo("host_gain_harvest", 300)) {
                        bot.markDone("host_gain_harvest");

                        // 0.1 Thu hoạch sản lượng công trình (Gỗ, Vàng...) qua Chủ Thành (Gói gom một chạm _plot: 0)
                        if (hlClass && typeof hlClass.reqBuildGain === "function") {
                            hlClass.reqBuildGain(0);
                        } else if (hl.reqBuildGain) {
                            hl.reqBuildGain(0);
                        } else if (gm.HostBuildGainCs) {
                            gm.RPCReq.send(gm.HostBuildGainCs.protocol, { _plot: 0 });
                        }
                        await bot.sleep(350);

                        // 0.2 Thu hoạch toàn bộ binh lính đã huấn luyện xong
                        if (hlClass && typeof hlClass.reqHostPickSoldier === "function") {
                            hlClass.reqHostPickSoldier(0);
                        } else if (hl.reqHostPickSoldier) {
                            hl.reqHostPickSoldier(0);
                        } else if (gm.HostPickSoldierCs) {
                            gm.RPCReq.send(gm.HostPickSoldierCs.protocol, { _plot: 0 });
                        }
                        await bot.sleep(350);

                        // 0.3 Thu hoạch quà tướng ghé thăm gia viên
                        if (hlClass && typeof hlClass.reqGetHeroReward === "function") {
                            hlClass.reqGetHeroReward(0, true);
                        } else if (hl.reqGetHeroReward) {
                            hl.reqGetHeroReward(0, true);
                        } else if (gm.HostEventRewardCs) {
                            gm.RPCReq.send(gm.HostEventRewardCs.protocol, { _hero_id: 0 });
                        }
                        await bot.sleep(350);

                        if (hasAnyOutput || bot.canDo("host_harvest_log", 60)) {
                            bot.markDone("host_harvest_log");
                            bot.log("🌾 Gia Viên: Tự động thu hoạch sản lượng công trình (Gỗ, Vàng...) & Binh lính!");
                        }
                        didHarvest = true;
                        didSomething = true;
                        // Chờ ngắn để server phản hồi evt_HostBuildGainSc cộng Gỗ vào PlayerModel
                        await bot.sleep(400);
                        // Cho phép tiếp tục tiến trình để hoàn thành nhiệm vụ Tái Thiết và nâng cấp/xây công trình ngay
                    }
                } catch (eH0) {
                    bot.log("Lỗi Thu Hoạch Gia Viên: " + (eH0.stack || eH0.toString()));
                }

                // 1. QUÉT & HOÀN THÀNH NHIỆM VỤ TÁI THIẾT GIA VIÊN (TaskHost - type 12):
                // Nhiệm vụ Tái Thiết là cốt lõi để thăng cấp Gia Viên và mở rộng công trình mới.
                let currentHostStage = hl.task_g || 1;
                let incompleteTasks = [];

                // Helper gửi yêu cầu nhận thưởng Giai Đoạn Tái Thiết (HostTaskGainCs - Protocol 10520)
                const claimHostGroupReward = () => {
                    try {
                        if (hlClass && typeof hlClass.reqGetHostGroupReward === "function") {
                            hlClass.reqGetHostGroupReward();
                            return true;
                        }
                        if (hl && typeof hl.reqGetHostGroupReward === "function") {
                            hl.reqGetHostGroupReward();
                            return true;
                        }
                        const vmInst = bot.getViewManager();
                        if (vmInst && typeof vmInst.getView === "function") {
                            const cView = vmInst.getView("HomeLandChapterView");
                            if (cView && cView.btnGet && typeof cView.btnGet.onClick === "function") {
                                cView.btnGet.onClick();
                                return true;
                            }
                        }
                        const rpc = gm.RPCReq || (window.G_Mapping && window.G_Mapping.RPCReq);
                        const proto = gm.HostTaskGainCs || (window.G_Mapping && window.G_Mapping.HostTaskGainCs);
                        if (rpc) {
                            rpc.send((proto && proto.protocol) || 10520, {});
                            return true;
                        }
                    } catch (err) { }
                    return false;
                };

                if (mm.TaskModel) {
                    const scanAndClaimTasks = async () => {
                        currentHostStage = hl.task_g || 1;
                        incompleteTasks = [];
                        let taskIds = [];
                        const activeTaskIds = (mm.TaskModel.getTaskListByType ? mm.TaskModel.getTaskListByType(12) : []) || [];
                        const tc = (gm && gm.TaskConfiger) || window.TaskConfiger || (typeof window.__require === "function" && (window.__require("TaskConfiger")?.TaskConfiger || window.__require("TaskConfiger")?.default || window.__require("TaskConfiger")));
                        let stageTaskIds = [];
                        if (tc && tc.getHostTaskByGroup) {
                            try {
                                const stageTasks = tc.getHostTaskByGroup(currentHostStage);
                                if (stageTasks && Array.isArray(stageTasks)) {
                                    stageTaskIds = stageTasks.filter(t => t && t.id != null).map(t => t.id);
                                }
                            } catch (errTC) {}
                        }

                        // Lọc các task thuộc giai đoạn hiện tại và có trong activeTaskIds
                        taskIds = stageTaskIds.filter(id => activeTaskIds.includes(id));
                        if (taskIds.length === 0) taskIds = activeTaskIds.length > 0 ? activeTaskIds : stageTaskIds;

                        if (!taskIds || taskIds.length === 0) return false;

                        // 1.1 Kiểm tra và nhận thưởng TẤT CẢ nhiệm vụ đã đạt điều kiện hoàn thành
                        let anyClaimed = false;
                        for (let tid of taskIds) {
                            if (tid == null) continue;
                            try {
                                const isCompleted = mm.TaskModel.isCompleted ? mm.TaskModel.isCompleted(12, tid) : false;
                                if (isCompleted) continue;

                                const tData = mm.TaskModel.getTaskData ? mm.TaskModel.getTaskData(12, tid) : null;
                                if (tData && Array.isArray(tData)) {
                                    const curVal = tData[0] || 0;
                                    const cfg = tData[1];
                                    const needVal = (cfg && cfg.task && cfg.task[3]) || 1;
                                    const taskName = (cfg && (cfg.name || (mm.TaskModel.getTaskDesc ? mm.TaskModel.getTaskDesc(cfg) : ""))) || ("ID " + tid);

                                    if (curVal >= needVal) {
                                        if (bot.canDo("host_task_claim_" + tid, 3)) {
                                            bot.markDone("host_task_claim_" + tid);
                                            bot.log(`📋 Gia Viên: Hoàn thành nhiệm vụ Tái Thiết [${taskName}] (GĐ ${currentHostStage}) -> Nhận thưởng!`);
                                            if (mm.TaskModel.reqTaskComplete) {
                                                mm.TaskModel.reqTaskComplete(12, tid);
                                            }
                                            anyClaimed = true;
                                            didSomething = true;
                                            await bot.sleep(300);
                                        }
                                    } else {
                                        // Nhiệm vụ chưa đạt điều kiện, cần nâng cấp công trình
                                        const reqBuildId = (cfg && cfg.task && cfg.task[2]) ? cfg.task[2] : 0;
                                        incompleteTasks.push({
                                            tid,
                                            name: taskName,
                                            buildId: reqBuildId,
                                            jumpPlot: cfg ? cfg.jumpParam : null,
                                            needVal,
                                            curVal
                                        });
                                    }
                                }
                            } catch (errTid) {}
                        }

                        if (anyClaimed) {
                            await bot.sleep(600);
                        }

                        // 1.2 Nhận thưởng giai đoạn khi tất cả nhiệm vụ trong nhóm hoàn thành (lên cấp Gia Viên)
                        const allTasksDone = mm.TaskModel.checkAllFinishByIds ? mm.TaskModel.checkAllFinishByIds(12, taskIds) : (incompleteTasks.length === 0);
                        const isGiftAvailable = (hl.task_gift === 0 || !hl.task_gift);
                        if (allTasksDone && isGiftAvailable) {
                            if (bot.canDo("host_group_reward_" + currentHostStage, 5)) {
                                bot.markDone("host_group_reward_" + currentHostStage);
                                bot.log(`🎉 Gia Viên: Đã hoàn thành toàn bộ nhiệm vụ Tái Thiết Giai Đoạn [${currentHostStage}] -> Nhận thưởng giai đoạn & lên cấp Gia Viên!`);
                                claimHostGroupReward();
                                didSomething = true;
                                await bot.sleep(800);
                                return true; // Đã nâng cấp giai đoạn thành công
                            }
                        }
                        return false;
                    };

                    try {
                        const upgraded = await scanAndClaimTasks();
                        if (upgraded) {
                            await bot.sleep(500);
                            // Quét tiếp ngay lập tức các nhiệm vụ của giai đoạn mới vừa mở
                            await scanAndClaimTasks();
                        }
                    } catch (eTask) {
                        bot.log("Lỗi Nhiệm Vụ Gia Viên: " + (eTask.stack || eTask.toString()));
                    }
                }

                // 2. NÂNG CẤP CÔNG TRÌNH THÔNG MINH KHI THỢ RẢNH:
                // Ưu tiên tuyệt đối các công trình theo nhiệm vụ Tái Thiết Giai Đoạn hiện tại!
                // Tiếp tục nâng cấp ngay cả khi vừa nhận thưởng nếu thợ vẫn rảnh
                try {
                    freeWorkers = bu && bu.GetFreeWorker ? bu.GetFreeWorker() : 0;
                } catch (eFW2) { freeWorkers = 0; }

                if (freeWorkers > 0) {
                    try {
                        const map = hl.getAllBuildingInfoMap ? hl.getAllBuildingInfoMap() : null;
                        if (map) {
                            const entries = [];
                            if (map instanceof Map) {
                                for (let [p, b] of map) if (b) entries.push([p, b]);
                            } else if (map.forEach) {
                                map.forEach((b, p) => { if (b) entries.push([p, b]); });
                            } else {
                                for (let p in map) if (map[p]) entries.push([p, map[p]]);
                            }

                            const currentWood = (mm.PlayerModel && mm.PlayerModel.getMoneyNum) ? mm.PlayerModel.getMoneyNum(5) : 0;

                            const getBName = (b) => {
                                try {
                                    if (gm.MaincityConfiger && gm.MaincityConfiger.getBuildingDataById) {
                                        const bCfg = gm.MaincityConfiger.getBuildingDataById(b.id);
                                        if (bCfg && gm.LanguageConfiger && gm.LanguageConfiger.getItemDataLanch) {
                                            return gm.LanguageConfiger.getItemDataLanch(bCfg.name);
                                        }
                                    }
                                } catch (e) {}
                                return `Ô [${b.plot}] (ID ${b.id})`;
                            };

                            const checkCanUpgrade = (b) => {
                                try {
                                    if (!b || typeof b !== "object" || (b.id || 0) <= 0 || b.Upgrading) return false;
                                    // Bảo đảm thuộc tính lv luôn là số hợp lệ
                                    if (typeof b.lv !== "number") {
                                        b.lv = (typeof b._lv === "number") ? b._lv : (b.level || b.rawLv || 1);
                                    }
                                    if (gm.MaincityConfiger && gm.MaincityConfiger.getBuildingDataById) {
                                        const bCfg = gm.MaincityConfiger.getBuildingDataById(b.id);
                                        if (bCfg && bCfg.is_up !== 1) return false;
                                    }
                                    if (bu && bu.CheckBuildLvUpReq) {
                                        try {
                                            if (!bu.CheckBuildLvUpReq(b)) return false;
                                        } catch (eReq) { return false; }
                                    }
                                    let cost = 0;
                                    if (bu && bu.GetUpgradeCost) {
                                        try { cost = bu.GetUpgradeCost(b) || 0; } catch (eCost) { cost = 0; }
                                    }
                                    if (cost > 0 && currentWood < cost) return false;
                                    return true;
                                } catch (eCheck) {
                                    return false;
                                }
                            };

                            let candidateToUpgrade = null;
                            let candidateToBuild = null;
                            let candidateReason = "";

                            // A. Duyệt danh sách các nhiệm vụ Tái Thiết chưa hoàn thành (Ưu tiên số 1)
                            if (incompleteTasks.length > 0) {
                                for (let task of incompleteTasks) {
                                    try {
                                        let targetEntry = null;
                                        if (task.jumpPlot) {
                                            targetEntry = entries.find(([plot, b]) => String(plot) === String(task.jumpPlot) && b && b.id > 0);
                                        }
                                        if (!targetEntry && task.buildId) {
                                            targetEntry = entries.find(([plot, b]) => b && b.id === task.buildId);
                                        }

                                        if (targetEntry) {
                                            const [plot, b] = targetEntry;
                                            if (!b) continue;
                                            const bLv = (typeof b.lv === "number") ? b.lv : (b.level || b.rawLv || 0);

                                            // Nếu công trình này đang được nâng cấp bởi thợ khác -> Đã có thợ làm
                                            if (b.Upgrading) {
                                                continue;
                                            }

                                            if (bLv < task.needVal) {
                                                // Kiểm tra nếu vướng điều kiện công trình tiền đề (ví dụ Chủ Thành cần Lv 6 trước)
                                                let isReqBlocked = false;
                                                if (bu && bu.CheckBuildLvUpReq) {
                                                    try { isReqBlocked = !bu.CheckBuildLvUpReq(b); } catch (eReqB) { isReqBlocked = false; }
                                                }

                                                if (isReqBlocked) {
                                                    try {
                                                        const lvCfg = gm.MaincityConfiger ? gm.MaincityConfiger.getBuildingLvUpDataById(b.id, bLv) : null;
                                                        const limits = lvCfg ? lvCfg.build_lv_limit : null;
                                                        if (limits && Array.isArray(limits)) {
                                                            for (let [reqId, reqLv] of limits) {
                                                                if (bu.CheckHasBuildWithLv && !bu.CheckHasBuildWithLv(reqId, reqLv)) {
                                                                    const prereqEntry = entries.find(([p, pb]) => pb && pb.id === reqId);
                                                                    if (prereqEntry && prereqEntry[1] && !prereqEntry[1].Upgrading && checkCanUpgrade(prereqEntry[1]) && bot.canDo("host_up_" + prereqEntry[0], 10)) {
                                                                        candidateToUpgrade = prereqEntry;
                                                                        candidateReason = `Điều kiện mở khóa cho [${task.name}] (Cần đạt Cấp ${reqLv})`;
                                                                        break;
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    } catch (e) {}
                                                    if (candidateToUpgrade) break;
                                                } else if (checkCanUpgrade(b) && bot.canDo("host_up_" + plot, 10)) {
                                                    candidateToUpgrade = [plot, b];
                                                    candidateReason = `Nhiệm vụ Tái Thiết GĐ ${currentHostStage}: [${task.name}] (Hiện tại ${bLv}/${task.needVal})`;
                                                    break;
                                                } else {
                                                    // Không đủ gỗ
                                                    let cost = 0;
                                                    try { cost = bu && bu.GetUpgradeCost ? bu.GetUpgradeCost(b) : 0; } catch (eCostB) {}
                                                    if (cost > currentWood && bot.canDo("host_wood_warn_" + plot, 60)) {
                                                        bot.markDone("host_wood_warn_" + plot);
                                                        bot.log(`🪵 Gia Viên: Cần thêm Gỗ để nâng cấp [${getBName(b)}] lên Cấp ${bLv + 1} (Có: ${currentWood}/${cost}) cho [${task.name}]. Chờ tích lũy!`);
                                                    }
                                                }
                                            }
                                        } else if (task.buildId) {
                                            // Công trình nhiệm vụ yêu cầu chưa có trên bản đồ -> Tìm ô trống phù hợp để XÂY MỚI!
                                            let emptyPlot = null;
                                            if (task.jumpPlot) {
                                                const jb = entries.find(([plot, b]) => String(plot) === String(task.jumpPlot));
                                                if (jb && (!jb[1] || jb[1].id <= 0)) {
                                                    emptyPlot = Number(task.jumpPlot);
                                                }
                                            }
                                            if (emptyPlot == null) {
                                                const bCfg = gm.MaincityConfiger ? gm.MaincityConfiger.getBuildingDataById(task.buildId) : null;
                                                for (let [p, b] of entries) {
                                                    if (!b || b.id <= 0) {
                                                        const plotCfg = gm.MaincityConfiger ? gm.MaincityConfiger.getBuildingPlotDataByPlotId(Number(p)) : null;
                                                        const isUnlocked = plotCfg ? (bu && bu.checkPlotAreaUnlock ? bu.checkPlotAreaUnlock(plotCfg) : true) : true;
                                                        if (isUnlocked) {
                                                            if (bCfg && plotCfg && bCfg.build_type === plotCfg.plot_type) {
                                                                emptyPlot = Number(p);
                                                                break;
                                                            } else if (!bCfg) {
                                                                emptyPlot = Number(p);
                                                                break;
                                                            }
                                                        }
                                                    }
                                                }
                                            }

                                            if (emptyPlot != null) {
                                                let buildCost = 0;
                                                const bCfg = gm.MaincityConfiger ? gm.MaincityConfiger.getBuildingDataById(task.buildId) : null;
                                                if (bCfg && bCfg.expend && bCfg.expend[0]) {
                                                    buildCost = bCfg.expend[0][1] || 0;
                                                }
                                                if (currentWood >= buildCost) {
                                                    candidateToBuild = { plot: emptyPlot, bId: task.buildId };
                                                    candidateReason = `Xây mới theo nhiệm vụ Tái Thiết GĐ ${currentHostStage}: [${task.name}]`;
                                                    break;
                                                } else {
                                                    if (bot.canDo("host_wood_build_warn_" + emptyPlot, 60)) {
                                                        bot.markDone("host_wood_build_warn_" + emptyPlot);
                                                        bot.log(`🪵 Gia Viên: Cần thêm Gỗ để xây mới [${task.name}] tại ô [${emptyPlot}] (Có: ${currentWood}/${buildCost}). Chờ tích lũy!`);
                                                    }
                                                }
                                            }
                                        }
                                    } catch (errTask) {}
                                }
                            }

                            // B. Nâng công trình khác nếu toàn bộ nhiệm vụ Tái Thiết đã hoàn thành hoặc đang chờ lên cấp
                            if (!candidateToBuild && !candidateToUpgrade && incompleteTasks.length === 0 && bot.hasRed("V_HomeLv")) {
                                candidateToUpgrade = entries.find(([plot, b]) => {
                                    if (!b) return false;
                                    const bLv = (typeof b.lv === "number") ? b.lv : ((b && b.level) || (b && b.rawLv) || 0);
                                    const bId = (typeof b.id === "number") ? b.id : 0;
                                    return bId > 0 && bLv > 0 && checkCanUpgrade(b) && bot.canDo("host_up_" + plot, 15);
                                });
                                if (candidateToUpgrade) {
                                    candidateReason = "Tăng phồn vinh Gia Viên";
                                }
                            }

                            if (candidateToBuild) {
                                const { plot, bId } = candidateToBuild;
                                const bc = window.BuildingConfiger || (gm && gm.BuildingConfiger);
                                const bCfg = (bc && typeof bc.getBuildingCfgById === "function") ? bc.getBuildingCfgById(Number(bId)) : (gm.MaincityConfiger ? gm.MaincityConfiger.getBuildingDataById(Number(bId)) : null);
                                const bName = (bCfg && (bCfg.name || bCfg.building_name)) || `Công trình ${bId}`;
                                bot.markDone("host_build_" + plot);
                                bot.log(`🏗️ Gia Viên: Thợ rảnh (${freeWorkers}) -> Tiến hành XÂY MỚI [${bName}] tại ô [${plot}] [${candidateReason}]...`);
                                if (hlClass && typeof hlClass.reqToBuild === "function") {
                                    hlClass.reqToBuild(Number(plot), Number(bId), null);
                                } else if (gm.HostBuildCs) {
                                    gm.RPCReq.send(gm.HostBuildCs.protocol, { _plot: Number(plot), _id: Number(bId), _cli: null });
                                } else {
                                    const rpc = gm.RPCReq || (window.G_Mapping && window.G_Mapping.RPCReq);
                                    if (rpc) rpc.send(10510, { _plot: Number(plot), _id: Number(bId), _cli: null });
                                }
                                didSomething = true;
                                await bot.sleep(600);
                            } else if (candidateToUpgrade) {
                                const [plot, b] = candidateToUpgrade;
                                const bLv = (typeof b.lv === "number") ? b.lv : ((b && b.level) || (b && b.rawLv) || 0);
                                const bName = getBName(b);
                                bot.markDone("host_up_" + plot);
                                bot.log(`🏗️ Gia Viên: Thợ rảnh (${freeWorkers}) -> Nâng cấp [${bName}] ô [${plot}] (Cấp ${bLv} ➜ ${bLv + 1}) [${candidateReason}]...`);
                                if (hlClass && typeof hlClass.reqBuildLvUp === "function") {
                                    hlClass.reqBuildLvUp(Number(plot));
                                } else if (gm.HostLvUpCs) {
                                    gm.RPCReq.send(gm.HostLvUpCs.protocol, { _plot: Number(plot) });
                                } else {
                                    const rpc = gm.RPCReq || (window.G_Mapping && window.G_Mapping.RPCReq);
                                    if (rpc) rpc.send(10511, { _plot: Number(plot) });
                                }
                                didSomething = true;
                                await bot.sleep(600);
                            }
                        }
                    } catch (eBuild) {
                        bot.log("Lỗi Nâng Cấp Gia Viên: " + (eBuild.stack || eBuild.toString()));
                    }
                }

                // 3. CƯỚP NÔNG SẢN & LẤY TIM THÔNG MINH (Chỉ cướp khi còn lượt VÀ chọn đối thủ còn nông sản)
                if (!didSomething && hasLoot && bot.tryDo("home_loot_action", 30)) {
                    try {
                        const hostList = hl.otherHostList;

                        // Nếu danh sách hàng xóm chưa có -> Gửi yêu cầu lấy danh sách
                        if (!hostList || hostList.length === 0) {
                            if (hlClass && typeof hlClass.reqOtherHomeList === "function") {
                                hlClass.reqOtherHomeList(false);
                            } else if (hl.reqOtherHomeList) {
                                hl.reqOtherHomeList(false);
                            } else if (gm.HostHostListCs) {
                                gm.RPCReq.send(gm.HostHostListCs.protocol, { _type: 0 });
                            } else {
                                const rpc = gm.RPCReq || (window.G_Mapping && window.G_Mapping.RPCReq);
                                if (rpc) rpc.send(10512, { _type: 0 });
                            }
                            await bot.sleep(800);
                        }

                        const currentList = hl.otherHostList;
                        if (currentList && currentList.length > 0) {
                            // 3.1 CƯỚP NÔNG SẢN nếu còn lượt cướp (remainRob > 0) và KHÔNG đang bật chế độ ưu tiên Giải Cứu KNB
                            if (remainRob > 0 && !bot.state.isAutoRescueKnbActive && bot.canDo("home_rob_action", 15)) {
                                // Lọc các hàng xóm có nông sản chưa bị cướp (_de_res === 0) và chưa thử trong phiên
                                const robTargets = currentList.filter(it => it && it._role_show && (it._de_res === 0 || it._de_res === false) && !it._botRobTried);
                                if (robTargets.length > 0) {
                                    // Sắp xếp theo cấp Gia Viên cao nhất để cướp nhiều tài nguyên nhất
                                    robTargets.sort((a, b) => ((b._host_lv || 0) - (a._host_lv || 0)));
                                    const target = robTargets[0];
                                    const targetRid = target._role_show.getRoleId ? target._role_show.getRoleId() : (target._role_show._rid || target._role_show.rid);
                                    const targetName = target._role_show.getName ? target._role_show.getName() : (target._role_show._name || "Hàng xóm");

                                    if (targetRid) {
                                        bot.markDone("home_rob_action");
                                        bot.log(`🌾 Gia Viên: Còn ${remainRob} lượt cướp -> Cướp nông sản của [${targetName}] (Lv.${target._host_lv || 1})...`);
                                        if (hlClass && typeof hlClass.reqLootReward === "function") {
                                            hlClass.reqLootReward(targetRid);
                                        } else if (gm.HostRobRewardsCs) {
                                            gm.RPCReq.send(gm.HostRobRewardsCs.protocol, { _tar_id: targetRid });
                                        } else {
                                            const rpc = gm.RPCReq || (window.G_Mapping && window.G_Mapping.RPCReq);
                                            if (rpc) rpc.send(10516, { _tar_id: targetRid });
                                        }
                                        target._botRobTried = true; // Không ghi đè _de_res = 1 để tránh làm sai lệch cờ nhà đang cháy
                                        didSomething = true;
                                        await bot.sleep(800);
                                    }
                                } else {
                                    // Toàn bộ hàng xóm trong danh sách hiện tại đã bị cướp hết -> Yêu cầu làm mới danh sách!
                                    bot.log("🌾 Gia Viên: Các hàng xóm hiện tại đều đã hết nông sản -> Đang làm mới danh sách hàng xóm...");
                                    if (hlClass && typeof hlClass.reqOtherHomeList === "function") {
                                        hlClass.reqOtherHomeList(true);
                                    } else if (hl.reqOtherHomeList) {
                                        hl.reqOtherHomeList(true);
                                    } else if (gm.HostHostListCs) {
                                        gm.RPCReq.send(gm.HostHostListCs.protocol, { _type: 1 });
                                    } else {
                                        const rpc = gm.RPCReq || (window.G_Mapping && window.G_Mapping.RPCReq);
                                        if (rpc) rpc.send(10512, { _type: 1 });
                                    }
                                    await bot.sleep(800);
                                }
                            }

                            // 3.2 LẤY TIM CHÚC PHÚC nếu còn lượt may mắn (remainLuck > 0)
                            if (!didSomething && remainLuck > 0 && bot.canDo("home_luck_action", 15)) {
                                const luckTargets = currentList.filter(it => it && it._role_show && (it._de_luck === 0 || it._de_luck === false));
                                if (luckTargets.length > 0) {
                                    const target = luckTargets[0];
                                    const targetRid = target._role_show.getRoleId ? target._role_show.getRoleId() : (target._role_show._rid || target._role_show.rid);
                                    const targetName = target._role_show.getName ? target._role_show.getName() : (target._role_show._name || "Hàng xóm");

                                    if (targetRid) {
                                        bot.markDone("home_luck_action");
                                        bot.log(`💖 Gia Viên: Còn ${remainLuck} lượt chúc phúc -> Lấy tim của [${targetName}]...`);
                                        if (hlClass && typeof hlClass.reqLootHeart === "function") {
                                            hlClass.reqLootHeart(targetRid);
                                        } else if (hl.reqLootHeart) {
                                            hl.reqLootHeart(targetRid);
                                        } else if (gm.HostRobLuckCs) {
                                            gm.RPCReq.send(gm.HostRobLuckCs.protocol, { _tar_id: targetRid });
                                        } else {
                                            const rpc = gm.RPCReq || (window.G_Mapping && window.G_Mapping.RPCReq);
                                            if (rpc) rpc.send(10518, { _tar_id: targetRid });
                                        }
                                        target._de_luck = 1;
                                        didSomething = true;
                                        await bot.sleep(800);
                                    }
                                }
                            }
                        }
                    } catch (eLootAct) {
                        bot.log("Lỗi Cướp Gia Viên: " + (eLootAct.stack || eLootAct.toString()));
                    }
                }

                // 4. THU HOẠCH HOA / NÔNG SẢN KHI ĐÃ CHÍN (V_HomeReward - kiểm tra chuẩn mốc Cá Nhân vs Bang Hội)
                if (!didSomething && hasHarvest && bot.canDo("home_reward", 60)) {
                    bot.markDone("home_reward");
                    let claimType = 0;
                    try {
                        const allPoe = (gm && gm.MaincityConfiger && gm.MaincityConfiger.getAllPoeData) ? gm.MaincityConfiger.getAllPoeData() : null;
                        if (flowerData && allPoe) {
                            // 1. Kiểm tra thưởng cá nhân (_type = 1)
                            if (allPoe[0] && Array.isArray(allPoe[0])) {
                                for (let i = 0; i < allPoe[0].length; i++) {
                                    const cfg = allPoe[0][i];
                                    if (cfg && flowerData._flower >= cfg.prosperity && flowerData._flower_gift < cfg.id) {
                                        claimType = 1;
                                        break;
                                    }
                                }
                            }
                            // 2. Nếu không có mốc cá nhân, kiểm tra thưởng bang hội (_type = 2)
                            if (claimType === 0 && allPoe[1] && Array.isArray(allPoe[1])) {
                                const gFlower = hl.guild_flower || 0;
                                for (let i = 0; i < allPoe[1].length; i++) {
                                    const cfg = allPoe[1][i];
                                    if (cfg && gFlower >= cfg.prosperity && flowerData._flower_guild < cfg.id) {
                                        claimType = 2;
                                        break;
                                    }
                                }
                            }
                        }
                    } catch (errCheck) { }

                    if (claimType > 0) {
                        const tName = claimType === 1 ? "Cá Nhân" : "Bang Hội";
                        const prevGift = claimType === 1 ? (flowerData._flower_gift || 0) : (flowerData._flower_guild || 0);
                        bot.log(`🌸 Gia Viên: Thưởng hoa [${tName}] đủ mốc -> Nhận thưởng!`);
                        if (hlClass && typeof hlClass.reqGetFlowerGift === "function") {
                            hlClass.reqGetFlowerGift(claimType);
                        } else if (gm.HostFlowerRewardCs) {
                            gm.RPCReq.send(gm.HostFlowerRewardCs.protocol, { _type: claimType });
                        } else {
                            const rpc = gm.RPCReq || (window.G_Mapping && window.G_Mapping.RPCReq);
                            if (rpc) rpc.send(10544, { _type: claimType });
                        }
                        didSomething = true;
                        await bot.sleep(1200);
                        const curFlower = hl && hl.flowerData;
                        const newGift = claimType === 1 ? (curFlower && curFlower._flower_gift) : (curFlower && curFlower._flower_guild);
                        if (newGift !== undefined && newGift > prevGift) {
                            bot.state.manorFlowerFailCount = 0;
                            bot.state.manorFlowerCooldown = 0;
                        }
                    } else {
                        // Chấm đỏ hiển thị nhưng không thỏa mãn mốc cá nhân lẫn bang hội -> Tạm hoãn 30 phút tránh spam 10544
                        bot.state.manorFlowerCooldown = Date.now() + 1800000;
                    }
                }
            } catch (e) {
                bot.log("Lỗi Gia Viên: " + (e.stack || e.toString()));
            }
            return didSomething || didHarvest;
        },

        // ====================================================================
        // TÍNH NĂNG 6.5: FARM KNB QUA GIẢI CỨU GIA VIÊN SIÊU TỐC (50 KNB/lượt không giới hạn)
        // - Dò chi tiết HostViewSc tốc độ cao (Event-Driven Polling 40ms thay vì sleep cứng 650ms)
        // - Kiểm tra cả nhà _de_res = 1, 2 và _de_res = 0 (vì nhà đang bị chiếm đóng vẫn có thể có _de_res = 0)
        // - Tự động bắt sóng tin nhắn Cầu Cứu Gia Viên (ChatParamHome) từ kênh Chat Thế Giới & Bang Hội
        // - Bỏ qua 0ms các nhà vừa kiểm tra trong 90s qua (tránh gửi trùng HostViewCs)
        // ====================================================================
        runAutoRescueKnbSmart: async function () {
            if (typeof G_Mapping === "undefined" || !G_Mapping.RPCReq) return false;
            const gm = G_Mapping;
            const mm = window.ModelManager;
            if (!mm || !mm.HomeLandModel) return false;
            const hl = mm.HomeLandModel;
            const hlClass = (hl && hl.constructor) || (typeof window.__require === "function" && (window.__require("HomeLandModel")?.default || window.__require("HomeLandModel"))) || gm.HomeLandModel || window.HomeLandModel;

            if (!hl) return false;

            // Chống xung đột khi đang vào trận, vừa thoát trận khác hoặc khi socket đang kết nối lại
            if (bot.state.rescueChecking && Date.now() - (bot.state.rescueCheckingStartTime || 0) > 15000) {
                bot.state.rescueChecking = false;
            }
            const nw = (gm && gm.NetWork && gm.NetWork.Ins) || (window.NetWork && window.NetWork.Ins);
            if (!nw || nw.isReconnecting || nw._needFullRelogin || (typeof nw.isClose === "function" && nw.isClose())) return false;
            if (bot.isBattling() || bot.state.rescueChecking) return false;
            if (Date.now() - (bot.state.lastBattleEndTime || 0) < 500) return false;
            if (Date.now() - (window.__LAST_OTHER_WAR_TIME__ || 0) < 1800) return false;

            // Nhịp độ chu kỳ: 0.5s - quét siêu tốc, phản ứng tức thì với cướp và cầu cứu
            if (!bot.canDo("rescue_knb_cycle", 0.15)) return false;

            bot.state.rescueChecking = true;
            bot.state.rescueCheckingStartTime = Date.now();
            let didSomething = false;

            const myRid = mm.PlayerModel && mm.PlayerModel.getRid ? Number(mm.PlayerModel.getRid()) : 0;
            const sTime = (mm.ServerTimeModel && mm.ServerTimeModel.getServerTime)
                ? mm.ServerTimeModel.getServerTime()
                : Math.floor(Date.now() / 1000);
            const lootShowTime = (hlClass && hlClass.LOOT_SHOW_TIME) || (hl && hl.constructor && hl.constructor.LOOT_SHOW_TIME) || 21600;
            const STRONG_ROBBER_SKIP_MS = 600000; // 10 phút nếu kẻ cướp quá mạnh

            if (!bot.state.failedRescueRids) bot.state.failedRescueRids = {};
            if (!bot.state.skipRescueHouseUntil) bot.state.skipRescueHouseUntil = {};
            if (!bot.state.skipRescueReason) bot.state.skipRescueReason = {};
            if (!bot.state.priorityRescueQueue) bot.state.priorityRescueQueue = [];
            if (!bot.state.checkedChatRescueKeys) bot.state.checkedChatRescueKeys = {};
            if (!bot.state.rescueAttempts) bot.state.rescueAttempts = {};
            if (typeof bot.state.totalRescueScanned !== "number") bot.state.totalRescueScanned = 0;

            const revoltType = (gm.e_GameplayDataGameplay && gm.e_GameplayDataGameplay.Revolt) ? gm.e_GameplayDataGameplay.Revolt : 106;

            const getHouseRid = (houseOrRole) => {
                if (!houseOrRole) return 0;
                const rs = houseOrRole._role_show || houseOrRole;
                return Number(rs.getRoleId ? rs.getRoleId() : (rs._rid || rs.rid || 0));
            };

            const getHouseName = (houseOrRole, fallbackRid) => {
                if (!houseOrRole) return `ID ${fallbackRid || 0}`;
                const rs = houseOrRole._role_show || houseOrRole;
                return (rs.getName ? rs.getName() : (rs._name || rs.name)) || `ID ${fallbackRid || 0}`;
            };

            if (window.Dispatcher && !window.__HOST_LIST_LISTENER_ATTACHED__) {
                window.__HOST_LIST_LISTENER_ATTACHED__ = true;
                window.Dispatcher.addEventListener("evt_HostHostListSc", function () {
                    window.__LAST_HOST_LIST_SC_TIME__ = Date.now();
                }, { name: "HostListTracker" });
            }

            // Hook trực tiếp vào setOtherHomeData để bắt gói HostViewSc 100% không trượt
            if (mm && mm.HomeLandModel && !window.__SET_OTHER_HOME_DATA_HOOKED__) {
                window.__SET_OTHER_HOME_DATA_HOOKED__ = true;
                const origSetOther = mm.HomeLandModel.setOtherHomeData;
                mm.HomeLandModel.setOtherHomeData = function (data) {
                    if (data) {
                        const rs = data._role_show;
                        const hRid = rs ? Number(rs._rid || rs.rid || (rs.getRoleId ? rs.getRoleId() : 0)) : 0;
                        if (hRid > 0) {
                            if (!window.__HOST_VIEW_DATA_MAP__) window.__HOST_VIEW_DATA_MAP__ = {};
                            window.__HOST_VIEW_DATA_MAP__[hRid] = { data: data, time: Date.now() };
                        }
                    }
                    if (typeof origSetOther === "function") return origSetOther.apply(this, arguments);
                };
            }

            if (window.Dispatcher && !window.__HOST_VIEW_LISTENER_ATTACHED__) {
                window.__HOST_VIEW_LISTENER_ATTACHED__ = true;
                window.Dispatcher.addEventListener("other_city_update", function () {
                    const oh = (hl.getOtherHomeData ? hl.getOtherHomeData() : hl._otherHomeData);
                    if (oh) {
                        const curRid = getHouseRid(oh);
                        if (curRid > 0) {
                            if (!window.__HOST_VIEW_DATA_MAP__) window.__HOST_VIEW_DATA_MAP__ = {};
                            window.__HOST_VIEW_DATA_MAP__[curRid] = { data: oh, time: Date.now() };
                        }
                    }
                }, { name: "HostViewTracker" });
            }

            const requestRefreshHostList = (isRefresh = true) => {
                const tVal = isRefresh ? 1 : 0;
                if (hlClass && typeof hlClass.reqOtherHomeList === "function") {
                    hlClass.reqOtherHomeList(!!isRefresh);
                } else if (hl.reqOtherHomeList) {
                    hl.reqOtherHomeList(!!isRefresh);
                } else if (gm.HostHostListCs) {
                    gm.RPCReq.send(gm.HostHostListCs.protocol, { _type: tVal });
                } else {
                    const rpc = gm.RPCReq || (window.G_Mapping && window.G_Mapping.RPCReq);
                    if (rpc) rpc.send(10550, { _type: tVal });
                }
            };

            const waitRefreshHostList = async (isRefresh = true, maxWaitMs = 250) => {
                if (bot.isBattling() || (Date.now() - (window.__LAST_OTHER_WAR_TIME__ || 0) < 1500)) return null;
                if (nw && (nw.isReconnecting || nw._needFullRelogin || (typeof nw.isClose === "function" && nw.isClose()))) return null;
                const prevFirstRid = (hl.otherHostList && hl.otherHostList[0]) ? getHouseRid(hl.otherHostList[0]) : 0;
                const reqTime = Date.now();
                requestRefreshHostList(isRefresh);
                const start = Date.now();
                while (Date.now() - start < maxWaitMs) {
                    await bot.sleep(15);
                    if ((window.__LAST_HOST_LIST_SC_TIME__ || 0) >= reqTime && hl.otherHostList && hl.otherHostList.length > 0) {
                        return hl.otherHostList;
                    }
                    if (hl.otherHostList && hl.otherHostList.length > 0) {
                        const curFirstRid = getHouseRid(hl.otherHostList[0]);
                        if (!isRefresh || curFirstRid !== prevFirstRid) {
                            return hl.otherHostList;
                        }
                    }
                }
                return hl.otherHostList;
            };

            const requestViewHome = (rid) => {
                const targetId = Number(rid);
                if (!targetId || targetId <= 0) return;
                try {
                    if (hl) hl._otherHomeData = null;
                } catch (e) { }
                const rpc = gm.RPCReq || (window.G_Mapping && window.G_Mapping.RPCReq) || window.RPCReq;
                const proto = (gm.HostViewCs && gm.HostViewCs.protocol) ? gm.HostViewCs.protocol : 10552;
                if (rpc && typeof rpc.send === "function") {
                    rpc.send(proto, { _rid: targetId });
                }
            };

            const waitViewHomeData = async (rid, maxWaitMs = 250) => {
                if (bot.isBattling() || (Date.now() - (window.__LAST_OTHER_WAR_TIME__ || 0) < 1500)) return null;
                if (nw && (nw.isReconnecting || nw._needFullRelogin || (typeof nw.isClose === "function" && nw.isClose()))) return null;
                const reqTime = Date.now();
                requestViewHome(rid);
                const start = Date.now();
                while (Date.now() - start < maxWaitMs) {
                    const cached = window.__HOST_VIEW_DATA_MAP__ && window.__HOST_VIEW_DATA_MAP__[rid];
                    if (cached && cached.time >= reqTime) {
                        return cached.data;
                    }
                    const oh = hl.getOtherHomeData ? hl.getOtherHomeData() : hl._otherHomeData;
                    if (oh) {
                        const curRid = getHouseRid(oh);
                        if (curRid === Number(rid)) {
                            return oh;
                        }
                    }
                    await bot.sleep(15);
                }
                const finalOh = (window.__HOST_VIEW_DATA_MAP__ && window.__HOST_VIEW_DATA_MAP__[rid]) ? window.__HOST_VIEW_DATA_MAP__[rid].data : (hl.getOtherHomeData ? hl.getOtherHomeData() : hl._otherHomeData);
                if (finalOh && getHouseRid(finalOh) === Number(rid)) {
                    return finalOh;
                }
                return null;
            };

            // Hàm kiểm tra chi tiết & đánh giải cứu 1 mục tiêu
            const inspectAndRescueTarget = async (targetRid, fallbackName, sourceLabel) => {
                if (!targetRid || Number(targetRid) <= 0 || Number(targetRid) === myRid) return false;
                const otherHome = await waitViewHomeData(targetRid, 650);
                if (!otherHome) {
                    bot.log(`⏳ [Farm KNB] Chưa nhận được dữ liệu chi tiết từ gia viên [${fallbackName || targetRid}] (thử lại sau)`);
                    return false;
                }

                const viewedRid = getHouseRid(otherHome) || Number(targetRid);
                const curServerTime = (mm.ServerTimeModel && mm.ServerTimeModel.getServerTime)
                    ? mm.ServerTimeModel.getServerTime()
                    : Math.floor(Date.now() / 1000);
                const robRid = Number(otherHome._rob_rid || 0);
                const robSec = Number(otherHome._rob_sec || 0);
                const victimName = getHouseName(otherHome, targetRid) || fallbackName || `ID ${targetRid}`;
                const robberName = otherHome._rob_name || (robRid > 0 ? `Kẻ địch (ID: ${robRid})` : "Kẻ chiếm đóng");

                const isOccupied = (robRid > 0 && robRid !== myRid && (robSec === 0 || curServerTime - robSec <= lootShowTime));
                bot.log(`🔍 [Farm KNB • Chi Tiết] Gia viên [${victimName}] (ID: ${targetRid}): Cướp = ${robRid > 0 ? `[${robberName}] (ID: ${robRid})` : "Không có kẻ chiếm đóng"}, robSec = ${robSec}`);

                if (isOccupied) {
                    if (robRid > 0 && robRid === myRid) {
                        bot.state.skipRescueHouseUntil[targetRid] = Date.now() + 1800000;
                        bot.state.skipRescueReason[targetRid] = "self";
                        return false;
                    }

                    const victimName = getHouseName(otherHome, targetRid) || fallbackName || "Hàng xóm";
                    const robberName = otherHome._rob_name || (robRid > 0 ? `Kẻ địch (ID: ${robRid})` : "Kẻ chiếm đóng");

                    const failTs = bot.state.failedRescueRids[robRid] || 0;
                    if (Date.now() - failTs < STRONG_ROBBER_SKIP_MS) {
                        bot.state.skipRescueHouseUntil[targetRid] = Date.now() + 300000;
                        bot.state.skipRescueReason[targetRid] = "strong_robber";
                        return false;
                    }

                    bot.state.battleInProgress = true;
                    bot.state.rescueFightActive = true;
                    bot.state.lastBattleStartTime = Date.now();
                    if (window.__QA_PENDING_MAIN_START__) {
                        clearTimeout(window.__QA_PENDING_MAIN_START__);
                        window.__QA_PENDING_MAIN_START__ = null;
                    }

                    bot.log(`⚔️ [Farm KNB • ${sourceLabel}] Phát hiện gia viên [${victimName}] đang bị chiếm bởi [${robberName}]! Đang giải cứu (+50 KNB)...`);

                    // 1. Luôn khôi phục 100% full đội hình mạnh nhất trước khi vào trận để chắc chắn chiến thắng
                    if (bot.state.isScoutLowPowerActive && typeof bot.restoreFullCombatArray === "function") {
                        await bot.restoreFullCombatArray("rescue_fight");
                    }

                    const lastProtoTimes = window.__LAST_PROTO_TIMES__ || {};
                    const lastAnyWarStart = Math.max(lastProtoTimes[10401] || 0, lastProtoTimes["10401_1"] || 0, window.__LAST_OTHER_WAR_TIME__ || 0);
                    const lastWarClose = window.__LAST_WAR_CLOSE_TIME__ || 0;
                    const lastFailCool = window.__LAST_WAR_FAIL_COOLDOWN__ || 0;
                    const safeStartAt = Math.max(lastAnyWarStart + 1500, lastWarClose + 1000, lastFailCool);
                    const waitMs = safeStartAt - Date.now();
                    if (waitMs > 0) {
                        await bot.sleep(Math.min(waitMs, 3000));
                    }

                    const fm = (gm.FubenManager && gm.FubenManager.I) || (window.FubenManager && window.FubenManager.I);
                    const fmInst = window.FightManager || (gm && gm.FightManager);

                    if (fmInst) {
                        if (typeof fmInst.removeFight === "function") {
                            try { fmInst.removeFight(revoltType); } catch (eRm) { }
                        }
                        if (fmInst.fightList) {
                            delete fmInst.fightList[revoltType];
                        }
                        if (fmInst.copyRequstStatus) {
                            fmInst.copyRequstStatus[revoltType] = 0;
                        }
                    }

                    const revoltStartTs = Date.now();
                    bot.state.lastServerNotice = null;
                    bot.state.suppressRescueRewardUntil = Date.now() + 8000;

                    try {
                        const bm = (window.ModelManager && window.ModelManager.BattleModel) || (gm && gm.BattleModel);
                        if (bm) {
                            if (typeof bm.clearStageView === "function") bm.clearStageView();
                            else if (Array.isArray(bm._stageViewArray)) bm._stageViewArray = [];
                        }
                    } catch (eBm) { }

                    const rawRs = { _rid: robRid, _name: robberName };

                    // Đồng bộ đối thủ trước khi đánh để tránh lỗi server Battle_PlayerPkGameTypeErr (10685)
                    try {
                        const rpc = gm.RPCReq || (window.G_Mapping && window.G_Mapping.RPCReq);
                        if (rpc && robRid > 0) {
                            const rivalProto = (gm.HeroRivalCs && gm.HeroRivalCs.protocol) || 10334;
                            rpc.send(rivalProto, { _rid: robRid, _type: 106, _id: 2 });
                        }
                    } catch (eRival) { }

                    await bot.sleep(80);

                    // Đảm bảo hook BattleController đã sẵn sàng
                    if (typeof bot.hookBattleController === "function") {
                        bot.hookBattleController();
                    }

                    if (fm && fm.enter) {
                        fm.enter(
                            revoltType,
                            targetRid,
                            null,
                            false,
                            function (e) {
                                if (e === "begin") {
                                    try {
                                        const bm = (window.ModelManager && window.ModelManager.BattleModel) || (gm && gm.BattleModel);
                                        if (bm && typeof bm.setStageView === "function") bm.setStageView(["HomeLandOtherView", "HomeLandView"]);
                                    } catch (err) { }
                                }
                            },
                            true, // skipArray = true (vào trận ngay)
                            {
                                _role_show: rawRs,
                                _id: 2
                            },
                            bot.settings.skip_battle !== false
                        );
                    } else if (gm.RPCReq && gm.WarStartCs) {
                        gm.RPCReq.send(gm.WarStartCs.protocol, { _type: revoltType, _id: targetRid, _cli: 1, _ext: [] });
                    }

                    let battleInfo = null;
                    let serverNotice = null;
                    const waitBattleDeadline = Date.now() + 3500;
                    while (Date.now() < waitBattleDeadline) {
                        const info = (bot.state.lastBattleByType && (bot.state.lastBattleByType[revoltType] || bot.state.lastBattleByType[106]))
                            || (bot.state.lastAnyBattle && bot.state.lastAnyBattle.time >= revoltStartTs ? bot.state.lastAnyBattle : null);
                        if (info && info.time >= revoltStartTs) {
                            battleInfo = info;
                            break;
                        }
                        if (bot.state.lastServerNotice && bot.state.lastServerNotice.time >= revoltStartTs) {
                            serverNotice = bot.state.lastServerNotice;
                            break;
                        }
                        if (bot.state.lastWarError66Time && bot.state.lastWarError66Time >= revoltStartTs) {
                            serverNotice = { code: 66, desc: "Chưa kết thúc trận trước" };
                            break;
                        }
                        await bot.sleep(50);
                    }

                    bot.closeBattleViews();

                    if (serverNotice) {
                        const skipDuration = (serverNotice.code === 335) ? 1800000 : 180000;
                        bot.log(`⚠️ [Farm KNB] Server từ chối giải cứu [${victimName}]: Mã lỗi [${serverNotice.code}]${serverNotice.desc ? ` - "${serverNotice.desc}"` : ""} -> Khóa bỏ qua gia viên này ${serverNotice.code === 335 ? "30 phút" : "3 phút"}.`);
                        bot.state.skipRescueHouseUntil[targetRid] = Date.now() + skipDuration;
                        bot.state.skipRescueReason[targetRid] = `server_reject_${serverNotice.code}`;
                        delete bot.state.rescueAttempts[targetRid];
                        bot.state.rescueFightActive = false;
                        bot.state.battleInProgress = false;
                        return false;
                    }

                    if (!battleInfo) {
                        if (fmInst && fmInst.copyRequstStatus) {
                            fmInst.copyRequstStatus[revoltType] = 0;
                        }
                        const attempts = (bot.state.rescueAttempts[targetRid] || 0) + 1;
                        bot.state.rescueAttempts[targetRid] = attempts;

                        if (attempts >= 2) {
                            bot.state.skipRescueHouseUntil[targetRid] = Date.now() + 300000;
                            bot.state.skipRescueReason[targetRid] = "timeout_2x";
                            delete bot.state.rescueAttempts[targetRid];
                            bot.log(`⚠️ [Farm KNB] Không thể vào trận giải cứu [${victimName}] sau 2 lần thử (server không phản hồi) -> Bỏ qua 5 phút.`);
                        } else {
                            bot.state.skipRescueHouseUntil[targetRid] = Date.now() + 15000;
                            bot.state.priorityRescueQueue.push({
                                rid: targetRid,
                                name: victimName,
                                source: "Thử lại lần 2"
                            });
                            bot.log(`⏳ [Farm KNB] Trận giải cứu [${victimName}] chưa phản hồi -> Đưa về cuối hàng đợi (thử lại sau 15s)...`);
                        }
                        bot.state.rescueFightActive = false;
                        bot.state.battleInProgress = false;
                        return false;
                    }

                    const isWin = Number(battleInfo.winner) === 1;

                    if (isWin) {
                        await bot.sleep(150);
                        bot.state.rescuedCount = (bot.state.rescuedCount || 0) + 1;
                        bot.state.rescuedKnbTotal = (bot.state.rescuedKnbTotal || 0) + 50;
                        bot.state.skipRescueHouseUntil[targetRid] = Date.now() + 180000;
                        bot.state.skipRescueReason[targetRid] = "rescued";
                        delete bot.state.rescueAttempts[targetRid];

                        bot.log(`💎 [Farm KNB] 🎉 GIẢI CỨU THÀNH CÔNG [${victimName}] (Đánh đuổi [${robberName}])! +50 KNB (Tổng: ${bot.state.rescuedKnbTotal.toLocaleString()} KNB • ${bot.state.rescuedCount} lượt)!`);
                        bot.showToast(`🎉 Giải cứu thành công! +50 KNB (Tổng: ${bot.state.rescuedKnbTotal} KNB)`);
                        if (typeof bot.updateStats === "function") bot.updateStats();
                        didSomething = true;
                    } else {
                        bot.state.failedRescueRids[robRid] = Date.now();
                        bot.state.skipRescueHouseUntil[targetRid] = Date.now() + 300000;
                        bot.state.skipRescueReason[targetRid] = "strong_robber";
                        bot.log(`⚠️ [Farm KNB] Thua trận giải cứu [${victimName}] trước [${robberName}]! Đã khóa bỏ qua kẻ địch này 5 phút.`);
                    }

                    bot.state.rescueFightActive = false;
                    bot.state.battleInProgress = false;
                    bot.state.lastBattleEndTime = Date.now() + 600;
                    return true;
                } else {
                    bot.state.skipRescueHouseUntil[targetRid] = Date.now() + 35000;
                    return false;
                }
            };

            try {
                // ==========================================
                // KÊNH 1: XỬ LÝ HÀNG ĐỢI CẦU CỨU TỪ CHAT (Ưu tiên số 1)
                // ==========================================
                if (bot.state.priorityRescueQueue.length > 0) {
                    const topTarget = bot.state.priorityRescueQueue.shift();
                    if (topTarget && topTarget.rid && Number(topTarget.rid) !== myRid) {
                        const skipUntil = bot.state.skipRescueHouseUntil[topTarget.rid] || 0;
                        if (Date.now() >= skipUntil) {
                            const handled = await inspectAndRescueTarget(topTarget.rid, topTarget.name, topTarget.source || "Chat Radar");
                            if (handled) return didSomething;
                        }
                    }
                }

                // Quét bổ sung tin nhắn trong ChatModel & định kỳ gửi ChatHisCs
                try {
                    const cm = mm.ChatModel;
                    if (cm) {
                        const rpc = gm.RPCReq || (window.G_Mapping && window.G_Mapping.RPCReq);
                        if (rpc && bot.canDo("req_chat_his_for_rescue", 10)) {
                            bot.markDone("req_chat_his_for_rescue");
                            if (gm.ChatHisCs) {
                                rpc.send(gm.ChatHisCs.protocol, { _channel: 2, _sub_channel: 0, _page: 1 });
                                rpc.send(gm.ChatHisCs.protocol, { _channel: 1, _sub_channel: 0, _page: 1 });
                            } else {
                                rpc.send(12712, { _channel: 2, _sub_channel: 0, _page: 1 });
                                rpc.send(12712, { _channel: 1, _sub_channel: 0, _page: 1 });
                            }
                        }

                        const scanChatDic = (dic) => {
                            if (!dic || typeof dic.forEach !== "function") return;
                            dic.forEach((msgList) => {
                                if (!Array.isArray(msgList)) return;
                                for (let m of msgList) {
                                    if (!m || !m._text || typeof m._text !== "string") continue;
                                    const match = m._text.match(/\{6,\s*(\d+)\}/);
                                    if (match && match[1]) {
                                        const hRid = Number(match[1]);
                                        if (hRid > 0 && hRid !== myRid) {
                                            const msgKey = `${hRid}_${m._sec || m.time || 0}`;
                                            if (!bot.state.checkedChatRescueKeys[msgKey]) {
                                                bot.state.checkedChatRescueKeys[msgKey] = Date.now();
                                                const rs = m._role_show;
                                                const sName = (rs && (rs.getName ? rs.getName() : (rs._name || rs.name))) || `ID ${hRid}`;
                                                if (!bot.state.priorityRescueQueue.some(x => Number(x.rid) === hRid)) {
                                                    bot.state.priorityRescueQueue.push({ rid: hRid, name: sName, source: "Cầu Cứu Chat History" });
                                                    bot.log(`📡 [Farm KNB • Chat] Bắt được tín hiệu Cầu Cứu từ [${sName}] (ID: ${hRid})! Đang giải cứu ngay (+50 KNB)...`);
                                                }
                                            }
                                        }
                                    }
                                }
                            });
                        };
                        scanChatDic(cm.ChatDic);
                        scanChatDic(cm.NewChatDic);
                    }
                } catch (eChatScan) { }

                // ==========================================
                // KÊNH 2: TUẦN TRA THÀNH VIÊN BANG HỘI (Guild Patrol)
                // ==========================================
                try {
                    const gmModel = mm.GuildModel;
                    if (gmModel) {
                        const mList = (gmModel.guildInfo && Array.isArray(gmModel.guildInfo._member_list))
                            ? gmModel.guildInfo._member_list
                            : null;

                        if (!mList || mList.length === 0) {
                            if (bot.canDo("req_guild_info_patrol", 20)) {
                                bot.markDone("req_guild_info_patrol");
                                if (typeof gmModel.requestGuildInfo === "function") {
                                    const gId = (gmModel.guildInfo && gmModel.guildInfo._id) || (mm.PlayerModel && mm.PlayerModel.getGuildId ? mm.PlayerModel.getGuildId() : 0);
                                    gmModel.requestGuildInfo(gId || 0);
                                } else if (gm.GuildInfoCs && gm.RPCReq) {
                                    gm.RPCReq.send(gm.GuildInfoCs.protocol, { _id: 0 });
                                }
                            }
                        } else {
                            if (bot.state.guildPatrolIdx === undefined) bot.state.guildPatrolIdx = 0;
                            const totalMembers = mList.length;
                            for (let pStep = 0; pStep < 2; pStep++) {
                                const mItem = mList[bot.state.guildPatrolIdx % totalMembers];
                                bot.state.guildPatrolIdx++;
                                if (!mItem) continue;
                                const mShows = mItem._shows || mItem._role_show;
                                const mRid = mShows ? Number(mShows.getRoleId ? mShows.getRoleId() : (mShows._rid || mShows.rid || 0)) : 0;
                                const mName = mShows ? ((mShows.getName ? mShows.getName() : (mShows._name || mShows.name)) || `ID ${mRid}`) : `ID ${mRid}`;

                                if (mRid > 0 && mRid !== myRid) {
                                    const skipUntil = bot.state.skipRescueHouseUntil[mRid] || 0;
                                    if (Date.now() >= skipUntil) {
                                        const handled = await inspectAndRescueTarget(mRid, mName, "Tuần Tra Bang Hội");
                                        if (handled) return didSomething;
                                        break; // Chỉ kiểm tra 1 thành viên mỗi chu kỳ để giữ tốc độ cao
                                    }
                                }
                            }
                        }
                    }
                } catch (eGuildPatrol) { }

                // ==========================================
                // KÊNH 3: LỌC SIÊU TỐC HÀNG XÓM BỐC LỬA (_de_res === 1)
                // Bỏ qua 0ms mọi nhà _de_res === 0 (nhà yên bình, không có cướp)
                // ==========================================
                // Cơ chế Hạ Lực Chiến Dò Nhà (Facebook Trick):
                // Nếu liên tục quét không gặp nhà bốc lửa, định kỳ mỗi 6 lần làm mới sẽ chuyển sang combo hạ LC
                // để hệ thống ghép cặp tìm nhà quanh mốc LC mới!
                if (!bot.isBattling() && !bot.isAutoStageOn()) {
                    if (bot.state.scoutStepCounter === undefined) bot.state.scoutStepCounter = 0;
                    bot.state.scoutStepCounter++;
                    if ((!bot.state.isScoutLowPowerActive || bot.state.scoutStepCounter % 6 === 0) && typeof bot.applyLowPowerScoutArray === "function") {
                        const nextComboIdx = (typeof bot.chooseNextScoutCombo === "function")
                            ? bot.chooseNextScoutCombo()
                            : (typeof bot.pickNextScoutComboIdx === "function" ? bot.pickNextScoutComboIdx() : 0);
                        if (nextComboIdx !== null && nextComboIdx !== undefined) {
                            await bot.applyLowPowerScoutArray(nextComboIdx);
                        }
                    }
                }

                if (typeof bot.hookBattleController === "function") {
                    bot.hookBattleController();
                }

                const hostList = await waitRefreshHostList(true, 180);
                if (Array.isArray(hostList) && hostList.length > 0) {
                    if (bot.state.spotCheckCounter === undefined) bot.state.spotCheckCounter = 0;
                    bot.state.spotCheckCounter++;
                    const allowSpotCheck = (bot.state.spotCheckCounter % 25 === 0);

                    for (let hIdx = 0; hIdx < hostList.length; hIdx++) {
                        const house = hostList[hIdx];
                        if (!house) continue;
                        bot.state.totalRescueScanned++;
                        const targetRid = getHouseRid(house);
                        if (!targetRid || targetRid === myRid) continue;

                        const skipUntil = bot.state.skipRescueHouseUntil[targetRid] || 0;
                        if (Date.now() < skipUntil) continue;

                        const deRes = Number(house._de_res !== undefined ? house._de_res : 0);
                        const houseName = getHouseName(house, targetRid);

                        // ƯU TIÊN TUYỆT ĐỐI 1: Nhà bốc lửa (_de_res === 1 hoặc _de_res === 2) -> SOI & TRẢM CƯỚP NGAY (+50 KNB)
                        if (deRes === 1 || deRes === 2) {
                            const sourceTag = (deRes === 1) ? "Hàng Xóm Bốc Lửa" : "Hàng Xóm Bị Chiếm Đóng";
                            bot.log(`🔥 [Farm KNB] Phát hiện gia viên [${houseName}] đang bốc lửa (_de_res = ${deRes})! Đang giải cứu ngay...`);
                            const handled = await inspectAndRescueTarget(targetRid, houseName, sourceTag);
                            if (handled) return didSomething;
                        } 
                        // ƯU TIÊN 2: Kiểm tra chéo (Spot-Check) mỗi 25 lượt làm mới để tránh sai sót
                        else if (allowSpotCheck && hIdx === 0) {
                            const handled = await inspectAndRescueTarget(targetRid, houseName, "Spot-Check An Toàn");
                            if (handled) return didSomething;
                        } else {
                            // Nhà yên bình (_de_res === 0) -> Bỏ qua 0ms, không tốn packet 10552, tăng tốc độ làm mới gấp 20 lần!
                            bot.state.skipRescueHouseUntil[targetRid] = Date.now() + 20000;
                        }
                    }
                }

                if (bot.canDo("rescue_scan_status_log", 15)) {
                    bot.markDone("rescue_scan_status_log");
                    bot.log(`🌾 [Farm KNB] Đã rà soát ${bot.state.totalRescueScanned.toLocaleString()} gia viên • Đã giải cứu: ${bot.state.rescuedCount || 0} lượt (+${(bot.state.rescuedKnbTotal || 0).toLocaleString()} KNB). Đang rà soát tiếp...`);
                }

            } catch (e) {
                bot.log("Lỗi Farm KNB Gia Viên: " + (e.stack || e.toString()));
            } finally {
                bot.state.rescueChecking = false;
                bot.state.rescueFightActive = false;
                bot.state.battleInProgress = false;
            }
            return didSomething;
        },

        runAutoDispatchSmart: async function () {
            if (typeof G_Mapping === "undefined" || !G_Mapping.RPCReq) return false;
            if (bot.state.exploreCoolDownUntil && Date.now() < bot.state.exploreCoolDownUntil) return false;

            const mm = window.ModelManager;
            if (!mm || !mm.ExploreModel) return false;

            const expModel = mm.ExploreModel;

            // CONDITION-DRIVEN & SAFETY BUFFER: Lọc các nhiệm vụ thực sự hoàn thành (đệm 3s so với ServerTime để chắc chắn server đã xong)
            const serverTime = (mm.ServerTimeModel && mm.ServerTimeModel.getServerTime) ? mm.ServerTimeModel.getServerTime() : Math.floor(Date.now() / 1000);
            const validCompletedRewards = [];
            if (expModel._exploreEventObj) {
                for (let k in expModel._exploreEventObj) {
                    const e = expModel._exploreEventObj[k];
                    if (e && e._end_time && e._heros && e._heros.length > 0 && (e._end_time + 3) <= serverTime) {
                        validCompletedRewards.push({ _val: +k });
                    }
                }
            }

            const hasTaskRed = validCompletedRewards.length > 0;
            const hasWeekRed = bot.hasRed("V_ExploreWeek");
            let hasEmpty = false;
            let hasReward = hasTaskRed;
            if (expModel._exploreEventObj) {
                for (let k in expModel._exploreEventObj) {
                    const e = expModel._exploreEventObj[k];
                    if (e && (!e._heros || e._heros.length === 0)) {
                        hasEmpty = true;
                        break;
                    }
                }
            }
            if (!hasReward && !hasWeekRed && !hasEmpty) return false;

            let didSomething = false;

            try {
                // 1. Nhận thưởng toàn bộ nhiệm vụ đã hoàn thành (với đệm an toàn 3s)
                if (validCompletedRewards.length > 0 && bot.canDo("explore_reward_claim", 15)) {
                    bot.markDone("explore_reward_claim");
                    bot.log(`🗺️ Phái Tướng: Có ${validCompletedRewards.length} nhiệm vụ hoàn thành -> Nhận toàn bộ!`);
                    expModel.reqExploreReward(validCompletedRewards);
                    // Cập nhật ngay trên client để không lặp lại khi server chưa kịp phản hồi
                    validCompletedRewards.forEach(r => {
                        const rId = (r && r._val !== undefined) ? r._val : r;
                        if (expModel._exploreEventObj && expModel._exploreEventObj[rId]) {
                            expModel._exploreEventObj[rId]._heros = [];
                            expModel._exploreEventObj[rId]._end_time = 0;
                        }
                    });
                    didSomething = true;
                    // Đợi 2.5s để server cập nhật và giải phóng tướng an toàn
                    await bot.sleep(2500);
                }

                // 2. Nhận thưởng mốc tuần nếu có chấm đỏ V_ExploreWeek
                if (bot.hasRed("V_ExploreWeek") && expModel.reqExploreWeekReward) {
                    const cfg = window.G_Mapping && window.G_Mapping.ExploreConfiger;
                    const weekIds = ((cfg && cfg.getExploreRewardIds) ? cfg.getExploreRewardIds() : null) || [];
                    const curTimes = expModel.getWeekTimes ? expModel.getWeekTimes() : 0;
                    for (let wIdx = 0; wIdx < weekIds.length; wIdx++) {
                        const wId = weekIds[wIdx];
                        const rCfg = cfg.getExploreRewardCfgById ? cfg.getExploreRewardCfgById(+wId) : null;
                        if (rCfg && curTimes >= rCfg.time && !expModel.getWeekRewardState(+wId)) {
                            expModel.reqExploreWeekReward(+wId);
                            bot.log(`🗺️ Phái Tướng: Đã nhận thưởng tuần mốc [${rCfg.time} lần]!`);
                            didSomething = true;
                            await bot.sleep(400);
                        }
                    }
                }

                // 3. Tự dùng lượt làm mới miễn phí khi có ô trống
                if (expModel.getFreeCount && expModel.getFreeCount() > 0 && bot.canDo("explore_free_refresh", 60)) {
                    let hasEmptySlot = false;
                    if (expModel._exploreEventObj) {
                        for (let k in expModel._exploreEventObj) {
                            const e = expModel._exploreEventObj[k];
                            if (e && (!e._heros || e._heros.length === 0)) {
                                hasEmptySlot = true;
                                break;
                            }
                        }
                    }
                    if (hasEmptySlot) {
                        bot.markDone("explore_free_refresh");
                        bot.log("🗺️ Phái Tướng: Có lượt làm mới miễn phí -> Làm mới danh sách!");
                        expModel.reqExploreRefresh();
                        didSomething = true;
                        await bot.sleep(800);
                    }
                }

                // 4. Tự động phái tướng vào các ô đang trống theo THỨ TỰ ƯU TIÊN PHẦN THƯỞNG:
                // Thang điểm ưu tiên: Mảnh thẻ tướng (1000+) > Kim Cương / KC (800+) > Xẻng đào bảo (600+) > Phẩm chất cao (400+) > Khác
                if (expModel._exploreEventObj && (!bot.state.exploreCoolDownUntil || Date.now() >= bot.state.exploreCoolDownUntil)) {
                    const idleEvents = [];
                    const expCfg = (window.G_Mapping && window.G_Mapping.ExploreConfiger) || window.ExploreConfiger;

                    for (let evKey in expModel._exploreEventObj) {
                        const ev = expModel._exploreEventObj[evKey];
                        const isIdle = ev && (!ev._heros || ev._heros.length === 0);
                        if (!isIdle) continue;

                        const eventId = ev._event_id || ev._id;
                        const cfg = (expCfg && expCfg.getExploreEventCfgById) ? expCfg.getExploreEventCfgById(eventId) : null;
                        const color = cfg ? (cfg.color || 1) : 1;

                        let priorityScore = 100 + color;
                        let priorityTag = "Thường";
                        let targetItemName = "";

                        if (cfg && cfg.reward && cfg.reward[0]) {
                            const itemCode = cfg.reward[0][0];
                            const itemCount = cfg.reward[0][1] || 1;

                            let itemName = "";
                            if (window.G_Mapping && window.G_Mapping.ItemConfiger && window.G_Mapping.ItemConfiger.getItemNameByCode) {
                                itemName = window.G_Mapping.ItemConfiger.getItemNameByCode(itemCode) || "";
                            }

                            // Kiểm tra nhóm vật phẩm từ game engine
                            let isShard = false;
                            try {
                                if (window.G_Mapping && window.G_Mapping.ItemData) {
                                    const itData = new window.G_Mapping.ItemData();
                                    itData.setDataByItemCodeAndItemCount(itemCode, itemCount);
                                    if (itData.isHeroShard && itData.isHeroShard()) isShard = true;
                                    if (itData.isHeroCardOrHeroShard && itData.isHeroCardOrHeroShard()) isShard = true;
                                }
                            } catch (itErr) { }

                            const lowName = itemName.toLowerCase();
                            if (isShard || lowName.includes("mảnh") || lowName.includes("tướng") || lowName.includes("hồn")) {
                                priorityScore = 1000 + (color * 100) + itemCount;
                                priorityTag = "Mảnh Tướng";
                                targetItemName = itemName || `Mảnh tướng #${itemCode}`;
                            } else if (itemCode === 2 || itemCode === 102 || lowName.includes("kim cương") || lowName.includes("nguyên bảo") || lowName.includes("kc")) {
                                priorityScore = 800 + Math.min(itemCount, 150);
                                priorityTag = "Kim Cương";
                                targetItemName = itemName || `${itemCount} KC`;
                            } else if (itemCode === 1001 || itemCode === 1002 || itemCode === 1003 || lowName.includes("xẻng") || lowName.includes("xeng") || lowName.includes("đào bảo")) {
                                priorityScore = 600 + Math.min(itemCount * 10, 150);
                                priorityTag = "Xẻng Đào Bảo";
                                targetItemName = itemName || `Xẻng #${itemCode}`;
                            } else if (color >= 4) {
                                priorityScore = 400 + (color * 10) + itemCount;
                                priorityTag = `Phẩm Hiếm (Cấp ${color})`;
                                targetItemName = itemName || `Vật phẩm #${itemCode}`;
                            } else {
                                targetItemName = itemName || `Vật phẩm #${itemCode}`;
                            }
                        }

                        idleEvents.push({
                            ev: ev,
                            score: priorityScore,
                            tag: priorityTag,
                            itemName: targetItemName,
                            color: color
                        });
                    }

                    // Sắp xếp các ô trống theo điểm ưu tiên giảm dần
                    idleEvents.sort((a, b) => b.score - a.score);

                    let dispatchedCount = 0;
                    for (let entry of idleEvents) {
                        if (dispatchedCount >= 4) break;
                        const ev = entry.ev;
                        if (expModel.onekeySelect && expModel.onekeySelect(ev._id)) {
                            if (expModel.checkConditionState) expModel.checkConditionState();
                            const heros = expModel.getStartHeros ? expModel.getStartHeros() : [];
                            if (heros && heros.length > 0) {
                                expModel.isRefresh = false;
                                expModel.reqExploreStart(ev._id, heros);
                                // Đánh dấu tạm thời _heros và gán _end_time ở tương lai (7200s = 2h)
                                ev._heros = heros.map(h => ({ _val: h }));
                                ev._end_time = Math.floor(Date.now() / 1000) + 7200;
                                bot.log(`🗺️ Phái Tướng: Ưu tiên [${entry.tag}] - Thưởng: ${entry.itemName} (Điểm: ${entry.score})`);
                                dispatchedCount++;
                                didSomething = true;
                                await bot.sleep(1200);
                            }
                        }
                    }
                    if (dispatchedCount > 0) {
                        bot.log(`🗺️ Phái Tướng: Đã tự động phái ${dispatchedCount} nhiệm vụ theo thứ tự ưu tiên thành công!`);
                    }
                }
            } catch (e) {
                bot.log("Lỗi phái tướng: " + e.toString());
            }
            return didSomething;
        },

        // ====================================================================
        // TÍNH NĂNG 7.5: TỰ ĐỘNG TÁCH / BÁN MẢNH TƯỚNG (CAM TRỞ XUỐNG: CAM, TÍM, LAM, LỤC, XÁM)
        // BẢO ĐẢM AN TOÀN TUYỆT ĐỐI: KHÔNG BAO GIỜ CHẠM ĐỎ (6), HỒNG (7), KIM (8)
        // ====================================================================
        runAutoHeroFragmentDecompose: async function () {
            if (bot.settings.auto_recycle_fragments === false) return false;
            const gm = window.G_Mapping || (typeof G_Mapping !== "undefined" ? G_Mapping : null);
            const mm = window.ModelManager;
            const bm = (mm && mm.BagModel) || (gm && gm.BagModel);
            if (!bm) return false;

            let didSomething = false;
            try {
                const packsToCheck = [];
                if (typeof bm.getSplitPack === "function") {
                    try { packsToCheck.push(bm.getSplitPack()); } catch (e) { }
                }
                if (typeof bm.getNormalPack === "function") {
                    try { packsToCheck.push(bm.getNormalPack()); } catch (e) { }
                }
                if (bm.__allPacks) {
                    for (let k in bm.__allPacks) {
                        const p = bm.__allPacks[k];
                        if (p && !packsToCheck.includes(p)) packsToCheck.push(p);
                    }
                }

                const eligibleShards = [];
                for (let pack of packsToCheck) {
                    if (!pack) continue;
                    if (typeof pack.getItemDatasByFunc === "function") {
                        try {
                            const found = pack.getItemDatasByFunc(function (item) {
                                if (!item) return false;
                                const isShard = typeof item.isHeroShard === "function" ? item.isHeroShard() : false;
                                if (!isShard) return false;
                                const color = typeof item.getColor === "function" ? item.getColor() : 0;
                                // ====================================================================
                                // NGUYÊN TẮC AN TOÀN TỐI THƯỢNG:
                                // Chỉ phân giải phẩm chất <= 5 (Cam=5, Tím=4, Lam=3, Lục=2, Trắng/Xám=1)
                                // TUYỆT ĐỐI KHÔNG BAO GIỜ PHÂN GIẢI ĐỎ (6), HỒNG (7), KIM (8)
                                // ====================================================================
                                if (color > 5 || color <= 0) return false;
                                const count = typeof item.getItemCount === "function" ? item.getItemCount() : (item._count || 0);
                                if (count <= 0) return false;
                                const canSell = typeof item.getSellBtnShow === "function" ? item.getSellBtnShow() : true;
                                return canSell;
                            });
                            if (Array.isArray(found)) {
                                for (let it of found) {
                                    const itId = typeof it.getId === "function" ? it.getId() : it._id;
                                    if (itId && !eligibleShards.some(x => (typeof x.getId === "function" ? x.getId() : x._id) === itId)) {
                                        eligibleShards.push(it);
                                    }
                                }
                            }
                        } catch (ePack) { }
                    }
                }

                if (eligibleShards.length === 0) return false;

                const batchSize = 15;
                for (let i = 0; i < eligibleShards.length; i += batchSize) {
                    const batch = eligibleShards.slice(i, i + batchSize);
                    const itemsPayload = batch.map(it => {
                        const itId = typeof it.getId === "function" ? it.getId() : it._id;
                        const itCount = typeof it.getItemCount === "function" ? it.getItemCount() : (it._count || 0);
                        const itName = (typeof it.getName === "function" ? it.getName() : null) || (it.itemInfo && it.itemInfo.name) || it._name || "Mảnh Tướng";
                        const itColor = typeof it.getColor === "function" ? it.getColor() : 0;
                        return { id: itId, count: itCount, name: itName, color: itColor };
                    }).filter(it => it.id && it.count > 0 && it.color <= 5);

                    if (itemsPayload.length === 0) continue;

                    if (typeof bm.reqSellItems === "function") {
                        try {
                            bm.reqSellItems(batch);
                        } catch (eSell) {
                            if (gm && gm.RPCReq && gm.ItemSellCs) {
                                gm.RPCReq.send(gm.ItemSellCs.protocol, {
                                    _p_use_item: itemsPayload.map(x => ({ _id: x.id, _count: x.count }))
                                });
                            }
                        }
                    } else if (gm && gm.RPCReq && gm.ItemSellCs) {
                        gm.RPCReq.send(gm.ItemSellCs.protocol, {
                            _p_use_item: itemsPayload.map(x => ({ _id: x.id, _count: x.count }))
                        });
                    }

                    const namesSummary = itemsPayload.map(x => `${x.name} x${x.count}`).slice(0, 4).join(", ");
                    const more = itemsPayload.length > 4 ? ` và ${itemsPayload.length - 4} loại khác` : "";
                    bot.log(`🧩 [Tách Mảnh] Tự động tách ${itemsPayload.length} loại mảnh (Cam trở xuống): [${namesSummary}${more}] thành công (+Bụi/Hồn Tướng)!`);
                    didSomething = true;
                    await bot.sleep(1200);
                }
            } catch (err) {
                bot.log("Lỗi tự động tách mảnh tướng: " + err.toString());
            }
            return didSomething;
        },

        // ====================================================================
        // TÍNH NĂNG 8: BÁI KIẾN TOÀN BỘ 7 BXH & NHẬN QUÀ MỐC VINH DANH SERVER
        // ====================================================================
        runAutoRankSmart: async function (forceAll) {
            const gm = window.G_Mapping || (typeof G_Mapping !== "undefined" ? G_Mapping : null);
            if (!gm || !gm.RPCReq) return false;
            bot.state.suppressRankRewardUntil = Date.now() + 4500;
            const mm = window.ModelManager;
            const rnm = (mm && mm.RankNewModel) || (gm && gm.RankNewModel);
            if (!rnm) return false;

            let didSomething = false;
            try {
                // Hook Reactive: Bái kiến ngay lập tức khi máy chủ phản hồi RankInfoSc cho bất kỳ BXH nào
                try {
                    let rnmMod = null;
                    if (typeof window.__require === "function") {
                        try { rnmMod = window.__require("RankNewModel"); } catch (e) { }
                    }
                    const RankNewModelClass = (rnmMod && (rnmMod.RankNewModel || rnmMod.default || rnmMod)) || (gm && gm.RankNewModel) || (rnm && rnm.constructor);
                    const rnmProto = (RankNewModelClass && RankNewModelClass.prototype) || (rnm && Object.getPrototypeOf(rnm));
                    if (rnmProto && !rnmProto.__QA_AUTO_RANK_LIKE_HOOKED__) {
                        rnmProto.__QA_AUTO_RANK_LIKE_HOOKED__ = true;
                        const origUpdateRankInfo = rnmProto.updateRankInfo;
                        rnmProto.updateRankInfo = function (info) {
                            const res = origUpdateRankInfo ? origUpdateRankInfo.apply(this, arguments) : null;
                            try {
                                if (info && info._type && [1001, 3001, 5001, 5002, 5003, 5004, 5005].includes(info._type)) {
                                    const top1 = info._self && info._self[0];
                                    const rid = top1 && top1._role_show && (top1._role_show._rid || top1._role_show.rid);
                                    const validRid = Number(rid);
                                    if (validRid > 1) {
                                        const canLike = typeof this.checkCanLikeByPPRank === "function" ? this.checkCanLikeByPPRank({ _role_show: { _rid: validRid } }, info._type) : true;
                                        if (canLike) {
                                            if (typeof this.reqRankLike === "function") {
                                                this.reqRankLike(info._type, validRid);
                                            }
                                            if (!this._rankLikeData) this._rankLikeData = {};
                                            if (!this._rankLikeData[info._type]) this._rankLikeData[info._type] = [];
                                            this._rankLikeData[info._type].push({ _val: validRid });
                                            const rankNames = { 1001: "Lực Chiến", 3001: "Leo Tháp", 5001: "Thần Tộc", 5002: "Ma Tộc", 5004: "Ngụy Quốc", 5003: "Thục Quốc", 5005: "Ngô Quốc" };
                                            const rName = rankNames[info._type] || info._type;
                                            const top1Name = (top1._role_show && top1._role_show._name) || "Top 1";
                                            bot.log(`👑 [BXH ${rName}] Nhận dữ liệu server -> Tự động bái kiến Top 1 [${top1Name}] thành công (+KNB/Vàng)!`);
                                        }
                                    }
                                }
                            } catch (eAutoLike) { }
                            return res;
                        };
                    }
                } catch (eHk) { }

                // 1. Đồng bộ lại trạng thái chấm đỏ quà mốc BXH từ model game
                if (typeof rnm.checkMileStoneRedPoint === "function") {
                    try { rnm.checkMileStoneRedPoint(); } catch (eSync) { }
                }

                const rdr = (gm && gm.e_RankDataRank) || window.e_RankDataRank || {};
                const rankTypes = [
                    { type: (rdr.Fc && typeof rdr.Fc === "number") ? rdr.Fc : 1001, name: "Lực Chiến", red: "V_RankPower" },
                    { type: (rdr.Tower && typeof rdr.Tower === "number") ? rdr.Tower : 3001, name: "Leo Tháp", red: "V_RankTower" },
                    { type: (rdr.Hero1 && typeof rdr.Hero1 === "number") ? rdr.Hero1 : 5001, name: "Thần Tộc", red: "V_RankGodPower" },
                    { type: (rdr.Hero2 && typeof rdr.Hero2 === "number") ? rdr.Hero2 : 5002, name: "Ma Tộc", red: "V_RankDemonPower" },
                    { type: (rdr.Hero4 && typeof rdr.Hero4 === "number") ? rdr.Hero4 : 5004, name: "Ngụy Quốc", red: "V_RankWeiPower" },
                    { type: (rdr.Hero3 && typeof rdr.Hero3 === "number") ? rdr.Hero3 : 5003, name: "Thục Quốc", red: "V_RankShuPower" },
                    { type: (rdr.Hero5 && typeof rdr.Hero5 === "number") ? rdr.Hero5 : 5005, name: "Ngô Quốc", red: "V_RankWuPower" },
                    { type: (rdr.MineGuide && typeof rdr.MineGuide === "number") ? rdr.MineGuide : 5302, name: "Chiếm Mỏ", red: "V_GuildMineRank" }
                ];

                // Helper: Kiểm tra chấm đỏ qua cả RedManager lẫn dữ liệu RankNewModel
                const hasMilestoneRed = function (r) {
                    if (bot.hasRed(r.red)) return true;
                    try {
                        if (rnm.bestPushMileStoneId && rnm.alreadyReceiveIds) {
                            const bestId = rnm.bestPushMileStoneId[r.type] || 0;
                            const rc = gm.RankConfiger || window.RankConfiger;
                            if (rc && rc.getMilestoneByType) {
                                const mList = rc.getMilestoneByType(r.type) || [];
                                for (let i = 0; i < mList.length; i++) {
                                    const m = mList[i];
                                    if (m && bestId >= m.id && !rnm.alreadyReceiveIds.includes(m.id)) {
                                        return true;
                                    }
                                }
                            }
                        }
                    } catch (eCheck) { }
                    return false;
                };

                // Helper: Kiểm tra một bảng xếp hạng đã hoàn tất bái kiến hôm nay chưa
                const isRankLiked = function (rType) {
                    const lData = rnm.getRankLikeDataByType ? rnm.getRankLikeDataByType(rType) : (rnm._rankLikeData && rnm._rankLikeData[rType]);
                    const rc = gm.RankConfiger || window.RankConfiger;
                    const cfg = rc && rc.getRankLikeDataByType ? rc.getRankLikeDataByType(rType) : null;
                    const maxTimes = (cfg && cfg.times) || 1;
                    return lData && Array.isArray(lData) && lData.length >= maxTimes;
                };

                const todayStr = new Date().toDateString();
                const localLikedDate = (typeof window !== "undefined" && window.localStorage && window.localStorage.getItem("3qdao_rank_liked_date")) || null;
                let canLikeToday = forceAll || ((bot.state.rankLikedDate !== todayStr && localLikedDate !== todayStr) && bot.canDo("rank_like_all", 30));

                // -------------------------------------------------------------
                // PHẦN 1: BÁI KIẾN 7 BXH TOP 1 SERVER (Lực Chiến, Tháp, 5 Tộc)
                // -------------------------------------------------------------
                if (canLikeToday) {
                    const missingBoards = [];

                    // Pass 1: Quét toàn bộ 7 BXH, bái ngay nếu đã có dữ liệu hoặc gửi reqRank nếu thiếu
                    for (let r of rankTypes) {
                        try {
                            if (isRankLiked(r.type)) continue;

                            let top1Rid = 0;
                            let top1Name = "";

                            // Thử lấy qua các getter Top 1 của RankNewModel
                            try {
                                let firstObj = null;
                                if ((r.type === 1001 || r.type === 1) && rnm.getPowerFirst) firstObj = rnm.getPowerFirst();
                                else if ((r.type === 3001 || r.type === 2) && rnm.getTowerFirst) firstObj = rnm.getTowerFirst();
                                else if ((r.type === 5001 || r.type === 3) && rnm.getGodPowerFirst) firstObj = rnm.getGodPowerFirst();
                                else if ((r.type === 5002 || r.type === 4) && rnm.getDemonPowerFirst) firstObj = rnm.getDemonPowerFirst();
                                else if ((r.type === 5004 || r.type === 5) && rnm.getWeiPowerFirst) firstObj = rnm.getWeiPowerFirst();
                                else if ((r.type === 5003 || r.type === 6) && rnm.getShuPowerFirst) firstObj = rnm.getShuPowerFirst();
                                else if ((r.type === 5005 || r.type === 7) && rnm.getWuPowerFirst) firstObj = rnm.getWuPowerFirst();

                                if (firstObj) {
                                    const role = firstObj.getRoleInfo ? firstObj.getRoleInfo() : (firstObj._role_show || (firstObj.rankData && firstObj.rankData._role_show) || firstObj.roleShow || firstObj);
                                    top1Rid = role && (role.getRoleId ? role.getRoleId() : (role._rid || role.rid || role._role_id));
                                    top1Name = role && (role.getName ? role.getName() : (role._name || "Top 1"));
                                }
                            } catch (eFirst) { }

                            // Nếu getter chưa có, tìm trong rankInfo._self
                            if (!top1Rid || Number(top1Rid) <= 1) {
                                const info = (rnm.getRankInfoByRankId ? rnm.getRankInfoByRankId(r.type) : null) || (rnm.rankInfo && rnm.rankInfo[r.type]);
                                if (info && info._self && Array.isArray(info._self)) {
                                    for (let s = 0; s < info._self.length; s++) {
                                        const it = info._self[s];
                                        if (it && it._rank === 1 && it._role_show) {
                                            top1Rid = it._role_show._rid || it._role_show.rid || it._role_show._role_id;
                                            top1Name = it._role_show._name || "Top 1";
                                            break;
                                        }
                                    }
                                    if ((!top1Rid || Number(top1Rid) <= 1) && info._self[0] && info._self[0]._role_show) {
                                        top1Rid = info._self[0]._role_show._rid || info._self[0]._role_show.rid;
                                        top1Name = info._self[0]._role_show._name || "Top 1";
                                    }
                                }
                            }

                            const validRid = Number(top1Rid);
                            if (validRid > 1) {
                                const canLikeThis = typeof rnm.checkCanLikeByPPRank === "function" ? rnm.checkCanLikeByPPRank({ _role_show: { _rid: validRid } }, r.type) : true;
                                if (canLikeThis) {
                                    if (typeof rnm.reqRankLike === "function") {
                                        rnm.reqRankLike(r.type, validRid);
                                    } else if (gm.RankLikeCs) {
                                        gm.RPCReq.send(gm.RankLikeCs.protocol, { _k: r.type, _v: validRid });
                                    }
                                    if (!rnm._rankLikeData) rnm._rankLikeData = {};
                                    if (!rnm._rankLikeData[r.type]) rnm._rankLikeData[r.type] = [];
                                    rnm._rankLikeData[r.type].push({ _val: validRid });

                                    bot.log(`👑 [BXH ${r.name}] Bái kiến Top 1 [${top1Name || validRid}] thành công (+KNB/Vàng)!`);
                                    didSomething = true;
                                    await bot.sleep(1500);
                                }
                            } else {
                                missingBoards.push(r);
                                if (typeof rnm.reqRank === "function" && bot.tryDo("rank_req_" + r.type, 20)) {
                                    rnm.reqRank(r.type);
                                }
                            }
                        } catch (eRank) { }
                    }

                    // Pass 2: Nếu có bảng thiếu dữ liệu, chờ máy chủ phản hồi rồi quét lại lần nữa
                    if (missingBoards.length > 0) {
                        await bot.sleep(1200);
                        for (let r of missingBoards) {
                            try {
                                if (isRankLiked(r.type)) continue;

                                let top1Rid = 0;
                                let top1Name = "";
                                const info = (rnm.getRankInfoByRankId ? rnm.getRankInfoByRankId(r.type) : null) || (rnm.rankInfo && rnm.rankInfo[r.type]);
                                if (info && info._self && Array.isArray(info._self)) {
                                    for (let s = 0; s < info._self.length; s++) {
                                        const it = info._self[s];
                                        if (it && it._rank === 1 && it._role_show) {
                                            top1Rid = it._role_show._rid || it._role_show.rid || it._role_show._role_id;
                                            top1Name = it._role_show._name || "Top 1";
                                            break;
                                        }
                                    }
                                    if ((!top1Rid || Number(top1Rid) <= 1) && info._self[0] && info._self[0]._role_show) {
                                        top1Rid = info._self[0]._role_show._rid || info._self[0]._role_show.rid;
                                        top1Name = info._self[0]._role_show._name || "Top 1";
                                    }
                                }

                                const validRid = Number(top1Rid);
                                if (validRid > 1) {
                                    const canLikeThis = typeof rnm.checkCanLikeByPPRank === "function" ? rnm.checkCanLikeByPPRank({ _role_show: { _rid: validRid } }, r.type) : true;
                                    if (canLikeThis) {
                                        if (typeof rnm.reqRankLike === "function") {
                                            rnm.reqRankLike(r.type, validRid);
                                        } else if (gm.RankLikeCs) {
                                            gm.RPCReq.send(gm.RankLikeCs.protocol, { _k: r.type, _v: validRid });
                                        }
                                        if (!rnm._rankLikeData) rnm._rankLikeData = {};
                                        if (!rnm._rankLikeData[r.type]) rnm._rankLikeData[r.type] = [];
                                        rnm._rankLikeData[r.type].push({ _val: validRid });

                                        bot.log(`👑 [BXH ${r.name}] Bái kiến Top 1 [${top1Name || validRid}] (Pass 2) thành công (+KNB/Vàng)!`);
                                        didSomething = true;
                                        await bot.sleep(1500);
                                    }
                                }
                            } catch (eP2) { }
                        }
                    }

                    // CHỈ GHI NHẬN HOÀN TẤT TRONG NGÀY KHI TOÀN BỘ 7 BXH ĐÃ ĐƯỢC BÁI KIẾN ĐỦ LƯỢT
                    const allDone = rankTypes.every(r => isRankLiked(r.type));
                    if (allDone) {
                        bot.state.rankLikedDate = todayStr;
                        if (typeof window !== "undefined" && window.localStorage) {
                            window.localStorage.setItem("3qdao_rank_liked_date", todayStr);
                        }
                        bot.markDone("rank_like_all");
                        bot.log("👑 [BXH] Hoàn tất bái kiến toàn bộ 7 BXH server trong ngày!");
                    }
                }

                // -------------------------------------------------------------
                // PHẦN 2: BÁI KIẾN 3Q TRANH HÙNG / THIÊN THÊ LIÊN SERVER (CrossLadder)
                // -------------------------------------------------------------
                try {
                    const clm = (mm && mm.CrossLadderModel) || (gm && gm.CrossLadderModel);
                    const needLadder = bot.hasRed("V_CrossLadderWorship_Day") || forceAll;
                    if (clm && needLadder) {
                        if (typeof clm.reqMainData === "function" && !clm._like_list && bot.canDo("ladder_req_main", 60)) {
                            clm.reqMainData();
                        }
                        const likedList = clm._like_list || [];
                        for (let nth = 1; nth <= 3; nth++) {
                            if (!likedList.includes(nth)) {
                                if (typeof clm.reqLike === "function") {
                                    if (typeof clm.setTodayShow === "function") clm.setTodayShow();
                                    clm.reqLike(nth);
                                    bot.log(`👑 [3Q Tranh Hùng / Thiên Thê] Bái kiến Top ${nth} liên server thành công (+Thưởng)!`);
                                    likedList.push(nth);
                                    didSomething = true;
                                    await bot.sleep(1500);
                                }
                            }
                        }
                    }
                } catch (eLadder) { }

                // -------------------------------------------------------------
                // PHẦN 3: BÁI KIẾN ĐẤU TRƯỜNG ĐỈNH PHONG LIÊN SERVER (CrossArena)
                // -------------------------------------------------------------
                try {
                    const cam = (mm && mm.CrossArenaModel) || (gm && gm.CrossArenaModel);
                    const needArena = bot.hasRed("V_CrossArena_Worship") || forceAll;
                    if (cam && needArena) {
                        bot.log("👑 [Đấu Trường Liên Server] Bái kiến Top 1 Đấu Trường (+Thưởng)...");
                        if (typeof cam.ReqLike === "function") {
                            cam.ReqLike(1, false);
                        } else if (cam.reqLike) {
                            cam.reqLike(1, false);
                        }
                        if (typeof cam.RecordWorship === "function") {
                            cam.RecordWorship();
                        }
                        didSomething = true;
                        await bot.sleep(1500);
                    }
                } catch (eCa) { }

                // -------------------------------------------------------------
                // PHẦN 4: NHẬN QUÀ MỐC VINH DANH BXH SERVER (Milestone Rewards)
                // -------------------------------------------------------------
                bot.state.rankMileAttempts = bot.state.rankMileAttempts || {};
                bot.state.claimedRankMilestones = bot.state.claimedRankMilestones || new Set();
                if (forceAll || !bot.state.rankMileCooldown || Date.now() >= bot.state.rankMileCooldown) {
                    for (let r of rankTypes) {
                        const mKey = "rank_mile_" + r.type;
                        const isRed = hasMilestoneRed(r);
                        if (isRed || forceAll) {
                            const curAttempts = bot.state.rankMileAttempts[r.type] || 0;
                            if (curAttempts >= 3 && !forceAll) {
                                if (bot.canDo(mKey, 1800)) {
                                    bot.markDone(mKey);
                                    bot.log(`⚠️ [BXH] Đã thử nhận mốc [${r.name}] ${curAttempts} lần -> Tạm hoãn 30 phút để tránh spam.`);
                                }
                                continue;
                            }

                            if (bot.canDo(mKey, 30) || forceAll) {
                                bot.markDone(mKey);
                                bot.state.rankMileAttempts[r.type] = curAttempts + 1;
                                if (typeof rnm.requestRankMilestone === "function") {
                                    try { rnm.requestRankMilestone(r.type); } catch (eReq) { }
                                }
                                // Quét nhận các id mốc cụ thể hợp lệ (> 0) khi dữ liệu alreadyReceiveIds đã đồng bộ
                                try {
                                    const rc = gm.RankConfiger || window.RankConfiger;
                                    if (rc && rc.getMilestoneByType && rnm.bestPushMileStoneId && Array.isArray(rnm.alreadyReceiveIds)) {
                                        const bestId = rnm.bestPushMileStoneId[r.type] || 0;
                                        const mList = rc.getMilestoneByType(r.type) || [];
                                        const recIds = rnm.alreadyReceiveIds;
                                        for (let mItem of mList) {
                                            const claimKey = r.type + "_" + (mItem && mItem.id);
                                            if (mItem && mItem.id > 0 && bestId >= mItem.id && !recIds.includes(mItem.id) && !bot.state.claimedRankMilestones.has(claimKey)) {
                                                bot.state.claimedRankMilestones.add(claimKey);
                                                bot.state.suppressRankRewardUntil = Date.now() + 3500;
                                                gm.RPCReq.send(gm.RankMileGainCs.protocol, { _type: r.type, _id: mItem.id });
                                                recIds.push(mItem.id);
                                                bot.log(`👑 [BXH] Nhận Quà Vinh Danh Toàn Server [${r.name}] (Mốc ${mItem.id}) thành công!`);
                                                didSomething = true;
                                                await bot.sleep(600);
                                            }
                                        }
                                    }
                                } catch (eM) { }
                            }
                        } else {
                            if (bot.state.rankMileAttempts[r.type]) {
                                bot.state.rankMileAttempts[r.type] = 0;
                            }
                        }
                    }
                }

                // -------------------------------------------------------------
                // PHẦN 5: NHẬN QUÀ XẾP HẠNG KỲ TRƯỚC (Rank Last Rank Rewards)
                // -------------------------------------------------------------
                try {
                    for (let r of rankTypes) {
                        if (typeof rnm.requestRankLastRankRewards === "function") {
                            if (typeof rnm.hasLastRankReward === "function" && rnm.hasLastRankReward(r.type)) {
                                bot.state.suppressRankRewardUntil = Date.now() + 3500;
                                rnm.requestRankLastRankRewards(r.type, 1);
                                bot.log(`👑 [BXH] Nhận thưởng tổng kết kỳ trước BXH [${r.name}] thành công!`);
                                didSomething = true;
                                await bot.sleep(600);
                            }
                        }
                    }
                } catch (eLastRank) { }

                // -------------------------------------------------------------
                // PHẦN 6: QUỸ PHÚC LỢI TOÀN SERVER (Welfare Fund Global)
                // -------------------------------------------------------------
                try {
                    bot.state.claimedGlobalFundIds = bot.state.claimedGlobalFundIds || new Set();
                    const wfm = mm && (mm.WelfareModel || mm.WelfareFundModel);
                    if (wfm && typeof wfm.reqWelfareFundGlobalPick === "function" && wfm.fundGlobalReward) {
                        const gCfg = (gm && gm.WelfareConfiger) || window.WelfareConfiger;
                        if (gCfg && typeof gCfg.getAllGlobalReward === "function") {
                            const allGlobal = gCfg.getAllGlobalReward() || [];
                            for (let gr of allGlobal) {
                                if (gr && gr.id && !bot.state.claimedGlobalFundIds.has(gr.id)) {
                                    const isPicked = typeof wfm.isPickedGlobalReward === "function" ? wfm.isPickedGlobalReward(gr.id) : false;
                                    const canPick = typeof wfm.globalRewardState === "function" ? (wfm.globalRewardState(gr.type || 1, gr.id) === 2) : !isPicked;
                                    if (!isPicked && canPick) {
                                        bot.state.claimedGlobalFundIds.add(gr.id);
                                        wfm.reqWelfareFundGlobalPick(gr.id);
                                        bot.log(`🎁 [Phúc Lợi Server] Nhận quà Quỹ Phúc Lợi Toàn Dân (Mốc ${gr.id}) thành công!`);
                                        didSomething = true;
                                        await bot.sleep(600);
                                    }
                                }
                            }
                        }
                    }
                } catch (eWf) { }

            } catch (e) {
                bot.log("Lỗi BXH: " + e.toString());
            }
            return didSomething;
        },

        // ====================================================================
        // TÍNH NĂNG 9: NHẬP GIFTCODE AN TOÀN (Delay 2.5s)
        // ====================================================================
        runRedeemCode: async function (code) {
            if (typeof G_Mapping === "undefined" || !G_Mapping.RPCReq || !G_Mapping.SystemCdKeyCs) {
                return { code: code, success: false, reason: "Game chưa sẵn sàng" };
            }
            try {
                const cTrim = code.trim();
                bot.log(`🎁 Đang nhập Giftcode: [${cTrim}]...`);
                G_Mapping.RPCReq.send(G_Mapping.SystemCdKeyCs.protocol, { _card: cTrim });
                await bot.sleep(2500);
                bot.log(`Đã gửi mã [${cTrim}].`);
                return { code: cTrim, success: true };
            } catch (e) {
                bot.log(`Lỗi nhập mã [${code}]: ${e.toString()}`);
                return { code: code, success: false, reason: e.toString() };
            }
        },

        runRedeemAllCodes: async function (customList) {
            const defaultCodes = [
                "TIEUKIEUVIP",
                "3QDAODAO",
                "3QVIP666",
                "DAOBAO2026",
                "DAODAODAO999",
                "GACHA1024",
                "3QDAODAODTN",
                "HUYNHPHUONGFAPTV",
                "VIP666",
                "VIP888",
                "VIP999",
                "SVIP666",
                "SVIP888",
                "SVIP999"
            ];
            const list = (Array.isArray(customList) && customList.length > 0) ? customList : defaultCodes;
            bot.log(`🎁 [Giftcode] Bắt đầu tự động quét và nhập hàng loạt ${list.length} mã quà tặng...`);
            for (let c of list) {
                await bot.runRedeemCode(c);
            }
            bot.log("🎉 [Giftcode] Đã hoàn thành nhập toàn bộ danh sách mã! Đang tự động nhận Thư thưởng...");
            try {
                const gm = window.G_Mapping;
                const mm = window.ModelManager;
                if (gm && gm.MailClaimCs && gm.RPCReq && mm && mm.MailModel) {
                    const mailList = mm.MailModel.getMailList ? mm.MailModel.getMailList() : (mm.MailModel._mailList || []);
                    const idsToClaim = [];
                    if (Array.isArray(mailList)) {
                        for (let m of mailList) {
                            const mId = m.getId ? m.getId() : (m._id || m.id);
                            if (mId) idsToClaim.push(mId);
                        }
                    }
                    if (idsToClaim.length > 0) {
                        gm.RPCReq.send(gm.MailClaimCs.protocol, { _ids: idsToClaim });
                        bot.log(`📬 [Thư] Đã gửi lệnh nhận nhanh ${idsToClaim.length} thư quà!`);
                    }
                }
            } catch (eMail) { }
        },

        // ====================================================================
        // TÍNH NĂNG 10: ĐÀO BẢO XẺNG (Condition-Driven: Kiểm tra xẻng, mặc đồ ngon, bán đồ cùi)
        // ====================================================================
        runAutoTreasureSmart: async function () {
            if (typeof G_Mapping === "undefined" || !G_Mapping.RPCReq) return false;
            const mm = window.ModelManager;
            const gm = window.G_Mapping;
            if (!mm || !mm.TreasureRewardModel || !mm.PlayerModel) return false;

            // KIỂM TRA TƯƠNG TÁC NGƯỜI CHƠI: Nếu người chơi đang mở giao diện Đào Bảo (TreasureBoxView), bot dừng hoàn toàn để người chơi tự bấm
            const vm = bot.getViewManager();
            if (vm && typeof vm.isOpenView === "function" && vm.isOpenView("TreasureBoxView")) {
                return false;
            }

            // Chống "Thao tác quá nhanh" hoặc cooldown sau lỗi đào bảo
            if (bot.state.treasureFailCooldown && Date.now() < bot.state.treasureFailCooldown) return false;

            const trm = mm.TreasureRewardModel;
            const pm = mm.PlayerModel;

            // CONDITION-DRIVEN: Fast exit nếu kho tạm rỗng, không đủ xẻng, không có nâng cấp rương
            const hasTemp = trm._temp_equip && trm._temp_equip.length > 0;
            const autoShovel = bot.settings && bot.settings.auto_shovel === true;
            const costCfg = trm.geBoxCostByType ? (trm.geBoxCostByType(3) || trm.geBoxCostByType(2)) : [];
            const costId = (costCfg && costCfg[1]) ? costCfg[1] : 71; // Xẻng phổ thông (71 - Đồng)
            const costPerOpen = (costCfg && costCfg[2]) ? costCfg[2] : 1;
            const shovels = pm.getMoneyNum ? pm.getMoneyNum(costId) : 0;
            const canDig = autoShovel && shovels >= costPerOpen && bot.canDo("treasure_dig_cycle", 12);
            const canBoxUp = bot.canDo("treasure_box_lvup", 30) && bot.hasRed("V_BoxUp");

            if (!hasTemp && !canDig && !canBoxUp) return false;

            let didSomething = false;

            try {
                // A. Kiểm tra và giải quyết toàn bộ trang bị đang nằm trong kho tạm (_temp_equip)
                if (hasTemp) {
                    bot.log(`⛏️ Đào Bảo: Phát hiện ${trm._temp_equip.length} trang bị trong kho tạm -> Đang xử lý...`);
                    const tempList = [...trm._temp_equip];
                    const toSell = [];
                    for (let rawItem of tempList) {
                        try {
                            const isBetter = trm.compareEquipTemp ? trm.compareEquipTemp(rawItem) : false;
                            if (isBetter) {
                                bot.log(`✨ Đào Bảo: Trang bị vượt trội lực chiến -> Tiến hành thay trang bị mới!`);
                                const itId = rawItem.getId ? rawItem.getId() : (rawItem._id || rawItem.id);
                                if (gm.EquipBoxSelectCs) {
                                    gm.RPCReq.send(gm.EquipBoxSelectCs.protocol, { _id: itId, _sell: 0 });
                                }
                                await bot.sleep(800);
                            } else {
                                toSell.push(rawItem);
                            }
                        } catch (itemErr) {
                            console.error("[AutoTreasure Item Error]", itemErr);
                        }
                    }
                    if (toSell.length > 0) {
                        bot.log(`♻️ Đào Bảo: Tự động bán gom ${toSell.length} trang bị phẩm chất thấp lấy EXP & Vàng.`);
                        const sellIds = toSell.map(it => ({ _val: (it.getId ? it.getId() : (it._id || it.id)) }));
                        if (gm.EquipBoxSellCs) {
                            gm.RPCReq.send(gm.EquipBoxSellCs.protocol, { _list: sellIds });
                        }
                        await bot.sleep(800);
                    }
                    bot.closeBattleViews();
                    return true; // Dừng tại đây, hoàn tất xử lý kho tạm trước khi đào lượt kế
                }

                // B. Kiểm tra số xẻng hiện có trước khi đào tiếp (chỉ mở xẻng đồng khi người chơi chủ động bật auto_shovel)
                if (canDig) {
                    bot.markDone("treasure_dig_cycle");
                    const leftQuick = (typeof trm.getLeftQuickDigNum === "function") ? (trm.getLeftQuickDigNum() || 0) : 0;
                    const maxBatch = (typeof trm.geBoxOpenRealyNumByType === "function") ? trm.geBoxOpenRealyNumByType(3) : ((typeof trm.geBoxOpenNumByType === "function") ? trm.geBoxOpenNumByType(3) : 40);
                    const actualBatch = Math.min(shovels, Math.max(1, maxBatch || 40));

                    const canQuickDig = (shovels >= actualBatch && leftQuick > 0 && bot.state.quickDigExhausted !== true && typeof trm.reqQuickDig === "function");
                    if (canQuickDig) {
                        bot.log(`⛏️ Đào Bảo: Tự động Đào Nhanh ${actualBatch} xẻng phổ thông (${shovels} xẻng còn lại, ${leftQuick} lượt nhanh)...`);
                        trm.reqQuickDig(actualBatch, 3);
                    } else {
                        bot.log(`⛏️ Đào Bảo: Tự động mở ${actualBatch} xẻng phổ thông (${shovels} xẻng còn lại)...`);
                        if (trm.reqEquipBoxOpen) {
                            trm.reqEquipBoxOpen(actualBatch, 3);
                        } else if (gm.EquipBoxOpenCs) {
                            gm.RPCReq.send(gm.EquipBoxOpenCs.protocol, { _type: 3, _cnt: actualBatch });
                        }
                    }
                    didSomething = true;
                    await bot.sleep(1200);
                }

                // C. Tự động nâng cấp Rương Đào Bảo (Box Level Up) khi đủ điều kiện
                if (canBoxUp) {
                    bot.markDone("treasure_box_lvup");
                    if (trm.checkBoxUpLvHongdian) trm.checkBoxUpLvHongdian();
                    if (bot.hasRed("V_BoxUp") && trm.reqEquipBoxLvUp) {
                        bot.log("📦 Đào Bảo: Đủ điều kiện thăng cấp -> Tự động nâng cấp Rương Đào Bảo!");
                        trm.reqEquipBoxLvUp();
                        didSomething = true;
                        await bot.sleep(600);
                    }
                }
            } catch (e) {
                bot.log("Lỗi Đào Bảo: " + e.toString());
            }
            return didSomething;
        },

        // ====================================================================
        // TÍNH NĂNG 11: ĐẤU TRƯỜNG LÔI ĐÀI (Chỉ đánh khi có lượt miễn phí, chọn đối thủ yếu nhất)
        // ====================================================================
        runAutoArenaSmart: async function () {
            if (typeof G_Mapping === "undefined" || !G_Mapping.RPCReq) return false;
            const mm = window.ModelManager;
            const gm = window.G_Mapping;
            if (!mm || !mm.ArenaModel || !mm.PlayerModel) return false;

            // Chống "Thao tác quá nhanh": Bỏ qua nếu có trận chiến khác đang diễn ra
            if (bot.isBattling()) return false;

            const am = mm.ArenaModel;
            if (am.RefreshRed) am.RefreshRed();

            const freeCount = am.GetFreeCount ? am.GetFreeCount() : 0;
            const hasFreeRed = bot.hasRed("V_ArenaFree");
            const hasReward = bot.hasRed("V_ArenaReward") && bot.canDo("arena_get_reward", 60);
            const canChallenge = (freeCount > 0 || hasFreeRed) && bot.canDo("arena_challenge_cycle", 45);

            // THÔNG MINH: Không có quà mốc VÀ không có lượt khiêu chiến miễn phí -> Dừng ngay, không làm gì
            if (!hasReward && !canChallenge) return false;

            let didSomething = false;

            try {
                // A. Kiểm tra nhận quà mốc điểm tích lũy
                if (hasReward) {
                    bot.markDone("arena_get_reward");
                    bot.log("🏆 Đấu Trường: Nhận thưởng tích lũy lượt khiêu chiến hàng ngày!");
                    if (am.reqGetReward) {
                        am.reqGetReward();
                    } else if (gm.ArenaCntRewardsCs) {
                        gm.RPCReq.send(gm.ArenaCntRewardsCs.protocol, {});
                    }
                    didSomething = true;
                    await bot.sleep(600);
                }

                // B. Khiêu chiến đối thủ (Chỉ đánh khi có lượt miễn phí)
                if (canChallenge) {
                    bot.markDone("arena_challenge_cycle");

                    // Lấy danh sách đối thủ
                    let rivalObj = am.getRivalList ? am.getRivalList() : null;
                    let rivals = (rivalObj && rivalObj._list) ? rivalObj._list : null;
                    if (!rivals || rivals.length === 0) {
                        if (gm.ArenaModel && gm.ArenaModel.reqRival) {
                            gm.ArenaModel.reqRival();
                        } else if (gm.ArenaRivalCs) {
                            gm.RPCReq.send(gm.ArenaRivalCs.protocol, {});
                        }
                        await bot.sleep(1200);
                        rivalObj = am.getRivalList ? am.getRivalList() : null;
                        rivals = (rivalObj && rivalObj._list) ? rivalObj._list : null;
                    }

                    if (rivals && rivals.length > 0) {
                        // Chọn đối thủ có LỰC CHIẾN THẤP NHẤT
                        let target = rivals[0];
                        let minPower = Infinity;
                        for (let r of rivals) {
                            const p = r._role_show ? (r._role_show._power || 0) : 0;
                            if (p < minPower) {
                                minPower = p;
                                target = r;
                            }
                        }

                        const targetRid = (target._role_show && (target._role_show._rid || target._role_show._role_id)) ? (target._role_show._rid || target._role_show._role_id) : (target._rid || 0);
                        if (!targetRid || Number(targetRid) <= 1) return false;

                        const targetName = (target._role_show && target._role_show._name) ? target._role_show._name : "Đối thủ";
                        const powerStr = minPower === Infinity ? "--" : minPower.toLocaleString();

                        bot.state.battleInProgress = true;
                        bot.state.lastBattleStartTime = Date.now();
                        bot.log(`⚔️ Đấu Trường: Còn ${freeCount} lượt miễn phí -> Khiêu chiến [${targetName}] (Lực chiến: ${powerStr})!`);

                        // Khiêu chiến chạy ngầm (skipArray = true, skipBattle = true)
                        const arenaType = (gm.e_GameplayDataGameplay && gm.e_GameplayDataGameplay.Arena) ? gm.e_GameplayDataGameplay.Arena : 2;
                        const fm = (gm.FubenManager && gm.FubenManager.I) || (window.FubenManager && window.FubenManager.I);

                        if (fm && fm.enter) {
                            fm.enter(
                                arenaType,
                                targetRid,
                                null,
                                false,
                                null,
                                true, // skipArray = true (Chặn tuyệt đối popup xếp trận)
                                { _role_show: target._role_show, _id: 2 },
                                true  // skipBattle = true (Skip ngay lập tức)
                            );
                        } else {
                            // Fallback socket RPC
                            gm.RPCReq.send(gm.WarStartCs.protocol, { _type: arenaType, _id: targetRid, _cli: 1, _ext: [] });
                            await bot.sleep(2000);
                            gm.RPCReq.send(gm.WarJumpCs.protocol, { _type: arenaType, _id: targetRid, _cli: 1, _ext: [] });
                        }

                        bot.closeBattleViews();
                        didSomething = true;
                        await bot.sleep(4000);
                        bot.closeBattleViews();
                    }
                }
            } catch (e) {
                bot.log("Lỗi Đấu Trường: " + e.toString());
            } finally {
                bot.state.battleInProgress = false;
                bot.state.lastBattleEndTime = Date.now();
            }
            return didSomething;
        },

        // ====================================================================
        // TÍNH NĂNG 12: THƯỞNG TREO MÁY AFK (Rương tích lũy & Thu hoạch nhanh miễn phí)
        // ====================================================================
        runAutoAFKSmart: async function () {
            if (typeof G_Mapping === "undefined" || !G_Mapping.RPCReq) return false;
            const mm = window.ModelManager;
            const gm = window.G_Mapping;
            if (!mm || !mm.MainUIModel) return false;

            const mum = mm.MainUIModel;
            const prog = mum.getMainCopyProgress ? mum.getMainCopyProgress() : mum.mainCopyProgress;
            const sTime = (mm.ServerTimeModel && mm.ServerTimeModel.getServerTime) ? mm.ServerTimeModel.getServerTime() : Math.floor(Date.now() / 1000);
            const diffSec = prog ? (sTime - (prog._sec || 0)) : 0;

            const canClaim = (diffSec >= 300 || bot.hasRed("V_TimeHook")) && bot.canDo("afk_claim_cycle", 300);
            const canQuick = mum.chekHookFreeTimes && mum.chekHookFreeTimes() && bot.canDo("afk_quick_free", 300);

            if (!canClaim && !canQuick) return false;
            let didSomething = false;

            try {
                // A. Nhận thưởng rương treo máy tích lũy khi đủ điều kiện
                if (canClaim) {
                    bot.markDone("afk_claim_cycle");
                    if (mum.reqCopyGainBox) mum.reqCopyGainBox();
                    await bot.sleep(300);
                    if (mum.CopyGetGains) mum.CopyGetGains();
                    bot.log(`🎁 Treo Máy: Đã thu thập thưởng AFK tích lũy (${Math.floor(diffSec / 60)} phút)!`);
                    didSomething = true;
                    await bot.sleep(400);
                }

                // B. Tự dùng lượt Thu Hoạch Nhanh miễn phí (Quick Hook AFK)
                if (canQuick) {
                    bot.markDone("afk_quick_free");
                    bot.log("⚡ Treo Máy: Có lượt Thu Hoạch Nhanh miễn phí -> Thu hoạch ngay!");
                    if (mum.reqCopyQuick) mum.reqCopyQuick();
                    didSomething = true;
                    await bot.sleep(400);
                }
            } catch (e) {
                bot.log("Lỗi Treo Máy AFK: " + e.toString());
            }
            return didSomething;
        },

        // ====================================================================
        // TÍNH NĂNG 8: TỰ ĐỘNG CHỌN LÕI BÍ CẢNH TẦN LĨNH (Không skip battle, chọn lõi tối ưu)
        // ====================================================================
        checkAndAutoSelectYyzqCore: async function () {
            if (!bot.settings.auto_yyzq_core) return false;
            const mm = window.ModelManager;
            if (!mm || !mm.YyzqModel) return false;
            const ym = mm.YyzqModel;
            const vm = (bot.getViewManager && bot.getViewManager()) || window.ViewManager || (window.G_Mapping && window.G_Mapping.ViewManager);

            // 1. Nếu đang mở bảng đổi Lõi khi đầy (YyzqBuffReplaceView)
            const repView = vm && vm.getView ? vm.getView("YyzqBuffReplaceView") : null;
            if (repView && repView.view && repView.view.visible) {
                if (bot.canDo("yyzq_core_view_replace", 1.5)) {
                    bot.markDone("yyzq_core_view_replace");
                    const buffData = repView.buffData || (ym.getSelectedBuffData && ym.getSelectedBuffData()) || [];
                    let dropBuffId = repView.chooseBuffId || (buffData.length > 0 ? buffData[0]._key : 0);
                    const selNewIdx = (repView.selNewIdx != null) ? repView.selNewIdx : 0;
                    bot.log(`🔮 [Bí Cảnh Tần Lĩnh] Tự động xác nhận thay thế Lõi #${selNewIdx + 1} (thay thế Lõi [${dropBuffId}])!`);
                    if (typeof ym.reqSelectBuff === "function") {
                        ym.reqSelectBuff(selNewIdx + 1, dropBuffId);
                    }
                    if (typeof repView.closeView === "function") {
                        try { repView.closeView(); } catch (e) { }
                    }
                    if (vm && typeof vm.closeView === "function") {
                        try { vm.closeView("YyzqBuffSelectView"); } catch (e) { }
                    }
                    return true;
                }
            }

            // 2. Nếu đang mở bảng chọn Lõi (YyzqBuffSelectView)
            const selView = vm && vm.getView ? vm.getView("YyzqBuffSelectView") : null;
            if (selView && selView.view && selView.view.visible) {
                if (bot.canDo("yyzq_core_view_select", 1.5)) {
                    bot.markDone("yyzq_core_view_select");
                    const needBuffs = ym.getNeedSelectBuff ? ym.getNeedSelectBuff() : [];
                    let autoIdx = (selView.chooseIndex != null) ? selView.chooseIndex : (ym.getAutoSelectBuffIdx ? ym.getAutoSelectBuffIdx() : 0);
                    if (autoIdx < 0 || (needBuffs.length > 0 && autoIdx >= needBuffs.length)) autoIdx = 0;

                    const cfgMisc = (window.G_Mapping && window.G_Mapping.YyzqConfiger && window.G_Mapping.YyzqConfiger.getYyzqMisc) ? window.G_Mapping.YyzqConfiger.getYyzqMisc() : null;
                    const buffLimit = (cfgMisc && cfgMisc.buff_limit) || 8;
                    const selectedBuffs = ym.getSelectedBuffData ? ym.getSelectedBuffData() : [];
                    const curCount = (needBuffs[autoIdx] && ym.getBuffCount) ? ym.getBuffCount(needBuffs[autoIdx]._val) : 0;

                    let dropBuffId = 0;
                    if (selectedBuffs && selectedBuffs.length >= buffLimit && curCount <= 0) {
                        dropBuffId = selectedBuffs[0]._key || 0;
                    }

                    bot.log(`🔮 [Bí Cảnh Tần Lĩnh] Tự động chọn Lõi #${autoIdx + 1}${dropBuffId ? " (thay thế Lõi [" + dropBuffId + "])" : ""} trên giao diện!`);
                    if (typeof ym.reqSelectBuff === "function") {
                        ym.reqSelectBuff(autoIdx + 1, dropBuffId);
                    }
                    if (typeof selView.closeView === "function") {
                        try { selView.closeView(); } catch (e) { }
                    }
                    return true;
                }
            }

            // 3. Quét kiểm tra trạng thái Model nếu có buff đang chờ chọn mà View không mở
            const needBuffs = ym.getNeedSelectBuff ? ym.getNeedSelectBuff() : null;
            if (needBuffs && needBuffs.length > 0) {
                if (bot.canDo("yyzq_core_model_select", 2)) {
                    bot.markDone("yyzq_core_model_select");
                    let autoIdx = ym.getAutoSelectBuffIdx ? ym.getAutoSelectBuffIdx() : 0;
                    if (autoIdx < 0 || autoIdx >= needBuffs.length) autoIdx = 0;

                    const cfgMisc = (window.G_Mapping && window.G_Mapping.YyzqConfiger && window.G_Mapping.YyzqConfiger.getYyzqMisc) ? window.G_Mapping.YyzqConfiger.getYyzqMisc() : null;
                    const buffLimit = (cfgMisc && cfgMisc.buff_limit) || 8;
                    const selectedBuffs = ym.getSelectedBuffData ? ym.getSelectedBuffData() : [];
                    const curCount = ym.getBuffCount ? ym.getBuffCount(needBuffs[autoIdx]._val) : 0;

                    let dropBuffId = 0;
                    if (selectedBuffs && selectedBuffs.length >= buffLimit && curCount <= 0) {
                        dropBuffId = selectedBuffs[0]._key || 0;
                    }

                    bot.log(`🔮 [Bí Cảnh Tần Lĩnh] Tự động chọn Lõi #${autoIdx + 1}${dropBuffId ? " (thay thế Lõi [" + dropBuffId + "])" : ""} qua Model!`);
                    ym.reqSelectBuff(autoIdx + 1, dropBuffId);
                    return true;
                }
            }

            return false;
        },

        // ====================================================================
        // TỰ ĐỘNG THẦN XẠ / ĐOẠT BẢO (AIM-BOT 100% TRÚNG HŨ & NHẬN THƯỞNG)
        // ====================================================================
        runAutoTouhuSmart: async function () {
            if (!bot.canDo("auto_touhu", 25)) return;
            try {
                const mm = window.ModelManager;
                const tm = mm && mm.TouhuModel;
                const am = mm && mm.ActivityModel;
                if (!tm || !am) return;

                const sc = window.ShejianConfiger || (window.G_Mapping && window.G_Mapping.ShejianConfiger);
                if (!sc) return;

                // Tìm các hoạt động Thần Xạ / Bách Bộ Xuyên Dương đang mở
                let targetActId = null;
                let targetModId = null;

                if (tm.act_level) {
                    for (let mId in tm.act_level) {
                        const aId = am.getActIdByModuleId ? am.getActIdByModuleId(Number(mId)) : null;
                        if (aId) {
                            targetActId = Number(aId);
                            targetModId = Number(mId);
                            break;
                        }
                    }
                }

                if (!targetActId && am._activityData) {
                    for (let id in am._activityData) {
                        const act = am._activityData[id];
                        if (act && typeof act.getModelId === "function") {
                            const modId = act.getModelId();
                            if (typeof sc.getShejianDataById === "function" && sc.getShejianDataById(modId)) {
                                targetActId = Number(id);
                                targetModId = modId;
                                break;
                            }
                        }
                    }
                }

                if (!targetActId) return;
                bot.markDone("auto_touhu");

                const cfg = sc.getShejianDataById ? sc.getShejianDataById(targetModId) : null;
                if (!cfg) return;

                // 1. Tự động nhận thưởng mốc điểm trước
                if (typeof tm.getScoreRewardState === "function" && typeof tm.reqMiniShejianRewardsCs === "function") {
                    for (let i = 0; i < cfg.guanka_big.length; i++) {
                        const gType = cfg.guanka_big[i][0];
                        const rewList = sc.getShejianRewardByType ? sc.getShejianRewardByType(gType) : null;
                        if (rewList) {
                            for (let r = 0; r < rewList.length; r++) {
                                if (tm.getScoreRewardState(targetActId, rewList[r].id) === 2) { // 2 = RewardState.CanGet
                                    bot.log(`🎁 [Thần Xạ] Tự động nhận thưởng mốc điểm Ải [${i + 1}]!`);
                                    tm.reqMiniShejianRewardsCs(targetActId, rewList[r].guanka_big);
                                    await bot.sleep(350);
                                }
                            }
                        }
                    }
                }

                // 2. Kiểm tra còn lượt khiêu chiến miễn phí
                const freeTimes = tm.getFreeTimes ? tm.getFreeTimes(targetActId) : 0;
                if (freeTimes <= 0) return;

                // Nếu đang mở giao diện TouhuGameView thì để UI hook tự động bắn
                const vm = bot.getViewManager();
                if (vm && typeof vm.isOpenView === "function" && (vm.isOpenView("TouhuGameView") || vm.isOpenView("DjTouhuGameView"))) {
                    return;
                }

                const curActDay = (am.getCurActivityDay && am.getCurActivityDay(targetActId)) || 1;
                // Tìm ải phù hợp đang mở
                for (let i = 0; i < cfg.guanka_big.length; i++) {
                    const gData = cfg.guanka_big[i];
                    const gType = gData[0];
                    const reqDay = gData[1];
                    if (curActDay >= reqDay) {
                        if (tm.getFreeTimes(targetActId) > 0) {
                            bot.log(`🏹 [Thần Xạ] Phát hiện ${freeTimes} lượt bắn miễn phí tại Ải [${i + 1}]. Bắt đầu tự động bắn...`);
                            if (vm && typeof vm.open === "function") {
                                if (typeof tm.reqPMiniShejianReset === "function") {
                                    tm.reqPMiniShejianReset(targetActId, gType);
                                }
                                const vName = (vm.hasView && vm.hasView("TouhuGameView")) ? "TouhuGameView" : ((vm.hasView && vm.hasView("DjTouhuGameView")) ? "DjTouhuGameView" : "TouhuGameView");
                                vm.open(vName, { curActId: targetActId, level: gType });
                            }
                            break;
                        }
                    }
                }
            } catch (e) {
                console.error("[AutoBot Touhu Error]", e);
            }
        },

        // ====================================================================
        // TÍNH NĂNG 12: TỰ ĐỘNG TOÀN DIỆN: QUÀ NGÀY, MỐC NĂNG ĐỘNG, SHOP, CÂY TIỀN, HÒM THƯ, BẠN BÈ & QUỸ
        // ====================================================================
        runAutoDailyRewardsSmart: async function (force = false) {
            if (typeof G_Mapping === "undefined" || !G_Mapping.RPCReq) return false;
            if (bot.isBattling()) return false;
            if (!force && !bot.canDo("auto_daily_rewards", 45)) return false;

            const mm = window.ModelManager;
            if (!mm) return false;
            const gm = window.G_Mapping;
            const rpc = (gm && gm.RPCReq) || window.RPCReq;
            if (!rpc || typeof rpc.send !== "function") return false;

            bot.markDone("auto_daily_rewards");
            let didSomething = false;

            // 1. NHIỆM VỤ NGÀY & RƯƠNG MỐC NĂNG ĐỘNG (TaskModel)
            try {
                const tm = mm.TaskModel;
                if (tm) {
                    bot.state.claimedTaskIds = bot.state.claimedTaskIds || new Set();
                    const eEnum = (gm && gm.e_EnumDataE) || (typeof window.__require === "function" && window.__require("t_EnumData")?.e_EnumDataE) || {};
                    const TaskDaily = eEnum.TaskDaily || 2;
                    const TaskDailyBox = eEnum.TaskDailyBox || 5;
                    const TaskWeekly = eEnum.TaskWeekly || 3;
                    const TaskWeeklyBox = eEnum.TaskWeeklyBox || 6;
                    const TaskAchieve = eEnum.TaskAchieve || 4;

                    const tc = (gm && gm.TaskConfiger) || window.TaskConfiger || (typeof window.__require === "function" && (window.__require("TaskConfiger")?.TaskConfiger || window.__require("TaskConfiger")?.default || window.__require("TaskConfiger")));

                    // 1a. Nhận toàn bộ Nhiệm vụ Ngày đã hoàn thành (TaskDaily = 2)
                    if (typeof tm.getTaskListByType === "function" && typeof tm.getTaskState === "function") {
                        const dailyTasks = tm.getTaskListByType(TaskDaily) || [];
                        const claimableDaily = [];
                        for (let tId of dailyTasks) {
                            const tKey = TaskDaily + "_" + tId;
                            if (tm.getTaskState(TaskDaily, tId) === 2 && !bot.state.claimedTaskIds.has(tKey)) { // 2 = CanGet
                                bot.state.claimedTaskIds.add(tKey);
                                claimableDaily.push(tId);
                            }
                        }
                        if (claimableDaily.length > 0) {
                            if (typeof tm.reqTaskComplete2 === "function") {
                                tm.reqTaskComplete2(TaskDaily, claimableDaily);
                                bot.log(`🎁 [Nhiệm Vụ Ngày] Tự động nhận ${claimableDaily.length} nhiệm vụ ngày đã xong!`);
                            } else if (typeof tm.reqTaskComplete === "function") {
                                for (let tId of claimableDaily) {
                                    tm.reqTaskComplete(TaskDaily, tId);
                                    await bot.sleep(300);
                                }
                                bot.log(`🎁 [Nhiệm Vụ Ngày] Tự động nhận ${claimableDaily.length} nhiệm vụ ngày!`);
                            }
                            didSomething = true;
                            await bot.sleep(400);
                        }

                        // 1b. Nhận Rương Mốc Năng Động Ngày (TaskDailyBox = 5, mốc 20, 40, 60, 80, 100 điểm)
                        let dailyBoxCfgs = [];
                        if (tc && typeof tc.getTaskActiveCfgArray === "function") {
                            dailyBoxCfgs = tc.getTaskActiveCfgArray(1) || [];
                        }
                        if (!dailyBoxCfgs.length) {
                            dailyBoxCfgs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
                        }
                        for (let boxCfg of dailyBoxCfgs) {
                            const bId = boxCfg.id || boxCfg._id;
                            const bKey = TaskDailyBox + "_" + bId;
                            if (bId && tm.getTaskState(TaskDailyBox, bId) === 2 && !bot.state.claimedTaskIds.has(bKey)) {
                                if (typeof tm.reqTaskComplete === "function") {
                                    bot.state.claimedTaskIds.add(bKey);
                                    tm.reqTaskComplete(TaskDailyBox, bId);
                                    bot.log(`🎉 [Mốc Năng Động] Tự động mở Rương Mốc Ngày [Mốc ID: ${bId}]!`);
                                    didSomething = true;
                                    await bot.sleep(400);
                                }
                            }
                        }

                        // 1c. Nhận Nhiệm Vụ Tuần & Rương Mốc Năng Động Tuần (TaskWeekly = 3, TaskWeeklyBox = 6)
                        const weeklyTasks = tm.getTaskListByType(TaskWeekly) || [];
                        const claimableWeekly = [];
                        for (let tId of weeklyTasks) {
                            const wKey = TaskWeekly + "_" + tId;
                            if (tm.getTaskState(TaskWeekly, tId) === 2 && !bot.state.claimedTaskIds.has(wKey)) {
                                bot.state.claimedTaskIds.add(wKey);
                                claimableWeekly.push(tId);
                            }
                        }
                        if (claimableWeekly.length > 0) {
                            if (typeof tm.reqTaskComplete2 === "function") {
                                tm.reqTaskComplete2(TaskWeekly, claimableWeekly);
                                bot.log(`🎁 [Nhiệm Vụ Tuần] Tự động nhận ${claimableWeekly.length} nhiệm vụ tuần!`);
                            } else if (typeof tm.reqTaskComplete === "function") {
                                for (let tId of claimableWeekly) {
                                    tm.reqTaskComplete(TaskWeekly, tId);
                                    await bot.sleep(300);
                                }
                            }
                            didSomething = true;
                            await bot.sleep(400);
                        }

                        let weeklyBoxCfgs = [];
                        if (tc && typeof tc.getTaskActiveCfgArray === "function") {
                            weeklyBoxCfgs = tc.getTaskActiveCfgArray(2) || [];
                        }
                        for (let boxCfg of weeklyBoxCfgs) {
                            const bId = boxCfg.id || boxCfg._id;
                            const wbKey = TaskWeeklyBox + "_" + bId;
                            if (bId && tm.getTaskState(TaskWeeklyBox, bId) === 2 && !bot.state.claimedTaskIds.has(wbKey)) {
                                if (typeof tm.reqTaskComplete === "function") {
                                    bot.state.claimedTaskIds.add(wbKey);
                                    tm.reqTaskComplete(TaskWeeklyBox, bId);
                                    bot.log(`🎉 [Mốc Tuần] Tự động mở Rương Mốc Tuần [Mốc ID: ${bId}]!`);
                                    didSomething = true;
                                    await bot.sleep(400);
                                }
                            }
                        }

                        // 1d. Nhận Thành Tựu (TaskAchieve = 4)
                        const achieveTasks = tm.getTaskListByType(TaskAchieve) || [];
                        for (let tId of achieveTasks) {
                            const aKey = TaskAchieve + "_" + tId;
                            if (tm.getTaskState(TaskAchieve, tId) === 2 && !bot.state.claimedTaskIds.has(aKey)) {
                                if (typeof tm.reqTaskComplete === "function") {
                                    bot.state.claimedTaskIds.add(aKey);
                                    tm.reqTaskComplete(TaskAchieve, tId);
                                    bot.log(`🏆 [Thành Tựu] Tự động nhận thưởng Thành Tựu [ID: ${tId}]!`);
                                    didSomething = true;
                                    await bot.sleep(350);
                                }
                            }
                        }
                    }
                }
            } catch (eTask) { }

            // 2. RUNG CÂY TIỀN MIỄN PHÍ (MoneyTreeModel)
            try {
                const mtm = mm.MoneyTreeModel;
                const gpc = (gm && gm.GoldPointConfiger) || window.GoldPointConfiger || (typeof window.__require === "function" && (window.__require("GoldPointConfiger")?.GoldPointConfiger || window.__require("GoldPointConfiger")?.default || window.__require("GoldPointConfiger")));
                if (mtm && gpc && typeof gpc.getGoldPointCfgIds === "function" && typeof mtm.reqWelfareGoldBuy === "function") {
                    const treeIds = gpc.getGoldPointCfgIds() || [];
                    for (let tId of treeIds) {
                        const cfg = gpc.getGoldPointCfgById(tId);
                        const cost = (cfg && cfg.cost && cfg.cost.length && cfg.cost[0] && cfg.cost[0][1]) || 0;
                        const remain = (typeof mtm.getTotalTimes === "function" && typeof mtm.getBuyTimes === "function")
                            ? (mtm.getTotalTimes(tId) - mtm.getBuyTimes(tId)) : 0;
                        if (cost <= 0 && remain > 0) {
                            mtm.reqWelfareGoldBuy(tId);
                            bot.log(`💰 [Cây Tiền] Tự động Rung Cây Tiền Miễn Phí [Lần còn: ${remain}]!`);
                            didSomething = true;
                            await bot.sleep(400);
                        }
                    }
                }
            } catch (eTree) { }

            // 3. QUÀ MIỄN PHÍ CỬA HÀNG / SHOP (ShopModel)
            try {
                const sm = mm.ShopModel;
                const sc = (gm && gm.ShopConfiger) || window.ShopConfiger || (typeof window.__require === "function" && (window.__require("ShopConfiger")?.default || window.__require("ShopConfiger")));
                if (sm && sc && typeof sm.reqShopBuy === "function") {
                    const goodsMap = sm.shopGoodsList || {};
                    for (let sType in goodsMap) {
                        const gList = goodsMap[sType];
                        if (Array.isArray(gList)) {
                            for (let gId of gList) {
                                const cfg = typeof sc.getShopCfgById === "function" ? sc.getShopCfgById(gId) : null;
                                if (cfg && cfg.price && cfg.price.length && cfg.price[0] && cfg.price[0][1] <= 0) {
                                    const purchased = typeof sm.getShopPurchasedById === "function" ? sm.getShopPurchasedById(gId) : 0;
                                    const limit = cfg.limit_num || 0;
                                    if (!limit || purchased < limit) {
                                        sm.reqShopBuy(gId, 1);
                                        bot.log(`🛍️ [Cửa Hàng] Tự động nhận Gói Quà Miễn Phí [ID: ${gId}]!`);
                                        didSomething = true;
                                        await bot.sleep(400);
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (eShop) { }

            // 4. NHẬN QUÀ ĐÍNH KÈM HÒM THƯ (MailModel)
            try {
                const mailM = mm.MailModel;
                if (mailM && typeof mailM.getMailCanGet === "function") {
                    const canGetMails = mailM.getMailCanGet() || [];
                    if (canGetMails.length > 0) {
                        const ids = canGetMails.map(m => ({ _id: m._id }));
                        const mailProto = (gm && gm.MailClaimCs && gm.MailClaimCs.protocol) || 10608;
                        rpc.send(mailProto, { _ids: ids });
                        bot.log(`📬 [Hòm Thư] Tự động nhận đính kèm của ${ids.length} thư mới!`);
                        didSomething = true;
                        await bot.sleep(400);
                    }
                }
            } catch (eMail) { }

            // 5. TẶNG & NHẬN TIM BẠN BÈ 1-CHẠM (FriendModel)
            try {
                const fm = mm.FriendModel;
                if (fm && bot.tryDo("friend_autopick_send", 300)) {
                    const isFullAccept = typeof fm.isFullAcceptGiftsTimes === "function" ? fm.isFullAcceptGiftsTimes() : false;
                    const isFullSend = typeof fm.isFullSendGiftsTimes === "function" ? fm.isFullSendGiftsTimes() : false;
                    // Chỉ gửi khi chưa nhận full hoặc chưa tặng full
                    if (!isFullAccept || !isFullSend) {
                        const relProto = (gm && gm.RelationAutoPickSendCs && gm.RelationAutoPickSendCs.protocol) || 14217;
                        rpc.send(relProto, {});
                        bot.log(`❤️ [Bạn Bè] Tự động Tặng & Nhận Tim/Quà Bạn Bè 1-chạm!`);
                        didSomething = true;
                        await bot.sleep(400);
                    }
                }
            } catch (eFriend) { }

            // 6. PHÚC LỢI QUỸ / CẤP / THÁP MIỄN PHÍ (RechargeShopModel)
            try {
                bot.state.claimedFundIds = bot.state.claimedFundIds || new Set();
                const rsm = mm.RechargeShopModel;
                const fc = (gm && gm.FundConfiger) || window.FundConfiger || (typeof window.__require === "function" && (window.__require("FundConfiger")?.default || window.__require("FundConfiger")));
                if (rsm && fc && typeof rsm.reqWelfareFundPick === "function") {
                    for (let fType of [1, 2]) {
                        const stages = typeof fc.getFundStageByType === "function" ? fc.getFundStageByType(fType) : [];
                        if (Array.isArray(stages)) {
                            for (let stage of stages) {
                                const cfgs = typeof fc.getFundPersonalCfgsByTypeStage === "function" ? fc.getFundPersonalCfgsByTypeStage(fType, stage) : [];
                                if (Array.isArray(cfgs)) {
                                    for (let pCfg of cfgs) {
                                        const fKey = "p_" + (pCfg && pCfg.id);
                                        if (pCfg && pCfg.id && !bot.state.claimedFundIds.has(fKey)) {
                                            const rewardState = typeof rsm.isGetReward === "function" ? rsm.isGetReward(pCfg.id) : [false, false];
                                            const isFreePicked = rewardState[0];
                                            const curCond = typeof rsm.getCondition === "function" ? rsm.getCondition(fType) : 0;
                                            if (!isFreePicked && pCfg.need <= curCond) {
                                                bot.state.claimedFundIds.add(fKey);
                                                rsm.reqWelfareFundPick(pCfg.id);
                                                bot.log(`🎖️ [Quỹ Phúc Lợi] Tự động nhận thưởng mốc miễn phí [ID: ${pCfg.id}]!`);
                                                didSomething = true;
                                                await bot.sleep(350);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if (typeof rsm.reqWelfareFundGlobalPick === "function" && typeof rsm.globalRewardState === "function") {
                        for (let fType of [1, 2]) {
                            const globalCfg = typeof fc.getFundGlobalCfgsByType === "function" ? fc.getFundGlobalCfgsByType(fType) : [];
                            if (Array.isArray(globalCfg)) {
                                for (let gCfg of globalCfg) {
                                    const gKey = "g_" + (gCfg && gCfg.id);
                                    if (gCfg && gCfg.id && !bot.state.claimedFundIds.has(gKey) && rsm.globalRewardState(fType, gCfg.id) === 2) {
                                        bot.state.claimedFundIds.add(gKey);
                                        rsm.reqWelfareFundGlobalPick(gCfg.id);
                                        bot.log(`🌐 [Quỹ Toàn Dân] Tự động nhận thưởng Quỹ Server [ID: ${gCfg.id}]!`);
                                        didSomething = true;
                                        await bot.sleep(350);
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (eFund) { }

            // 7. HOẠT ĐỘNG NGÀY & ĐIỂM DANH SỰ KIỆN (ActivityModel)
            try {
                const am = mm.ActivityModel;
                if (am && typeof am.getAllData === "function") {
                    bot.state.claimedActSubIds = bot.state.claimedActSubIds || new Set();
                    const allActs = am.getAllData() || {};
                    const isTaskCooling = bot.state.actTaskFailCooldown && (Date.now() < bot.state.actTaskFailCooldown);
                    if (!bot.state.actFailCooldowns) bot.state.actFailCooldowns = {};

                    for (let actId in allActs) {
                        const numActId = Number(actId);
                        if (numActId > 0) {
                            // 7a. Nhận thưởng điểm danh/ngày (ActDaily) - Chỉ nhận khi có cấu hình và CHƯA nhận (!getActDailyState)
                            if (typeof am.getActDailyState === "function" && typeof am.reqActDailyReward === "function") {
                                const actItem = allActs[actId];
                                const dRwd = actItem && typeof actItem.getDaliyReward === "function" ? actItem.getDaliyReward() : null;
                                const hasDailyRwd = Array.isArray(dRwd) && dRwd.length > 0;
                                const isAlreadyClaimed = !!am.getActDailyState(numActId);

                                if (hasDailyRwd && !isAlreadyClaimed) {
                                    if (!bot.state.actDailyClaimAttempts) bot.state.actDailyClaimAttempts = {};
                                    const lastAttempt = bot.state.actDailyClaimAttempts[numActId] || 0;
                                    if (Date.now() - lastAttempt > 30 * 60000) {
                                        bot.state.actDailyClaimAttempts[numActId] = Date.now();
                                        am.reqActDailyReward(numActId);
                                        bot.log(`🎁 [Hoạt Động] Tự động nhận thưởng ngày Hoạt Động [ID: ${numActId}]!`);
                                        didSomething = true;
                                        await bot.sleep(600);
                                    }
                                }
                            }

                            // 7b. Nhận thưởng mốc nhiệm vụ sự kiện (chỉ thực hiện khi có chấm đỏ và không bị cooldown)
                            if (!isTaskCooling && (!bot.state.actFailCooldowns[numActId] || Date.now() >= bot.state.actFailCooldowns[numActId])) {
                                const actItem = allActs[actId];
                                const hasActRed = bot.hasRed("M_Actvity_" + numActId) || bot.hasRed("Activity_" + numActId) ||
                                    (actItem && typeof actItem.getHongdian === "function" && actItem.getHongdian()) ||
                                    (actItem && typeof actItem.hasRed === "function" && actItem.hasRed());

                                if (hasActRed && actItem && typeof actItem.getGroupLibList === "function" && typeof am.reqActReward === "function") {
                                    const libList = actItem.getGroupLibList() || {};
                                    let claimedForThisAct = 0;
                                    for (let grpId in libList) {
                                        if (claimedForThisAct >= 3 || bot.state.actTaskFailCooldown) break;
                                        const subMap = libList[grpId] || {};
                                        for (let subId in subMap) {
                                            if (claimedForThisAct >= 3 || bot.state.actTaskFailCooldown) break;
                                            const numSubId = Number(subId);
                                            const numGrpId = Number(grpId);
                                            const actSubKey = numActId + "_" + numSubId;
                                            if (bot.state.claimedActSubIds.has(actSubKey)) continue;
                                            const alreadyGot = typeof actItem.rewardbGet === "function" ? actItem.rewardbGet(numSubId, numGrpId) : false;
                                            if (!alreadyGot) {
                                                const condObj = typeof actItem.getCondsObj === "function" ? actItem.getCondsObj(subMap[subId]) : null;
                                                if (condObj) {
                                                    const keys = Object.keys(condObj);
                                                    if (keys.length > 0) {
                                                        const targetType = +keys[0];
                                                        const targetKey = condObj[targetType].targetKey;
                                                        const targetVal = condObj[targetType].targetVal;
                                                        if (targetVal > 0) {
                                                            const curProgress = typeof actItem.getProcessExByTypeAndKey === "function"
                                                                ? actItem.getProcessExByTypeAndKey(targetType, targetKey) : 0;
                                                            if (targetVal <= curProgress) {
                                                                bot.state.claimedActSubIds.add(actSubKey);
                                                                am.reqActReward(numActId, numSubId);
                                                                bot.log(`🎯 [Sự Kiện ID ${numActId}] Tự động nhận thưởng nhiệm vụ mốc [SubID: ${numSubId}]!`);
                                                                claimedForThisAct++;
                                                                didSomething = true;
                                                                await bot.sleep(800);
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    // Đặt cooldown 10 phút cho sự kiện này để không quét liên tục
                                    bot.state.actFailCooldowns[numActId] = Date.now() + 10 * 60000;
                                }
                            }
                        }
                    }
                }
            } catch (eAct) { }

            // 8. Nhận Thưởng Mở Tính Năng Mới (FunPreModel - SystemPickModuleNoticeCs: 50 KNB / mỗi tính năng đã mở khóa)
            try {
                const fpm = mm.FunPreModel;
                const modCfg = (gm && gm.ModuleConfiger) || window.ModuleConfiger;
                const modUtil = (gm && gm.ModuleUtil) || window.ModuleUtil;
                if (fpm && modCfg && typeof modCfg.getFunPreIds === "function" && bot.canDo("daily_funpre_knb", 300)) {
                    bot.markDone("daily_funpre_knb");
                    if (!bot.state.attemptedFunPreIds) bot.state.attemptedFunPreIds = {};
                    const preIds = modCfg.getFunPreIds() || [];
                    for (let i = 0; i < preIds.length; i++) {
                        const mid = Number(preIds[i]);
                        if (!mid || bot.state.attemptedFunPreIds[mid]) continue;
                        const alreadyPicked = typeof fpm.isPick === "function" ? fpm.isPick(mid) : true;
                        const isOpened = (modUtil && typeof modUtil.moduleOpen === "function") ? modUtil.moduleOpen(mid, false) : false;
                        if (!alreadyPicked && isOpened && typeof fpm.reqPickModuleNotice === "function") {
                            bot.state.attemptedFunPreIds[mid] = true;
                            fpm.reqPickModuleNotice(mid);
                            await bot.sleep(450);
                            if (typeof fpm.isPick === "function" && fpm.isPick(mid)) {
                                bot.log(`💎 [Thưởng Mở Tính Năng] Tự động nhận 50 KNB mở khóa tính năng [Module ID: ${mid}]!`);
                                didSomething = true;
                            }
                        }
                    }
                }
            } catch (eFunPre) { }

            // 9. Nhận Thưởng Sổ Tay Đồ Giám (HeroManualModel: Tướng, Thần Binh, Thiên Phú, Cẩm Nang, Thời Trang & Mốc Tổng)
            try {
                const hmm = mm.HeroManualModel;
                if (hmm && bot.canDo("daily_hero_manual_knb", 180)) {
                    bot.markDone("daily_hero_manual_knb");
                    bot.state.claimedManualIds = bot.state.claimedManualIds || new Set();
                    const manualCategories = [
                        { mapName: "heroManualCanGetMap", reqFn: "reqHeroManualPickHero", label: "Đồ Giám Tướng" },
                        { mapName: "godWeaponManualCanGetMap", reqFn: "reqHeroManualPickArtifact", label: "Đồ Giám Thần Binh" },
                        { mapName: "talentManualCanGetMap", reqFn: "reqHeroManualPickTalent", label: "Đồ Giám Thiên Phú" },
                        { mapName: "silkPouchManualCanGetMap", reqFn: "reqHeroManualPickTalent2", label: "Đồ Giám Cẩm Nang" },
                        { mapName: "skinManualCanGetMap", reqFn: "reqHeroManualPickFashion", label: "Đồ Giám Thời Trang" }
                    ];
                    let manualClaimCount = 0;
                    for (let cat of manualCategories) {
                        const canMap = hmm[cat.mapName];
                        if (canMap && typeof canMap === "object" && typeof hmm[cat.reqFn] === "function") {
                            const ids = Object.keys(canMap);
                            for (let k = 0; k < ids.length; k++) {
                                const itemId = Number(ids[k]);
                                const mKey = cat.mapName + "_" + itemId;
                                if (itemId > 0 && canMap[ids[k]] && !bot.state.claimedManualIds.has(mKey)) {
                                    bot.state.claimedManualIds.add(mKey);
                                    hmm[cat.reqFn](itemId);
                                    manualClaimCount++;
                                    didSomething = true;
                                    await bot.sleep(250);
                                    if (manualClaimCount >= 10) break;
                                }
                            }
                        }
                        if (manualClaimCount >= 10) break;
                    }
                    if (manualClaimCount > 0) {
                        bot.log(`📖 [Đồ Giám] Tự động kích hoạt & nhận thưởng ${manualClaimCount} mục Sổ Tay Đồ Giám!`);
                    }
                    if (typeof hmm.getHeroManualCanGet === "function" && hmm.getHeroManualCanGet() && typeof hmm.reqHeroManualPick === "function" && bot.canDo("daily_hero_manual_lv_pick", 600)) {
                        bot.markDone("daily_hero_manual_lv_pick");
                        hmm.reqHeroManualPick();
                        bot.log("💎 [Đồ Giám] Tự động nhận thưởng cấp độ Sổ Tay Đồ Giám!");
                        didSomething = true;
                        await bot.sleep(400);
                    }
                }
            } catch (eManual) { }

            // 10. Nhận Thưởng Treo Máy Offline Vượt Ải (OfflinePassModel - CopyGetOfflineCs)
            try {
                const opm = mm.OfflinePassModel;
                if (opm && typeof opm.reqGetOffLineData === "function" && bot.hasRed("M_OfflinePass") && bot.canDo("daily_offline_pass_check", 300)) {
                    bot.markDone("daily_offline_pass_check");
                    opm.reqGetOffLineData();
                    await bot.sleep(300);
                }
            } catch (eOffPass) { }

            return didSomething;
        },

        // Wrapper tương thích ngược cho các hook cũ
        runAutoActivitySmart: async function () {
            return await bot.runAutoDailyRewardsSmart();
        },

        // ====================================================================
        // TÍNH NĂNG 12b: TỰ ĐỘNG QUAY MIỄN PHÍ MỖI NGÀY & RƯƠNG MỐC TÀNG BẢO CÁC
        // ====================================================================
        runAutoFreeLotterySmart: async function (force = false) {
            if (typeof G_Mapping === "undefined" || !G_Mapping.RPCReq) return false;
            if (bot.isBattling()) return false;
            if (!force && !bot.canDo("auto_free_lottery", 30)) return false;

            const mm = window.ModelManager;
            if (!mm) return false;
            const gcm = mm.GetCardsNewModel;
            const gm = window.G_Mapping;
            const rpc = (gm && gm.RPCReq) || window.RPCReq;
            if (!rpc || typeof rpc.send !== "function") return false;

            bot.markDone("auto_free_lottery");
            let didSomething = false;

            // 0. Luôn kích hoạt Bỏ qua hoạt ảnh quay (Skip Animation 0s)
            try {
                if (gcm && typeof gcm.setSkipAnima === "function" && !gcm.getSkipAnima()) {
                    gcm.setSkipAnima(true);
                }
            } catch (e) { }

            const lotteryProto = (gm && gm.LotteryStartCs && gm.LotteryStartCs.protocol) || 10810;
            const pickScoreProto = (gm && gm.LotteryPickScoreCs && gm.LotteryPickScoreCs.protocol) || 10830;

            // Quay miễn phí có XÁC MINH: chỉ coi là thành công khi server cập nhật số lượt đã dùng.
            // Nếu server không xác nhận -> tạm khóa loại quay đó (30 phút -> 2 giờ) để không spam request mỗi 30s.
            if (!bot.state.lotteryBlockUntil) bot.state.lotteryBlockUntil = {};
            if (!bot.state.lotteryFailCount) bot.state.lotteryFailCount = {};
            const freeSpin = async (type, label) => {
                if (!gcm || typeof gcm.getFreeTimeLeftByLotteryType !== "function") return;
                const blockUntil = bot.state.lotteryBlockUntil[type] || 0;
                if (Date.now() < blockUntil) return;
                const left0 = gcm.getFreeTimeLeftByLotteryType(type);
                if (!(left0 > 0)) return;

                // Xác minh lượt MIỄN PHÍ THẬT SỰ (tránh nhầm với lượt còn lại do Xem QC):
                // Trong engine Cocos, khi hết lượt miễn phí (free_time - used <= 0), hàm getFreeTimeLeftByLotteryType
                // sẽ trả về số lượt xem QC (AdvertModel.getAdEffectTimes). Gửi RPC 10810 trực tiếp sẽ bị server từ chối.
                const lc = window.LotteryConfiger || (gm && gm.LotteryConfiger) || (typeof window.__require === "function" && (function() { try { const m = window.__require("LotteryConfiger"); return m && (m.LotteryConfiger || m.default || m); } catch(e){} })());
                if (lc && typeof lc.getLotteryData === "function") {
                    const lData = lc.getLotteryData(type);
                    const maxFree = (lData && typeof lData.free_time === "number") ? lData.free_time : 0;
                    const usedFree = typeof gcm.getFreeTimeUseByLotteryType === "function" ? gcm.getFreeTimeUseByLotteryType(type) : 0;
                    if (maxFree - usedFree <= 0) {
                        return; // Đã hết lượt miễn phí thật sự (chỉ còn lượt QC) -> Không gửi RPC chay
                    }
                }

                // Server chưa từng gửi dữ liệu lượt quay loại này (LotteryInfoSc) -> "lượt miễn phí" chỉ là tính toán phía client
                // (thường do tính năng chưa mở thật trên server / mở khóa giả phía client) -> không gửi request vô ích.
                if (typeof gcm.getLotteryInfoByType === "function" && !gcm.getLotteryInfoByType(type)) {
                    bot.state.lotteryBlockUntil[type] = Date.now() + 120 * 60000;
                    bot.log(`⚠️ ${label} Server chưa có dữ liệu lượt quay (tính năng chưa mở thật trên tài khoản) -> Bỏ qua 2 giờ.`);
                    return;
                }
                const use0 = typeof gcm.getTotUseByLotteryType === "function" ? gcm.getTotUseByLotteryType(type) : 0;
                const free0 = typeof gcm.getFreeTimeUseByLotteryType === "function" ? gcm.getFreeTimeUseByLotteryType(type) : 0;
                bot.log(`${label} Phát hiện lượt quay Miễn Phí -> Đang tự động mở...`);
                const payload = { _type: type, _cnt: 1 };
                if (typeof gcm.saveReportData === "function") {
                    try { gcm.saveReportData([0, 0], payload); } catch (e) { }
                }
                rpc.send(lotteryProto, payload);
                didSomething = true;
                await bot.sleep(1800);
                const left1 = gcm.getFreeTimeLeftByLotteryType(type);
                const use1 = typeof gcm.getTotUseByLotteryType === "function" ? gcm.getTotUseByLotteryType(type) : 0;
                const free1 = typeof gcm.getFreeTimeUseByLotteryType === "function" ? gcm.getFreeTimeUseByLotteryType(type) : 0;
                if (use1 > use0 || free1 > free0 || left1 < left0) {
                    bot.state.lotteryFailCount[type] = 0;
                    bot.log(`OK ${label} Quay miễn phí thành công!`);
                } else {
                    const fc = (bot.state.lotteryFailCount[type] || 0) + 1;
                    bot.state.lotteryFailCount[type] = fc;
                    const coolMin = fc === 1 ? 30 : 120;
                    bot.state.lotteryBlockUntil[type] = Date.now() + coolMin * 60000;
                    bot.log(`⚠️ ${label} Server không xác nhận lượt quay miễn phí [đã dùng free: ${free0}->${free1}, tổng: ${use0}->${use1}, còn: ${left0}->${left1}] (có thể là lượt cần xem QC hoặc tính năng chưa mở thật) -> Tạm hoãn ${coolMin} phút.`);
                }
            };
            // Nhận rương mốc điểm: mỗi rương tối đa 1 lần / 10 phút (tránh spam khi model chưa kịp cập nhật)
            const pickScoreBoxes = async (scoreType, label) => {
                const lc = window.LotteryConfiger || (gm && gm.LotteryConfiger);
                const cfg = (lc && typeof lc.getLotteryScoreByType === "function" && lc.getLotteryScoreByType(scoreType)) || (gcm && gcm["scoreType" + scoreType + "Cfg"]);
                if (!Array.isArray(cfg) || cfg.length === 0 || !mm.PlayerModel) return;
                const scoreTid = cfg[0].tid;
                const currentScore = typeof mm.PlayerModel.getItemNum === "function" ? mm.PlayerModel.getItemNum(scoreTid) : 0;
                for (let box of cfg) {
                    const isCompleted = gcm && typeof gcm.isLotteryScoreComplete === "function" ? gcm.isLotteryScoreComplete(box.id) : true;
                    if (!isCompleted && currentScore >= box.score && bot.tryDo("lottery_box_" + box.id, 600)) {
                        bot.log(`📦 ${label} Đạt ${currentScore}/${box.score} điểm -> Đang nhận Rương mốc [ID: ${box.id}]...`);
                        rpc.send(pickScoreProto, { _type: box.type });
                        didSomething = true;
                        await bot.sleep(600);
                    }
                }
            };

            // 1. TÀNG BẢO CÁC / RƯƠNG GIÁM BẢO (LotteryType 7 - Pháp Bảo) + rương mốc (score type 5)
            try { await freeSpin(7, "🎁 [Tàng Bảo Các]"); } catch (e) { }
            try { await pickScoreBoxes(5, "[Tàng Bảo Các]"); } catch (e) { }
            // 2. CHIÊU MỘ DANH TƯỚNG (Thăm Mộ - LotteryType 2)
            try { await freeSpin(2, "🎴 [Chiêu Mộ]"); } catch (e) { }
            // 3. RÈN THẦN BINH (LotteryType 5) + rương mốc (score type 2)
            try { await freeSpin(5, "🗡️ [Thần Binh]"); } catch (e) { }
            try { await pickScoreBoxes(2, "[Thần Binh]"); } catch (e) { }

            return didSomething;
        },

        // ====================================================================
        // TÍNH NĂNG 13: TỰ ĐỘNG VƯỢT ẢI PHI ĐAO (Auto-Win & Tự Sang Màn)
        // ====================================================================
        runAutoFeiDaoSmart: async function () {
            if (typeof G_Mapping === "undefined" || !G_Mapping.RPCReq) return false;
            if (bot.isBattling()) return false;
            if (!bot.canDo("auto_feidao_loop", 10)) return false;

            const vm = bot.getViewManager();
            if (!vm || typeof vm.isOpenView !== "function") return false;

            // Nếu đang mở FeiDaoGameView thì để hook tự động xử lý onGameWin
            if (vm.isOpenView("FeiDaoGameView")) return true;

            // Nếu đang ở màn hình chọn màn FeiDaoMainView và còn màn chưa hoàn thành -> Tự động vào màn
            if (vm.isOpenView("FeiDaoMainView")) {
                bot.markDone("auto_feidao_loop");
                const v = vm.getView("FeiDaoMainView");
                if (v && v.btn_enter && typeof v.btn_enter.onClick === "function") {
                    try {
                        bot.log("🗡️ [Phi Đao] Phát hiện giao diện Phi Kiếm Đạo -> Bắt đầu tự động khiêu chiến màn mới...");
                        v.btn_enter.onClick();
                        return true;
                    } catch (e) { }
                }
            }
            return false;
        },

        // ====================================================================
        // TÍNH NĂNG 14: TỰ ĐỘNG TẦM BẢO LONG MẠCH (CỜ TỶ PHÚ & AIM-BOT XÚC XẮC VÀNG)
        // ====================================================================
        runAutoLongMachSmart: async function () {
            if (typeof G_Mapping === "undefined" || !G_Mapping.RPCReq) return false;
            if (bot.isBattling()) return false;
            if (!bot.canDo("auto_longmach", 12)) return false;

            try {
                const mm = window.ModelManager;
                if (!mm || !mm.ActivityModel) return false;
                const am = mm.ActivityModel;
                const dm = mm.ActivityDragonRewardModel;
                const pm = mm.PlayerModel;
                if (!pm) return false;

                const lc = window.LmLotteryConfiger || (window.G_Mapping && window.G_Mapping.LmLotteryConfiger);

                // 1. Tìm ID hoạt động Long Mạch
                let curData = dm ? dm.getCurData() : null;
                let targetActId = curData ? curData._act_id : null;
                let actConfig = null;

                if (!targetActId && am.getAllData && lc) {
                    const allActs = am.getAllData();
                    if (allActs && typeof allActs === "object") {
                        for (let id in allActs) {
                            const act = allActs[id];
                            if (act && typeof act.getModelId === "function") {
                                const mId = act.getModelId();
                                const mCfg = lc.getModelDataById ? lc.getModelDataById(mId) : null;
                                if (mCfg) {
                                    targetActId = Number(id);
                                    actConfig = mCfg;
                                    break;
                                }
                            }
                        }
                    }
                }

                if (!targetActId) return false;
                bot.markDone("auto_longmach");

                const vm = bot.getViewManager();
                // Nếu giao diện đang chạy hoạt cảnh nhảy thì tạm chờ
                if (vm && typeof vm.getView === "function") {
                    const mv = vm.getView("DragonRewardMainView");
                    if (mv && mv.isMoving) return false;
                }

                // Khởi tạo costData nếu chưa có
                if (dm && (!dm.costDataTouzi || !dm.costDataGoldTouzi)) {
                    if (typeof dm.initCostData === "function") dm.initCostData();
                }

                const actData = am.getActDataById ? am.getActDataById(targetActId) : null;
                if (actData && !actConfig && lc && typeof lc.getModelDataById === "function") {
                    actConfig = lc.getModelDataById(actData.getModelId());
                }

                const costTouzi = (dm && dm.costDataTouzi) || (actConfig && actConfig.cost && actConfig.cost[0]);
                const costGoldTouzi = (dm && dm.costDataGoldTouzi) || (actConfig && actConfig.cost2 && actConfig.cost2[0]);

                // 2. Xử lý trạng thái trigger Mini Game (nếu nhân vật đang đứng ở ô Sự Kiện)
                curData = dm ? dm.getCurData() : null;
                if (curData && curData._trigger === 1) {
                    const argVal = (curData._args && curData._args[0]) ? curData._args[0]._val : 0;
                    if (argVal === 3) {
                        // Rương bí ẩn 2 chọn 1
                        bot.log("🐉 [Long Mạch] Mini Game Rương Bí Ẩn (2 chọn 1): Tự động chọn rương & nhận quà...");
                        if (typeof dm.reqDragonBoxIdx === "function") {
                            dm.reqDragonBoxIdx(Math.floor(Math.random() * 2));
                        }
                    } else if (argVal === 2) {
                        // Slot Machine 3 cuộn
                        bot.log("🐉 [Long Mạch] Mini Game Máy Kéo May Mắn (Slot Machine): Nhận thưởng cuộn quay...");
                        if (typeof dm.popReward === "function") dm.popReward();
                    } else if (argVal === 1) {
                        // Bùa May Mắn x2/x3
                        bot.log("🐉 [Long Mạch] Mini Game May Mắn Long Mạch: Kích hoạt Bùa Bạo Kích Bội Số...");
                        if (typeof dm.popReward === "function") dm.popReward();
                    } else {
                        if (typeof dm.reqDragonBoxIdx === "function") dm.reqDragonBoxIdx(0);
                    }

                    await bot.sleep(400);
                    if (vm && typeof vm.isOpenView === "function") {
                        if (vm.isOpenView("DragonRewardBoxView")) vm.close("DragonRewardBoxView");
                        if (vm.isOpenView("DragonRewardRollView")) vm.close("DragonRewardRollView");
                        if (vm.isOpenView("DragonRewardLuckyView")) vm.close("DragonRewardLuckyView");
                        if (vm.isOpenView("DragonRewardSelectPointView")) vm.close("DragonRewardSelectPointView");
                    }
                    if (typeof dm.popReward === "function") dm.popReward();
                    if (typeof dm.showAllReward === "function") dm.showAllReward();
                    await bot.sleep(300);
                    curData = dm ? dm.getCurData() : null;
                }

                // 3. Đọc dữ liệu 26 ô bàn cờ (allGridData)
                let allGridData = [];
                if (lc && typeof lc.getAllGridByPool === "function" && curData && actConfig && actConfig.pool) {
                    const curRound = curData._round || 1;
                    let targetPoolId = 0;
                    for (let s = 0; s < actConfig.pool.length; s++) {
                        const l = actConfig.pool[s];
                        if (curRound <= l[0]) {
                            targetPoolId = l[1];
                            break;
                        }
                    }
                    if (targetPoolId > 0) {
                        allGridData = lc.getAllGridByPool(targetPoolId) || [];
                    }
                }

                const silverDiceId = costTouzi ? costTouzi[0] : null;
                const silverCostAmt = costTouzi ? costTouzi[1] : 1;
                const goldDiceId = costGoldTouzi ? costGoldTouzi[0] : null;
                const goldCostAmt = costGoldTouzi ? costGoldTouzi[1] : 1;

                let silverCount = silverDiceId ? pm.getItemNum(silverDiceId) : 0;
                let goldCount = goldDiceId ? pm.getItemNum(goldDiceId) : 0;
                const curPos = curData ? curData._location : 1;

                // 4. THUẬT TOÁN AIM-BOT XÚC XẮC HOÀNG KIM (VÀNG)
                // Ưu tiên 1: Ô type === 5 (Mini-game Sự Kiện: Slot Machine / Rương bí ẩn / Bùa x2)
                // Ưu tiên 2: Ô type === 4 (Bảo rương VIP Jackpot)
                // Giữ xúc xắc vàng nếu không có ô đặc biệt trong tầm 1-6 bước!
                if (goldCount >= goldCostAmt && curData && allGridData.length > 0 && curData._trigger !== 1) {
                    let bestStep = null;
                    let bestTargetName = "";

                    // Kiểm tra ô Sự Kiện type 5 (Mini Game)
                    for (let step = 1; step <= 6; step++) {
                        let targetLoc = curPos + step;
                        if (targetLoc > 26) targetLoc -= 26;
                        const grid = allGridData.find(g => g && g.location === targetLoc);
                        if (grid && grid.type === 5) {
                            bestStep = step;
                            bestTargetName = `Ô Mini Game Sự Kiện [Vị trí ${targetLoc}]`;
                            break;
                        }
                    }

                    // Nếu không có type 5, kiểm tra ô Quà VIP Jackpot (type 4)
                    if (!bestStep) {
                        for (let step = 1; step <= 6; step++) {
                            let targetLoc = curPos + step;
                            if (targetLoc > 26) targetLoc -= 26;
                            const grid = allGridData.find(g => g && g.location === targetLoc);
                            if (grid && grid.type === 4) {
                                bestStep = step;
                                bestTargetName = `Ô Quà VIP Jackpot [Vị trí ${targetLoc}]`;
                                break;
                            }
                        }
                    }

                    if (bestStep) {
                        bot.log(`🎯 [Aim-bot Long Mạch] Phát hiện ${bestTargetName} cách ${bestStep} bước! Dùng Xúc Xắc Vàng -> Chọn [${bestStep}] điểm...`);
                        am.reqActReward(targetActId, 0, [ bestStep ]);
                        await bot.sleep(1000);

                        curData = dm ? dm.getCurData() : null;
                        if (curData && curData._trigger === 1) {
                            const argVal = (curData._args && curData._args[0]) ? curData._args[0]._val : 0;
                            if (argVal === 3 && typeof dm.reqDragonBoxIdx === "function") {
                                dm.reqDragonBoxIdx(Math.floor(Math.random() * 2));
                                await bot.sleep(400);
                            }
                            if (typeof dm.popReward === "function") dm.popReward();
                        }
                        if (vm && typeof vm.isOpenView === "function") {
                            if (vm.isOpenView("DragonRewardBoxView")) vm.close("DragonRewardBoxView");
                            if (vm.isOpenView("DragonRewardRollView")) vm.close("DragonRewardRollView");
                            if (vm.isOpenView("DragonRewardLuckyView")) vm.close("DragonRewardLuckyView");
                            if (vm.isOpenView("DragonRewardSelectPointView")) vm.close("DragonRewardSelectPointView");
                        }
                        if (typeof dm.showAllReward === "function") dm.showAllReward();
                        return true;
                    }
                }

                // 5. TỰ ĐỘNG ĐỔ XÚC XẮC THƯỜNG (BẠC)
                if (silverCount >= silverCostAmt && curData && curData._trigger !== 1) {
                    bot.log(`🎲 [Long Mạch] Đang có ${silverCount} Xúc Xắc Thường -> Đổ xúc xắc ngẫu nhiên...`);
                    am.reqActReward(targetActId, 0);
                    await bot.sleep(1000);

                    curData = dm ? dm.getCurData() : null;
                    if (curData && curData._trigger === 1) {
                        const argVal = (curData._args && curData._args[0]) ? curData._args[0]._val : 0;
                        if (argVal === 3 && typeof dm.reqDragonBoxIdx === "function") {
                            dm.reqDragonBoxIdx(Math.floor(Math.random() * 2));
                            await bot.sleep(400);
                        }
                        if (typeof dm.popReward === "function") dm.popReward();
                    }
                    if (vm && typeof vm.isOpenView === "function") {
                        if (vm.isOpenView("DragonRewardBoxView")) vm.close("DragonRewardBoxView");
                        if (vm.isOpenView("DragonRewardRollView")) vm.close("DragonRewardRollView");
                        if (vm.isOpenView("DragonRewardLuckyView")) vm.close("DragonRewardLuckyView");
                        if (vm.isOpenView("DragonRewardSelectPointView")) vm.close("DragonRewardSelectPointView");
                    }
                    if (typeof dm.showAllReward === "function") dm.showAllReward();
                    return true;
                }

                // 6. Dọn dẹp hàng đợi nhận thưởng nếu có
                if (dm && dm.rewardQueue && dm.rewardQueue.length > 0) {
                    if (typeof dm.showAllReward === "function") dm.showAllReward();
                }

                return false;
            } catch (err) {
                return false;
            }
        },

        // ====================================================================
        // TÍNH NĂNG 15: TỰ ĐỘNG LONG HỔ TRANH BÁ (LÌ XÌ, ĐOÁN QUÁN QUÂN/Á QUÂN, ĐOÁN 1V1)
        // ====================================================================
        runAutoSkVsSmart: async function (forceBetOnly) {
            if (!forceBetOnly && !bot.canDo("auto_skvs", 15)) return;
            try {
                const mm = window.ModelManager;
                const sm = (mm && mm.SkVsModel) || (window.G_Mapping && window.G_Mapping.SkVsModel);
                const tm = mm && mm.ServerTimeModel;
                const nowSec = tm ? tm.getServerTime() : Math.floor(Date.now() / 1000);
                const rm = (mm && mm.RedManager) || window.RedManager;

                if (!forceBetOnly) {
                    bot.markDone("auto_skvs");
                }

                if (sm) {
                    const md = sm.mainData;
                    if (!md) {
                        if (typeof sm.reqHallViewData === "function" && bot.tryDo("skvs_hall_init", 60)) {
                            sm.reqHallViewData();
                        }
                    } else if (nowSec >= md._g_sec) {
                        // -------------------------------------------------------------
                        // A. TỰ ĐỘNG BỐC LÌ XÌ & NHẬN THƯỞNG SERVER
                        // -------------------------------------------------------------
                        // 1. Nhận thưởng Server nếu có (hasSameServerReward)
                        if (sm.hasSameServerReward || sm._hasSameServerReward) {
                            if (typeof sm.reqPickShowReward === "function" && bot.tryDo("skvs_pick_reward", 30)) {
                                bot.log("🏆 [Long Hổ] Đã nhận thưởng Server giải Long Hổ Tranh Bá!");
                                sm.reqPickShowReward();
                            }
                        }

                        // 2. Tự động bốc lì xì (Red Packet)
                        const hasRedDot = rm && typeof rm.getTips === "function" ? rm.getTips("V_SkvsRed") : false;

                        let isRedPackTime = false;
                        let smallState = 0;
                        try {
                            const su = window.SkVsUtil || (window.G_Mapping && window.G_Mapping.SkVsUtil);
                            if (su && typeof su.getStateTimeLeft === "function") {
                                const stateLeft = su.getStateTimeLeft();
                                smallState = stateLeft ? stateLeft[0] : 0;
                                if (smallState === 1) isRedPackTime = true;
                            }
                        } catch (e) { }

                        const lastRed = sm._lastAttendRedTime || bot.state._skvsLastRedPackReq || 0;
                        const timeSinceLastRed = nowSec - lastRed;
                        // Chỉ bốc lì xì khi thực sự có chấm đỏ V_SkvsRed và giãn cách tối thiểu 30s
                        if (hasRedDot && timeSinceLastRed > 30) {
                            if (typeof sm.reqGetRedPack === "function" && bot.tryDo("skvs_redpack_req", 30)) {
                                bot.state._skvsLastRedPackReq = nowSec;
                                sm._lastAttendRedTime = nowSec;
                                bot.log("🧧 [Long Hổ] Đang bốc lì xì giải đấu Long Hổ Tranh Bá...");
                                sm.reqGetRedPack();
                                await bot.sleep(450);
                            }
                        }

                        // -------------------------------------------------------------
                        // B. TỰ ĐỘNG ĐOÁN TOP (QUÁN QUÂN, Á QUÂN, TOP 3, TOP 4)
                        // -------------------------------------------------------------
                        const stateInfo = typeof sm.getSkVsState === "function" ? sm.getSkVsState() : null;
                        const bigState = stateInfo ? stateInfo[0] : (nowSec < md._guess_sec ? 1 : 2);

                        if (bigState === 1 && md._is_guess !== 1) {
                            const myGuesses = sm.myGuessData || {};
                            const missingRanks = [];
                            for (let r = 1; r <= 4; r++) {
                                const guessEntry = myGuesses[r];
                                const rid = guessEntry ? (guessEntry._rid || guessEntry) : 0;
                                if (!rid || rid === 0) {
                                    missingRanks.push(r);
                                }
                            }

                            if (missingRanks.length > 0) {
                                let candidates = bot.state._skvsCandidates;
                                if (!candidates || candidates.length < 4) {
                                    if (typeof sm.reqGuessRolePageData === "function" && bot.tryDo("skvs_req_candidates", 10)) {
                                        bot.log("🔍 [Long Hổ] Đang nạp danh sách cao thủ dự đoán Quán Quân / Á Quân...");
                                        sm.reqGuessRolePageData(1);
                                        if (typeof sm.reqGuessViewData === "function") {
                                            sm.reqGuessViewData();
                                        }
                                    }
                                } else {
                                    const sortedCandidates = candidates.slice().sort((a, b) => {
                                        const pA = bot.getCandidatePower(a);
                                        const pB = bot.getCandidatePower(b);
                                        return pB - pA;
                                    });

                                    const pickedRids = new Set();
                                    for (let r = 1; r <= 4; r++) {
                                        if (!missingRanks.includes(r) && myGuesses[r]) {
                                            const gRid = myGuesses[r]._rid || myGuesses[r];
                                            if (gRid) pickedRids.add(gRid);
                                        }
                                    }

                                    for (let r of missingRanks) {
                                        let chosen = null;
                                        for (let cand of sortedCandidates) {
                                            const cRid = bot.getCandidateRid(cand);
                                            if (cRid && !pickedRids.has(cRid)) {
                                                chosen = cand;
                                                break;
                                            }
                                        }

                                        if (chosen && bot.tryDo(`skvs_guess_rank_${r}`, 8)) {
                                            const cRid = bot.getCandidateRid(chosen);
                                            const cName = bot.getCandidateName(chosen) || `Cao thủ #${cRid}`;
                                            const cPower = bot.getCandidatePower(chosen);
                                            pickedRids.add(cRid);

                                            const rankNames = {
                                                1: "Quán Quân (Top 1)",
                                                2: "Á Quân (Top 2)",
                                                3: "Hạng 3 (Top 3)",
                                                4: "Hạng 4 (Top 4)"
                                            };
                                            bot.log(`🎯 [Long Hổ] Tự động chọn ${rankNames[r] || "Hạng " + r}: ${cName} (LC: ${bot.formatNumber(cPower)})`);
                                            sm.reqSelectGuessRole(r, cRid);
                                            await bot.sleep(350);
                                        }
                                    }
                                }
                            }
                        }

                        // -------------------------------------------------------------
                        // C. TỰ ĐỘNG ĐOÁN TRẬN 1V1 (ĐOÁN AI WIN / CƯỢC MAX 100% SỐ ĐANG CÓ)
                        // -------------------------------------------------------------
                        if (bigState === 2) {
                            if (smallState === 2 || smallState === 0) {
                                if (!forceBetOnly && (!bot.state._skvsVsingData || bot.tryDo("skvs_refresh_vsing", 12))) {
                                    if (typeof sm.reqGuessViewVsing === "function") {
                                        sm.reqGuessViewVsing();
                                        await bot.sleep(600);
                                    }
                                }

                                const vsData = bot.state._skvsVsingData;
                                if (vsData && vsData._array_list && vsData._array_list.length >= 2) {
                                    const userSide = vsData._side || 0;
                                    let availableChip = Number(vsData._chip) || 0;
                                    try {
                                        const vm = (window.G_Mapping && window.G_Mapping.ViewManager) || window.ViewManager;
                                        if (vm && typeof vm.getView === "function") {
                                            const guessView = vm.getView("SkVsGuessView");
                                            if (guessView && guessView.SkVsGuessingComp && (Number(guessView.SkVsGuessingComp.hasChip) || 0) > availableChip) {
                                                availableChip = Number(guessView.SkVsGuessingComp.hasChip) || 0;
                                            }
                                        }
                                        const pm = mm && mm.PlayerModel;
                                        if (pm && typeof pm.getItemNum === "function") {
                                            const bagChip = Number(pm.getItemNum(26)) || 0;
                                            if (bagChip > availableChip) availableChip = bagChip;
                                        }
                                    } catch (eChip) { }

                                    const betAmount = Math.floor(availableChip / 10) * 10;

                                    if (userSide === 0 && betAmount >= 10 && bot.tryDo("skvs_vsing_bet", 8)) {
                                        const role1 = vsData._array_list[0]._role_show;
                                        const role2 = vsData._array_list[1]._role_show;

                                        const p1 = bot.getCandidatePower(role1);
                                        const p2 = bot.getCandidatePower(role2);
                                        const name1 = bot.getCandidateName(role1) || "Cửa Trái";
                                        const name2 = bot.getCandidateName(role2) || "Cửa Phải";

                                        const chosenSide = p1 >= p2 ? 1 : 2;
                                        const chosenName = chosenSide === 1 ? name1 : name2;
                                        const chosenPower = chosenSide === 1 ? p1 : p2;

                                        bot.log(`⚔️ [Long Hổ] Đoán 1v1: Đặt Cửa ${chosenSide === 1 ? "Trái" : "Phải"} [${chosenName}] (LC: ${bot.formatNumber(chosenPower)}) - CƯỢC MAX: ${betAmount} xu / ${availableChip} xu`);
                                        sm.reqVsingGuess(chosenSide, betAmount);
                                        vsData._side = chosenSide;
                                        vsData._chip = Math.max(0, availableChip - betAmount);
                                    }
                                }
                            }
                        }
                    }
                }

                // -------------------------------------------------------------
                // D. TỰ ĐỘNG CƯỢC MAX 100% TRẬN 1V1 GIẢI LIÊN SERVER (TIANSHI)
                // -------------------------------------------------------------
                try {
                    const tsm = (mm && mm.TianshiModel) || (window.G_Mapping && window.G_Mapping.TianshiModel);
                    if (tsm && typeof tsm.getStage === "function") {
                        const tsStage = tsm.getStage();
                        const hasTsGuessRed = rm && typeof rm.getTips === "function" ? rm.getTips("V_Tianshi_Guess") : false;
                        if (tsStage > 0 && (hasTsGuessRed || tsm._warGuessData || bot.state._tianshiWarGuessData)) {
                            if (!forceBetOnly && bot.tryDo("tianshi_refresh_war_guess", 15)) {
                                if (typeof tsm.reqTianshiMine === "function") tsm.reqTianshiMine();
                                if (typeof tsm.reqTianshiWarGuess === "function") tsm.reqTianshiWarGuess();
                                await bot.sleep(600);
                            }
                            const warData = tsm._warGuessData || bot.state._tianshiWarGuessData;
                            const mine = typeof tsm.getTianshiMine === "function" ? tsm.getTianshiMine() : tsm._tianshiMine;
                            const availableChip = (mine && Number(mine._chip)) || 0;
                            const betAmount = Math.floor(availableChip / 10) * 10;

                            if (warData && (warData._side || 0) === 0 && betAmount >= 10 && Array.isArray(warData._role_show) && warData._role_show.length >= 2 && bot.tryDo("tianshi_vsing_bet", 8)) {
                                const role1 = warData._role_show[0];
                                const role2 = warData._role_show[1];
                                const p1 = bot.getCandidatePower(role1);
                                const p2 = bot.getCandidatePower(role2);
                                const name1 = bot.getCandidateName(role1) || "Cửa Trái";
                                const name2 = bot.getCandidateName(role2) || "Cửa Phải";
                                const chosenSide = p1 >= p2 ? 1 : 2;
                                const chosenName = chosenSide === 1 ? name1 : name2;
                                const chosenPower = chosenSide === 1 ? p1 : p2;

                                bot.log(`⚔️ [Long Hổ Liên SV] Đoán 1v1: Đặt Cửa ${chosenSide === 1 ? "Trái" : "Phải"} [${chosenName}] (LC: ${bot.formatNumber(chosenPower)}) - CƯỢC MAX: ${betAmount} xu / ${availableChip} xu`);
                                if (typeof tsm.reqTianshiSetWarGuess === "function") {
                                    tsm.reqTianshiSetWarGuess(chosenSide, betAmount);
                                    warData._side = chosenSide;
                                }
                            }
                        }
                    }
                } catch (eTs) { }
            } catch (err) {
                bot.log(`⚠️ [Long Hổ] Lỗi xử lý tự động: ${err.message || err}`);
            }
        },

        // ====================================================================
        // TÍNH NĂNG 16: TỰ ĐỘNG THU HOẠCH CHIẾM MỎ (GUILD MINE TEAM 1 & TEAM 2)
        // ====================================================================
        runAutoGuildMineSmart: async function () {
            if (typeof G_Mapping === "undefined" || !G_Mapping.RPCReq) return false;
            if (bot.isBattling()) return false;
            if (!bot.canDo("auto_guild_mine", 20)) return false;
            if (bot.state.mineFailUntil && Date.now() < bot.state.mineFailUntil) return false;
            bot.markDone("auto_guild_mine");

            try {
                const gm = window.G_Mapping || {};
                const mm = window.ModelManager || bot.getModelManager() || gm.ModelManager;
                const cmm = mm && mm.CrossMineModel;
                if (!cmm) return false;

                // Nạp thông tin mỏ nếu chưa có
                if (!cmm.mineInfo) {
                    if (typeof cmm.reqMineInfo === "function" && bot.tryDo("req_mine_info", 60)) {
                        cmm.reqMineInfo();
                    }
                    return false;
                }

                const mi = cmm.mineInfo;
                const teams = mi._team || [];
                const nowSec = mm.ServerTimeModel ? mm.ServerTimeModel.getServerTime() : Math.floor(Date.now() / 1000);
                // Chỉ thu hoạch trong khung giờ mỏ mở (server từ chối ngoài khung giờ)
                if (mi._s_sec && nowSec < mi._s_sec) return false;
                if (mi._e_sec && nowSec >= mi._e_sec) return false;

                const mc = (window.CrossMineConfiger || (window.G_Mapping && window.G_Mapping.CrossMineConfiger));
                const misc = (mc && mc.getMineMisc ? mc.getMineMisc() : null) || { reward_min: 5 };
                // Đảm bảo tối thiểu ít nhất 5 phút (300s) + 15s an toàn để tránh bị server phạt mã lỗi 4
                const minPickSec = Math.max((misc.reward_min || 5) * 60, 300) + 15;
                const rewardMinSec = minPickSec;

                let didHarvest = false;

                // Tự động nhận thưởng Xếp Hạng Mỏ kỳ trước & Bái kiến (Zan) Mỏ
                try {
                    const rnm = (mm && mm.RankNewModel) || (gm && gm.RankNewModel);
                    if (rnm && typeof rnm.requestRankLastRankRewards === "function") {
                        const rMine = rnm.getRankLastRank ? rnm.getRankLastRank(5302) : null;
                        const bitUtil = (gm && gm.BitUtil) || window.BitUtil;
                        if (rMine && bitUtil) {
                            if (!bitUtil.checkBit(rMine._bit, 1, 1) && bot.canDo("mine_rank_reward_claim", 60)) {
                                bot.markDone("mine_rank_reward_claim");
                                bot.state.suppressMineRewardUntil = Date.now() + 2000;
                                rnm.requestRankLastRankRewards(5302, 1);
                                bot.log("🌾 [Chiếm Mỏ] Tự động nhận thưởng Xếp Hạng Mỏ kỳ trước thành công!");
                                didHarvest = true;
                            }
                            const inOpen = (cmm && typeof cmm.isInOpenTime === "function") ? cmm.isInOpenTime() : true;
                            if (inOpen && !bitUtil.checkBit(rMine._bit, 2, 1) && bot.canDo("mine_zan_reward_claim", 60)) {
                                bot.markDone("mine_zan_reward_claim");
                                bot.state.suppressMineRewardUntil = Date.now() + 2000;
                                rnm.requestRankLastRankRewards(5302, 2);
                                bot.log("🌾 [Chiếm Mỏ] Tự động bái kiến (Zan) Top Mỏ kỳ trước thành công (+Thưởng)!");
                                didHarvest = true;
                            }
                        }
                    }
                } catch (eMineRank) { }

                for (let t of teams) {
                    if (!t || !t._idx) continue;
                    // Đội hình đang ở mỏ (_hole > 0) và có thời gian tích lũy
                    if (t._hole > 0 && t._loot_time > 0) {
                        const elapsed = nowSec - t._loot_time;
                        const pickKey = `mine_pick_${t._idx}`;
                        if (elapsed >= rewardMinSec && bot.canDo(pickKey, 300)) {
                            if (typeof cmm.reqMinePick !== "function") break;
                            bot.markDone(pickKey);
                            const oldLoot = t._loot_time;
                            const minElapsed = (elapsed / 60).toFixed(1);
                            bot.log(`🌾 [Chiếm Mỏ] Đội hình ${t._idx} đã đào được ${minElapsed} phút -> Tự động thu hoạch tài nguyên mỏ...`);
                            bot.state.suppressMineRewardUntil = Date.now() + 1500;
                            cmm.reqMinePick(t._idx);
                            didHarvest = true;
                            await bot.sleep(1500);
                            // Xác minh: server trả về sẽ cập nhật _loot_time mới (updatePickReward)
                            const cur = ((cmm.mineInfo && cmm.mineInfo._team) || []).find(x => x && x._idx === t._idx);
                            if (cur && cur._loot_time === oldLoot) {
                                bot.state.cooldowns[pickKey] = Date.now() + 5 * 60000; // tổng 5 phút
                                bot.log(`⚠️ [Chiếm Mỏ] Đội hình ${t._idx} chưa được server xác nhận thu hoạch -> Thử lại sau 5 phút.`);
                            } else {
                                bot.state.cooldowns[pickKey] = Date.now() + 5 * 60000; // Đặt giãn cách 5 phút cho lần thu hoạch tiếp theo
                            }
                            if (bot.state.mineFailUntil && Date.now() < bot.state.mineFailUntil) break;
                        }
                    }
                }
                return didHarvest;
            } catch (err) {
                return false;
            }
        },

        // ====================================================================
        // WATCHDOG KẾT NỐI (Chỉ kiểm tra socket thực thụ, KHÔNG quét text thô)
        // ====================================================================
        
        startScheduleLoop: function () {
            if (window.__AUTO_BOT_LOOP_RUNNING__) return;
            window.__AUTO_BOT_LOOP_RUNNING__ = true;

            let isTickBusy = false;
            const runLoopTick = async function () {
                if (isTickBusy) return;
                isTickBusy = true;
                try {
                    // Watchdog cứu kẹt thanh tải 80-90% (Transition Loading Safeguard)
                    try {
                        const vmCheck = bot.getViewManager ? bot.getViewManager() : window.ViewManager;
                        const isLoading = !!(vmCheck && typeof vmCheck.isOpenView === "function" && vmCheck.isOpenView("LoadingView"));
                        const mm = window.ModelManager || (window.G_Mapping && window.G_Mapping.ModelManager);
                        const isHadEnter = !!(mm && mm.LoginModel && mm.LoginModel.hadEnterGame);
                        if (isLoading && isHadEnter && !window.__ENTER_GAME__) {
                            if (!bot.state._loadingStallStart) bot.state._loadingStallStart = Date.now();
                            const stallDuration = Date.now() - bot.state._loadingStallStart;
                            if (stallDuration >= 2000) {
                                const bm = mm.BattleModel;
                                const fm = (window.G_Mapping && window.G_Mapping.FightManager) || window.FightManager;
                                const mum = mm.MainUIModel;
                                if (bm && typeof bm.getHangupBattleInfo === "function" && !bm.getHangupBattleInfo() && fm && mum && typeof mum.getMainCopyProgress === "function") {
                                    const p = mum.getMainCopyProgress();
                                    if (p && p._id && typeof fm.requestCopyData === "function") {
                                        fm.requestCopyData(p._id);
                                    }
                                }
                            }
                            if (stallDuration >= 4500) {
                                const disp = (window.G_Mapping && window.G_Mapping.Dispatcher) || window.Dispatcher;
                                if (disp && typeof disp.dispatchEvent === "function") {
                                    disp.dispatchEvent("TransitionDegree_Update", { firstRes: 1 });
                                    disp.dispatchEvent("TransitionDegree_Update", { batteLevelRes: 1 });
                                }
                            }
                        } else {
                            bot.state._loadingStallStart = 0;
                        }
                    } catch (eStall) { }

                    if (bot.state.hasLoggedInOnce && bot.isReady()) {
                        bot.checkAndDismissRestartAlert();
                    }
                    if (!bot.isDisconnected() && bot.isReady()) {
                        bot.updateStats();
                        bot.hookGameEngine();
                        bot.checkMainCopyStall();
                        if (typeof bot.checkBattleWatchdog === "function") {
                            bot.checkBattleWatchdog();
                        }
                        if (bot.state.mod_skin !== false && typeof bot.refreshBattleMainCopySkins === "function") {
                            bot.refreshBattleMainCopySkins();
                        }

                        // Tự động khôi phục 100% Full Đội Hình nếu người chơi mở giao diện Đội Hình hoặc khi Tắt Farm KNB / Tạm dừng Master
                        try {
                            const vmCheck = bot.getViewManager ? bot.getViewManager() : window.ViewManager;
                            const isPrepareOpen = !!(vmCheck && typeof vmCheck.isOpenView === "function" && vmCheck.isOpenView("BattlePrepareView"));
                            if (bot.state.isScoutLowPowerActive && (isPrepareOpen || !bot.state.isAutoRescueKnbActive || bot.state.master === false || bot.isAutoStageOn())) {
                                if (typeof bot.restoreFullCombatArray === "function") {
                                    await bot.restoreFullCombatArray("auto_guard");
                                }
                            } else if (!bot.state.isScoutLowPowerActive && typeof bot.captureAndEnsureFullFormation === "function") {
                                bot.captureAndEnsureFullFormation();
                            }
                        } catch (eGuardArr) { }

                        if (bot.state.master !== false) {
                            // 1. Tự động chọn Lõi Bí Cảnh Tần Lĩnh (khi người chơi tham gia Bí Cảnh)
                            try {
                                if (bot.settings.auto_yyzq_core && typeof bot.checkAndAutoSelectYyzqCore === "function") {
                                    await bot.checkAndAutoSelectYyzqCore();
                                }
                            } catch (e1) { }
                            try {
                                if (bot.settings.auto_defjz && Date.now() >= (bot.state.suppressDefJzUntil || 0) && typeof bot.runAutoDefJzSmart === "function") {
                                    await bot.runAutoDefJzSmart();
                                }
                            } catch (eDefJz) { }

                            // 2. Tự Động Tái Thiết & Làm Gia Viên (Nâng cấp Tái Thiết trước, xong mới làm việc khác)
                            try {
                                if (bot.state.isAutoHostActive) {
                                    await bot.runAutoHostSmart();
                                }
                            } catch (e2) {
                                console.error("[AutoBot] Error in runAutoHostSmart:", e2);
                            }

                            // 2.1 Tự động Farm KNB qua Giải Cứu Gia Viên (50 KNB/lượt không giới hạn)
                            try {
                                if (bot.state.isAutoRescueKnbActive && typeof bot.runAutoRescueKnbSmart === "function") {
                                    await bot.runAutoRescueKnbSmart();
                                }
                            } catch (eRescue) {
                                console.error("[AutoBot] Error in runAutoRescueKnbSmart:", eRescue);
                            }

                            // 3. Vượt Ải chính tuyến (Chạy ngầm liên tục khi BẬT FEAT_AUTO_STAGE)
                            try {
                                if (bot.isAutoStageOn()) {
                                    if (bot.state.isScoutLowPowerActive && typeof bot.restoreFullCombatArray === "function") {
                                        await bot.restoreFullCombatArray("auto_stage");
                                    }
                                    bot.currentAction = "Đang vượt ải an toàn (100% ngầm, Defeat Guard)";
                                    await bot.runAutoStageSmart();
                                }
                            } catch (e3) {
                                console.error("[AutoBot] Error in runAutoStageSmart:", e3);
                            }

                            // 4. Leo Tháp Thông Thiên
                            try {
                                if (bot.state.isAutoTowerActive && typeof bot.runAutoTowerSmart === "function") {
                                    if (bot.state.isScoutLowPowerActive && typeof bot.restoreFullCombatArray === "function") {
                                        await bot.restoreFullCombatArray("auto_tower");
                                    }
                                    await bot.runAutoTowerSmart();
                                }
                            } catch (e4) { }

                            // 5. Phái tướng thám hiểm (nhận quà xong phái tiếp)
                            try {
                                if (bot.settings.auto_dispatch !== false && typeof bot.runAutoDispatchSmart === "function" && bot.tryDo("loop_dispatch", 20)) {
                                    await bot.runAutoDispatchSmart();
                                }
                            } catch (e5) { }

                            // 6. Đào bảo mở xẻng & nâng rương
                            try {
                                if (bot.settings.auto_treasure && typeof bot.runAutoTreasureSmart === "function" && bot.tryDo("loop_treasure", 30)) {
                                    await bot.runAutoTreasureSmart();
                                }
                            } catch (e6) { }

                            // 7. Đấu trường khi có lượt miễn phí
                            try {
                                if (bot.settings.auto_arena !== false && typeof bot.runAutoArenaSmart === "function" && bot.tryDo("loop_arena", 45)) {
                                    if (bot.state.isScoutLowPowerActive && typeof bot.restoreFullCombatArray === "function") {
                                        await bot.restoreFullCombatArray("auto_arena");
                                    }
                                    await bot.runAutoArenaSmart();
                                }
                            } catch (e7) { }

                            // 8. Thưởng AFK tích lũy & Thu hoạch nhanh
                            try {
                                if (bot.settings.auto_afk && typeof bot.runAutoAFKSmart === "function" && bot.tryDo("loop_afk", 60)) {
                                    await bot.runAutoAFKSmart();
                                }
                            } catch (e8) { }

                            // 9. Nâng cấp tướng & Nâng sao & Đồ Giám
                            try {
                                if (bot.settings.auto_hero_up && typeof bot.runAutoHeroUpSmart === "function" && bot.tryDo("loop_heroup", 30)) {
                                    await bot.runAutoHeroUpSmart();
                                }
                            } catch (e9a) { }
                            try {
                                if (bot.settings.auto_star_up && typeof bot.runAutoStarUpSmart === "function" && bot.tryDo("loop_starup", 30)) {
                                    await bot.runAutoStarUpSmart();
                                }
                            } catch (e9b) { }
                            try {
                                if (bot.settings.auto_manual && typeof bot.runAutoManualSmart === "function" && bot.tryDo("loop_manual", 30)) {
                                    await bot.runAutoManualSmart();
                                }
                            } catch (e9c) { }

                            // 10. Bái kiến toàn bộ BXH & Quà Mốc Vinh Danh Server
                            try {
                                if (bot.state.isAutoRankActive !== false) {
                                    const todayStr = new Date().toDateString();
                                    const localLikedDate = (typeof window !== "undefined" && window.localStorage && window.localStorage.getItem("3qdao_rank_liked_date")) || null;
                                    const needDailyLike = (bot.state.rankLikedDate !== todayStr) && (localLikedDate !== todayStr);
                                    const hasLadderRed = bot.hasRed("V_CrossLadderWorship_Day");
                                    const hasArenaRed = bot.hasRed("V_CrossArena_Worship");
                                    const hasMilestoneRed = bot.hasRed("M_Rank");

                                    // Chỉ chạy khi thực sự có việc: chưa bái kiến hôm nay, hoặc có chấm đỏ mốc/bái liên server
                                    if ((needDailyLike || hasLadderRed || hasArenaRed || hasMilestoneRed) && bot.tryDo("loop_rank_check", 30)) {
                                        await bot.runAutoRankSmart(false);
                                    }
                                }
                            } catch (e10) { }

                            // 11. Tự động chơi Thần Xạ / Bách Bộ Xuyên Dương (Đoạt Bảo)
                            try {
                                if (bot.state.isAutoTouhuActive !== false && bot.settings.auto_touhu !== false && typeof bot.runAutoTouhuSmart === "function" && bot.tryDo("loop_touhu", 25)) {
                                    await bot.runAutoTouhuSmart();
                                }
                            } catch (e11) { }

                            // 12. Tự động nhận toàn bộ Quà Ngày, Rương Mốc Năng Động, Shop Free, Cây Tiền, Thư & Bạn Bè
                            try {
                                if (bot.settings.auto_daily_rewards !== false && typeof bot.runAutoDailyRewardsSmart === "function" && bot.tryDo("loop_daily_rewards", 45)) {
                                    await bot.runAutoDailyRewardsSmart();
                                }
                            } catch (e12) { }

                            // 12b. Tự động quay Free mỗi ngày (Tàng Bảo Các / Thần Binh / Danh Tướng) & nhận rương mốc
                            try {
                                if (bot.settings.auto_free_lottery !== false && typeof bot.runAutoFreeLotterySmart === "function" && bot.tryDo("loop_free_lottery", 30)) {
                                    await bot.runAutoFreeLotterySmart();
                                }
                            } catch (e12b) { }

                            // 13. Tự động chơi Phi Kiếm / Phi Đao (khi mở giao diện)
                            try {
                                if (bot.settings.auto_feidao !== false && typeof bot.runAutoFeiDaoSmart === "function" && bot.tryDo("loop_feidao", 10)) {
                                    await bot.runAutoFeiDaoSmart();
                                }
                            } catch (e13) { }

                            // 14. Tự động Tầm Bảo Long Mạch (Cờ Tỷ Phú & Aim-bot Xúc Xắc Vàng)
                            try {
                                if (bot.settings.auto_longmach !== false && typeof bot.runAutoLongMachSmart === "function" && bot.tryDo("loop_longmach", 12)) {
                                    await bot.runAutoLongMachSmart();
                                }
                            } catch (e14) { }

                            // 15. Tự động Long Hổ Tranh Bá (Bốc Lì Xì, Đoán Top Quán Quân/Á Quân, Đoán 1v1)
                            try {
                                if (bot.state.isAutoSkVsActive !== false && bot.settings.auto_skvs !== false && typeof bot.runAutoSkVsSmart === "function" && bot.tryDo("loop_skvs", 20)) {
                                    await bot.runAutoSkVsSmart();
                                }
                            } catch (e15) { }

                            // 16. Tự động thu hoạch tài nguyên Chiếm Mỏ (Guild Mine) Đội hình 1 & Đội hình 2
                            try {
                                if (bot.settings.auto_guild_mine !== false && typeof bot.runAutoGuildMineSmart === "function") {
                                    await bot.runAutoGuildMineSmart();
                                }
                            } catch (e16) { }

                            // 17. Tự động tách / bán mảnh tướng Cam trở xuống (Cam, Tím, Lam, Lục, Xám; KHÔNG BAO GIỜ chạm Đỏ, Hồng, Kim)
                            try {
                                if (bot.settings.auto_recycle_fragments !== false && typeof bot.runAutoHeroFragmentDecompose === "function" && bot.tryDo("loop_decompose_shard", 30)) {
                                    await bot.runAutoHeroFragmentDecompose();
                                }
                            } catch (e17) { }

                            // 17. Heartbeat Activity Log định kỳ (Mỗi 20s ghi lại 1 log trực chiến)
                            if (bot.canDo("heartbeat_log", 20)) {
                                bot.markDone("heartbeat_log");
                                const gm = window.G_Mapping || {};
                                const mmHb = window.ModelManager || {};
                                const mum = (mmHb.MainUIModel && typeof mmHb.MainUIModel.getMainCopyProgress === "function") ? mmHb.MainUIModel : ((gm.MainUIModel && typeof gm.MainUIModel.getMainCopyProgress === "function") ? gm.MainUIModel : null);
                                let pProg = null, stageInfo = null, restraint = 0;
                                try { pProg = mum ? mum.getMainCopyProgress() : null; } catch (eP) { }
                                try { stageInfo = (mum && pProg && typeof mum.getMainCopyInfo === "function") ? mum.getMainCopyInfo() : null; } catch (eI) { }
                                try { restraint = (mum && typeof mum.getRestraintLv === "function") ? (mum.getRestraintLv() || 0) : 0; } catch (eR) { }
                                let stageTxt = "Đang kết nối";
                                if (pProg && pProg._id) {
                                    stageTxt = `Ải [${pProg._id}] (Đợt ${pProg._nth || 1}/${(stageInfo && stageInfo.count) || "?"}${stageInfo && stageInfo.isBoss ? " - BOSS" : ""})`;
                                    if (bot.isAutoStageOn()) {
                                        if (restraint > 0) stageTxt += ` | ⚠️ Áp chế cấp: thiếu ${restraint} cấp`;
                                        try {
                                            const bfmHb = gm.BattleFastManager || window.BattleFastManager;
                                            const stNames = { 1: "kết thúc", 2: "đang đánh", 3: "chờ đóng trận", 4: "chờ dữ liệu", 5: "tải hiệu ứng", 6: "khóa (chờ khiêu chiến)", 7: "kết nối lại" };
                                            if (bfmHb && bfmHb.batteStatus) stageTxt += ` [${stNames[bfmHb.batteStatus] || bfmHb.batteStatus}]`;
                                        } catch (eSt) { }
                                        // Theo dõi kẹt ải: không đổi ải/đợt trong 10 phút -> cảnh báo (chỉ khi BẬT Vượt Ải)
                                        const sig = `${pProg._id}_${pProg._nth}`;
                                        if (bot.state._stageSig !== sig) {
                                            bot.state._stageSig = sig;
                                            bot.state._stageSigSince = Date.now();
                                        } else if (Date.now() - (bot.state._stageSigSince || Date.now()) >= 10 * 60000 && bot.tryDo("stage_stuck_warn", 600)) {
                                            const reason = restraint > 0 ? `bị áp chế cấp (cần thêm ${restraint} cấp nhân vật)` : "lực chiến chưa đủ để thắng đợt này";
                                            bot.log(`⚠️ [Vượt Ải] Ải [${pProg._id}] đợt ${pProg._nth} không tiến triển hơn 10 phút -> ${reason}. Hãy nâng cấp tướng/trang bị.`);
                                        }
                                    } else {
                                        stageTxt += ` [Tự vượt ải: TẮT]`;
                                        bot.state._stageSigSince = Date.now();
                                    }
                                }
                                else if (bot.stats.stage) {
                                    stageTxt = `Ải [${bot.stats.stage}]`;
                                    if (!bot.isAutoStageOn()) stageTxt += ` [Tự vượt ải: TẮT]`;
                                }
                                const fullSavedPow = (bot.state.savedFullMainArray && bot.state.savedFullMainArray.rolePower) ? Number(bot.state.savedFullMainArray.rolePower) : 0;
                                const curPow = Number(bot.stats.power || 0);
                                let pVal = (fullSavedPow > curPow ? fullSavedPow : curPow) ? Number(fullSavedPow > curPow ? fullSavedPow : curPow).toLocaleString() : "---";
                                if (bot.state.isScoutLowPowerActive && curPow > 0 && fullSavedPow > curPow) {
                                    pVal += ` (Hạ LC dò: ${curPow.toLocaleString()} • ${bot.state.currentScoutHeroCount || 2} tướng)`;
                                }
                                const rawHostStage = window.ModelManager && window.ModelManager.HomeLandModel && window.ModelManager.HomeLandModel.task_g;
                                if (rawHostStage && Number(rawHostStage) > 0) {
                                    bot.stats.hostStage = Number(rawHostStage);
                                }
                                const hostStage = bot.stats.hostStage || rawHostStage || 1;
                                bot.log(`🟢 [Hệ Thống] Trực chiến: ${stageTxt} | Gia Viên: Giai Đoạn ${hostStage} | LC: ${pVal} | Tự động: ${bot.state.master !== false ? "BẬT" : "TẠM DỪNG"}`);
                            }

                            if (!bot.isAutoStageOn() && !bot.state.isAutoHostActive) {
                                bot.currentAction = "Sẵn sàng: Bỏ qua QC, Skip Battle, Tự chọn Lõi Tần Lĩnh, Speed 2.0x, Mod Skin";
                            }
                        }
                    }
                    bot.notifyNativeStatus();
                } catch (e) {
                    console.error("[AutoBot Scheduler Error]", e);
                    bot.notifyNativeStatus(null, null, String(e));
                } finally {
                    isTickBusy = false;
                }
            };

            trackTimer(setInterval(runLoopTick, 1000));
            bot.log("Master Scheduler Loop Started (1.0s interval).");
        },

        setToggles: function (t) {
            if (!t || typeof t !== "object") return;
            for (let k in t) {
                bot.settings[k] = t[k];
            }
            if (t.auto_stage !== undefined) bot.setAutoStageActive(t.auto_stage);
            if (t.auto_tower !== undefined) bot.setAutoTowerActive(t.auto_tower);
            if (t.auto_host !== undefined) bot.state.isAutoHostActive = !!t.auto_host;
            if (t.auto_rescue_knb !== undefined) {
                bot.state.isAutoRescueKnbActive = !!t.auto_rescue_knb;
                bot.settings.auto_rescue_knb = !!t.auto_rescue_knb;
                if (window.__DAUTO_CONFIG) window.__DAUTO_CONFIG.FEAT_AUTO_RESCUE_KNB = !!t.auto_rescue_knb;
                if (!t.auto_rescue_knb && bot.state.isScoutLowPowerActive && typeof bot.restoreFullCombatArray === "function") {
                    bot.restoreFullCombatArray("toggle_off");
                }
            }
            if (t.auto_rank !== undefined) bot.state.isAutoRankActive = !!t.auto_rank;
            if (t.auto_touhu !== undefined) {
                bot.state.isAutoTouhuActive = !!t.auto_touhu;
                bot.settings.auto_touhu = !!t.auto_touhu;
                bot.settings.touhu_aimbot = !!t.auto_touhu;
            }
            if (t.auto_feidao !== undefined) bot.settings.auto_feidao = !!t.auto_feidao;
            if (t.auto_hongbao !== undefined) bot.settings.auto_hongbao = !!t.auto_hongbao;
            if (t.auto_act_task !== undefined) bot.settings.auto_act_task = !!t.auto_act_task;
            if (t.auto_longmach !== undefined) {
                bot.settings.auto_longmach = !!t.auto_longmach;
                bot.settings.longmach_aimbot = !!t.auto_longmach;
            }
            if (t.auto_skvs !== undefined) {
                bot.state.isAutoSkVsActive = !!t.auto_skvs;
                bot.settings.auto_skvs = !!t.auto_skvs;
            }
            if (t.auto_guild_mine !== undefined) {
                bot.settings.auto_guild_mine = !!t.auto_guild_mine;
            }
            if (t.auto_free_lottery !== undefined) {
                bot.settings.auto_free_lottery = !!t.auto_free_lottery;
            }
            if (t.auto_yyzq_core !== undefined) {
                bot.settings.auto_yyzq_core = !!t.auto_yyzq_core;
                if (bot.state) bot.state.isAutoYyzqCoreActive = !!t.auto_yyzq_core;
            }
            if (t.auto_defjz !== undefined) {
                bot.settings.auto_defjz = !!t.auto_defjz;
                if (bot.state) bot.state.isAutoDefJzActive = !!t.auto_defjz;
                if (!t.auto_defjz) {
                    bot.state.suppressDefJzUntil = Date.now() + 86400000;
                }
            }
            if (t.auto_daily_rewards !== undefined) {
                bot.settings.auto_daily_rewards = !!t.auto_daily_rewards;
            }
            if (t.auto_split_purple_shard !== undefined) {
                bot.settings.auto_split_purple_shard = !!t.auto_split_purple_shard;
                bot.settings.auto_recycle_fragments = !!t.auto_split_purple_shard;
            }
            if (t.auto_recycle_fragments !== undefined) {
                bot.settings.auto_recycle_fragments = !!t.auto_recycle_fragments;
            }
            if (t.mod_skin !== undefined) {
                bot.state.mod_skin = !!t.mod_skin;
                bot.settings.mod_skin = !!t.mod_skin;
            }
            if (t.mod_headframe_title !== undefined) {
                bot.state.mod_headframe_title = !!t.mod_headframe_title;
                bot.settings.mod_headframe_title = !!t.mod_headframe_title;
            }
            if (typeof bot.saveSettings === "function") {
                try { bot.saveSettings(); } catch (e) { }
            }
            try {
                if (typeof window !== "undefined" && window.__UPDATE_HUD__) {
                    window.__UPDATE_HUD__(bot);
                }
            } catch (e) { }
        },

        checkAndDismissRestartAlert: function () {
            try {
                if (!bot.state.hasLoggedInOnce || !bot.isReady()) return;
                const nw = (window.G_Mapping && window.G_Mapping.NetWork && window.G_Mapping.NetWork.Ins) || (window.NetWork && window.NetWork.Ins);
                if (!nw) return;

                const vm = window.ViewManager || (window.G_Mapping && window.G_Mapping.ViewManager);
                if (vm) {
                    const alertViews = [
                        "AlertView", "AlertPopUpTipsView", "AlertPopUpTipsView2", "AlertView2",
                        "NoticeView", "SignNoticeView", "DailySignNoticeView", "AnnouncementView"
                    ];
                    for (let vName of alertViews) {
                        const isVis = (typeof vm.isOpenView === "function" && vm.isOpenView(vName)) ||
                                      (typeof vm.isShow === "function" && vm.isShow(vName));
                        if (isVis) {
                            const vObj = vm.getView ? vm.getView(vName) : null;
                            const vTxt = String((vObj && (vObj.text || (vObj.view && vObj.view.text))) || "").toLowerCase();
                            if (vTxt.includes("nội dung mới") || vTxt.includes("khởi động lại") || vTxt.includes("bảo trì") || vTxt.includes("kết nối")) {
                                bot.log(`🛡️ [Auto-Dismiss] Đã tự động đóng hộp thoại thông báo ${vName}!`);
                                if (typeof vm.closeView === "function") {
                                    try { vm.closeView(vName); } catch (e) { }
                                }
                            }
                        }
                    }
                }

                if (nw && typeof nw.isClose === "function" && nw.isClose()) {
                    const isConnecting = !!(nw._wsClient && typeof nw._wsClient.isConnecting === "function" && nw._wsClient.isConnecting());
                    if (!isConnecting && !bot.state.kickedByOtherDevice && !window.__BOT_HARD_STOPPED__) {
                        bot.scheduleSafeReconnect(nw, "watchdog_alert", 1800);
                    }
                }
            } catch (e) { }
        },

        runSmartCycle: async function (t) {
            if (t) bot.setToggles(t);
            if (bot.state.hasLoggedInOnce && bot.isReady()) {
                bot.checkAndDismissRestartAlert();
            }
            const isKicked = !!bot.state.kickedByOtherDevice;
            return {
                stats: bot.updateStats(),
                isDisconnected: isKicked || bot.isDisconnected(),
                ready: !isKicked && bot.isReady(),
                kickedByOtherDevice: isKicked
            };
        },

        isDisconnected: function () {
            try {
                if (bot.state.kickedByOtherDevice) return true;
                const nw = (window.G_Mapping && window.G_Mapping.NetWork && window.G_Mapping.NetWork.Ins) || (window.NetWork && window.NetWork.Ins);
                if (nw && typeof nw.isClose === "function") {
                    const closed = nw.isClose();
                    const isConnecting = !!(nw._wsClient && typeof nw._wsClient.isConnecting === "function" && nw._wsClient.isConnecting());
                    if (closed && !isConnecting && bot.state.hasLoggedInOnce && !bot.state.kickedByOtherDevice) {
                        bot.scheduleSafeReconnect(nw, "watchdog_disconnect", 1800);
                    }
                    return closed;
                }
            } catch (e) { }
            return false;
        },

        scanServerEvents: function () {
            try {
                const mm = window.ModelManager || bot.getModelManager() || (window.G_Mapping && window.G_Mapping.ModelManager);
                const am = mm && mm.ActivityModel;
                if (!am || !am.actData) {
                    bot.log("⚠️ [Event Scanner] Chưa tìm thấy ActivityModel hoặc chưa tải xong dữ liệu sự kiện.");
                    return [];
                }
                const list = [];
                for (let actId in am.actData) {
                    const item = am.actData[actId];
                    if (!item) continue;
                    const name = item.getActName ? item.getActName() : "Sự kiện #" + actId;
                    const modId = item.getModuleId ? item.getModuleId() : 0;
                    const modKey = (item.getJsonDataByKey && item.getJsonDataByKey("moduleKey")) || "N/A";
                    const heroId = item.getHeroId ? item.getHeroId() : 0;
                    const timeState = item.getStateAndTime ? item.getStateAndTime() : [0, 0];
                    const state = timeState[0];
                    const remainSec = Math.max(0, timeState[1] || 0);
                    list.push({
                        actId: Number(actId),
                        name: name,
                        modId: modId,
                        modKey: modKey,
                        heroId: heroId,
                        state: state,
                        remainSec: remainSec
                    });
                }
                const stm = mm.ServerTimeModel;
                const openDay = (stm && typeof stm.getOpenDay === "function") ? (stm.getOpenDay() + 1) : "N/A";
                bot.log(`🔍 [Event Scanner] Máy chủ mở Ngày thứ: ${openDay} | Phát hiện ${list.length} sự kiện trên máy chủ:`);
                const stateNames = { 0: "Chưa mở", 1: "Sắp mở (Preview)", 2: "Đang mở", 3: "Sắp đóng", 4: "Đã đóng" };
                list.forEach(act => {
                    const h = Math.floor(act.remainSec / 3600);
                    const m = Math.floor((act.remainSec % 3600) / 60);
                    const sTxt = stateNames[act.state] || `State ${act.state}`;
                    const timeTxt = act.remainSec > 0 ? `[${sTxt}] Còn: ${h}h ${m}m` : `[${sTxt}]`;
                    bot.log(`   👉 [ID: ${act.actId}] "${act.name}" (Key: ${act.modKey}, Mod: ${act.modId}${act.heroId ? ', HeroID: ' + act.heroId : ''}) -> ${timeTxt}`);
                });
                return list;
            } catch (e) {
                console.error("[Event Scanner Error]", e);
                return [];
            }
        },

        openEventView: function (target, extraArgs) {
            try {
                // Hỗ trợ mở trực tiếp bằng module ID số: ví dụ openEventView(42) hoặc openModule(42)
                const numId = Number(target);
                if (!isNaN(numId) && numId > 0) {
                    const mu = (window.G_Mapping && window.G_Mapping.ModuleUtil) || window.ModuleUtil;
                    if (mu && typeof mu.openModule === "function") {
                        bot.log(`🚀 [Bypass Module] Đang mở module ID: ${numId}...`);
                        mu.openModule(numId);
                        return true;
                    }
                }

                const str = String(target || "").toLowerCase();
                let viewName = target;
                let args = extraArgs || {};

                // Điều hướng các module hệ thống qua ModuleUtil
                const mu = (window.G_Mapping && window.G_Mapping.ModuleUtil) || window.ModuleUtil;
                if (str.includes("phu_van") || str.includes("phù văn") || str.includes("rune")) {
                    if (mu && typeof mu.openModule === "function") { bot.log("🚀 [Bypass Module] Mở Phù Văn (Mod 42)..."); mu.openModule(42); return true; }
                } else if (str.includes("than_trang") || str.includes("thần trang")) {
                    if (mu && typeof mu.openModule === "function") { bot.log("🚀 [Bypass Module] Mở Thần Trang (Mod 140)..."); mu.openModule(140); return true; }
                } else if (str.includes("than_khi") || str.includes("thần khí") || str.includes("artifact")) {
                    if (mu && typeof mu.openModule === "function") { bot.log("🚀 [Bypass Module] Mở Thần Khí (Mod 114)..."); mu.openModule(114); return true; }
                } else if (str.includes("ma_tinh") || str.includes("ma tinh") || str.includes("tang_bao") || str.includes("tàng bảo") || str.includes("giam_bao") || str.includes("giám bảo") || str.includes("magic_lottery")) {
                    if (mu && typeof mu.openModule === "function") { bot.log("🚀 [Bypass Module] Mở Tàng Bảo Các / Rương Giám Bảo (Mod 154)..."); mu.openModule(154); return true; }
                } else if (str.includes("chieu_mo") || str.includes("chiêu mộ") || str.includes("tham_mo") || str.includes("thăm mộ") || str.includes("lottery")) {
                    if (mu && typeof mu.openModule === "function") { bot.log("🚀 [Bypass Module] Mở Chiêu Mộ Tướng (Mod 119)..."); mu.openModule(119); return true; }
                } else if (str.includes("tro_thu") || str.includes("trợ thủ") || str.includes("helper")) {
                    if (mu && typeof mu.openModule === "function") { bot.log("🚀 [Bypass Module] Mở Trợ Thủ (Mod 311)..."); mu.openModule(311); return true; }
                } else if (str.includes("mo") || str.includes("mỏ") || str.includes("guild_mine")) {
                    if (mu && typeof mu.openModule === "function") { bot.log("🚀 [Bypass Module] Mở Chiếm Mỏ Bang (Mod 152)..."); mu.openModule(152); return true; }
                } else if (str.includes("dau_truong") || str.includes("đấu trường") || str.includes("arena")) {
                    if (mu && typeof mu.openModule === "function") { bot.log("🚀 [Bypass Module] Mở Đấu Trường (Mod 101)..."); mu.openModule(101); return true; }
                } else if (str.includes("loi_dai") || str.includes("lôi đài") || str.includes("ladder")) {
                    if (mu && typeof mu.openModule === "function") { bot.log("🚀 [Bypass Module] Mở Lôi Đài (Mod 105)..."); mu.openModule(105); return true; }
                } else if (str.includes("thap") || str.includes("tháp") || str.includes("tower")) {
                    if (mu && typeof mu.openModule === "function") { bot.log("🚀 [Bypass Module] Mở Tháp Thông Thiên (Mod 2)..."); mu.openModule(2); return true; }
                } else if (str.includes("phu_ban") || str.includes("phụ bản") || str.includes("daily")) {
                    if (mu && typeof mu.openModule === "function") { bot.log("🚀 [Bypass Module] Mở Phụ Bản Ngày (Mod 3)..."); mu.openModule(3); return true; }
                } else if (str.includes("gia_vien") || str.includes("gia viên") || str.includes("manor") || str.includes("build")) {
                    if (mu && typeof mu.openModule === "function") { bot.log("🚀 [Bypass Module] Mở Gia Viên (Mod 83)..."); mu.openModule(83); return true; }
                }

                const vm = bot.getViewManager();
                if (!vm || typeof vm.open !== "function") {
                    bot.log("⚠️ [Bypass View] Không tìm thấy ViewManager để mở giao diện!");
                    return false;
                }

                if (str.includes("than_xa") || str.includes("touhu") || str.includes("bắn")) {
                    viewName = (vm.hasView && vm.hasView("DjTouhuMainView")) ? "DjTouhuMainView" : "TouhuGameView";
                    const mm = window.ModelManager;
                    const am = mm && mm.ActivityModel;
                    if (am && am.actData) {
                        for (let id in am.actData) {
                            const act = am.actData[id];
                            const mInfo = act && act.getJsonDataByKey && act.getJsonDataByKey("moduleInfo");
                            if (mInfo && mInfo.moduleKey === "Touhu") {
                                args.curActId = Number(id);
                                break;
                            }
                        }
                    }
                    if (!args.curActId) args.curActId = 1;
                    if (!args.level) args.level = 1;
                } else if (str.includes("dieu_thuyen") || str.includes("diaochan") || str.includes("new_hero") || str.includes("quay_tuong")) {
                    viewName = (vm.hasView && vm.hasView("NewHeroCallView")) ? "NewHeroCallView" : ((vm.hasView && vm.hasView("NewHeroCall2View")) ? "NewHeroCall2View" : "NewHeroCallView");
                    const mm = window.ModelManager;
                    const am = mm && mm.ActivityModel;
                    let foundAct = null;
                    if (am && am.actData) {
                        for (let id in am.actData) {
                            const act = am.actData[id];
                            const mInfo = act && act.getJsonDataByKey && act.getJsonDataByKey("moduleInfo");
                            const mKey = (mInfo && mInfo.moduleKey) || "";
                            const aName = (act && act.getActName && act.getActName()) || "";
                            if (mKey.includes("NewHeroCall") || mKey.includes("HeroSummon") || mKey.includes("SpecialSummon") || aName.includes("Điêu Thuyền") || aName.includes("Chiêu Mộ")) {
                                args.curActId = Number(id);
                                foundAct = act;
                                break;
                            }
                        }
                    }
                    if (!foundAct) {
                        bot.log("⚠️ [Điêu Thuyền] Hiện không có sự kiện Chiêu Mộ Tướng Mới/Điêu Thuyền nào đang mở trên máy chủ!");
                        bot.log("💡 Gợi ý: Gõ scanEvents() để kiểm tra danh sách toàn bộ sự kiện & thời gian mở trên server.");
                        return false;
                    }
                } else if (str.includes("long_mai") || str.includes("longmai")) {
                    viewName = "DragonRewardMainActView";
                } else if (str.includes("yinfu") || str.includes("phù") || str.includes("âm phù")) {
                    viewName = "YinfuMainView";
                } else if (str.includes("than_binh") || str.includes("godweapon")) {
                    viewName = (vm.hasView && vm.hasView("DrawsNewView")) ? "DrawsNewView" : "DrawsView";
                    args = { page: 3 };
                } else if (str.includes("tran_doanh") || str.includes("camp")) {
                    viewName = (vm.hasView && vm.hasView("DrawsNewView")) ? "DrawsNewView" : "DrawsView";
                    args = { page: 2 };
                } else if (str.includes("draw") || str.includes("chieu_mo") || str.includes("chiêu mộ")) {
                    viewName = (vm.hasView && vm.hasView("DrawsNewView")) ? "DrawsNewView" : "DrawsView";
                } else if (str.includes("pet") || str.includes("linh_thu") || str.includes("linh thú")) {
                    viewName = "PetMainView";
                }

                bot.log(`🚀 [Bypass View] Đang mở giao diện: [${viewName}]...`);
                vm.open(viewName, args);
                return true;
            } catch (e) {
                bot.log(`⚠️ Lỗi khi mở giao diện [${target}]: ${e.message || e}`);
                return false;
            }
        },

        openShopView: function (shopType) {
            try {
                const vm = bot.getViewManager();
                if (!vm || typeof vm.open !== "function") {
                    bot.log("⚠️ Không tìm thấy ViewManager để mở Cửa Hàng!");
                    return false;
                }
                const sType = Number(shopType) || 1;
                bot.log(`🛒 [Shop] Đang mở Cửa Hàng (ShopType: ${sType})...`);
                vm.open("ShopView", { shopType: sType });
                return true;
            } catch (e) {
                bot.log(`⚠️ Lỗi khi mở Cửa Hàng: ${e.message || e}`);
                return false;
            }
        },

        openHomelandUI: function () {
            return bot.openEventView("gia_vien");
        },

        openGuildMineUI: function () {
            return bot.openEventView("mo");
        },

        openRankUI: function () {
            try {
                const mu = (window.G_Mapping && window.G_Mapping.ModuleUtil) || window.ModuleUtil;
                if (mu && typeof mu.openModule === "function") {
                    bot.log("🚀 [Quick Action] Mở Bảng Xếp Hạng (Mod 57)...");
                    mu.openModule(57);
                    return true;
                }
                const vm = bot.getViewManager();
                if (vm && typeof vm.open === "function") {
                    vm.open("RankMainView");
                    return true;
                }
            } catch (e) { }
            return false;
        },

        openDefendJingzhouUI: function () {
            try {
                const mu = (window.G_Mapping && window.G_Mapping.ModuleUtil) || window.ModuleUtil;
                if (mu && typeof mu.openModule === "function") {
                    bot.log("🚀 [Quick Action] Mở Bí Cảnh Tần Lĩnh / Bảo Vệ Kinh Châu (Mod 9)...");
                    mu.openModule(9);
                    return true;
                }
                const vm = bot.getViewManager();
                if (vm && typeof vm.open === "function") {
                    vm.open("DefendJingzhouView");
                    return true;
                }
            } catch (e) { }
            return false;
        },

        forceExitDefJz: function () {
            try {
                bot.state.suppressDefJzUntil = Date.now() + 86400000;
                bot.state.defjzInProgress = false;
                const vm = bot.getViewManager();
                if (vm && typeof vm.closeView === "function") {
                    try { vm.closeView("DefJzSkillSelectView"); } catch (e) { }
                    try { vm.closeView("BatteJingzhouView"); } catch (e) { }
                    try { vm.closeView("DefendJingzhouView"); } catch (e) { }
                }
                const fm = bot.getFightManager();
                if (fm && typeof fm.removeFight === "function") {
                    try { fm.removeFight(9); } catch (e) { }
                }
                bot.log("🚪 [Quick Action] Đã cưỡng chế thoát Bí Cảnh Tần Lĩnh về sảnh chính!");
                return true;
            } catch (e) {
                return false;
            }
        },

        bypassAllLocks: function () {
            try {
                const mu = (window.G_Mapping && window.G_Mapping.ModuleUtil) || window.ModuleUtil;
                if (mu) {
                    if (!mu._hasOpen) mu._hasOpen = {};
                    for (let id = 1; id <= 1000; id++) {
                        mu._hasOpen[id] = id;
                    }
                }
                bot.log("✨ [Bypass All] Đã kích hoạt mở khóa toàn bộ tất cả tính năng, giao diện & đội hình!");
                return true;
            } catch (e) {
                console.error(e);
                return false;
            }
        }
    };

    window.AutoBot = bot;
    window.openModule = (id) => bot.openEventView(id);
    window.openThanXa = () => bot.openEventView("than_xa");
    window.openDiaoChan = () => bot.openEventView("dieu_thuyen");
    window.openLongMai = () => bot.openEventView("long_mai");
    window.openYinfu = () => bot.openEventView("yinfu");
    window.openChieuMo = (page) => bot.openEventView("draws", { page: page || 1 });
    window.openThanBinh = () => bot.openEventView("than_binh");
    window.openTranDoanh = () => bot.openEventView("tran_doanh");
    window.openLinhThu = () => bot.openEventView("pet");
    window.openPhuVan = () => bot.openEventView("phu_van");
    window.openThanTrang = () => bot.openEventView("than_trang");
    window.openThanKhi = () => bot.openEventView("than_khi");
    window.openMaTinh = () => bot.openEventView("ma_tinh");
    window.openTangBao = () => bot.openEventView("tang_bao");
    window.openGiamBao = () => bot.openEventView("giam_bao");
    window.claimFreeLottery = () => bot.runAutoFreeLotterySmart(true);
    window.openMo = () => bot.openEventView("mo");
    window.openTroThu = () => bot.openEventView("tro_thu");
    window.openDauTruong = () => bot.openEventView("dau_truong");
    window.openLoiDai = () => bot.openEventView("loi_dai");
    window.openThap = () => bot.openEventView("thap");
    window.openPhuBan = () => bot.openEventView("phu_ban");
    window.openGiaVien = () => bot.openEventView("gia_vien");
    window.openShop = (type) => bot.openShopView(type || 1);
    window.openArenaShop = () => bot.openShopView(3);
    window.openSoulShop = () => bot.openShopView(5);
    window.scanEvents = () => bot.scanServerEvents();
    window.openView = (viewName, args) => bot.openEventView(viewName, args);
    window.bypassAllLocks = () => bot.bypassAllLocks();
    window.redeemAllCodes = (list) => bot.runRedeemAllCodes(list);

    bot.loadSettings();
    bot.hookGameEngine();
    bot.updateStats();
    bot.log("🚀 [D-AUTO] Hệ thống Tự Động Hóa Thông Minh v3.9.31 (Khôi phục đăng nhập ổn định) đã khởi động!");
    bot.log("⚡ [Tính Năng] Quà Ngày & Mốc: BẬT | Bỏ qua QC: BẬT | Mở 2 Đội Mỏ: BẬT | Bypass All Locks: BẬT | Thu Hoạch Mỏ: BẬT | Skip Battle: BẬT | Gia Viên: BẬT | Cây Tiền/Shop Free: BẬT | Mod Skin & Khung: BẬT | Speed 2.0x: BẬT");

    window.__dauto_syncLogsToNative = function () {
        try {
            if (bot && bot.logs && typeof jsb !== "undefined" && jsb.reflection) {
                for (let i = 0; i < bot.logs.length; i++) {
                    jsb.reflection.callStaticMethod("QAUI", "addLog:", String(bot.logs[i].msg));
                }
            }
        } catch (e) { }
    };

    // ====================================================================
    // NATIVE D-AUTO INTEGRATION & TOGGLE DISPATCHER
    // ====================================================================
    window.__DAUTO_CONFIG = {
        master: true,
        FEAT_SPEED_SCALE: true,
        FEAT_SKIP_ADS: true,
        FEAT_SKIP_BATTLE: true,
        FEAT_AUTO_STAGE: false,
        FEAT_MOD_SKIN: true,
        FEAT_MOD_FRAME_TITLE: true,
        FEAT_AUTO_RANK: true,
        FEAT_AUTO_HOST: true,
        FEAT_AUTO_RESCUE_KNB: true,
        FEAT_AUTO_YYZQ_CORE: true,
        FEAT_AUTO_TOUHU: true,
        FEAT_AUTO_FEIDAO: true,
        FEAT_AUTO_HONGBAO: true,
        FEAT_AUTO_ACT_TASK: true,
        FEAT_AUTO_LONGMACH: true,
        FEAT_AUTO_SKVS: true,
        FEAT_AUTO_GUILD_MINE: true,
        FEAT_AUTO_RECYCLE_FRAGMENTS: true,
        FEAT_AUTO_DEFJZ: false,
        FEAT_AUTO_DAILY_REWARDS: true
    };

    window.__dauto_toggle = function (key, val) {
        val = !!val;
        if (window.__DAUTO_CONFIG) window.__DAUTO_CONFIG[key] = val;
        if (!window.AutoBot) return;
        const b = window.AutoBot;
        if (key === "master") {
            b.state.master = val;
            b.settings.skip_ads = val;
            b.settings.skip_battle = val;
            b.setAutoStageActive(val && window.__DAUTO_CONFIG.FEAT_AUTO_STAGE);
            b.state.isAutoHostActive = val && window.__DAUTO_CONFIG.FEAT_AUTO_HOST;
            b.state.isAutoRescueKnbActive = val && window.__DAUTO_CONFIG.FEAT_AUTO_RESCUE_KNB;
            b.state.isAutoYyzqCoreActive = val && window.__DAUTO_CONFIG.FEAT_AUTO_YYZQ_CORE;
            b.state.isAutoTouhuActive = val && window.__DAUTO_CONFIG.FEAT_AUTO_TOUHU;
            b.settings.auto_touhu = val && window.__DAUTO_CONFIG.FEAT_AUTO_TOUHU;
            b.settings.touhu_aimbot = val && window.__DAUTO_CONFIG.FEAT_AUTO_TOUHU;
            b.state.isAutoSkVsActive = val && window.__DAUTO_CONFIG.FEAT_AUTO_SKVS;
            b.settings.auto_skvs = val && window.__DAUTO_CONFIG.FEAT_AUTO_SKVS;
            b.setSpeed(val ? (window.__DAUTO_CONFIG.FEAT_SPEED_SCALE ? 2 : 1) : 1);
            if (!val && b.state.isScoutLowPowerActive && typeof b.restoreFullCombatArray === "function") {
                b.restoreFullCombatArray("master_off");
            }
            b.log(val ? "▶️ [Master] ĐÃ TIẾP TỤC TẤT CẢ TÍNH NĂNG TỰ ĐỘNG." : "⏸️ [Master] ĐÃ TẠM DỪNG TẤT CẢ TÍNH NĂNG TỰ ĐỘNG.");
        } else if (key === "FEAT_SPEED_SCALE") {
            b.setSpeed(val ? 2 : 1);
        } else if (key === "FEAT_SKIP_ADS") {
            b.setSkipAds(val);
            b.log(`🚫 [Cài đặt] Bỏ qua quảng cáo 0s: ${val ? "BẬT" : "TẮT"}`);
        } else if (key === "FEAT_SKIP_BATTLE") {
            b.setSkipBattle(val);
            b.log(`⚔️ [Cài đặt] Bỏ qua trận đấu (Skip Battle): ${val ? "BẬT" : "TẮT"}`);
        } else if (key === "FEAT_AUTO_STAGE") {
            b.setAutoStageActive(val);
            b.log(`🚀 [Cài đặt] Vượt ải tự động ngầm: ${val ? "BẬT" : "TẮT"}`);
            if (val) {
                if (b.state.isScoutLowPowerActive && typeof b.restoreFullCombatArray === "function") {
                    b.restoreFullCombatArray("stage_on");
                }
                b.log("⚔️ [Vượt Ải] Đã kích hoạt Vượt Ải tự động ngầm. Bot sẽ tự động khiêu chiến Boss liên tục.");
                b.runAutoStageSmart();
            }
        } else if (key === "FEAT_AUTO_HOST") {
            b.state.isAutoHostActive = val;
            b.settings.auto_host = val;
            b.log(`🏡 [Cài đặt] Tự động Tái Thiết & Làm Gia Viên: ${val ? "BẬT" : "TẮT"}`);
            if (val) {
                b.runAutoHostSmart();
            }
        } else if (key === "FEAT_AUTO_RESCUE_KNB") {
            b.state.isAutoRescueKnbActive = val;
            b.settings.auto_rescue_knb = val;
            b.log(`🌾 [Cài đặt] Farm KNB Giải Cứu Gia Viên (50 KNB/lượt): ${val ? "BẬT" : "TẮT"}`);
            if (val && typeof b.runAutoRescueKnbSmart === "function") {
                b.runAutoRescueKnbSmart();
            } else if (!val && b.state.isScoutLowPowerActive && typeof b.restoreFullCombatArray === "function") {
                b.restoreFullCombatArray("rescue_off");
            }
        } else if (key === "FEAT_AUTO_YYZQ_CORE") {
            b.state.isAutoYyzqCoreActive = val;
            b.settings.auto_yyzq_core = val;
            b.log(`🔮 [Cài đặt] Tự động chọn Lõi Bí Cảnh Tần Lĩnh: ${val ? "BẬT" : "TẮT"}`);
            if (val) {
                b.checkAndAutoSelectYyzqCore();
            }
        } else if (key === "FEAT_AUTO_TOUHU") {
            b.state.isAutoTouhuActive = val;
            b.settings.auto_touhu = val;
            b.settings.touhu_aimbot = val;
            b.log(`🏹 [Cài đặt] Tự động Thần Xạ & Aim-bot 100%: ${val ? "BẬT" : "TẮT"}`);
            if (val && typeof b.runAutoTouhuSmart === "function") {
                b.runAutoTouhuSmart();
            }
        } else if (key === "FEAT_MOD_SKIN") {
            b.state.mod_skin = val;
            b.settings.mod_skin = val;
            b.saveSettings();
            if (typeof b.refreshBattleMainCopySkins === "function") {
                b.refreshBattleMainCopySkins();
            }
            b.log(`👘 [Cài đặt] Mod Skin Ngoại Trang: ${val ? "BẬT" : "TẮT"}`);
        } else if (key === "FEAT_MOD_FRAME_TITLE") {
            b.state.mod_headframe_title = val;
            b.settings.mod_headframe_title = val;
            b.saveSettings();
            if (typeof b.applyModCosmetics === "function") {
                b.applyModCosmetics();
            }
            b.log(`👑 [Cài đặt] Mod Khung & Danh Hiệu: ${val ? "BẬT" : "TẮT"}`);
        } else if (key === "FEAT_AUTO_RANK") {
            b.state.isAutoRankActive = val;
            b.log(`👑 [Cài đặt] Tự động bái kiến 7 BXH: ${val ? "BẬT" : "TẮT"}`);
            if (val) {
                b.runAutoRankSmart(false);
            }
        } else if (key === "FEAT_AUTO_FEIDAO") {
            b.settings.auto_feidao = val;
            b.log(`🗡️ [Cài đặt] Tự động chơi Phi Đao (Auto-Win): ${val ? "BẬT" : "TẮT"}`);
            if (val && typeof b.runAutoFeiDaoSmart === "function") {
                b.runAutoFeiDaoSmart();
            }
        } else if (key === "FEAT_AUTO_HONGBAO") {
            b.settings.auto_hongbao = val;
            b.log(`🧧 [Cài đặt] Tự động giật Lì Xì hoạt động: ${val ? "BẬT" : "TẮT"}`);
        } else if (key === "FEAT_AUTO_ACT_TASK") {
            b.settings.auto_act_task = val;
            b.log(`🎁 [Cài đặt] Tự động nhận thưởng nhiệm vụ sự kiện: ${val ? "BẬT" : "TẮT"}`);
        } else if (key === "FEAT_AUTO_LONGMACH") {
            b.settings.auto_longmach = val;
            b.settings.longmach_aimbot = val;
            b.log(`🐉 [Cài đặt] Tự động Tầm Bảo Long Mạch: ${val ? "BẬT" : "TẮT"}`);
            if (val && typeof b.runAutoLongMachSmart === "function") {
                b.runAutoLongMachSmart();
            }
        } else if (key === "FEAT_AUTO_SKVS") {
            b.state.isAutoSkVsActive = val;
            b.settings.auto_skvs = val;
            b.log(`🐯 [Cài đặt] Long Hổ Tranh Bá (Lì Xì & Đoán Top/1v1): ${val ? "BẬT" : "TẮT"}`);
            if (val && typeof b.runAutoSkVsSmart === "function") {
                b.runAutoSkVsSmart();
            }
        } else if (key === "FEAT_AUTO_GUILD_MINE") {
            b.settings.auto_guild_mine = val;
            b.log(`🌾 [Cài đặt] Tự động thu hoạch Chiếm Mỏ: ${val ? "BẬT" : "TẮT"}`);
            if (val && typeof b.runAutoGuildMineSmart === "function") {
                b.runAutoGuildMineSmart();
            }
        } else if (key === "FEAT_AUTO_FREE_LOTTERY" || key === "auto_free_lottery") {
            b.settings.auto_free_lottery = val;
            b.log(`🎁 [Cài đặt] Tự động quay Free mỗi ngày (Tàng Bảo Các / Thần Binh / Tướng): ${val ? "BẬT" : "TẮT"}`);
            if (val && typeof b.runAutoFreeLotterySmart === "function") {
                b.runAutoFreeLotterySmart(true);
            }
        } else if (key === "FEAT_AUTO_RECYCLE_FRAGMENTS" || key === "auto_recycle_fragments") {
            b.settings.auto_recycle_fragments = val;
            b.log(`🧩 [Cài đặt] Tự động tách mảnh Cam trở xuống: ${val ? "BẬT" : "TẮT"}`);
            if (val && typeof b.runAutoHeroFragmentDecompose === "function") {
                b.runAutoHeroFragmentDecompose();
            }
        } else if (key === "FEAT_AUTO_DEFJZ" || key === "auto_defjz") {
            b.settings.auto_defjz = val;
            b.state.isAutoDefJzActive = val;
            if (!val) {
                b.state.suppressDefJzUntil = Date.now() + 86400000;
                const vm = b.getViewManager ? b.getViewManager() : window.ViewManager;
                if (vm && typeof vm.closeView === "function") {
                    try { vm.closeView("DefJzSkillSelectView"); } catch (e) { }
                }
            }
            b.log(`🛡️ [Cài đặt] Tự động Thủ Vệ Kinh Châu (Bí Cảnh): ${val ? "BẬT" : "TẮT"}`);
        } else if (key === "FEAT_AUTO_DAILY_REWARDS" || key === "auto_daily_rewards") {
            b.settings.auto_daily_rewards = val;
            b.log(`🎁 [Cài đặt] Tự động nhận toàn bộ Quà Ngày, Mốc Năng Động & Phúc Lợi: ${val ? "BẬT" : "TẮT"}`);
            if (val && typeof b.runAutoDailyRewardsSmart === "function") {
                b.runAutoDailyRewardsSmart(true);
            }
        }
        b.notifyNativeStatus();
    };

    // =========================================================================
    // LỆNH HÀNH ĐỘNG NHANH: BẢNG XẾP HẠNG & 3Q TRANH HÙNG (Console / Window API)
    // =========================================================================
    window.claimRankRewards = async function () {
        const b = bot;
        b.log("👑 [Hành động] Đang quét và gom toàn bộ Quà Vinh Danh BXH + Bái kiến tất cả BXH Server...");
        b.state.rankLikedDate = null;
        if (b.state.cooldowns) {
            b.state.cooldowns["rank_like_all"] = 0;
            b.state.cooldowns["ladder_req_main"] = 0;
        }
        await b.runAutoRankSmart(true);
    };

    window.openRank = function () {
        const vm = bot.getViewManager();
        if (vm && typeof vm.open === "function") {
            vm.open("RankMainWindow");
            bot.log("📖 Đã mở giao diện Bảng Xếp Hạng Server.");
        }
    };

    window.openLadder = function () {
        const vm = bot.getViewManager();
        if (vm && typeof vm.open === "function") {
            vm.open("CrossLadderMainView");
            bot.log("⚔️ Đã mở giao diện 3Q Tranh Hùng / Đấu Trường Thiên Thê.");
        }
    };

    window.openSkVs = function () {
        const vm = bot.getViewManager();
        if (vm && typeof vm.open === "function") {
            vm.open("SkVsMainView");
            bot.log("🐯 Đã mở giao diện Long Hổ Tranh Bá.");
        }
    };

    window.__dauto_toggleMenu = function () {
        try {
            if (typeof jsb !== "undefined" && jsb.reflection && typeof jsb.reflection.callStaticMethod === "function") {
                jsb.reflection.callStaticMethod("QAUI", "toggleMenu");
                return;
            }
        } catch (e) { }
        try {
            const root = document.getElementById("autobot-hud-root");
            if (root && root.shadowRoot) {
                const pill = root.shadowRoot.getElementById("hud-pill");
                const panel = root.shadowRoot.getElementById("hud-panel");
                if (panel && pill) {
                    if (panel.style.display === "flex") {
                        panel.style.display = "none";
                        pill.style.display = "flex";
                    } else {
                        panel.style.display = "flex";
                        pill.style.display = "none";
                    }
                }
            }
        } catch (e) { }
    };

    window.__dauto_setFloatVisible = function (visible) {
        try {
            if (typeof jsb !== "undefined" && jsb.reflection && typeof jsb.reflection.callStaticMethod === "function") {
                jsb.reflection.callStaticMethod("QAUI", "setFloatButtonVisible:", !!visible);
            }
        } catch (e) { }
    };

    window.__dauto_viewBattleData = function () {
        if (window.AutoBot && typeof window.AutoBot.openLastBattleData === "function") {
            window.AutoBot.openLastBattleData();
        }
    };

    window.__dauto_openHelper = function () {
        try {
            const mu = (window.G_Mapping && window.G_Mapping.ModuleUtil) || window.ModuleUtil;
            if (mu && typeof mu.openModule === "function") {
                mu.openModule(311); // Module 311: QuickHelp / HelperMainView (Trợ Thủ)
                return true;
            }
        } catch (e) { }
        return false;
    };

    // Quét định kỳ FGUI nếu có node 18+ trong Cocos UI & đảm bảo Nút Trợ Thủ luôn hiển thị
    trackTimer(setInterval(function () {
        try {
            const vm = window.G_Mapping && window.G_Mapping.ViewManager;
            const mainView = vm && (vm.getView("MainUI_2025View") || vm.getView("MainUIView"));
            if (mainView) {
                if (mainView.helperBtn && typeof mainView.helperBtn.setVisible === "function") {
                    mainView.helperBtn.setVisible(true);
                }
                if (mainView.view && !mainView.__dauto_18_hooked) {
                    mainView.__dauto_18_hooked = true;
                    const children = mainView.view.getChildren ? mainView.view.getChildren() : [];
                    for (let i = 0; i < children.length; i++) {
                        const ch = children[i];
                        const name = (ch.name || "").toLowerCase();
                        if (name.includes("18") || name.includes("age") || name.includes("rating")) {
                            ch.onClick(function () {
                                if (window.__dauto_toggleMenu) window.__dauto_toggleMenu();
                            }, mainView);
                        }
                    }
                }
            }
        } catch (e) { }
    }, 3000));

    // Đảm bảo Bypass Tổ Đội Cấm Địa, Mỏ Đội Hình 2 & Game Engine luôn được duy trì liên tục mỗi 1s
    bot.hookTeamRestrictionBypass();
    bot.hookYyzqBuffViews();
    bot.enforceMineTeam2Unlock();
    bot.hookGameEngine();
    trackTimer(setInterval(function () {
        try {
            bot.hookTeamRestrictionBypass();
            bot.hookYyzqBuffViews();
            bot.enforceMineTeam2Unlock();
            bot.hookGameEngine();
            bot.updateDefJzEscapeUI();
        } catch (e) { }
    }, 1000));

    trackTimer(setTimeout(function () {
        bot.hookTeamRestrictionBypass();
        bot.hookYyzqBuffViews();
        bot.enforceMineTeam2Unlock();
        bot.hookGameEngine();
        bot.startScheduleLoop();
        if (!window.__HIDE_IN_GAME_HUD__ && typeof jsb === "undefined" && typeof window !== "undefined" && window.__INIT_3Q_HUD__) {
            try { window.__INIT_3Q_HUD__(bot); } catch (e) { }
        }
    }, 1500));

/**
 * In-Game Floating HUD Overlay for 3Q Đào Đào Đào (Tampermonkey & Web Injected Agent)
 * Designed with UI/UX Pro Max Glassmorphism & Dark Mode OLED Architecture
 */

(function () {
    if (typeof window === 'undefined') return;

    window.__INIT_3Q_HUD__ = function (bot) {
        if (window.__HIDE_IN_GAME_HUD__) return;
        if (window.__3Q_HUD_MOUNTED__) return;
        window.__3Q_HUD_MOUNTED__ = true;

        function mount() {
            if (!document.body) {
                setTimeout(mount, 500);
                return;
            }

            const host = document.createElement('div');
            host.id = 'autobot-hud-root';
            host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
            document.body.appendChild(host);

            const shadow = host.attachShadow({ mode: 'open' });

            const style = document.createElement('style');
            style.textContent = `
                * {
                    box-sizing: border-box;
                    margin: 0;
                    padding: 0;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    user-select: none;
                    -webkit-user-select: none;
                }

                /* Floating Pill (Collapsed) */
                #hud-pill {
                    position: fixed;
                    top: 18px;
                    right: 18px;
                    background: rgba(15, 23, 42, 0.90);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    border: 1px solid rgba(56, 189, 248, 0.4);
                    border-radius: 24px;
                    padding: 6px 14px 6px 10px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    cursor: grab;
                    pointer-events: auto;
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
                    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.2s ease;
                    z-index: 1000;
                }
                #hud-pill:hover {
                    transform: translateY(-2px);
                    border-color: #38BDF8;
                    box-shadow: 0 12px 28px rgba(2, 132, 199, 0.35);
                }
                #hud-pill:active {
                    cursor: grabbing;
                }
                .pulse-dot {
                    width: 9px;
                    height: 9px;
                    border-radius: 50%;
                    background: #10B981;
                    box-shadow: 0 0 10px #10B981;
                    animation: pulseDot 2s infinite ease-in-out;
                }
                @keyframes pulseDot {
                    0%, 100% { transform: scale(0.9); opacity: 0.6; }
                    50% { transform: scale(1.2); opacity: 1; }
                }
                .pill-text {
                    color: #F8FAFC;
                    font-size: 12px;
                    font-weight: 700;
                    letter-spacing: 0.3px;
                }
                .pill-badge {
                    background: #0284C7;
                    color: #E0F2FE;
                    font-size: 9px;
                    font-weight: 800;
                    padding: 2px 6px;
                    border-radius: 10px;
                }

                /* Expanded Panel */
                #hud-panel {
                    position: fixed;
                    top: 60px;
                    right: 20px;
                    width: 360px;
                    max-height: 580px;
                    background: rgba(11, 15, 25, 0.95);
                    backdrop-filter: blur(20px);
                    -webkit-backdrop-filter: blur(20px);
                    border: 1px solid rgba(56, 189, 248, 0.3);
                    border-radius: 16px;
                    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.75), 0 0 20px rgba(2, 132, 199, 0.15);
                    display: none;
                    flex-direction: column;
                    pointer-events: auto;
                    overflow: hidden;
                    z-index: 1001;
                    animation: fadeInScale 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                }
                @keyframes fadeInScale {
                    from { opacity: 0; transform: scale(0.95) translateY(-8px); }
                    to { opacity: 1; transform: scale(1) translateY(0); }
                }

                /* Header */
                .panel-header {
                    padding: 12px 16px;
                    background: rgba(18, 26, 42, 0.8);
                    border-bottom: 1px solid rgba(38, 53, 77, 0.7);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    cursor: grab;
                }
                .panel-header:active {
                    cursor: grabbing;
                }
                .header-title-box {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .header-title {
                    color: #F8FAFC;
                    font-size: 14px;
                    font-weight: 800;
                    letter-spacing: 0.3px;
                }
                .header-badge {
                    background: #0369A1;
                    color: #E0F2FE;
                    font-size: 10px;
                    font-weight: 800;
                    padding: 2px 7px;
                    border-radius: 4px;
                }
                .btn-icon {
                    background: transparent;
                    border: none;
                    color: #94A3B8;
                    font-size: 16px;
                    width: 26px;
                    height: 26px;
                    border-radius: 6px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: background 0.15s, color 0.15s;
                }
                .btn-icon:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: #F8FAFC;
                }

                /* Content Body */
                .panel-body {
                    padding: 12px 14px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    overflow-y: auto;
                    max-height: 500px;
                }
                .panel-body::-webkit-scrollbar {
                    width: 5px;
                }
                .panel-body::-webkit-scrollbar-thumb {
                    background: #1E293B;
                    border-radius: 4px;
                }

                /* Stat Cards */
                .stat-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 8px;
                }
                .stat-card {
                    background: rgba(19, 28, 45, 0.7);
                    border: 1px solid rgba(32, 45, 66, 0.8);
                    border-radius: 10px;
                    padding: 8px 10px;
                }
                .stat-label {
                    color: #64748B;
                    font-size: 10px;
                    font-weight: 700;
                    text-transform: uppercase;
                    margin-bottom: 2px;
                }
                .stat-value {
                    font-size: 13px;
                    font-weight: 800;
                    color: #F8FAFC;
                }
                .stat-power { color: #34D399; }
                .stat-stage { color: #FBBF24; }
                .stat-tower { color: #38BDF8; }
                .stat-gold { color: #F472B6; }

                /* Section Titles */
                .section-title {
                    color: #38BDF8;
                    font-size: 11px;
                    font-weight: 800;
                    letter-spacing: 0.5px;
                    text-transform: uppercase;
                    margin-top: 4px;
                }

                /* Toggles Grid */
                .toggle-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 6px;
                }
                .toggle-item {
                    background: rgba(19, 28, 45, 0.6);
                    border: 1px solid rgba(30, 41, 59, 0.7);
                    border-radius: 8px;
                    padding: 6px 10px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    cursor: pointer;
                    transition: background 0.15s, border-color 0.15s;
                }
                .toggle-item:hover {
                    background: rgba(24, 35, 56, 0.85);
                    border-color: rgba(56, 189, 248, 0.4);
                }
                .toggle-name {
                    color: #CBD5E1;
                    font-size: 11px;
                    font-weight: 600;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .switch-dot {
                    width: 14px;
                    height: 14px;
                    border-radius: 4px;
                    background: #1E293B;
                    border: 1px solid #334155;
                    transition: background 0.2s, border-color 0.2s;
                }
                .toggle-item.active .switch-dot {
                    background: #10B981;
                    border-color: #10B981;
                    box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
                }
                .toggle-item.active .toggle-name {
                    color: #F8FAFC;
                }

                /* Speed Bar */
                .speed-bar {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    background: rgba(19, 28, 45, 0.6);
                    border: 1px solid rgba(30, 41, 59, 0.7);
                    border-radius: 8px;
                    padding: 6px 10px;
                }
                .speed-label {
                    color: #94A3B8;
                    font-size: 11px;
                    font-weight: 700;
                    margin-right: 4px;
                }
                .btn-speed {
                    flex: 1;
                    background: #1E293B;
                    border: 1px solid #334155;
                    color: #CBD5E1;
                    font-size: 11px;
                    font-weight: 700;
                    padding: 4px 0;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.15s;
                }
                .btn-speed:hover {
                    background: #334155;
                    color: #F8FAFC;
                }
                .btn-speed.active {
                    background: #0284C7;
                    border-color: #38BDF8;
                    color: #FFFFFF;
                }

                /* Mini Console */
                .console-box {
                    background: #06090F;
                    border: 1px solid #1A2333;
                    border-radius: 8px;
                    padding: 8px;
                    font-family: Consolas, Monaco, "Courier New", monospace;
                    font-size: 10px;
                    max-height: 100px;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 3px;
                }
                .console-box::-webkit-scrollbar {
                    width: 4px;
                }
                .console-box::-webkit-scrollbar-thumb {
                    background: #1E293B;
                    border-radius: 3px;
                }
                .log-line {
                    line-height: 1.3;
                    word-break: break-all;
                }
                .log-time { color: #64748B; }
                .log-ok { color: #34D399; }
                .log-err { color: #F87171; }
                .log-info { color: #60A5FA; }
                .log-warn { color: #FBBF24; }

                /* Master Action */
                .btn-master {
                    background: #10B981;
                    color: #022C22;
                    font-weight: 800;
                    font-size: 12px;
                    padding: 8px 0;
                    border-radius: 8px;
                    border: none;
                    cursor: pointer;
                    transition: background 0.15s;
                    text-align: center;
                }
                .btn-master:hover {
                    background: #34D399;
                }
                .btn-master.stopped {
                    background: #EF4444;
                    color: #FFFFFF;
                }
            `;
            shadow.appendChild(style);

            // Container Wrapper
            const container = document.createElement('div');
            container.innerHTML = `
                <!-- Collapsed Floating Pill -->
                <div id="hud-pill">
                    <div class="pulse-dot"></div>
                    <span class="pill-text">⚡ 3Q AUTO</span>
                    <span class="pill-badge" id="hud-pill-stage">Ải --</span>
                </div>

                <!-- Expanded Panel -->
                <div id="hud-panel">
                    <div class="panel-header" id="panel-drag-handle">
                        <div class="header-title-box">
                            <span style="font-size: 16px;">⚡</span>
                            <span class="header-title">3Q ĐÀO ĐÀO ĐÀO</span>
                            <span class="header-badge">v3.9.20 PRO</span>
                        </div>
                        <button class="btn-icon" id="btn-close-hud" title="Thu nhỏ">✕</button>
                    </div>

                    <div class="panel-body">
                        <!-- Stats Grid -->
                        <div class="stat-grid">
                            <div class="stat-card">
                                <div class="stat-label">Lực Chiến</div>
                                <div class="stat-value stat-power" id="hud-val-power">--</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-label">Ải & Tháp</div>
                                <div class="stat-value stat-stage" id="hud-val-stage">Ải -- | Tháp --</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-label">Vàng & Ngọc</div>
                                <div class="stat-value stat-gold" id="hud-val-money">-- | --</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-label">Xẻng Đào</div>
                                <div class="stat-value stat-tower" id="hud-val-shovels">-- xẻng</div>
                            </div>
                        </div>

                        <!-- Speed Hack -->
                        <div class="speed-bar">
                            <span class="speed-label">⚡ Tốc Độ:</span>
                            <button class="btn-speed" data-spd="1">1x</button>
                            <button class="btn-speed active" data-spd="2">2x</button>
                            <button class="btn-speed" data-spd="3">3x</button>
                            <button class="btn-speed" data-spd="5">5x</button>
                        </div>

                        <!-- Toggles Grid -->
                        <div class="section-title">Tính Năng Tự Động</div>
                        <div class="toggle-grid">
                            <div class="toggle-item active" data-key="auto_daily_rewards" data-type="setting">
                                <span class="toggle-name">🎁 Quà Ngày & Mốc</span>
                                <div class="switch-dot"></div>
                            </div>
                            <div class="toggle-item" data-key="auto_stage">
                                <span class="toggle-name">⚔️ Vượt Ải</span>
                                <div class="switch-dot"></div>
                            </div>
                            <div class="toggle-item" data-key="auto_tower">
                                <span class="toggle-name">🏰 Leo Tháp</span>
                                <div class="switch-dot"></div>
                            </div>
                            <div class="toggle-item active" data-key="skip_battle" data-type="setting">
                                <span class="toggle-name">⚡ Skip 0s</span>
                                <div class="switch-dot"></div>
                            </div>
                            <div class="toggle-item active" data-key="skip_ads" data-type="setting">
                                <span class="toggle-name">🚫 Bỏ QC 0s</span>
                                <div class="switch-dot"></div>
                            </div>
                            <div class="toggle-item active" data-key="auto_host">
                                <span class="toggle-name">🏡 Gia Viên</span>
                                <div class="switch-dot"></div>
                            </div>
                            <div class="toggle-item" data-key="auto_rescue_knb" data-type="setting">
                                <span class="toggle-name">💎 Farm 50 KNB</span>
                                <div class="switch-dot"></div>
                            </div>
                            <div class="toggle-item active" data-key="auto_dispatch">
                                <span class="toggle-name">🗺️ Phái Tướng</span>
                                <div class="switch-dot"></div>
                            </div>
                            <div class="toggle-item" data-key="auto_treasure">
                                <span class="toggle-name">⛏️ Đào Bảo</span>
                                <div class="switch-dot"></div>
                            </div>
                            <div class="toggle-item active" data-key="auto_guild_mine">
                                <span class="toggle-name">🌾 Mỏ Bang (2Đ)</span>
                                <div class="switch-dot"></div>
                            </div>
                            <div class="toggle-item active" data-key="auto_touhu">
                                <span class="toggle-name">🎯 Aimbot Hũ</span>
                                <div class="switch-dot"></div>
                            </div>
                            <div class="toggle-item active" data-key="auto_feidao">
                                <span class="toggle-name">🗡️ Phi Kiếm</span>
                                <div class="switch-dot"></div>
                            </div>
                            <div class="toggle-item active" data-key="auto_recycle_fragments" data-type="setting">
                                <span class="toggle-name">🧩 Tách Mảnh</span>
                                <div class="switch-dot"></div>
                            </div>
                            <div class="toggle-item active" data-key="auto_yyzq_core" data-type="setting">
                                <span class="toggle-name">🔮 Lõi Tần Lĩnh</span>
                                <div class="switch-dot"></div>
                            </div>
                            <div class="toggle-item" data-key="auto_defjz" data-type="setting">
                                <span class="toggle-name">🛡️ Auto Bí Cảnh</span>
                                <div class="switch-dot"></div>
                            </div>
                            <div class="toggle-item active" data-key="auto_skvs">
                                <span class="toggle-name">🐯 Long Hổ Max</span>
                                <div class="switch-dot"></div>
                            </div>
                            <div class="toggle-item active" data-key="auto_rank">
                                <span class="toggle-name">👑 Bái 7 BXH</span>
                                <div class="switch-dot"></div>
                            </div>
                        </div>

                        <!-- Console Box -->
                        <div class="section-title">Nhật Ký Thời Gian Thực</div>
                        <div class="console-box" id="hud-console">
                            <div class="log-line"><span class="log-time">[Init]</span> <span class="log-ok">Sẵn sàng vận hành.</span></div>
                        </div>

                        <!-- Master Button -->
                        <button class="btn-master" id="btn-master-toggle">TẠM DỪNG TẤT CẢ AUTO</button>
                    </div>
                </div>
            `;
            shadow.appendChild(container);

            // DOM elements
            const pill = shadow.getElementById('hud-pill');
            const panel = shadow.getElementById('hud-panel');
            const btnClose = shadow.getElementById('btn-close-hud');
            const panelHeader = shadow.getElementById('panel-drag-handle');
            const consoleBox = shadow.getElementById('hud-console');
            const btnMaster = shadow.getElementById('btn-master-toggle');
            const pillStage = shadow.getElementById('hud-pill-stage');

            const valPower = shadow.getElementById('hud-val-power');
            const valStage = shadow.getElementById('hud-val-stage');
            const valMoney = shadow.getElementById('hud-val-money');
            const valShovels = shadow.getElementById('hud-val-shovels');

            // Open / Close Panel
            pill.addEventListener('click', () => {
                pill.style.display = 'none';
                panel.style.display = 'flex';
            });
            btnClose.addEventListener('click', () => {
                panel.style.display = 'none';
                pill.style.display = 'flex';
            });

            // Draggable Pill
            makeDraggable(pill);
            makeDraggable(panel, panelHeader);

            function makeDraggable(element, handle) {
                let isDragging = false;
                let startX, startY, origX, origY;
                const target = handle || element;

                target.addEventListener('mousedown', (e) => {
                    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
                    isDragging = true;
                    startX = e.clientX;
                    startY = e.clientY;
                    const rect = element.getBoundingClientRect();
                    origX = rect.left;
                    origY = rect.top;
                    e.preventDefault();
                });

                window.addEventListener('mousemove', (e) => {
                    if (!isDragging) return;
                    const dx = e.clientX - startX;
                    const dy = e.clientY - startY;
                    let newX = Math.max(10, Math.min(window.innerWidth - element.offsetWidth - 10, origX + dx));
                    let newY = Math.max(10, Math.min(window.innerHeight - element.offsetHeight - 10, origY + dy));
                    element.style.left = newX + 'px';
                    element.style.top = newY + 'px';
                    element.style.right = 'auto';
                });

                window.addEventListener('mouseup', () => {
                    isDragging = false;
                });
            }

            // Bind Toggles
            const toggleItems = shadow.querySelectorAll('.toggle-item');
            toggleItems.forEach((item) => {
                const key = item.getAttribute('data-key');
                const isSetting = item.getAttribute('data-type') === 'setting';

                // Initial sync
                let active = false;
                if (key === 'auto_stage') {
                    active = typeof bot.isAutoStageOn === "function" ? bot.isAutoStageOn() : false;
                } else if (key === 'auto_tower') {
                    active = bot.state ? bot.state.isAutoTowerActive !== false : true;
                } else {
                    active = isSetting ? !!bot.settings[key] : !!bot.settings[key];
                }
                if (active) item.classList.add('active');
                else item.classList.remove('active');

                item.addEventListener('click', () => {
                    const nowActive = !item.classList.contains('active');
                    if (nowActive) item.classList.add('active');
                    else item.classList.remove('active');

                    if (isSetting) {
                        bot.settings[key] = nowActive;
                        if (key === 'skip_ads' && typeof bot.setSkipAds === "function") {
                            bot.setSkipAds(nowActive);
                        }
                        if (key === 'skip_battle' && typeof bot.setSkipBattle === "function") {
                            bot.setSkipBattle(nowActive);
                        }
                        if (key === 'auto_recycle_fragments') {
                            bot.settings.auto_split_purple_shard = nowActive;
                        }
                        if (key === 'auto_yyzq_core' && bot.state) {
                            bot.state.isAutoYyzqCoreActive = nowActive;
                        }
                        if (key === 'auto_rescue_knb') {
                            if (bot.state) bot.state.isAutoRescueKnbActive = nowActive;
                            if (nowActive && typeof bot.runAutoRescueKnbSmart === "function") {
                                bot.runAutoRescueKnbSmart();
                            }
                        }
                        if (key === 'auto_defjz') {
                            if (bot.state) bot.state.isAutoDefJzActive = nowActive;
                            if (!nowActive) {
                                bot.state.suppressDefJzUntil = Date.now() + 86400000;
                                const vm = bot.getViewManager ? bot.getViewManager() : window.ViewManager;
                                if (vm && typeof vm.closeView === "function") {
                                    try { vm.closeView("DefJzSkillSelectView"); } catch (e) { }
                                }
                            }
                        }
                    } else {
                        bot.settings[key] = nowActive;
                        if (key === 'auto_stage') {
                            bot.setAutoStageActive(nowActive);
                        } else if (key === 'auto_tower' && typeof bot.setAutoTowerActive === "function") {
                            bot.setAutoTowerActive(nowActive);
                        } else if (bot.state) {
                            if (key === 'auto_tower') bot.state.isAutoTowerActive = nowActive;
                            if (key === 'auto_host') bot.state.isAutoHostActive = nowActive;
                            if (key === 'auto_touhu') {
                                bot.state.isAutoTouhuActive = nowActive;
                                bot.settings.touhu_aimbot = nowActive;
                            }
                            if (key === 'auto_skvs') {
                                bot.state.isAutoSkVsActive = nowActive;
                                if (nowActive && typeof bot.runAutoSkVsSmart === "function") bot.runAutoSkVsSmart();
                            }
                            if (key === 'auto_rank') {
                                bot.state.isAutoRankActive = nowActive;
                                if (nowActive && typeof bot.runAutoRankSmart === "function") bot.runAutoRankSmart(false);
                            }
                        }
                    }
                    if (typeof bot.saveSettings === "function") {
                        try { bot.saveSettings(); } catch (e) { }
                    }
                    bot.log(`[HUD] Chuyển đổi ${key}: ${nowActive ? 'BẬT' : 'TẮT'}`);
                });
            });

            // Bind Speed Buttons
            const speedBtns = shadow.querySelectorAll('.btn-speed');
            speedBtns.forEach((btn) => {
                btn.addEventListener('click', () => {
                    speedBtns.forEach((b) => b.classList.remove('active'));
                    btn.classList.add('active');
                    const spd = parseInt(btn.getAttribute('data-spd'));
                    if (typeof bot.setSpeed === "function") {
                        bot.setSpeed(spd);
                    } else {
                        bot.settings.speed_hack = spd;
                        try {
                            if (window.cc && window.cc.director && window.cc.director.getScheduler) {
                                window.cc.director.getScheduler().setTimeScale(spd);
                            }
                        } catch (e) { }
                    }
                    if (typeof bot.saveSettings === "function") {
                        try { bot.saveSettings(); } catch (e) { }
                    }
                    bot.log(`[HUD] Đã đặt tốc độ game: ${spd}x`);
                });
            });

            // Master Pause/Resume Button
            let isPausedAll = bot.state ? !bot.state.master : false;
            btnMaster.addEventListener('click', () => {
                isPausedAll = !isPausedAll;
                if (bot.state) bot.state.master = !isPausedAll;
                if (isPausedAll) {
                    btnMaster.textContent = 'KÍCH HOẠT LẠI AUTO';
                    btnMaster.classList.add('stopped');
                    bot.log('[HUD] ⏸️ Đã tạm dừng tất cả tác vụ tự động (Master Pause)!');
                } else {
                    btnMaster.textContent = 'TẠM DỪNG TẤT CẢ AUTO';
                    btnMaster.classList.remove('stopped');
                    bot.log('[HUD] ▶️ Đã kích hoạt lại toàn bộ tác vụ tự động!');
                }
            });

            // Global HUD Hooks for Live Updates
            window.__UPDATE_HUD_STATS__ = function (stats) {
                try {
                    if (stats.power) {
                        const p = Number(stats.power);
                        valPower.textContent = isNaN(p) ? stats.power : p.toLocaleString();
                    }
                    if (stats.stage || stats.towerFloor) {
                        const st = `Ải ${stats.stage || '--'} | Tháp ${stats.towerFloor || '--'}`;
                        valStage.textContent = st;
                        pillStage.textContent = `Ải ${stats.stage || '--'}`;
                    }
                    if (stats.gold !== undefined || stats.jade !== undefined) {
                        const g = Number(stats.gold || 0);
                        const j = Number(stats.jade || 0);
                        valMoney.textContent = `${g >= 1e6 ? (g / 1e6).toFixed(1) + 'M' : g.toLocaleString()} V | ${j.toLocaleString()} N`;
                    }
                    if (stats.shovels !== undefined) {
                        valShovels.textContent = `${stats.shovels || 0} xẻng`;
                    }
                } catch (e) { }
            };

            window.__UPDATE_HUD_LOG__ = function (entry) {
                try {
                    const line = document.createElement('div');
                    line.className = 'log-line';
                    const msg = entry.msg || '';
                    let cls = 'log-info';
                    if (msg.includes('thất bại') || msg.includes('Lỗi') || msg.includes('kẹt')) cls = 'log-err';
                    else if (msg.includes('Chiến thắng') || msg.includes('thành công') || msg.includes('hoàn tất')) cls = 'log-ok';
                    else if (msg.includes('chờ') || msg.includes('⚠️')) cls = 'log-warn';

                    line.innerHTML = `<span class="log-time">[${entry.time || ''}]</span> <span class="${cls}">${msg}</span>`;
                    consoleBox.appendChild(line);
                    if (consoleBox.children.length > 25) {
                        consoleBox.removeChild(consoleBox.children[0]);
                    }
                    consoleBox.scrollTop = consoleBox.scrollHeight;
                } catch (e) { }
            };
        }

        mount();
    };
})();


})();
