/**
 * 3Q Đào Đào Đào - Local GUI & Cloud AutoBot Runner v3.0 Final (Puppeteer + Live GUI Dashboard + Interactive Telegram Control)
 * Tích hợp:
 * - Bảng Điều Khiển GUI Trực Quan tại http://127.0.0.1:3939 (Theo dõi KNB, Cứu Trợ, Màn hình Game trực tiếp & Bật/Tắt 22 tính năng)
 * - Treo liên tục 24/7 trên Máy tính (macOS / Windows) hoặc GitHub Actions
 * - Điều khiển Bật/Tắt mọi tính năng (Vượt Ải, Long Mạch, Farm KNB, Leo Tháp, Gia Viên...) TRỰC TIẾP TRÊN GUI & QUA NÚT BẤM TELEGRAM
 * - Cơ chế Nhường Máy thông minh (yield_on_kick: tự dừng 15 phút khi có login từ Điện thoại, xong tự chạy tiếp; hoặc bấm nút Chạy Ngay)
 * - Báo cáo tiến trình & thống kê KNB định kỳ về Telegram (kèm ảnh chụp màn hình)
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execSync, exec } = require('child_process');

// ============================================================================
// 1. ĐỌC CẤU HÌNH TỪ CONFIG.JSON & BIẾN MÔI TRƯỜNG
// ============================================================================
const CONFIG_PATH = path.join(__dirname, 'config.json');
let rawConfig = {};
try {
    if (fs.existsSync(CONFIG_PATH)) {
        rawConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
} catch (err) {
    console.error(`[Config] ⚠️ Lỗi đọc config.json: ${err.message}`);
}

const primaryAccount = (Array.isArray(rawConfig.accounts) && rawConfig.accounts[0]) || rawConfig.account || {};
const cfgSettings = rawConfig.settings || {};
const cfgTelegram = rawConfig.telegram || {};
const cfgToggles = rawConfig.toggles || {};
const cfgIntervals = rawConfig.intervals || {};
const cfgTreasureFilter = rawConfig.treasure_filter || {};

const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const forceHeadless = isGitHubActions || process.env.HEADLESS === 'true' || cfgSettings.show_browser === false;
const GUI_PORT = parseInt(process.env.GUI_PORT || '3939', 10);

const CONFIG = {
    email: process.env.JOYPLAY_EMAIL || primaryAccount.email || 'dungby5@gmail.com',
    password: process.env.JOYPLAY_PASSWORD || primaryAccount.password || 'ntdung12',
    server: process.env.GAME_SERVER || primaryAccount.server_name || 'Tam Quốc S6',
    durationMinutes: parseInt(process.env.RUN_DURATION_MINUTES || (isGitHubActions ? '330' : '999999'), 10),
    headless: forceHeadless,
    settings: {
        show_browser: !forceHeadless,
        skip_ads: cfgSettings.skip_ads !== undefined ? !!cfgSettings.skip_ads : true,
        skip_battle: cfgSettings.skip_battle !== undefined ? !!cfgSettings.skip_battle : true,
        speed_hack: Number(cfgSettings.speed_hack) || 2,
        yield_on_kick: cfgSettings.yield_on_kick !== undefined ? !!cfgSettings.yield_on_kick : true,
        yield_wait_minutes: Number(cfgSettings.yield_wait_minutes) || 5
    },
    telegram: {
        bot_token: process.env.TELEGRAM_BOT_TOKEN || cfgTelegram.bot_token || '',
        chat_id: process.env.TELEGRAM_CHAT_ID || cfgTelegram.chat_id || '',
        report_interval_min: parseInt(process.env.TELEGRAM_REPORT_INTERVAL_MIN || cfgTelegram.report_interval_min || '30', 10)
    },
    toggles: Object.assign({
        auto_stage: false,
        auto_tower: false,
        auto_hero_up: false,
        auto_dispatch: false,
        auto_host: false,
        auto_rescue_knb: true,
        auto_star_up: false,
        auto_manual: false,
        auto_rank: true,
        auto_treasure: false,
        auto_arena: true,
        auto_afk: true,
        auto_defjz: true,
        auto_yyzq_core: true,
        auto_split_purple_shard: true,
        auto_touhu: true,
        auto_feidao: false,
        auto_hongbao: false,
        auto_act_task: true,
        auto_daily_rewards: true,
        auto_buy_gold: true,
        auto_free_lottery: true,
        auto_longmach: false,
        auto_skvs: true,
        auto_guild_mine: true,
        mod_skin: true,
        mod_headframe_title: true
    }, cfgToggles),
    intervals: cfgIntervals,
    treasure_filter: cfgTreasureFilter,
    gameUrl: 'https://yxkp-cdn.anhhung3q.com/web-mobile/index.html',
    playPortalUrl: 'https://3qdao.joyplay.vn/play',
    productId: 'b21anhhung',
    screenshotDir: path.join(__dirname, 'screenshots'),
    logFile: path.join(__dirname, 'bot.log')
};

const TOGGLE_LABELS = {
    auto_rescue_knb: '💎 Farm 50 KNB',
    auto_stage: '⚔️ Vượt Ải',
    auto_longmach: '🎲 Long Mạch',
    auto_tower: '🏰 Leo Tháp',
    auto_host: '🏡 Gia Viên',
    auto_defjz: '🛡️ Bí Cảnh',
    auto_guild_mine: '🌾 Mỏ Bang',
    auto_touhu: '🎯 Thần Xạ',
    auto_feidao: '🗡️ Phi Kiếm',
    auto_hongbao: '🧧 Lì Xì',
    auto_treasure: '⛏️ Đào Bảo',
    auto_dispatch: '🗺️ Phái Tướng',
    auto_arena: '🏆 Đấu Trường',
    auto_rank: '👑 Bái 7 BXH',
    auto_skvs: '🐯 Long Hổ',
    auto_daily_rewards: '🎁 Quà Ngày',
    auto_buy_gold: '💰 Mua Vàng KNB',
    auto_free_lottery: '🎰 Quay Free',
    auto_split_purple_shard: '🧩 Tách Mảnh'
};

if (!fs.existsSync(CONFIG.screenshotDir)) {
    fs.mkdirSync(CONFIG.screenshotDir, { recursive: true });
}

const RECENT_LOGS = [];

function writeLog(msg) {
    const now = new Date();
    const vnTime = new Date(now.getTime() + 7 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19);
    const cleanLine = `[${vnTime}] ${msg}`;
    const line = `${cleanLine}\n`;
    process.stdout.write(line);
    RECENT_LOGS.push(cleanLine);
    if (RECENT_LOGS.length > 160) {
        RECENT_LOGS.shift();
    }
    try {
        fs.appendFileSync(CONFIG.logFile, line, 'utf8');
    } catch (e) {}
}

function formatNum(n) {
    const num = Number(n || 0);
    return isNaN(num) ? String(n || 0) : num.toLocaleString('en-US');
}

async function pushLiveTelemetryToGitHub(telemetryObj, sessionState) {
    if (!isGitHubActions || typeof fetch !== 'function') return false;
    const token = process.env.GH_TOKEN || '';
    const repo = process.env.GH_REPO || '';
    if (!token || !repo) return false;

    const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': '3Q-AutoBot-Telemetry/3.8'
    };
    const apiBase = `https://api.github.com/repos/${repo}`;
    const jsonText = JSON.stringify(telemetryObj, null, 2);
    const contentB64 = Buffer.from(jsonText, 'utf8').toString('base64');

    try {
        let fileSha = (sessionState && sessionState._telemetryFileSha) || null;
        if (!fileSha) {
            const getRes = await fetch(`${apiBase}/contents/live_telemetry.json?ref=telemetry`, {
                method: 'GET',
                headers,
                signal: AbortSignal.timeout(8000)
            });
            if (getRes.status === 200) {
                const getJson = await getRes.json();
                fileSha = getJson && getJson.sha ? getJson.sha : null;
            } else if (getRes.status === 404) {
                const refRes = await fetch(`${apiBase}/git/ref/heads/telemetry`, {
                    method: 'GET',
                    headers,
                    signal: AbortSignal.timeout(8000)
                });
                if (refRes.status === 404) {
                    const blobRes = await fetch(`${apiBase}/git/blobs`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ content: contentB64, encoding: 'base64' }),
                        signal: AbortSignal.timeout(8000)
                    });
                    if (!blobRes.ok) return false;
                    const blobJson = await blobRes.json();

                    const treeRes = await fetch(`${apiBase}/git/trees`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            tree: [{ path: 'live_telemetry.json', mode: '100644', type: 'blob', sha: blobJson.sha }]
                        }),
                        signal: AbortSignal.timeout(8000)
                    });
                    if (!treeRes.ok) return false;
                    const treeJson = await treeRes.json();

                    const commitRes = await fetch(`${apiBase}/git/commits`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            message: 'chore(telemetry): init live_telemetry.json branch',
                            tree: treeJson.sha,
                            parents: []
                        }),
                        signal: AbortSignal.timeout(8000)
                    });
                    if (!commitRes.ok) return false;
                    const commitJson = await commitRes.json();

                    const createRefRes = await fetch(`${apiBase}/git/refs`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ ref: 'refs/heads/telemetry', sha: commitJson.sha }),
                        signal: AbortSignal.timeout(8000)
                    });
                    if (createRefRes.ok && sessionState) {
                        sessionState._telemetryFileSha = blobJson.sha;
                    }
                    return createRefRes.ok;
                }
            }
        }

        const putBody = {
            message: `chore(telemetry): run #${telemetryObj.runNumber || 0} (${telemetryObj.uptimeMin || 0}m, +${telemetryObj.totalRescuedKnb || 0} KNB)`,
            content: contentB64,
            branch: 'telemetry'
        };
        if (fileSha) putBody.sha = fileSha;

        let putRes = await fetch(`${apiBase}/contents/live_telemetry.json`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(putBody),
            signal: AbortSignal.timeout(8000)
        });
        if ((putRes.status === 409 || putRes.status === 422) && sessionState) {
            sessionState._telemetryFileSha = null;
            const retryGet = await fetch(`${apiBase}/contents/live_telemetry.json?ref=telemetry`, {
                method: 'GET',
                headers,
                signal: AbortSignal.timeout(8000)
            });
            if (retryGet.status === 200) {
                const retryJson = await retryGet.json();
                if (retryJson && retryJson.sha) {
                    putBody.sha = retryJson.sha;
                    putRes = await fetch(`${apiBase}/contents/live_telemetry.json`, {
                        method: 'PUT',
                        headers,
                        body: JSON.stringify(putBody),
                        signal: AbortSignal.timeout(8000)
                    });
                }
            }
        }
        if (putRes.ok) {
            const putJson = await putRes.json();
            if (sessionState && putJson && putJson.content && putJson.content.sha) {
                sessionState._telemetryFileSha = putJson.content.sha;
            }
            return true;
        }
    } catch (eTel) { }
    return false;
}

function saveConfigToDisk() {
    try {
        rawConfig.account = Object.assign(rawConfig.account || {}, {
            email: CONFIG.email,
            password: CONFIG.password,
            server_name: CONFIG.server
        });
        if (Array.isArray(rawConfig.accounts) && rawConfig.accounts.length > 0) {
            rawConfig.accounts[0] = Object.assign(rawConfig.accounts[0] || {}, {
                email: CONFIG.email,
                password: CONFIG.password,
                server_name: CONFIG.server
            });
        }
        rawConfig.settings = Object.assign(rawConfig.settings || {}, CONFIG.settings);
        rawConfig.telegram = Object.assign(rawConfig.telegram || {}, CONFIG.telegram);
        rawConfig.toggles = Object.assign(rawConfig.toggles || {}, CONFIG.toggles);
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(rawConfig, null, 2), 'utf8');
    } catch (e) {}
}

// ============================================================================
// 2. HỆ THỐNG BÁO CÁO & ĐIỀU KHIỂN TỪ XA QUA TELEGRAM (INLINE KEYBOARD)
// ============================================================================
function buildTelegramKeyboard(sessionState) {
    const t = CONFIG.toggles;
    const isYielding = !!(sessionState && sessionState.isYielding);
    const isHardStopped = !!(sessionState && (sessionState.isHardStopped || sessionState.isMaintenance));
    const btn = (key) => ({
        text: `${t[key] ? '✅' : '❌'} ${TOGGLE_LABELS[key] || key}`,
        callback_data: `toggle:${key}`
    });

    return {
        inline_keyboard: [
            [
                { text: '⚡ Dọn Sạch NV Ngày (100/100) + Mua Hết Vàng KNB + Nhận Quà', callback_data: 'action:one_click_daily' }
            ],
            [btn('auto_daily_rewards'), btn('auto_buy_gold')],
            [btn('auto_rescue_knb'), btn('auto_stage')],
            [btn('auto_longmach'), btn('auto_tower')],
            [btn('auto_host'), btn('auto_defjz')],
            [btn('auto_guild_mine'), btn('auto_touhu')],
            [btn('auto_arena'), btn('auto_rank')],
            [btn('auto_skvs'), btn('auto_free_lottery')],
            [btn('auto_feidao'), btn('auto_hongbao')],
            [btn('auto_treasure'), btn('auto_dispatch')],
            [btn('auto_split_purple_shard')],
            [
                { text: '📸 Xem Ảnh & Báo Cáo Ngay', callback_data: 'action:report_now' },
                (isYielding || isHardStopped)
                    ? { text: '▶️ Chạy Lại Ngay (Bỏ Chờ)', callback_data: 'action:resume_now' }
                    : { text: `⏸️ Nghỉ ${CONFIG.settings.yield_wait_minutes || 5}p Nhường Máy`, callback_data: 'action:pause_5m' }
            ],
            [
                isHardStopped
                    ? { text: '🟢 Khởi Động Lại Bot & Kết Nối Game Ngay', callback_data: 'action:resume_now' }
                    : { text: '🛑 Dừng Hẳn Bot (Ngắt Login / Bảo Trì / Tắt Workflow)', callback_data: 'action:stop_bot' }
            ]
        ]
    };
}

async function sendTelegramMessage(htmlText, photoPath = null, sessionState = null) {
    const token = CONFIG.telegram.bot_token;
    const chatId = CONFIG.telegram.chat_id;
    if (!token || !chatId) return false;

    const replyMarkup = buildTelegramKeyboard(sessionState);

    try {
        if (photoPath && fs.existsSync(photoPath) && typeof FormData !== 'undefined' && typeof Blob !== 'undefined') {
            try {
                const fileBuf = fs.readFileSync(photoPath);
                const isCaptionShort = String(htmlText || '').length <= 980;
                const form = new FormData();
                form.append('chat_id', String(chatId));
                if (isCaptionShort) {
                    form.append('caption', htmlText);
                    form.append('parse_mode', 'HTML');
                    form.append('reply_markup', JSON.stringify(replyMarkup));
                } else {
                    const vnShort = new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19);
                    form.append('caption', `📸 <b>Ảnh chụp màn hình thực tế</b> (${vnShort} GMT+7)`);
                    form.append('parse_mode', 'HTML');
                }
                form.append('photo', new Blob([fileBuf], { type: 'image/png' }), path.basename(photoPath));

                const photoResp = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
                    method: 'POST',
                    body: form
                });
                const photoRes = await photoResp.json();
                if (photoRes && photoRes.ok && isCaptionShort) {
                    writeLog(`[Telegram] ✅ Đã gửi báo cáo kèm ảnh & bảng điều khiển về Telegram!`);
                    return true;
                }
            } catch (ePhoto) {
                writeLog(`[Telegram] ⚠️ Gửi ảnh thất bại (${ePhoto.message}), chuyển sang gửi tin nhắn văn bản...`);
            }
        }

        const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: String(chatId),
                text: htmlText,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: replyMarkup
            })
        });
        const res = await resp.json();
        if (res && res.ok) {
            writeLog(`[Telegram] ✅ Đã gửi báo cáo & bảng điều khiển về Telegram thành công!`);
            return true;
        } else {
            writeLog(`[Telegram] ⚠️ API trả về lỗi: ${JSON.stringify(res)}`);
            return false;
        }
    } catch (err) {
        writeLog(`[Telegram] ⚠️ Lỗi kết nối Telegram: ${err.message}`);
        return false;
    }
}

function isStatsLoaded(st) {
    return !!(
        st &&
        st.roleName &&
        st.roleName !== 'Đang tải...' &&
        st.roleName !== '---' &&
        (Number(st.jade || 0) > 0 || Number(st.basePower || st.power || 0) > 0)
    );
}

function buildTelegramReportHtml(title, stats, sessionState, extraNote = '') {
    const rawSt = stats || {};
    const fallbackSt = (sessionState && sessionState.lastKnownStats) || {};
    const isUnloaded = !rawSt.roleName || rawSt.roleName === 'Đang tải...' || rawSt.roleName === '---' ||
        (Number(rawSt.jade || 0) <= 0 && Number(rawSt.basePower || rawSt.power || 0) <= 0);
    const st = isUnloaded ? Object.assign({}, rawSt, fallbackSt, {
        rescuedCount: rawSt.rescuedCount !== undefined ? rawSt.rescuedCount : fallbackSt.rescuedCount,
        rescuedKnbTotal: rawSt.rescuedKnbTotal !== undefined ? rawSt.rescuedKnbTotal : fallbackSt.rescuedKnbTotal,
        inspectedHomesCount: rawSt.inspectedHomesCount !== undefined ? rawSt.inspectedHomesCount : fallbackSt.inspectedHomesCount,
        totalRescueScanned: rawSt.totalRescueScanned !== undefined ? rawSt.totalRescueScanned : fallbackSt.totalRescueScanned
    }) : rawSt;

    const nowVn = new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19);
    const elapsedMin = Math.max(1, Math.round((Date.now() - sessionState.startTime) / 60000));
    const remainMin = Math.max(0, Math.round((sessionState.endTime - Date.now()) / 60000));

    const curJade = Number(st.jade || fallbackSt.jade || 0);
    const startJade = (sessionState.initialJade !== null && curJade > 0) ? sessionState.initialJade : curJade;
    const deltaJade = curJade > 0 ? (curJade - startJade) : 0;
    const deltaJadeStr = deltaJade >= 0 ? `+${formatNum(deltaJade)}` : formatNum(deltaJade);

    const totalRescuedCount = (sessionState.baseRescuedCount || 0) + Number(st.rescuedCount || 0);
    const totalRescuedKnb = (sessionState.baseRescuedKnb || 0) + Number(st.rescuedKnbTotal || 0);
    const inspectedHomes = (sessionState.baseInspectedHomes || 0) + Number(st.inspectedHomesCount || st.totalRescueScanned || 0);
    const avgScanPerMin = Math.round(inspectedHomes / elapsedMin);

    const basePow = Number(st.basePower || st.power || fallbackSt.basePower || fallbackSt.power || 0);
    const curPow = Number(st.power || basePow || 0);
    const powText = (basePow > curPow && curPow > 0)
        ? `${formatNum(basePow)} <i>(Đội dò: ${formatNum(curPow)})</i>`
        : `${formatNum(basePow || curPow)}`;

    const activeFeatures = [];
    for (const [k, label] of Object.entries(TOGGLE_LABELS)) {
        if (CONFIG.toggles[k]) activeFeatures.push(label);
    }

    let lines = [
        `<b>${title}</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `👤 <b>Nhân vật:</b> ${st.roleName || 'Đang tải...'} (Lv.${st.level || '?'})`,
        `🌐 <b>Máy chủ:</b> ${CONFIG.server} (<code>${CONFIG.email}</code>)`,
        `⚔️ <b>Lực chiến:</b> ${powText}`,
        `🏰 <b>Tiến độ:</b> Ải ${st.stage || '--'} | Tháp ${st.towerFloor || '--'}`,
        `💰 <b>KNB hiện có:</b> <b>${formatNum(curJade)} KNB</b> (<code>${deltaJadeStr} KNB</code>)`,
        `🪙 <b>Vàng:</b> ${formatNum(st.gold || 0)} | ⛏️ <b>Xẻng:</b> ${formatNum(st.shovels || 0)}`,
        `━━━━━━━━━━━━━━━━━━`,
        `💎 <b>THỐNG KÊ FARM KNB GIẢI CỨU:</b>`,
        `• <b>Giải cứu thành công:</b> <b>${totalRescuedCount} lượt</b> (<b>+${formatNum(totalRescuedKnb)} KNB</b>)`,
        `• <b>Gia viên đã dò:</b> ${formatNum(inspectedHomes)} nhà (~${formatNum(avgScanPerMin)} nhà/phút)`,
        `━━━━━━━━━━━━━━━━━━`,
        `⚙️ <b>Đang bật:</b> ${activeFeatures.join(', ') || 'Tạm dừng'}`,
        `⏱️ <b>Đã treo:</b> ${elapsedMin}p (Còn ${remainMin}p trong phiên • Tự nối 24/7)`,
        `🕒 <b>Cập nhật:</b> ${nowVn} (GMT+7)`,
        `💡 <i>Bấm trực tiếp các nút bên dưới để Bật/Tắt tính năng ngay khi đang chạy!</i>`
    ];

    if (extraNote) {
        lines.push(`━━━━━━━━━━━━━━━━━━`);
        lines.push(extraNote);
    }

    return lines.join('\n');
}

async function applyTogglesToLivePage(page, changedKey = null) {
    if (!page || page.isClosed()) return false;
    try {
        const merged = Object.assign({}, CONFIG.settings, CONFIG.toggles);
        await page.evaluate((t, key) => {
            try {
                localStorage.setItem("3qdao_bot_settings", JSON.stringify(t));
            } catch (e) {}
            if (!window.AutoBot) return;
            window.AutoBot.setToggles(t);
            if (typeof window.AutoBot.setSpeed === 'function' && t.speed_hack) {
                window.AutoBot.setSpeed(t.speed_hack);
            }
            if (key && t[key]) {
                const runBg = (fn) => {
                    if (typeof window.AutoBot.runInBgAutoContext === 'function') {
                        window.AutoBot.runInBgAutoContext(fn);
                    } else {
                        fn();
                    }
                };
                if (key === 'auto_stage' && typeof window.AutoBot.runAutoStageSmart === 'function') {
                    runBg(() => window.AutoBot.runAutoStageSmart());
                } else if (key === 'auto_longmach' && typeof window.AutoBot.runAutoLongMachSmart === 'function') {
                    runBg(() => window.AutoBot.runAutoLongMachSmart());
                } else if (key === 'auto_rescue_knb' && typeof window.AutoBot.runAutoRescueKnbSmart === 'function') {
                    runBg(() => window.AutoBot.runAutoRescueKnbSmart());
                } else if (key === 'auto_tower' && typeof window.AutoBot.runAutoTowerSmart === 'function') {
                    runBg(() => window.AutoBot.runAutoTowerSmart());
                } else if (key === 'auto_host' && typeof window.AutoBot.runAutoHostSmart === 'function') {
                    runBg(() => window.AutoBot.runAutoHostSmart());
                } else if (key === 'auto_defjz' && typeof window.AutoBot.runAutoDefJzSmart === 'function') {
                    runBg(() => window.AutoBot.runAutoDefJzSmart(true));
                } else if (key === 'auto_feidao' && typeof window.AutoBot.runAutoFeiDaoSmart === 'function') {
                    runBg(() => window.AutoBot.runAutoFeiDaoSmart());
                } else if (key === 'auto_buy_gold' && typeof window.AutoBot.runBuyAllGoldSmart === 'function') {
                    runBg(() => window.AutoBot.runBuyAllGoldSmart(true));
                } else if (key === 'auto_daily_rewards') {
                    runBg(async () => {
                        if (typeof window.AutoBot.runAutoQuestsMasterSmart === 'function') await window.AutoBot.runAutoQuestsMasterSmart();
                        if (typeof window.AutoBot.runAutoDailyRewardsSmart === 'function') await window.AutoBot.runAutoDailyRewardsSmart(true);
                    });
                } else if (key === 'auto_guild_mine' && typeof window.AutoBot.runAutoGuildMineSmart === 'function') {
                    runBg(() => window.AutoBot.runAutoGuildMineSmart());
                } else if (key === 'auto_touhu' && typeof window.AutoBot.runAutoTouhuSmart === 'function') {
                    runBg(() => window.AutoBot.runAutoTouhuSmart(true));
                } else if (key === 'auto_treasure' && typeof window.AutoBot.runAutoTreasureSmart === 'function') {
                    runBg(() => window.AutoBot.runAutoTreasureSmart());
                } else if (key === 'auto_dispatch' && typeof window.AutoBot.runAutoDispatchSmart === 'function') {
                    runBg(() => window.AutoBot.runAutoDispatchSmart(true));
                } else if (key === 'auto_arena' && typeof window.AutoBot.runAutoArenaSmart === 'function') {
                    runBg(() => window.AutoBot.runAutoArenaSmart(true));
                } else if (key === 'auto_rank' && typeof window.AutoBot.runAutoRankSmart === 'function') {
                    runBg(() => window.AutoBot.runAutoRankSmart(true));
                } else if (key === 'auto_skvs' && typeof window.AutoBot.runAutoSkVsSmart === 'function') {
                    runBg(() => window.AutoBot.runAutoSkVsSmart());
                } else if (key === 'auto_free_lottery' && typeof window.AutoBot.runAutoFreeLotterySmart === 'function') {
                    runBg(() => window.AutoBot.runAutoFreeLotterySmart(true));
                } else if (key === 'auto_split_purple_shard' && typeof window.AutoBot.runAutoHeroFragmentDecompose === 'function') {
                    runBg(() => window.AutoBot.runAutoHeroFragmentDecompose());
                }
            }
        }, merged, changedKey);
        return true;
    } catch (e) {
        writeLog(`[LiveSync] ⚠️ Không thể áp dụng trực tiếp vào trang: ${e.message}`);
        return false;
    }
}

// ============================================================================
// 3. BỘ LẮNG NGHE LỆNH ĐIỀU KHIỂN TELEGRAM & HOT-RELOAD GITHUB CONFIG
// ============================================================================
function startTelegramCommandPoller(sessionState, getActivePage) {
    const token = CONFIG.telegram.bot_token;
    const allowedChatId = String(CONFIG.telegram.chat_id || '');
    if (!token || !allowedChatId) return () => {};

    let stopped = false;
    let lastUpdateId = 0;

    const answerCallbackFast = async (cqId, text, showAlert = false) => {
        try {
            await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    callback_query_id: cqId,
                    text,
                    show_alert: !!showAlert
                })
            });
        } catch (e) {}
    };

    const runOneClickDailyTaskAsync = async (sourceTag) => {
        if (sessionState.oneClickDailyRunning) return;
        sessionState.oneClickDailyRunning = true;
        try {
            writeLog(`⚡ [${sourceTag}] Kích hoạt 1-Click: Làm Hết NV Ngày (100/100) + Mua Sạch Lượt Vàng KNB + Nhận Full Quà...`);
            const page = getActivePage();
            const snapPath = path.join(CONFIG.screenshotDir, 'latest.png');
            if (!page || page.isClosed()) {
                const offlineHtml = buildTelegramReportHtml(
                    '⚠️ CHƯA THỂ CHẠY 1-CLICK (PHIÊN ĐANG NGHỈ NHƯỜNG MÁY / ĐANG TẢI)',
                    sessionState.lastKnownStats,
                    sessionState,
                    '⏳ <i>Hiện Bot đang tạm nghỉ nhường Điện thoại hoặc đang mở lại sảnh. Hãy bấm <b>"▶️ Chạy Lại Ngay"</b> để vào sảnh rồi bấm lại nhé!</i>'
                );
                await sendTelegramMessage(offlineHtml, null, sessionState);
                return;
            }

            let resData = null;
            try {
                resData = await page.evaluate(async () => {
                    if (window.AutoBot && typeof window.AutoBot.runOneClickAllDailyAndGifts === 'function') {
                        return await window.AutoBot.runOneClickAllDailyAndGifts();
                    }
                    return null;
                });
                const stNow = await page.evaluate(() => window.AutoBot ? window.AutoBot.updateStats() : null);
                if (isStatsLoaded(stNow)) sessionState.lastKnownStats = stNow;
                await page.screenshot({ path: snapPath });
            } catch (eExec) {
                writeLog(`⚠️ [${sourceTag}] Lỗi trong lúc thực thi 1-Click: ${eExec.message}`);
            }

            const noteLines = [
                '✅ <b>Đã hoàn tất chuỗi 1-Click Toàn Diện:</b>'
            ];
            if (resData && resData.ok) {
                const gDiff = Number(resData.goldDelta || 0);
                const kDiff = Number(resData.knbDelta || 0);
                const dScore = Number(resData.dailyScore || 0);
                const dBoxes = Number(resData.dailyBoxesOpened || 0);
                const wBoxes = Number(resData.weeklyBoxesOpened || 0);
                const totTurns = Number(resData.totalGoldTurns || 0);
                const freeTurns = Number(resData.freeGoldTurns || 0);
                const knbTurns = Number(resData.knbGoldTurns || 0);
                noteLines.push(`• 🎯 <b>Năng động ngày:</b> <b>${dScore}/100</b> (Đã nhận <b>${resData.dailyTasksClaimed || 0}</b> NV, mở <b>${dBoxes}</b> rương ngày${wBoxes > 0 ? `, <b>${wBoxes}</b> rương tuần` : ''})`);
                noteLines.push(`• 💰 <b>Cây Tài Lộc:</b> Đã mua sạch <b>${totTurns} lượt</b> (Miễn phí: <b>${freeTurns}</b> • KNB: <b>${knbTurns}</b>)`);
                noteLines.push(`• 📈 <b>Biến động ròng:</b> Vàng <b>${gDiff >= 0 ? '+' : ''}${formatNum(gDiff)}</b> | KNB <b>${kDiff >= 0 ? '+' : ''}${formatNum(kDiff)}</b>`);
            } else {
                noteLines.push('• Đã quét toàn bộ Nhiệm Vụ Ngày, Cây Tài Lộc (Free + KNB), Phó Bản Ngày, Cửa Hàng, Hòm Thư & Quà Phúc Lợi!');
            }

            const html = buildTelegramReportHtml(
                '⚡ KẾT QUẢ 1-CLICK: NV NGÀY 100/100 + MUA HẾT VÀNG KNB + FULL QUÀ',
                sessionState.lastKnownStats,
                sessionState,
                noteLines.join('\n')
            );
            await sendTelegramMessage(html, fs.existsSync(snapPath) ? snapPath : null, sessionState);
        } finally {
            sessionState.oneClickDailyRunning = false;
        }
    };

    const runInstantReportAsync = async (titleStr) => {
        try {
            const page = getActivePage();
            const snapPath = path.join(CONFIG.screenshotDir, 'latest.png');
            if (page && !page.isClosed()) {
                try {
                    const stNow = await page.evaluate(() => window.AutoBot ? window.AutoBot.updateStats() : null);
                    if (isStatsLoaded(stNow)) sessionState.lastKnownStats = stNow;
                    await page.screenshot({ path: snapPath });
                } catch (e) {}
            }
            const waitMinNow = Math.max(1, Number(CONFIG.settings.yield_wait_minutes) || 5);
            const html = buildTelegramReportHtml(
                titleStr,
                sessionState.lastKnownStats,
                sessionState,
                sessionState.isHardStopped
                    ? '🛑 <i>Bot hiện đã DỪNG HẲN toàn bộ kết nối theo lệnh điều khiển.</i>'
                    : sessionState.isMaintenance
                        ? '🛠️ <i>Máy chủ đang bảo trì — Bot đã ngắt toàn bộ lệnh login tránh lag.</i>'
                        : sessionState.isYielding
                            ? `⏸️ <i>Bot hiện đang tạm nghỉ nhường máy (${waitMinNow} phút).</i>`
                            : '🟢 <i>Bot đang hoạt động trực tuyến bình thường.</i>'
            );
            await sendTelegramMessage(html, fs.existsSync(snapPath) ? snapPath : null, sessionState);
        } catch (eRep) {}
    };

    // Khởi tạo offset ban đầu để bỏ qua các tin nhắn cũ trước khi phiên chạy bắt đầu
    (async () => {
        try {
            const initResp = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=-1&limit=1`);
            const initData = await initResp.json();
            if (initData && initData.ok && Array.isArray(initData.result) && initData.result.length > 0) {
                lastUpdateId = initData.result[initData.result.length - 1].update_id;
            }
        } catch (e) {}

        while (!stopped) {
            let pollHadError = false;
            try {
                const resp = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=8`);
                const data = await resp.json();
                if (data && data.ok && Array.isArray(data.result)) {
                    for (const upd of data.result) {
                        lastUpdateId = Math.max(lastUpdateId, upd.update_id);

                        // 1. Xử lý khi người dùng bấm nút trên bảng điều khiển Inline Keyboard (Phản hồi tức thì <0.2s, không nghẽn luồng!)
                        if (upd.callback_query) {
                            const cq = upd.callback_query;
                            const fromChatId = String((cq.message && cq.message.chat && cq.message.chat.id) || '');
                            if (fromChatId && fromChatId !== allowedChatId) continue;

                            const actionData = String(cq.data || '');
                            if (actionData.startsWith('toggle:')) {
                                const key = actionData.split(':')[1];
                                if (key && CONFIG.toggles[key] !== undefined) {
                                    CONFIG.toggles[key] = !CONFIG.toggles[key];
                                    const newVal = CONFIG.toggles[key];
                                    const label = TOGGLE_LABELS[key] || key;
                                    saveConfigToDisk();
                                    writeLog(`🎛️ [Telegram Remote] Đã chuyển đổi [${label}] -> ${newVal ? 'BẬT' : 'TẮT'}`);

                                    await answerCallbackFast(cq.id, `⚡ Đã ${newVal ? 'BẬT ✅' : 'TẮT ❌'} ${label}!`);

                                    if (cq.message && cq.message.message_id) {
                                        fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                chat_id: fromChatId,
                                                message_id: cq.message.message_id,
                                                reply_markup: buildTelegramKeyboard(sessionState)
                                            })
                                        }).catch(() => {});
                                    }

                                    const page = getActivePage();
                                    applyTogglesToLivePage(page, key).catch(() => {});
                                } else {
                                    await answerCallbackFast(cq.id, '⚠️ Tính năng không hợp lệ!');
                                }
                            } else if (actionData === 'action:one_click_daily') {
                                if (sessionState.oneClickDailyRunning) {
                                    await answerCallbackFast(cq.id, '⏳ Đang chạy chuỗi NV Ngày 100/100 + Mua Hết Vàng KNB, vui lòng chờ vài giây...');
                                } else {
                                    await answerCallbackFast(cq.id, '⚡ Đang làm hết NV Ngày (100/100) + Mua sạch Vàng KNB + Nhận Full Quà...');
                                    void runOneClickDailyTaskAsync('Telegram Remote');
                                }
                            } else if (actionData === 'action:report_now') {
                                await answerCallbackFast(cq.id, '📸 Đang chụp màn hình và gửi báo cáo mới nhất...');
                                void runInstantReportAsync('📸 BÁO CÁO TRẠNG THÁI TỨC THÌ (THEO YÊU CẦU)');
                            } else if (actionData === 'action:pause_5m' || actionData === 'action:pause_15m') {
                                const waitM = Math.max(1, Number(CONFIG.settings.yield_wait_minutes) || 5);
                                sessionState.manualYieldRequested = true;
                                await answerCallbackFast(cq.id, `⏸️ Đang tạm dừng Bot ${waitM} phút để nhường máy...`);
                            } else if (actionData === 'action:stop_bot') {
                                sessionState.stopRequested = true;
                                sessionState.isHardStopped = true;
                                CONFIG.settings.bot_stopped = true;
                                saveConfigToDisk();
                                try { fs.writeFileSync(path.join(__dirname, '.bot_stopped'), '1', 'utf8'); } catch (e) {}
                                await answerCallbackFast(cq.id, '🛑 Đã dừng hẳn Bot & ngắt toàn bộ lệnh đăng nhập/kết nối!');
                            } else if (actionData === 'action:resume_now') {
                                sessionState.stopRequested = false;
                                sessionState.isHardStopped = false;
                                sessionState.isMaintenance = false;
                                sessionState.maintenanceDetected = false;
                                sessionState.forceResumeFromYield = true;
                                CONFIG.settings.bot_stopped = false;
                                saveConfigToDisk();
                                try { fs.unlinkSync(path.join(__dirname, '.bot_stopped')); } catch (e) {}
                                await answerCallbackFast(cq.id, '▶️ Đang kết nối vào lại game ngay lập tức!');
                            }
                        }

                        // 2. Xử lý tin nhắn văn bản gửi tới Bot (/menu, /status, /daily, /pause, /stop, /resume)
                        if (upd.message && upd.message.text) {
                            const fromChatId = String((upd.message.chat && upd.message.chat.id) || '');
                            if (fromChatId !== allowedChatId) continue;
                            const txt = upd.message.text.trim().toLowerCase();

                            if (txt === '/menu' || txt === '/settings' || txt === '/start' || txt === '/status' || txt === '/report') {
                                void runInstantReportAsync('🎛️ BẢNG ĐIỀU KHIỂN TRỰC TUYẾN 3Q AUTOBOT v3.8');
                            } else if (txt === '/daily' || txt === '/nhanh' || txt === '/nvngay' || txt === '/muavang') {
                                void runOneClickDailyTaskAsync('Telegram /daily');
                            } else if (txt === '/pause' || txt === '/nghi') {
                                sessionState.manualYieldRequested = true;
                            } else if (txt === '/stop' || txt === '/dung' || txt === '/tat' || txt === '/baotri') {
                                sessionState.stopRequested = true;
                                sessionState.isHardStopped = true;
                                CONFIG.settings.bot_stopped = true;
                                saveConfigToDisk();
                                try { fs.writeFileSync(path.join(__dirname, '.bot_stopped'), '1', 'utf8'); } catch (e) {}
                            } else if (txt === '/resume' || txt === '/chay' || txt === '/bat') {
                                sessionState.stopRequested = false;
                                sessionState.isHardStopped = false;
                                sessionState.isMaintenance = false;
                                sessionState.maintenanceDetected = false;
                                sessionState.forceResumeFromYield = true;
                                CONFIG.settings.bot_stopped = false;
                                saveConfigToDisk();
                                try { fs.unlinkSync(path.join(__dirname, '.bot_stopped')); } catch (e) {}
                            }
                        }
                    }
                }
            } catch (ePoll) {
                pollHadError = true;
            }
            await new Promise(r => setTimeout(r, pollHadError ? 1500 : 250));
        }
    })();

    return () => { stopped = true; };
}

// Kiểm tra nếu người dùng sửa file config.json trực tiếp trên web GitHub và bấm Commit (KHÔNG ghi đè nút vừa bật/tắt qua Telegram!)
let lastGitConfigHash = '';
let lastGitRemoteParsed = null;
async function checkGitConfigHotReload(page, sessionState) {
    try {
        if (isGitHubActions) {
            try {
                execSync('git fetch -q origin HEAD 2>/dev/null || git fetch -q origin 2>/dev/null', { cwd: __dirname, timeout: 8000, stdio: ['ignore', 'ignore', 'ignore'] });
                let remoteCfgRaw = '';
                try {
                    remoteCfgRaw = execSync('git show FETCH_HEAD:config.json 2>/dev/null', { cwd: __dirname, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
                } catch (e1) {
                    remoteCfgRaw = execSync('git show FETCH_HEAD:3q-autobot-github/config.json 2>/dev/null', { cwd: __dirname, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
                }
                if (!remoteCfgRaw) return;
                const hash = crypto.createHash('md5').update(remoteCfgRaw).digest('hex');
                if (!lastGitConfigHash) {
                    lastGitConfigHash = hash;
                    try { lastGitRemoteParsed = JSON.parse(remoteCfgRaw); } catch (eInitP) {}
                    return;
                }
                if (hash !== lastGitConfigHash) {
                    lastGitConfigHash = hash;
                    const parsed = JSON.parse(remoteCfgRaw);
                    const prevToggles = (lastGitRemoteParsed && lastGitRemoteParsed.toggles) || {};
                    const prevSettings = (lastGitRemoteParsed && lastGitRemoteParsed.settings) || {};
                    lastGitRemoteParsed = parsed;

                    const changes = [];
                    if (parsed.toggles) {
                        for (const [k, v] of Object.entries(parsed.toggles)) {
                            const boolV = !!v;
                            const prevRemoteBool = prevToggles[k] !== undefined ? !!prevToggles[k] : CONFIG.toggles[k];
                            if (CONFIG.toggles[k] !== undefined && prevRemoteBool !== boolV && CONFIG.toggles[k] !== boolV) {
                                CONFIG.toggles[k] = boolV;
                                changes.push(`${TOGGLE_LABELS[k] || k}: <b>${boolV ? 'BẬT ✅' : 'TẮT ❌'}</b>`);
                            }
                        }
                    }
                    if (parsed.settings) {
                        if (parsed.settings.speed_hack !== undefined && parsed.settings.speed_hack !== prevSettings.speed_hack) {
                            CONFIG.settings.speed_hack = Number(parsed.settings.speed_hack) || 2;
                        }
                        if (parsed.settings.yield_on_kick !== undefined && parsed.settings.yield_on_kick !== prevSettings.yield_on_kick) {
                            CONFIG.settings.yield_on_kick = !!parsed.settings.yield_on_kick;
                        }
                        if (parsed.settings.yield_wait_minutes !== undefined && parsed.settings.yield_wait_minutes !== prevSettings.yield_wait_minutes) {
                            CONFIG.settings.yield_wait_minutes = Number(parsed.settings.yield_wait_minutes) || 5;
                        }
                    }
                    if (changes.length > 0) {
                        saveConfigToDisk();
                        await applyTogglesToLivePage(page);
                        writeLog(`🔄 [Git Hot-Reload] Đã tự động nạp thay đổi từ config.json trên GitHub: ${changes.join(', ')}`);
                        const html = buildTelegramReportHtml(
                            '🔄 ĐÃ CẬP NHẬT CẤU HÌNH MỚI TỪ GITHUB (HOT-RELOAD)',
                            sessionState.lastKnownStats,
                            sessionState,
                            `⚙️ <b>Thay đổi vừa áp dụng:</b>\n• ${changes.join('\n• ')}`
                        );
                        await sendTelegramMessage(html, null, sessionState);
                    }
                }
            } catch (eGit) {}
        }
    } catch (e) {}
}

// ============================================================================
// 4. XÁC THỰC JOYPLAY API & ĐỊNH VỊ MÁY CHỦ
// ============================================================================
async function authenticateJoyPlay(email, password) {
    writeLog(`[Auth] Đang gửi yêu cầu đăng nhập tài khoản: ${email}...`);
    const pwdMd5 = crypto.createHash('md5').update(password).digest('hex');

    const resp = await fetch('https://sdkapi.joygames.vn/auth/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
        },
        body: JSON.stringify({
            username: email,
            password: pwdMd5,
            isWebsite: true,
            productId: CONFIG.productId
        })
    });

    const res = await resp.json();
    if (res.status === 0 && res.data && res.data.accessToken) {
        writeLog(`[Auth] ✅ Đăng nhập JoyPlay thành công! Token ID: ${res.data.accessToken.substring(0, 24)}...`);
        return res.data.accessToken;
    } else {
        throw new Error(`Đăng nhập JoyPlay thất bại: ${JSON.stringify(res)}`);
    }
}

const SECRET_SALT = 'fH6CN6UDmt9jkCjuRRukUCfyj4joSIE3';

function ignoreCaseStringCompare(a, b) {
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i++) {
        const diff = a.charAt(i).toUpperCase().charCodeAt(0) - b.charAt(i).toUpperCase().charCodeAt(0);
        if (diff !== 0) return diff;
    }
    return a.length < b.length ? -1 : 1;
}

function getFlag(obj) {
    const keys = Object.keys(obj).filter(k => k !== 'flag').sort(ignoreCaseStringCompare);
    let str = '';
    keys.forEach(k => {
        if (obj[k] !== undefined && obj[k] !== null) {
            str += String(obj[k]);
        }
    });
    return crypto.createHash('md5').update(SECRET_SALT + str).digest('hex');
}

async function crawlDirectServerInfo(token, targetServer) {
    writeLog(`[Server] Đang cào danh sách máy chủ trực tiếp từ API game...`);
    try {
        const meResp = await fetch('https://sdkapi.joygames.vn/users/me', {
            headers: { 'Authorization': token, 'User-Agent': 'Mozilla/5.0' }
        });
        const meRes = await meResp.json();
        const userId = String(meRes.data.id);

        const nowSec = Math.floor(Date.now() / 1000);
        const loginPayload = {
            openId: userId,
            account: userId,
            password: token,
            uuid: '',
            token: '',
            account_type: 2,
            device: 'mac-runner',
            os: 3,
            time: nowSec,
            cid: 72
        };
        loginPayload.flag = getFlag(loginPayload);

        const loginResp = await fetch('https://yxkp-login.anhhung3q.com/login/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json;charset=UTF-8' },
            body: JSON.stringify(loginPayload)
        });
        const loginData = await loginResp.json();

        const allServers = [];
        let history = [];
        let maxPage = 3;
        for (let p = 0; p <= maxPage; p++) {
            const listPayload = {
                cid: 72,
                account: loginData.account || userId,
                token: loginData.token || '',
                page: p,
                time: Math.floor(Date.now() / 1000)
            };
            listPayload.flag = getFlag(listPayload);

            const listResp = await fetch('https://yxkp-login.anhhung3q.com/login/list', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json;charset=UTF-8' },
                body: JSON.stringify(listPayload)
            });
            const listData = await listResp.json();
            if (listData.code === 0) {
                if (typeof listData.tot_page === 'number' && listData.tot_page > maxPage) {
                    maxPage = Math.min(10, listData.tot_page);
                }
                if (p === 0 && Array.isArray(listData.history)) {
                    history = listData.history.map(h => Object.assign({}, h, {
                        id: h.id || h.sid,
                        sid: h.sid || h.id,
                        state: h.state !== undefined ? h.state : (h.srv_state || 0),
                        open_time: h.open_time || 0
                    }));
                }
                if (Array.isArray(listData.srv_list)) {
                    listData.srv_list.forEach(s => {
                        const norm = Object.assign({}, s, {
                            id: s.id || s.sid,
                            sid: s.sid || s.id,
                            page: s.page !== undefined ? s.page : p
                        });
                        if (!allServers.some(e => e.id === norm.id)) allServers.push(norm);
                    });
                }
            }
        }

        const targetStr = String(targetServer).toLowerCase().trim();
        const numMatch = targetStr.match(/\d+/);
        const targetNum = numMatch ? parseInt(numMatch[0], 10) : 6;
        const fullSid = targetNum < 1000 ? (20000 + targetNum) : targetNum;

        let targetObj = allServers.find(s =>
            s.id === fullSid ||
            s.id === targetNum ||
            (s.srv_name && s.srv_name.toLowerCase() === targetStr) ||
            (s.srv_name && s.srv_name.toLowerCase().includes(`s${targetNum}`))
        );
        if (!targetObj && history.length > 0) {
            targetObj = history.find(h => h.id === fullSid || h.sid === fullSid) || history[0];
        }
        if (targetObj && !allServers.some(e => e.id === targetObj.id)) {
            allServers.push(targetObj);
        }

        writeLog(`[Server] ✅ Cào thành công ${allServers.length} máy chủ! Đã định vị máy chủ mục tiêu: [${targetObj ? (targetObj.srv_name || targetObj.id) : targetServer}]`);
        return { userId, gameAccount: loginData.account, srvToken: loginData.token, targetObj, allServers, history };
    } catch (err) {
        writeLog(`[Server] ⚠️ Không cào được trực tiếp: ${err.message || err}`);
        return null;
    }
}

// ============================================================================
// 5. KHỞI TẠO PHIÊN TRÌNH DUYỆT & TIÊM AUTOBOT V3.9.33
// ============================================================================
function findBrowserExecutable() {
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
        return process.env.CHROME_PATH;
    }

    const home = os.homedir();
    const candidates = [
        // macOS standard browsers
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        // Linux standard browsers
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        // Windows standard browsers
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(home, 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];

    // Quét thêm thư mục cache của Playwright & Puppeteer trên macOS / Linux / Windows
    const cacheDirs = [
        path.join(home, 'Library/Caches/ms-playwright'),
        path.join(home, '.cache/ms-playwright'),
        path.join(home, '.cache/puppeteer/chrome'),
        path.join(home, 'AppData/Local/ms-playwright')
    ];

    for (const cDir of cacheDirs) {
        if (fs.existsSync(cDir)) {
            try {
                const subDirs = fs.readdirSync(cDir).sort().reverse();
                for (const sub of subDirs) {
                    const base = path.join(cDir, sub);
                    candidates.push(
                        path.join(base, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
                        path.join(base, 'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
                        path.join(base, 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium'),
                        path.join(base, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
                        path.join(base, 'chrome-linux/chrome'),
                        path.join(base, 'chrome-win/chrome.exe')
                    );
                }
            } catch (e) {}
        }
    }

    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

async function launchAndEnterGame(sessionState) {
    let puppeteer;
    try {
        puppeteer = require('puppeteer');
    } catch (e) {
        puppeteer = require('puppeteer-core');
    }

    sessionState.kickDetectedFromLog = false;
    sessionState.freshReloginRequested = false;
    sessionState.freshReloginReason = '';
    sessionState.disconnectStreak = 0;

    const accessToken = await authenticateJoyPlay(CONFIG.email, CONFIG.password);
    const serverInfo = await crawlDirectServerInfo(accessToken, CONFIG.server);

    if (serverInfo && serverInfo.history && serverInfo.history[0] && (!sessionState.lastKnownStats || !sessionState.lastKnownStats.roleName)) {
        const h0 = serverInfo.history[0];
        sessionState.lastKnownStats = {
            roleName: h0.name || '---',
            level: h0.lev || 0,
            power: Number(h0.fc || 0),
            basePower: Number(h0.fc || 0)
        };
    }

    writeLog(`[Browser] Đang khởi chạy Chromium (${CONFIG.headless ? 'Chạy Ngầm Headless' : 'Hiển thị Cửa sổ Game'})...`);
    const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-zygote',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-ipc-flooding-protection',
        '--window-size=450,850'
    ];
    if (process.platform === 'linux') {
        launchArgs.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl');
    }
    const launchOpts = {
        headless: CONFIG.headless ? 'new' : false,
        timeout: 90000,
        args: launchArgs,
        defaultViewport: {
            width: 450,
            height: 850,
            isMobile: true,
            hasTouch: true
        }
    };
    const foundExec = findBrowserExecutable();
    if (foundExec) {
        launchOpts.executablePath = foundExec;
        writeLog('[Browser] Sử dụng trình duyệt: ' + foundExec);
    }
    let browser;
    try {
        browser = await puppeteer.launch(launchOpts);
    } catch (launchErr) {
        writeLog('[Browser] Khởi chạy Chrome lần 1 gặp sự cố (' + launchErr.message + ') -> Đang dọn tiến trình và thử lại lần 2...');
        try {
            const { execSync } = require('child_process');
            execSync('pkill -f chrome || true');
        } catch (eKill) { }
        await new Promise(r => setTimeout(r, 2000));
        browser = await puppeteer.launch(launchOpts);
    }

    const page = await browser.newPage();
    sessionState.currentBrowser = browser;
    sessionState.currentPage = page;
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148');

    await page.exposeFunction('pyOnBotLog', (entry) => {
        if (!entry) return;
        const m = String(entry.msg || '');
        const mLower = m.toLowerCase();
        if (m) writeLog(`[AutoBot] ${entry.time || ''} ${m}`);

        if (entry.freshReloginNow === true) {
            if (!sessionState.isYielding && !sessionState.kickDetectedFromLog) {
                sessionState.freshReloginRequested = true;
                sessionState.freshReloginReason = m || 'session_expired';
            }
            return;
        }

        const isHotfixKickLog = m.includes('_res=3');
        const isTrueDeviceKick = entry.kickNow === true ||
            m.includes('[Nhường Máy] Khẩn cấp') ||
            (!isHotfixKickLog && (m.includes('onLoginKickSc _res=') || m.includes('evt_LoginKickSc (_res='))) ||
            mLower.includes('thiết bị khác') ||
            mLower.includes('nơi khác') ||
            mLower.includes('trùng lặp đăng nhập') ||
            mLower.includes('đăng nhập trùng') ||
            mLower.includes('phiên khác');

        if (isTrueDeviceKick && !sessionState.isYielding && !sessionState.closingBrowserForYield) {
            sessionState.kickDetectedFromLog = true;
            sessionState.isYielding = true;
            const br = sessionState.activeBrowser || sessionState.currentBrowser;
            if (br && !sessionState.closingBrowserForYield) {
                sessionState.closingBrowserForYield = true;
                writeLog(`📱 [Nhường Máy] Nhận tín hiệu KICK thiết bị khác từ game -> Đóng Chromium ngay lập tức để giải phóng kết nối cho Điện thoại!`);
                (async () => {
                    try {
                        if (br) await br.close();
                    } catch (e) {}
                    if (sessionState.activeBrowser === br) sessionState.activeBrowser = null;
                    if (sessionState.currentBrowser === br) sessionState.currentBrowser = null;
                    sessionState.activePage = null;
                    sessionState.currentPage = null;
                    sessionState.closingBrowserForYield = false;
                })();
            }
        }
    });

    page.on('console', msg => {
        try {
            const text = msg.text();
            if (text && (text.includes('[Farm KNB]') || text.includes('[Gia Viên]') || text.includes('AutoBot') || text.includes('Giải cứu'))) {
                writeLog(text);
            }
        } catch (e) {}
    });

    let bundleBootError = false;
    page.on('pageerror', err => {
        const errStr = err ? err.toString() : '';
        writeLog(`[WebError] ${errStr}`);
        if (errStr.includes('is not a constructor') || errStr.includes('ChunkLoadError') || errStr.includes('Loading chunk')) {
            bundleBootError = true;
        }
    });

    writeLog(`[Nav] Điều hướng tới cổng game: ${CONFIG.gameUrl}...`);
    await page.goto(CONFIG.gameUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    const mergedSettingsAndToggles = Object.assign({}, CONFIG.settings, CONFIG.toggles);

    writeLog("[Auth] Tiêm JoyPlay AccessToken, Cấu hình Bot & Dữ liệu máy chủ vào LocalStorage...");
    await page.evaluate((token, sInfo, botCfg) => {
        try {
            localStorage.setItem("joygamesAccessToken", token);
            localStorage.setItem("3qdao_bot_settings", JSON.stringify(botCfg));
            if (sInfo) {
                window.__PRELOADED_SERVER_INFO__ = sInfo;
            }
        } catch (e) {}
    }, accessToken, serverInfo, mergedSettingsAndToggles);

    writeLog("[Nav] Tải lại trang với xác thực đã lưu...");
    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });

    await page.screenshot({ path: path.join(CONFIG.screenshotDir, '01_page_loaded.png') });

    writeLog("[Game] Đang đợi Canvas và Engine tải gói tài nguyên...");
    await page.waitForSelector('#GameCanvas', { timeout: 45000 });

    let attempts = 0;
    let loginReady = false;
    while (attempts < 90) {
        if (sessionState && (sessionState.stopRequested || sessionState.manualYieldRequested || sessionState.kickDetectedFromLog)) {
            writeLog("[Login] 🛑 Nhận lệnh Dừng/Nhường máy trong lúc tải màn hình đăng nhập -> Ngắt ngay lập tức!");
            try { if (browser) await browser.close(); } catch (eClose) {}
            sessionState.currentBrowser = null;
            sessionState.currentPage = null;
            return { browser: null, page: null, inGame: false };
        }
        attempts++;
        await new Promise(r => setTimeout(r, 2000));

        try {
            loginReady = await page.evaluate((sInfo, tick) => {
                function safeReq(name) {
                    if (window[name]) return window[name];
                    if (window.G_Mapping && window.G_Mapping[name]) return window.G_Mapping[name];
                    if (name === "ModelManager" && (!window.Controller || !window.BaseModel)) return null;
                    if (typeof window.__require === "function") {
                        try {
                            const mod = window.__require(name);
                            if (mod) return mod[name] || mod.default || mod;
                        } catch (e) {}
                    }
                    return null;
                }

                const sUtil = safeReq("LoadingServerUtil");
                const vm = safeReq("ViewManager");
                const mm = safeReq("ModelManager");
                const fcm = safeReq("FileCacheManager");

                if (fcm && typeof fcm.setStringForKey === "function") {
                    try { fcm.setStringForKey("showAgreement", "1", null, true); } catch (e) {}
                }

                if (sUtil && sInfo) {
                    if ((!sUtil.__serverList || sUtil.__serverList.length === 0) && Array.isArray(sInfo.allServers)) {
                        sUtil.__serverList = sInfo.allServers;
                    } else if (Array.isArray(sUtil.__serverList) && sInfo.targetObj) {
                        if (!sUtil.__serverList.some(x => x && x.id === sInfo.targetObj.id)) {
                            sUtil.__serverList.push(sInfo.targetObj);
                        }
                    }
                    if (sInfo.targetObj && typeof sUtil.updateSelectedServer === "function") {
                        try { sUtil.updateSelectedServer(sInfo.targetObj); } catch (e) {}
                    }
                }

                if (mm && mm.PlayerModel) {
                    const pm = mm.PlayerModel;
                    const rInfo = typeof pm.getRoleInfo === "function" ? pm.getRoleInfo() : pm.roleInfo;
                    const rid = Number(
                        (typeof pm.getRid === "function" ? pm.getRid() : 0) ||
                        pm.userid ||
                        (rInfo && typeof rInfo.getRoleId === "function" ? rInfo.getRoleId() : 0) ||
                        (rInfo && (rInfo._roleId || rInfo.roleId || rInfo.rid || rInfo._rid)) ||
                        0
                    );
                    const rName = String(
                        pm.username ||
                        (rInfo && typeof rInfo.getName === "function" ? rInfo.getName(false) : "") ||
                        (rInfo && (rInfo._name || rInfo.name || rInfo.roleName)) ||
                        ""
                    );
                    if (rid > 0 || (rName && rName !== "txt_30")) {
                        return "IN_GAME";
                    }
                }

                const loginView = (vm && typeof vm.getView === "function") ? vm.getView("LoginView") : null;
                if (loginView) {
                    const btnReady = !!(loginView.loginBtn && loginView.loginBtn.visible !== false);
                    const barDone = !loginView.barNode || loginView.barNode.visible === false;
                    if ((btnReady && barDone) || tick >= 55) {
                        return "LOGIN_VIEW";
                    }
                }
                return false;
            }, serverInfo, attempts);
        } catch (evalErr) {
            writeLog(`[Game] Đang chờ bundle khởi tạo... (${attempts}/90)`);
        }

        if (loginReady) break;
        if (attempts % 5 === 0) {
            writeLog(`[Game] Đang chờ tải tài nguyên đăng nhập... (${attempts}/90)`);
        }
    }

    writeLog(`[Game] Trạng thái màn hình đăng nhập: ${loginReady}`);
    await page.screenshot({ path: path.join(CONFIG.screenshotDir, '02_login_ready.png') });

    if (sessionState && (sessionState.stopRequested || sessionState.manualYieldRequested || sessionState.kickDetectedFromLog)) {
        writeLog("[Login] 🛑 Đã nhận lệnh Dừng/Nhường máy -> Không bấm Vào Game nữa!");
        try { if (browser) await browser.close(); } catch (eClose) {}
        sessionState.currentBrowser = null;
        sessionState.currentPage = null;
        return { browser: null, page: null, inGame: false };
    }

    let inGame = (loginReady === "IN_GAME");
    if (!inGame) {
        writeLog(`[Server] Đang chọn máy chủ: [${CONFIG.server}] và kích hoạt Vào Game...`);
        const selectRes = await page.evaluate((targetSrv, sInfo) => {
            function safeReq(name) {
                if (window[name]) return window[name];
                if (window.G_Mapping && window.G_Mapping[name]) return window.G_Mapping[name];
                if (typeof window.__require === "function") {
                    try {
                        const mod = window.__require(name);
                        if (mod) return mod[name] || mod.default || mod;
                    } catch (e) {}
                }
                return null;
            }

            const sUtil = safeReq("LoadingServerUtil");
            const vm = safeReq("ViewManager");
            const fcm = safeReq("FileCacheManager");

            if (fcm && typeof fcm.setStringForKey === "function") {
                try { fcm.setStringForKey("showAgreement", "1", null, true); } catch (e) {}
            }

            const targetStr = String(targetSrv).toLowerCase().trim();
            const numMatch = targetStr.match(/\d+/);
            const targetNum = numMatch ? parseInt(numMatch[0], 10) : 6;
            const fullSid = targetNum < 1000 ? (20000 + targetNum) : targetNum;

            let found = null;
            if (sUtil) {
                if (sInfo && sInfo.targetObj) {
                    found = Object.assign({}, sInfo.targetObj, {
                        id: sInfo.targetObj.id || sInfo.targetObj.sid || fullSid,
                        sid: sInfo.targetObj.sid || sInfo.targetObj.id || fullSid,
                        state: 2,
                        open_time: 0
                    });
                }
                if (!found && Array.isArray(sUtil.__serverList) && sUtil.__serverList.length > 0) {
                    found = sUtil.__serverList.find(s =>
                        s.id === fullSid || s.sid === fullSid ||
                        s.id === targetNum || s.sid === targetNum ||
                        (s.srv_name && (s.srv_name.toLowerCase() === targetStr || s.srv_name.toLowerCase().includes(`s${targetNum}`) || s.srv_name.toLowerCase().includes(` ${targetNum}`))) ||
                        (s.name && (s.name.toLowerCase() === targetStr || s.name.toLowerCase().includes(`s${targetNum}`) || s.name.toLowerCase().includes(` ${targetNum}`)))
                    );
                }
                if (!found && typeof sUtil.getServerInfoBySid === "function") {
                    try { found = sUtil.getServerInfoBySid(fullSid) || sUtil.getServerInfoBySid(targetNum); } catch (e) {}
                }
                if (!found) {
                    found = { id: fullSid, sid: fullSid, srv_name: targetSrv, state: 2, page: 1, open_time: 0 };
                }
                if (!Array.isArray(sUtil.__serverList)) sUtil.__serverList = [];
                if (!sUtil.__serverList.some(x => x && x.id === found.id)) {
                    sUtil.__serverList.push(found);
                }
                if (typeof sUtil.updateSelectedServer === "function") {
                    try { sUtil.updateSelectedServer(found); } catch (e) {}
                }
            }

            let triggered = false;
            const loginView = vm && typeof vm.getView === "function" ? vm.getView("LoginView") : null;
            if (loginView) {
                try { loginView.checkHasAgree = function () { return true; }; } catch (e) {}
                if (typeof loginView.login_chooseServer === "function") {
                    try { loginView.login_chooseServer(); } catch (e) {}
                }
                if (typeof loginView.loginHandler === "function") {
                    try {
                        loginView.loginHandler();
                        triggered = true;
                    } catch (e) {}
                }
            }

            return {
                selectedServer: found ? (found.srv_name || found.name || found.id) : null,
                triggeredEnter: triggered
            };
        }, CONFIG.server, serverInfo);

        writeLog(`[Server] Kết quả chọn máy chủ: ${JSON.stringify(selectRes)}`);

        if (!selectRes.triggeredEnter) {
            writeLog("[Input] Click giả lập nút Vào Game trên Canvas...");
            await page.click('#GameCanvas', { offset: { x: 225, y: 650 } });
        }

        writeLog("[Game] Đang đợi tải tài nguyên và chuyển tiếp vào sảnh...");
        let enteredLobby = false;
        let authReadyTicks = 0;
        let lastDiagState = null;
        for (let i = 0; i < 30; i++) {
            if (sessionState && (sessionState.stopRequested || sessionState.manualYieldRequested || sessionState.kickDetectedFromLog)) {
                writeLog("[Login] 🛑 Nhận lệnh Dừng/Nhường máy trong lúc đợi vào sảnh -> Ngắt ngay lập tức!");
                try { if (browser) await browser.close(); } catch (eClose) {}
                sessionState.currentBrowser = null;
                sessionState.currentPage = null;
                return { browser: null, page: null, inGame: false };
            }
            await new Promise(r => setTimeout(r, 2000));
            try {
                const lobbyCheck = await page.evaluate((tickIdx, curAuthTicks) => {
                    function safeReq(name) {
                        if (window[name]) return window[name];
                        if (window.G_Mapping && window.G_Mapping[name]) return window.G_Mapping[name];
                        if (name === "ModelManager" && (!window.Controller || !window.BaseModel)) return null;
                        if (typeof window.__require === "function") {
                            try {
                                const mod = window.__require(name);
                                if (mod) return mod[name] || mod.default || mod;
                            } catch (e) {}
                        }
                        return null;
                    }

                    const mm = safeReq("ModelManager");
                    const vm = safeReq("ViewManager");
                    const pm = mm && mm.PlayerModel ? mm.PlayerModel : null;
                    const rInfo = pm ? (typeof pm.getRoleInfo === "function" ? pm.getRoleInfo() : pm.roleInfo) : null;

                    const rid = Number(
                        (pm && typeof pm.getRid === "function" ? pm.getRid() : 0) ||
                        (pm && pm.userid) ||
                        (rInfo && typeof rInfo.getRoleId === "function" ? rInfo.getRoleId() : 0) ||
                        (rInfo && (rInfo._roleId || rInfo.roleId || rInfo.rid || rInfo._rid)) ||
                        0
                    );
                    const rNameRaw = String(
                        (pm && pm.username) ||
                        (rInfo && typeof rInfo.getName === "function" ? rInfo.getName(false) : "") ||
                        (rInfo && (rInfo._name || rInfo.name || rInfo.roleName)) ||
                        ""
                    );
                    const rName = rNameRaw === "txt_30" ? "" : rNameRaw;
                    const rLv = Number(
                        (rInfo && typeof rInfo.getLv === "function" ? rInfo.getLv() : 0) ||
                        (pm && pm.level) ||
                        (rInfo && (rInfo.level || rInfo._level)) ||
                        0
                    );
                    const hadEnter = !!(mm && mm.LoginModel && mm.LoginModel.hadEnterGame);
                    const mainOpen = !!(
                        window.__ENTER_GAME__ === true ||
                        (vm && typeof vm.isOpenView === "function" && (vm.isOpenView("MainUIView") || vm.isOpenView("MainUI_2025View"))) ||
                        (vm && typeof vm.getView === "function" && (vm.getView("MainUIView") || vm.getView("MainUI_2025View")))
                    );
                    const loadingOpen = !!(vm && typeof vm.isOpenView === "function" && vm.isOpenView("LoadingView"));
                    const loginOpen = !!(vm && typeof vm.isOpenView === "function" && vm.isOpenView("LoginView"));
                    const hasPlayer = !!(rid > 0 || rName || rLv > 0);

                    // Nudge LoadingView transition on headless SwiftShader if authenticated for >= 6s
                    if ((hasPlayer || hadEnter) && !mainOpen && curAuthTicks >= 2) {
                        try {
                            const fm = (window.G_Mapping && window.G_Mapping.FightManager) || window.FightManager;
                            const mum = mm && mm.MainUIModel;
                            const bm = mm && mm.BattleModel;
                            if (bm && typeof bm.getHangupBattleInfo === "function" && !bm.getHangupBattleInfo() && fm && mum && typeof mum.getMainCopyProgress === "function") {
                                const p = mum.getMainCopyProgress();
                                if (p && p._id && typeof fm.requestCopyData === "function") {
                                    fm.requestCopyData(p._id);
                                }
                            }
                        } catch (eCopy) {}
                        if (curAuthTicks >= 3) {
                            try {
                                const disp = (window.G_Mapping && window.G_Mapping.Dispatcher) || window.Dispatcher;
                                if (disp && typeof disp.dispatchEvent === "function") {
                                    disp.dispatchEvent("TransitionDegree_Update", { firstRes: 1 });
                                    disp.dispatchEvent("TransitionDegree_Update", { batteLevelRes: 1 });
                                }
                            } catch (eDisp) {}
                        }
                    }

                    // Retry loginHandler ONLY if not yet authenticated and still on LoginView
                    if (!hasPlayer && !hadEnter && !mainOpen && (tickIdx === 5 || tickIdx === 12)) {
                        const loginView = vm && typeof vm.getView === "function" ? vm.getView("LoginView") : null;
                        if (loginView && typeof loginView.loginHandler === "function") {
                            const barDone = !loginView.barNode || loginView.barNode.visible === false;
                            if (barDone) {
                                try { loginView.loginHandler(); } catch (e) {}
                            }
                        }
                    }

                    const openViews = (vm && vm._openingViews) ? Object.keys(vm._openingViews) : [];
                    return {
                        hasPlayer,
                        hadEnter,
                        mainOpen,
                        loadingOpen,
                        loginOpen,
                        rid,
                        rName,
                        rLv,
                        openViews
                    };
                }, i, authReadyTicks);

                if (lobbyCheck) {
                    lastDiagState = lobbyCheck;
                    if (lobbyCheck.hasPlayer || lobbyCheck.hadEnter) {
                        authReadyTicks++;
                    }
                    if ((lobbyCheck.hasPlayer && lobbyCheck.mainOpen) ||
                        (lobbyCheck.hasPlayer && !lobbyCheck.loginOpen && authReadyTicks >= 3) ||
                        (lobbyCheck.hadEnter && authReadyTicks >= 6)) {
                        enteredLobby = true;
                        writeLog(`[Lobby] ✅ Đã xác nhận vào game thành công: ${lobbyCheck.rName || 'Nhân vật'} (Lv.${lobbyCheck.rLv || '?'}, ID: ${lobbyCheck.rid || 'OK'}, MainUI=${lobbyCheck.mainOpen})`);
                        break;
                    }
                    if ((i + 1) % 5 === 0) {
                        writeLog(`[Game] Đang chuyển cảnh vào sảnh (${i + 1}/30): hadEnter=${lobbyCheck.hadEnter}, hasPlayer=${lobbyCheck.hasPlayer}, mainOpen=${lobbyCheck.mainOpen}, views=${JSON.stringify(lobbyCheck.openViews || [])}`);
                    }
                }
                if (bundleBootError && i >= 5 && authReadyTicks === 0) {
                    writeLog("[Login] ⚠️ Phát hiện lỗi khởi tạo bundle trên màn hình Login -> Ngắt sớm để thử lại phiên sạch!");
                    break;
                }
            } catch (e) {}
        }
        if (!enteredLobby) {
            try {
                await page.click('#GameCanvas', { offset: { x: 225, y: 700 } });
                await new Promise(r => setTimeout(r, 2500));
                enteredLobby = await page.evaluate(() => {
                    try {
                        const mm = window.ModelManager || (window.G_Mapping && window.G_Mapping.ModelManager);
                        const pm = mm && mm.PlayerModel;
                        const rInfo = pm ? (typeof pm.getRoleInfo === "function" ? pm.getRoleInfo() : pm.roleInfo) : null;
                        const rid = Number(
                            (pm && typeof pm.getRid === "function" ? pm.getRid() : 0) ||
                            (pm && pm.userid) ||
                            (rInfo && typeof rInfo.getRoleId === "function" ? rInfo.getRoleId() : 0) ||
                            (rInfo && (rInfo._roleId || rInfo.roleId || rInfo.rid || rInfo._rid)) ||
                            0
                        );
                        const hadEnter = !!(mm && mm.LoginModel && mm.LoginModel.hadEnterGame);
                        return !!(rid > 0 || hadEnter || window.__ENTER_GAME__ === true);
                    } catch (e) { return false; }
                });
            } catch (e) {}
        }
        if (!enteredLobby && !(sessionState && (sessionState.stopRequested || sessionState.manualYieldRequested || sessionState.kickDetectedFromLog))) {
            writeLog(`[Login] ❌ Chi tiết trạng thái cuối trước khi đóng trình duyệt: ${JSON.stringify(lastDiagState || {})}`);
            try { await browser.close(); } catch (eClose) {}
            if (sessionState && sessionState.currentBrowser === browser) {
                sessionState.currentBrowser = null;
                sessionState.currentPage = null;
            }
            throw new Error("Chưa vào được sảnh chính sau khi bấm Vào Game (kẹt LoginView hoặc lỗi bundle)");
        }
    }

    if (sessionState && (sessionState.stopRequested || sessionState.manualYieldRequested || sessionState.kickDetectedFromLog)) {
        try { if (browser) await browser.close(); } catch (eClose) {}
        sessionState.currentBrowser = null;
        sessionState.currentPage = null;
        return { browser: null, page: null, inGame: false };
    }

    const payloadFile = fs.existsSync(path.join(__dirname, 'injected_agent.js'))
        ? path.join(__dirname, 'injected_agent.js')
        : path.join(__dirname, 'bot-payload.js');
    writeLog(`[Bot] Đang nạp mã nguồn ${path.basename(payloadFile)} (AutoBot v3.0 Final)...`);
    const botPayloadCode = fs.readFileSync(payloadFile, 'utf8');

    await page.evaluate((code, cfg, isCloudHeadless) => {
        if (isCloudHeadless) {
            window.__CLOUD_HEADLESS_BOT__ = true;
        }
        const script = document.createElement('script');
        script.textContent = code;
        document.body.appendChild(script);

        if (window.AutoBot) {
            const merged = Object.assign({}, cfg.settings, cfg.toggles);
            window.AutoBot.setToggles(merged);
            if (typeof window.AutoBot.setSpeed === 'function') {
                window.AutoBot.setSpeed(cfg.settings.speed_hack || 2);
            }
            if (typeof window.AutoBot.setSkipAds === 'function') {
                window.AutoBot.setSkipAds(cfg.settings.skip_ads !== false);
            }
            if (typeof window.AutoBot.setSkipBattle === 'function') {
                window.AutoBot.setSkipBattle(cfg.settings.skip_battle !== false);
            }
            if (typeof window.AutoBot.startScheduleLoop === 'function') {
                window.AutoBot.startScheduleLoop();
            }
        }
    }, botPayloadCode, { settings: CONFIG.settings, toggles: CONFIG.toggles }, !!(isGitHubActions || CONFIG.headless));

    writeLog("[Bot] ✅ AutoBot v3.0 Final (Anti-Lag Stop & Pre-Unlock Bypass Edition) đã kích hoạt!");
    await new Promise(r => setTimeout(r, 4000));

    const snapStart = path.join(CONFIG.screenshotDir, '03_bot_started.png');
    const latestSnap = path.join(CONFIG.screenshotDir, 'latest.png');
    await page.screenshot({ path: snapStart });
    try { fs.copyFileSync(snapStart, latestSnap); } catch (e) {}

    return { browser, page, inGame: true };
}

// Khởi chạy an toàn với cơ chế thử lại và tự động phát hiện Điện thoại / Bảo trì
async function safeLaunchAndEnterGame(sessionState, maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (sessionState.stopRequested || sessionState.manualYieldRequested || sessionState.kickDetectedFromLog) {
            return { browser: null, page: null, inGame: false };
        }
        try {
            writeLog(`[Session] Đang khởi tạo phiên đăng nhập (Lần thử ${attempt}/${maxAttempts})...`);
            const session = await launchAndEnterGame(sessionState);
            if (session && session.browser && session.inGame === true) {
                return session;
            }
            if (session && session.browser) {
                try { await session.browser.close(); } catch (eClose) {}
            }
            if (sessionState.stopRequested || sessionState.manualYieldRequested || sessionState.kickDetectedFromLog) {
                return { browser: null, page: null, inGame: false };
            }
            writeLog(`⚠️ [Session] Phiên lần ${attempt}/${maxAttempts} chưa vào được sảnh chính -> Đang chuẩn bị thử lại...`);
            if (attempt < maxAttempts) {
                await new Promise(r => setTimeout(r, 5000));
            }
        } catch (err) {
            writeLog(`⚠️ [Session] Lỗi khởi tạo phiên lần ${attempt}/${maxAttempts}: ${err.message}`);
            try {
                const { execSync } = require('child_process');
                execSync('pkill -f chrome || true');
            } catch (eKill) {}
            if (sessionState.stopRequested || sessionState.manualYieldRequested || sessionState.kickDetectedFromLog) {
                return { browser: null, page: null, inGame: false, error: err.message };
            }
            if (attempt < maxAttempts) {
                await new Promise(r => setTimeout(r, 6000));
            } else {
                return { browser: null, page: null, inGame: false, error: err.message };
            }
        }
    }
    return { browser: null, page: null, inGame: false };
}

// ============================================================================
// 6. BẢNG ĐIỀU KHIỂN GUI WEB SERVER TRỰC QUAN (http://127.0.0.1:3939)
// ============================================================================
function startLocalGuiServer(sessionState, getActivePage) {
    const guiHtmlPath = path.join(__dirname, 'gui.html');

    function readJsonBody(req) {
        return new Promise((resolve) => {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString('utf8');
                if (body.length > 100000) req.destroy();
            });
            req.on('end', () => {
                try {
                    resolve(body ? JSON.parse(body) : {});
                } catch (e) {
                    resolve({});
                }
            });
            req.on('error', () => resolve({}));
        });
    }

    function sendJson(res, obj, status = 200) {
        res.writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        });
        res.end(JSON.stringify(obj));
    }

    const server = http.createServer(async (req, res) => {
        try {
            const parsedUrl = new URL(req.url, `http://127.0.0.1:${GUI_PORT}`);
            const pathname = parsedUrl.pathname;

            // 1. Giao diện chính GUI
            if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html' || pathname === '/gui')) {
                if (fs.existsSync(guiHtmlPath)) {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                    res.end(fs.readFileSync(guiHtmlPath, 'utf8'));
                } else {
                    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('3Q AutoBot GUI v3.0 Final is running.');
                }
                return;
            }

            // 2. API Trạng thái trực tiếp
            if (req.method === 'GET' && pathname === '/api/status') {
                const st = sessionState.lastKnownStats || {};
                const curJade = Number(st.jade || 0);
                const startJade = sessionState.initialJade !== null ? sessionState.initialJade : curJade;
                const jadeDiff = curJade - startJade;
                const totalRescued = (sessionState.baseRescuedCount || 0) + Number(st.rescuedCount || 0);
                const totalKnb = (sessionState.baseRescuedKnb || 0) + Number(st.rescuedKnbTotal || 0);
                const totalHomes = (sessionState.baseInspectedHomes || 0) + Number(st.inspectedHomesCount || st.totalRescueScanned || 0);
                const uptimeMinutes = Math.max(0, Math.round((Date.now() - sessionState.startTime) / 60000));
                const page = getActivePage();
                const inGame = !!(page && !page.isClosed() && st && st.roleName && st.roleName !== '---' && st.roleName !== 'Đang tải...');

                return sendJson(res, {
                    ok: true,
                    inGame,
                    isYielding: !!sessionState.isYielding,
                    isStopped: !!(sessionState.stopRequested || sessionState.maintenanceDetected),
                    stopReason: sessionState.stopReason || '',
                    yieldEndTime: sessionState.yieldEndTime || 0,
                    stats: st,
                    totalRescued,
                    totalKnb,
                    totalHomes,
                    jadeDiff,
                    uptimeMinutes,
                    config: {
                        email: CONFIG.email,
                        server: CONFIG.server,
                        settings: CONFIG.settings,
                        telegram: CONFIG.telegram,
                        toggles: CONFIG.toggles
                    },
                    logs: RECENT_LOGS.slice(-120)
                });
            }

            // 3. API Ảnh chụp màn hình mới nhất
            if (req.method === 'GET' && pathname === '/api/screenshot') {
                const candidates = [
                    path.join(CONFIG.screenshotDir, 'latest.png'),
                    path.join(CONFIG.screenshotDir, '03_bot_started.png'),
                    path.join(CONFIG.screenshotDir, '02_login_ready.png'),
                    path.join(CONFIG.screenshotDir, '01_page_loaded.png')
                ];
                for (const p of candidates) {
                    if (fs.existsSync(p)) {
                        try {
                            const buf = fs.readFileSync(p);
                            res.writeHead(200, {
                                'Content-Type': 'image/png',
                                'Cache-Control': 'no-store'
                            });
                            res.end(buf);
                            return;
                        } catch (e) {}
                    }
                }
                res.writeHead(204);
                res.end();
                return;
            }

            // 4. API Bật/Tắt tính năng trực tiếp
            if (req.method === 'POST' && pathname === '/api/toggle') {
                const body = await readJsonBody(req);
                const key = body.key;
                if (!key) return sendJson(res, { ok: false, error: 'Missing key' }, 400);

                let newVal = false;
                if (key in CONFIG.settings) {
                    CONFIG.settings[key] = !CONFIG.settings[key];
                    newVal = CONFIG.settings[key];
                } else {
                    CONFIG.toggles[key] = !CONFIG.toggles[key];
                    newVal = CONFIG.toggles[key];
                }
                saveConfigToDisk();
                const page = getActivePage();
                await applyTogglesToLivePage(page, key);

                const label = TOGGLE_LABELS[key] || key;
                writeLog(`🎛️ [GUI Control] Đã chuyển đổi [${label}] -> ${newVal ? 'BẬT ✅' : 'TẮT ❌'}`);
                return sendJson(res, { ok: true, key, value: newVal });
            }

            // 5. API Đổi tốc độ SpeedHack
            if (req.method === 'POST' && pathname === '/api/speed') {
                const body = await readJsonBody(req);
                const spd = Math.max(1, Math.min(10, Number(body.speed) || 2));
                CONFIG.settings.speed_hack = spd;
                saveConfigToDisk();
                const page = getActivePage();
                await applyTogglesToLivePage(page, null);
                writeLog(`⚡ [GUI Control] Đã đặt tốc độ game: x${spd}`);
                return sendJson(res, { ok: true, speed: spd });
            }

            // 6. API Các hành động nhanh (Nghỉ 15p, Dừng hẳn Bot, Chạy lại ngay, Báo cáo Telegram, Đổi hiển thị cửa sổ, Tải lại game)
            if (req.method === 'POST' && pathname === '/api/action') {
                const body = await readJsonBody(req);
                const act = body.action;

                if (act === 'stop_bot') {
                    sessionState.stopRequested = true;
                    sessionState.stopReason = 'Người dùng bấm nút Dừng Hẳn Bot trên GUI';
                    try {
                        fs.writeFileSync(path.join(__dirname, '.bot_stopped'), sessionState.stopReason, 'utf8');
                    } catch (e) {}
                    const page = getActivePage();
                    if (page && !page.isClosed()) {
                        try {
                            await page.evaluate(() => {
                                if (window.AutoBot && typeof window.AutoBot.stopAllReconnectAndClose === 'function') {
                                    window.AutoBot.stopAllReconnectAndClose('GUI Stop');
                                }
                            });
                        } catch (e) {}
                    }
                    writeLog(`🛑 [GUI Control] Đã yêu cầu DỪNG HẲN BOT & NGẮT TOÀN BỘ LOGIN/RECONNECT!`);
                    return sendJson(res, { ok: true, message: '🛑 Đã dừng hẳn Bot và ngắt toàn bộ kết nối đăng nhập!' });
                }

                if (act === 'pause') {
                    sessionState.manualYieldRequested = true;
                    writeLog(`⏸️ [GUI Control] Đã yêu cầu tạm dừng ${CONFIG.settings.yield_wait_minutes || 5} phút để nhường máy!`);
                    return sendJson(res, { ok: true, message: `Đã kích hoạt chế độ nghỉ ${CONFIG.settings.yield_wait_minutes || 5} phút nhường máy!` });
                }

                if (act === 'resume') {
                    sessionState.stopRequested = false;
                    sessionState.maintenanceDetected = false;
                    sessionState.stopReason = '';
                    try { fs.unlinkSync(path.join(__dirname, '.bot_stopped')); } catch (e) {}
                    sessionState.forceResumeFromYield = true;
                    writeLog(`▶️ [GUI Control] Đã yêu cầu bỏ chờ và đăng nhập lại ngay lập tức!`);
                    return sendJson(res, { ok: true, message: 'Đang kết nối vào lại game ngay lập tức!' });
                }

                if (act === 'report_telegram') {
                    const page = getActivePage();
                    const snapPath = path.join(CONFIG.screenshotDir, 'latest.png');
                    if (page && !page.isClosed()) {
                        try {
                            const stNow = await page.evaluate(() => window.AutoBot ? window.AutoBot.updateStats() : null);
                            if (isStatsLoaded(stNow)) sessionState.lastKnownStats = stNow;
                            await page.screenshot({ path: snapPath });
                        } catch (e) {}
                    }
                    const html = buildTelegramReportHtml(
                        '📸 BÁO CÁO TỨC THÌ TỪ BẢNG ĐIỀU KHIỂN GUI',
                        sessionState.lastKnownStats,
                        sessionState,
                        '🖥️ <i>Gửi trực tiếp từ Bảng Điều Khiển GUI trên máy tính.</i>'
                    );
                    await sendTelegramMessage(html, fs.existsSync(snapPath) ? snapPath : null, sessionState);
                    return sendJson(res, { ok: true, message: 'Đã chụp màn hình và gửi báo cáo về Telegram!' });
                }

                if (act === 'toggle_browser') {
                    CONFIG.settings.show_browser = !CONFIG.settings.show_browser;
                    CONFIG.headless = !CONFIG.settings.show_browser;
                    saveConfigToDisk();
                    sessionState.restartBrowserRequested = true;
                    const modeStr = CONFIG.settings.show_browser ? 'Hiện Cửa Sổ Game' : 'Chạy Ngầm (Headless)';
                    writeLog(`🖥️ [GUI Control] Đã chuyển chế độ hiển thị sang: [${modeStr}] -> Đang khởi động lại trình duyệt...`);
                    return sendJson(res, { ok: true, show_browser: CONFIG.settings.show_browser, message: `Đã chuyển sang chế độ: ${modeStr}` });
                }

                if (act === 'one_click_daily') {
                    const page = getActivePage();
                    if (!page || page.isClosed()) {
                        return sendJson(res, { ok: false, error: 'Phiên game hiện chưa sẵn sàng hoặc đang tạm nghỉ nhường máy!' }, 400);
                    }
                    writeLog('⚡ [GUI Control] Kích hoạt 1-Click: Làm Hết NV Ngày + Mua Hết Vàng KNB + Nhận Full Ưu Đãi & Gói Quà...');
                    let resData = null;
                    try {
                        resData = await page.evaluate(async () => {
                            if (window.AutoBot && typeof window.AutoBot.runOneClickAllDailyAndGifts === 'function') {
                                return await window.AutoBot.runOneClickAllDailyAndGifts();
                            }
                            return null;
                        });
                        const stNow = await page.evaluate(() => window.AutoBot ? window.AutoBot.updateStats() : null);
                        if (isStatsLoaded(stNow)) sessionState.lastKnownStats = stNow;
                    } catch (e) {
                        writeLog(`⚠️ [GUI Control] Lỗi khi thực thi 1-Click Daily: ${e.message}`);
                    }
                    const gDiff = resData && resData.ok ? Number(resData.goldDelta || 0) : 0;
                    const kDiff = resData && resData.ok ? Number(resData.knbDelta || 0) : 0;
                    const deltaMsg = (gDiff !== 0 || kDiff !== 0)
                        ? ` (Vàng ${gDiff >= 0 ? '+' : ''}${formatNum(gDiff)} | KNB ${kDiff >= 0 ? '+' : ''}${formatNum(kDiff)})`
                        : '';
                    return sendJson(res, {
                        ok: true,
                        result: resData,
                        message: `⚡ Đã làm hết NV Ngày + Mua hết lượt Vàng KNB + Nhận sạch Ưu Đãi & Quà!${deltaMsg}`
                    });
                }

                if (act === 'restart') {
                    sessionState.stopRequested = false;
                    sessionState.maintenanceDetected = false;
                    sessionState.stopReason = '';
                    try { fs.unlinkSync(path.join(__dirname, '.bot_stopped')); } catch (e) {}
                    sessionState.restartBrowserRequested = true;
                    writeLog(`🔄 [GUI Control] Đã yêu cầu tải lại phiên trình duyệt game...`);
                    return sendJson(res, { ok: true, message: 'Đang khởi động lại cửa sổ game...' });
                }

                if (act === 'eval') {
                    const page = getActivePage();
                    if (!page || page.isClosed()) return sendJson(res, { ok: false, error: 'No page' });
                    try {
                        const result = await page.evaluate(body.code);
                        return sendJson(res, { ok: true, result });
                    } catch (eEval) {
                        return sendJson(res, { ok: false, error: eEval.message });
                    }
                }

                return sendJson(res, { ok: false, error: 'Unknown action' }, 400);
            }

            // 7. API Lưu cài đặt chung từ GUI
            if (req.method === 'POST' && pathname === '/api/settings') {
                const body = await readJsonBody(req);
                const prevAccount = `${CONFIG.email}|${CONFIG.server}`;
                if (body.email) CONFIG.email = String(body.email).trim();
                if (body.server) CONFIG.server = String(body.server).trim();
                if (body.yield_wait_minutes) CONFIG.settings.yield_wait_minutes = Math.max(1, Number(body.yield_wait_minutes) || 5);
                if (body.report_interval_min) CONFIG.telegram.report_interval_min = Math.max(1, Number(body.report_interval_min) || 30);
                saveConfigToDisk();
                writeLog(`💾 [GUI Control] Đã lưu cài đặt hệ thống (Server: ${CONFIG.server}, Nghỉ ĐT: ${CONFIG.settings.yield_wait_minutes}p, Báo cáo Tele: ${CONFIG.telegram.report_interval_min}p)`);
                if (`${CONFIG.email}|${CONFIG.server}` !== prevAccount) {
                    sessionState.restartBrowserRequested = true;
                }
                return sendJson(res, { ok: true });
            }

            // 8. API Click trực tiếp lên màn hình Game từ GUI Preview
            if (req.method === 'POST' && pathname === '/api/click') {
                const body = await readJsonBody(req);
                const x = Math.max(0, Math.min(450, Number(body.x) || 225));
                const y = Math.max(0, Math.min(850, Number(body.y) || 425));
                const page = getActivePage();
                if (page && !page.isClosed()) {
                    try {
                        await page.mouse.click(x, y);
                        setTimeout(async () => {
                            try {
                                await page.screenshot({ path: path.join(CONFIG.screenshotDir, 'latest.png') });
                            } catch (e) {}
                        }, 350);
                        writeLog(`👆 [GUI Tap] Đã chạm vào toạ độ (${x}, ${y}) trên màn hình game`);
                        return sendJson(res, { ok: true, x, y });
                    } catch (e) {
                        return sendJson(res, { ok: false, error: e.message });
                    }
                }
                return sendJson(res, { ok: false, error: 'Page not ready' });
            }

            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
        } catch (err) {
            sendJson(res, { ok: false, error: err.message }, 500);
        }
    });

    server.on('error', (err) => {
        writeLog(`[GUI Server] ⚠️ Cổng ${GUI_PORT} đang bận hoặc gặp lỗi: ${err.message}`);
    });

    server.listen(GUI_PORT, '127.0.0.1', () => {
        const guiUrl = `http://127.0.0.1:${GUI_PORT}`;
        writeLog(`🖥️ [GUI Control Center] Bảng điều khiển trực quan đã sẵn sàng tại: ${guiUrl}`);
        if (!isGitHubActions && process.env.NO_OPEN_GUI !== '1') {
            const openCmd = process.platform === 'darwin'
                ? `open "${guiUrl}"`
                : process.platform === 'win32'
                    ? `start "" "${guiUrl}"`
                    : `xdg-open "${guiUrl}"`;
            exec(openCmd, () => {});
        }
    });

    return () => {
        try { server.close(); } catch (e) {}
    };
}

// ============================================================================
// 7. VÒNG LẶP GIÁM SÁT, NHƯỜNG MÁY 15P & ĐIỀU KHIỂN TRỰC TIẾP QUA GUI + TELEGRAM
// ============================================================================
async function run() {
    writeLog("====================================================================");
    writeLog("🚀 KHỞI ĐỘNG 3Q ĐÀO ĐÀO ĐÀO - AUTOBOT GUI & CLOUD v3.0 Final (ANTI-LAG STOP & BYPASS)");
    writeLog(`🎯 Tài khoản: ${CONFIG.email} | Máy chủ: ${CONFIG.server} | Chế độ: ${isGitHubActions ? `Cloud (${CONFIG.durationMinutes}p)` : 'Treo 24/7 Liên Tục (GUI)'}`);
    writeLog(`📡 Báo cáo & Điều khiển Telegram: Mỗi ${CONFIG.telegram.report_interval_min} phút | Nhường máy khi vào ĐT: ${CONFIG.settings.yield_on_kick ? `BẬT (Nghỉ ${CONFIG.settings.yield_wait_minutes}p rồi tự chạy tiếp)` : 'TẮT'}`);
    writeLog("====================================================================");

    // Xoá cờ dừng cũ khi bắt đầu phiên mới
    try { fs.unlinkSync(path.join(__dirname, '.bot_stopped')); } catch (e) {}

    const startTime = Date.now();
    const endTime = startTime + (CONFIG.durationMinutes * 60 * 1000);

    const sessionState = {
        startTime,
        endTime,
        initialJade: null,
        startupReported: false,
        lastReportTime: Date.now(),
        baseRescuedCount: (CONFIG.rescue_stats && CONFIG.rescue_stats.total_rescued_count) || 0,
        baseRescuedKnb: (CONFIG.rescue_stats && CONFIG.rescue_stats.total_rescued_knb) || 0,
        baseInspectedHomes: (CONFIG.rescue_stats && CONFIG.rescue_stats.total_inspected_homes) || 0,
        lastKnownStats: {},
        isYielding: false,
        yieldEndTime: 0,
        manualYieldRequested: false,
        forceResumeFromYield: false,
        restartBrowserRequested: false,
        stopRequested: false,
        maintenanceDetected: false,
        stopReason: ''
    };

    let activeBrowser = null;
    let activePage = null;

    // Khởi chạy Bảng điều khiển GUI trực quan tại http://127.0.0.1:3939
    const stopGuiServer = startLocalGuiServer(sessionState, () => activePage);

    // Khởi chạy bộ lắng nghe nút bấm điều khiển trực tiếp từ Telegram
    const stopPoller = startTelegramCommandPoller(sessionState, () => activePage);

    async function handleHardStopOrMaintenance() {
        const reason = sessionState.stopReason || (sessionState.maintenanceDetected ? 'Phát hiện máy chủ đang Bảo Trì' : 'Người dùng yêu cầu Dừng Hẳn Bot');
        writeLog(`🛑 [STOP/MAINTENANCE] ${reason} -> Đóng trình duyệt ngay lập tức, ngắt 100% lệnh login/reconnect!`);
        try {
            fs.writeFileSync(path.join(__dirname, '.bot_stopped'), reason, 'utf8');
        } catch (e) {}
        if (sessionState.lastKnownStats) {
            sessionState.baseRescuedCount += Number(sessionState.lastKnownStats.rescuedCount || 0);
            sessionState.baseRescuedKnb += Number(sessionState.lastKnownStats.rescuedKnbTotal || 0);
            sessionState.baseInspectedHomes += Number(sessionState.lastKnownStats.inspectedHomesCount || sessionState.lastKnownStats.totalRescueScanned || 0);
            sessionState.lastKnownStats.rescuedCount = 0;
            sessionState.lastKnownStats.rescuedKnbTotal = 0;
            sessionState.lastKnownStats.inspectedHomesCount = 0;
            sessionState.lastKnownStats.totalRescueScanned = 0;
        }
        try { if (activeBrowser) await activeBrowser.close(); } catch (e) {}
        activeBrowser = null;
        activePage = null;

        const stopHtml = buildTelegramReportHtml(
            `🛑 [DỪNG HẲN BOT / BẢO TRÌ] ĐÃ NGẮT KẾT NỐI 100%`,
            Object.assign({}, sessionState.lastKnownStats || {}, { rescuedCount: 0, rescuedKnbTotal: 0, inspectedHomesCount: 0, totalRescueScanned: 0 }),
            sessionState,
            `🛑 <b>Lý do dừng:</b> <code>${String(reason).replace(/[<>&]/g, '')}</code>\n✅ <b>Đã đóng hoàn toàn Chromium & ngắt 100% vòng lặp Login/Reconnect (không gây lag tài khoản).</b>\n${isGitHubActions ? '⏹️ <i>Workflow GitHub Actions sẽ kết thúc ngay và KHÔNG tự kích hoạt lại cho tới khi anh bấm Run workflow mới!</i>' : '👉 <i>Bấm "▶️ Chạy Lại Ngay" trên GUI hoặc Telegram bất kỳ lúc nào khi anh muốn chạy lại!</i>'}`
        );
        await sendTelegramMessage(stopHtml, null, sessionState);

        if (isGitHubActions) {
            return 'EXIT_WORKFLOW';
        }

        // Ở chế độ Local GUI: Đợi cho tới khi người dùng bấm "▶️ Chạy Lại Ngay" hoặc "🔄 Tải Lại Game"
        writeLog(`⏸️ [Local Stop] Bot đang ở trạng thái DỪNG HẲN. Bấm "▶️ Chạy Lại Ngay" trên GUI hoặc Telegram khi muốn chạy tiếp...`);
        while (sessionState.stopRequested && !sessionState.forceResumeFromYield && !sessionState.restartBrowserRequested && Date.now() < endTime) {
            await new Promise(r => setTimeout(r, 2000));
        }
        if (Date.now() >= endTime) return 'EXIT_WORKFLOW';

        sessionState.stopRequested = false;
        sessionState.maintenanceDetected = false;
        sessionState.stopReason = '';
        sessionState.forceResumeFromYield = false;
        sessionState.restartBrowserRequested = false;
        try { fs.unlinkSync(path.join(__dirname, '.bot_stopped')); } catch (e) {}
        writeLog(`▶️ [Resume] Nhận lệnh chạy lại sau khi dừng -> Đang khởi tạo lại phiên game...`);
        const resumed = await safeLaunchAndEnterGame(sessionState);
        if (resumed && resumed.browser && resumed.inGame === true) {
            activeBrowser = resumed.browser;
            activePage = resumed.page;
            sessionState.activeBrowser = activeBrowser;
            sessionState.activePage = activePage;
        }
        return 'RESUMED';
    }

    try {
        const yieldFile = path.join(__dirname, '.yield_until');
        if (fs.existsSync(yieldFile)) {
            try {
                const yEnd = parseInt(fs.readFileSync(yieldFile, 'utf8').trim(), 10);
                const remainingMs = yEnd - Date.now();
                if (remainingMs > 5000) {
                    const remM = Math.ceil(remainingMs / 60000);
                    writeLog(`⏳ [Nhường Máy] Phiên trước đang trong thời gian nhường Điện thoại (còn ${remM} phút). Đang chờ tiếp...`);
                    sessionState.isYielding = true;
                    sessionState.yieldEndTime = yEnd;
                    let lastYLog = Date.now();
                    while (Date.now() < yEnd && Date.now() < endTime && !sessionState.forceResumeFromYield && !sessionState.stopRequested) {
                        await new Promise(r => setTimeout(r, 2000));
                        if (Date.now() - lastYLog >= 60000) {
                            lastYLog = Date.now();
                            const remSec = Math.max(0, Math.round((yEnd - Date.now()) / 1000));
                            writeLog(`⏳ [Nhường Máy] Đang nhường Điện thoại... Còn ${Math.floor(remSec / 60)}p ${remSec % 60}s sẽ tự động đăng nhập lại.`);
                        }
                    }
                    const yForced = !!sessionState.forceResumeFromYield;
                    sessionState.isYielding = false;
                    sessionState.yieldEndTime = 0;
                    sessionState.forceResumeFromYield = false;
                    if (Date.now() >= yEnd || yForced || sessionState.stopRequested) {
                        try { fs.unlinkSync(yieldFile); } catch (e) {}
                    }
                } else {
                    try { fs.unlinkSync(yieldFile); } catch (e) {}
                }
            } catch (e) {}
        }

        const session = await safeLaunchAndEnterGame(sessionState);
        if (session && session.browser && session.inGame === true) {
            activeBrowser = session.browser;
            activePage = session.page;
            sessionState.activeBrowser = activeBrowser;
            sessionState.activePage = activePage;
        }

        if (sessionState.stopRequested || sessionState.maintenanceDetected) {
            const actRes = await handleHardStopOrMaintenance();
            if (actRes === 'EXIT_WORKFLOW') return;
        }

        let cycle = 0;

        while (Date.now() < endTime) {
            cycle++;
            // Chu kỳ kiểm tra 10 giây, phản ứng ngay lập tức trong 250ms nếu bị KICK, cần làm mới Token, nhận lệnh dừng hoặc yield
            for (let s = 0; s < 40; s++) {
                if (sessionState.kickDetectedFromLog || sessionState.manualYieldRequested || sessionState.freshReloginRequested || sessionState.stopRequested || sessionState.maintenanceDetected || !activeBrowser || (activePage && activePage.isClosed())) {
                    break;
                }
                await new Promise(r => setTimeout(r, 250));
            }

            if (sessionState.stopRequested || sessionState.maintenanceDetected) {
                const actRes = await handleHardStopOrMaintenance();
                if (actRes === 'EXIT_WORKFLOW') break;
                continue;
            }

            // Xử lý yêu cầu khởi động lại cửa sổ trình duyệt từ GUI hoặc làm mới Token tức thì khi rớt mạng 4 lần / hết hạn phiên.
            // ĐẶC BIỆT: Nếu vừa mới tự động làm mới phiên trong vòng 180s mà lại tiếp tục bị văng (dấu hiệu Điện thoại đang giữ phiên ngầm không gửi LoginKickSc) -> Tự chuyển sang Nhường Máy 5 phút, tuyệt đối không đá lại Điện thoại sau 1-2p!
            let hasImmediateKick = !!(sessionState.kickDetectedFromLog && CONFIG.settings.yield_on_kick) || !!sessionState.manualYieldRequested;
            if (!hasImmediateKick && sessionState.freshReloginRequested && !sessionState.restartBrowserRequested && CONFIG.settings.yield_on_kick) {
                const reasonNow = String(sessionState.freshReloginReason || '');
                const isNotHotfixOrSpam = !reasonNow.includes('_res=3') && !reasonNow.includes('err_code_66');
                const sinceLastAutoRelogin = Date.now() - Number(sessionState.lastAutoReloginAt || 0);
                if (isNotHotfixOrSpam && sessionState.lastAutoReloginAt && sinceLastAutoRelogin < 180000) {
                    writeLog(`📱 [Nhường Máy] Phát hiện mất phiên lần thứ 2 liên tiếp sau ${Math.round(sinceLastAutoRelogin / 1000)}s (${reasonNow}) -> Có thiết bị đang online, kích hoạt Nhường Máy ${CONFIG.settings.yield_wait_minutes || 5} phút!`);
                    sessionState.freshReloginRequested = false;
                    sessionState.freshReloginReason = '';
                    sessionState.kickDetectedFromLog = true;
                    sessionState.isYielding = true;
                    hasImmediateKick = true;
                }
            }
            if (!hasImmediateKick && (sessionState.restartBrowserRequested || sessionState.freshReloginRequested)) {
                const isFreshToken = !!sessionState.freshReloginRequested && !sessionState.restartBrowserRequested;
                const freshReason = sessionState.freshReloginReason || 'hết hạn phiên / rớt mạng';
                sessionState.restartBrowserRequested = false;
                sessionState.freshReloginRequested = false;
                sessionState.freshReloginReason = '';
                if (isFreshToken) sessionState.lastAutoReloginAt = Date.now();
                writeLog(isFreshToken
                    ? `🔄 [Watchdog] Làm mới phiên đăng nhập tức thì (${freshReason}) -> Kết nối lại ngay...`
                    : "[GUI] Đang khởi tạo lại cửa sổ trình duyệt theo yêu cầu...");
                if (sessionState.lastKnownStats) {
                    sessionState.baseRescuedCount += Number(sessionState.lastKnownStats.rescuedCount || 0);
                    sessionState.baseRescuedKnb += Number(sessionState.lastKnownStats.rescuedKnbTotal || 0);
                    sessionState.baseInspectedHomes += Number(sessionState.lastKnownStats.inspectedHomesCount || sessionState.lastKnownStats.totalRescueScanned || 0);
                    sessionState.lastKnownStats.rescuedCount = 0;
                    sessionState.lastKnownStats.rescuedKnbTotal = 0;
                    sessionState.lastKnownStats.inspectedHomesCount = 0;
                    sessionState.lastKnownStats.totalRescueScanned = 0;
                }
                try { if (activeBrowser) await activeBrowser.close(); } catch (e) {}
                activeBrowser = null;
                activePage = null;
                sessionState.activeBrowser = null;
                sessionState.activePage = null;
                sessionState.deadSessionStreak = 0;
                const reSession = await safeLaunchAndEnterGame(sessionState, 3);
                if (reSession && reSession.browser && reSession.inGame === true) {
                    activeBrowser = reSession.browser;
                    activePage = reSession.page;
                    sessionState.activeBrowser = activeBrowser;
                    sessionState.activePage = activePage;
                    writeLog("✅ [Watchdog] Đã làm mới Token & kết nối lại sảnh chính thành công!");
                } else {
                    writeLog("⚠️ [Watchdog] Khởi tạo lại phiên chưa thành công, chờ 8s trước khi thử lại...");
                    await new Promise(r => setTimeout(r, 8000));
                }
                continue;
            }

            // Kiểm tra Hot-Reload nếu sửa config.json mỗi 30 giây
            if (cycle % 3 === 0 && activePage && !activePage.isClosed()) {
                await checkGitConfigHotReload(activePage, sessionState);
            }

            // 1. KIỂM TRA NHƯỜNG MÁY TỪ TÍN HIỆU KICK THIẾT BỊ KHÁC HOẶC MANUAL YIELD TRƯỚC TIÊN
            const hasKickSignal = !!(sessionState.kickDetectedFromLog && CONFIG.settings.yield_on_kick);
            if (hasKickSignal || sessionState.manualYieldRequested) {
                const isManual = sessionState.manualYieldRequested;
                sessionState.manualYieldRequested = false;
                sessionState.kickDetectedFromLog = false;
                sessionState.freshReloginRequested = false;
                sessionState.isYielding = true;
                sessionState.forceResumeFromYield = false;
                sessionState.deadSessionStreak = 0;

                const waitMin = Math.max(1, Number(CONFIG.settings.yield_wait_minutes) || 5);
                writeLog(`📱 [Nhường Máy] ${isManual ? 'Nhận lệnh tạm dừng từ người dùng' : 'Phát hiện tài khoản đăng nhập từ Điện thoại/PC'}! Đóng trình duyệt ngay, tạm dừng ${waitMin} phút rồi tự động kết nối lại...`);

                // Lưu cộng dồn chỉ số Farm KNB trước khi đóng trình duyệt (reset bộ đếm phiên cũ tránh cộng trùng)
                if (sessionState.lastKnownStats) {
                    sessionState.baseRescuedCount += Number(sessionState.lastKnownStats.rescuedCount || 0);
                    sessionState.baseRescuedKnb += Number(sessionState.lastKnownStats.rescuedKnbTotal || 0);
                    sessionState.baseInspectedHomes += Number(sessionState.lastKnownStats.inspectedHomesCount || sessionState.lastKnownStats.totalRescueScanned || 0);
                    sessionState.lastKnownStats.rescuedCount = 0;
                    sessionState.lastKnownStats.rescuedKnbTotal = 0;
                    sessionState.lastKnownStats.inspectedHomesCount = 0;
                    sessionState.lastKnownStats.totalRescueScanned = 0;
                }

                try {
                    if (activeBrowser) await activeBrowser.close();
                } catch (eClose) {}
                activeBrowser = null;
                activePage = null;
                sessionState.activeBrowser = null;
                sessionState.activePage = null;
                sessionState.currentBrowser = null;
                sessionState.currentPage = null;
                // Xóa sạch mọi tín hiệu trễ phát sinh trong lúc đóng browser
                sessionState.kickDetectedFromLog = false;
                sessionState.freshReloginRequested = false;

                const kickHtml = buildTelegramReportHtml(
                    `📱 [NHƯỜNG MÁY] ĐÃ TẠM DỪNG ${waitMin} PHÚT`,
                    sessionState.lastKnownStats || {},
                    sessionState,
                    isManual
                        ? `⏸️ <b>Đã tạm dừng Bot ${waitMin} phút theo lệnh điều khiển!</b>\n👉 Bấm nút <b>"▶️ Chạy Lại Ngay"</b> trên GUI hoặc Telegram bất kỳ lúc nào nếu anh muốn Bot vào lại sớm hơn.`
                        : `⚠️ <b>Phát hiện anh vừa đăng nhập vào game trên Điện thoại!</b>\n🛑 Bot đã lập tức ngắt kết nối và tạm nghỉ <b>${waitMin} phút</b> để nhường máy.\n🔄 <i>Sau ${waitMin} phút Bot sẽ tự động đăng nhập lại và chạy tiếp (hoặc bấm nút "▶️ Chạy Lại Ngay" khi anh chơi xong)!</i>`
                );
                await sendTelegramMessage(kickHtml, null, sessionState);

                const waitEnd = Date.now() + (waitMin * 60 * 1000);
                sessionState.yieldEndTime = waitEnd;
                try { fs.writeFileSync(yieldFile, String(waitEnd), 'utf8'); } catch (e) {}

                writeLog(`⏳ [Nhường Máy] Đang chờ ${waitMin} phút (hoặc bấm "▶️ Chạy Lại Ngay" / "🛑 Dừng Hẳn Bot" trên GUI / Telegram)...`);
                let lastCountdownLog = Date.now();
                while (Date.now() < waitEnd && Date.now() < endTime && !sessionState.forceResumeFromYield && !sessionState.stopRequested) {
                    await new Promise(r => setTimeout(r, 2000));
                    if (Date.now() - lastCountdownLog >= 60000) {
                        lastCountdownLog = Date.now();
                        const remSec = Math.max(0, Math.round((waitEnd - Date.now()) / 1000));
                        writeLog(`⏳ [Nhường Máy] Đang nhường Điện thoại... Còn ${Math.floor(remSec / 60)}p ${remSec % 60}s sẽ tự động đăng nhập lại (bấm "▶️ Chạy Lại Ngay" trên GUI/Telegram nếu đã chơi xong).`);
                    }
                }

                const wasForcedResume = !!sessionState.forceResumeFromYield;
                sessionState.isYielding = false;
                sessionState.yieldEndTime = 0;
                sessionState.forceResumeFromYield = false;
                sessionState.kickDetectedFromLog = false;
                sessionState.freshReloginRequested = false;

                if (Date.now() >= waitEnd || wasForcedResume || sessionState.stopRequested) {
                    try { fs.unlinkSync(yieldFile); } catch (e) {}
                }

                if (sessionState.stopRequested || sessionState.maintenanceDetected) {
                    try { fs.unlinkSync(yieldFile); } catch (e) {}
                    const actRes = await handleHardStopOrMaintenance();
                    if (actRes === 'EXIT_WORKFLOW') break;
                    continue;
                }

                if (Date.now() >= endTime) {
                    writeLog(`[Nhường Máy] Đã hết thời lượng phiên chạy hiện tại, chuyển sang phiên kế tiếp để tự động kết nối lại...`);
                    break;
                }

                writeLog(`🔄 [Nhường Máy] ${wasForcedResume ? "Nhận lệnh Chạy Lại Ngay" : "Đã hết " + waitMin + " phút nhường máy"}! Đang đăng nhập lại mới 100%...`);

                const resumed = await safeLaunchAndEnterGame(sessionState, 4);
                if (resumed && resumed.browser && resumed.inGame === true) {
                    activeBrowser = resumed.browser;
                    activePage = resumed.page;
                    sessionState.activeBrowser = activeBrowser;
                    sessionState.activePage = activePage;
                    sessionState.pendingPostYieldReport = false;
                    const resumeSnap = path.join(CONFIG.screenshotDir, 'latest.png');
                    try {
                        const stResumed = await activePage.evaluate(() => window.AutoBot ? window.AutoBot.updateStats() : null);
                        if (isStatsLoaded(stResumed)) sessionState.lastKnownStats = stResumed;
                        await activePage.screenshot({ path: resumeSnap });
                    } catch (e) {}
                    const resumeHtml = buildTelegramReportHtml(
                        `🟢 [KẾT NỐI LẠI] ĐÃ VÀO LẠI GAME SAU KHI NHƯỜNG MÁY`,
                        sessionState.lastKnownStats || {},
                        sessionState,
                        `✅ <i>Đã hết ${waitMin} phút nhường máy, Bot đã tự động đăng nhập lại sảnh chính thành công và tiếp tục treo 24/7!</i>`
                    );
                    await sendTelegramMessage(resumeHtml, fs.existsSync(resumeSnap) ? resumeSnap : null, sessionState);
                    sessionState.lastReportTime = Date.now();
                } else {
                    sessionState.pendingPostYieldReport = true;
                    writeLog(`⚠️ [Nhường Máy] Hết ${waitMin} phút nhưng lần kết nối đầu chưa vào sảnh -> Chờ 8s và tiếp tục tự động kết nối lại cho tới khi thành công!`);
                    await new Promise(r => setTimeout(r, 8000));
                }
                continue;
            }

            // 2. NẾU TRANG ĐANG ĐÓNG (VÀ KHÔNG PHẢI ĐANG YIELD HOẶC DỪNG)
            if (!activePage || activePage.isClosed()) {
                if (sessionState.isYielding || (sessionState.kickDetectedFromLog && CONFIG.settings.yield_on_kick) || sessionState.manualYieldRequested) {
                    continue;
                }
                if (sessionState.stopRequested || sessionState.maintenanceDetected) {
                    const actRes = await handleHardStopOrMaintenance();
                    if (actRes === 'EXIT_WORKFLOW') break;
                    continue;
                }
                writeLog("[Watchdog] Trang trình duyệt đang đóng -> Đang tự động kết nối & đăng nhập lại phiên mới...");
                try { if (activeBrowser) await activeBrowser.close(); } catch (e) {}
                activeBrowser = null;
                activePage = null;
                sessionState.activeBrowser = null;
                sessionState.activePage = null;
                const reSession = await safeLaunchAndEnterGame(sessionState, 3);
                if (reSession && reSession.browser && reSession.inGame === true) {
                    activeBrowser = reSession.browser;
                    activePage = reSession.page;
                    sessionState.activeBrowser = activeBrowser;
                    sessionState.activePage = activePage;
                    if (sessionState.pendingPostYieldReport) {
                        sessionState.pendingPostYieldReport = false;
                        const resumeSnap = path.join(CONFIG.screenshotDir, 'latest.png');
                        try {
                            const stResumed = await activePage.evaluate(() => window.AutoBot ? window.AutoBot.updateStats() : null);
                            if (isStatsLoaded(stResumed)) sessionState.lastKnownStats = stResumed;
                            await activePage.screenshot({ path: resumeSnap });
                        } catch (e) {}
                        const resumeHtml = buildTelegramReportHtml(
                            `🟢 [KẾT NỐI LẠI] ĐÃ VÀO LẠI GAME SAU KHI NHƯỜNG MÁY`,
                            sessionState.lastKnownStats || {},
                            sessionState,
                            `✅ <i>Bot đã tự động đăng nhập lại sảnh chính thành công và tiếp tục treo 24/7!</i>`
                        );
                        await sendTelegramMessage(resumeHtml, fs.existsSync(resumeSnap) ? resumeSnap : null, sessionState);
                        sessionState.lastReportTime = Date.now();
                    }
                } else {
                    writeLog("⚠️ [Watchdog] Khởi tạo lại phiên chưa thành công, chờ 10s trước khi thử lại...");
                    await new Promise(r => setTimeout(r, 10000));
                }
                continue;
            }

            // 3. ĐÁNH GIÁ TRẠNG THÁI GAME QUA EVALUATE
            const mergedToggles = Object.assign({}, CONFIG.settings, CONFIG.toggles);
            let status = null;
            try {
                status = await activePage.evaluate(async (t) => {
                    if (window.AutoBot && typeof window.AutoBot.runSmartCycle === "function") {
                        const res = await window.AutoBot.runSmartCycle(t);
                        if (res && !res.rescueTelemetry && typeof window.AutoBot.getRescueTelemetry === "function") {
                            res.rescueTelemetry = window.AutoBot.getRescueTelemetry();
                        }
                        return res;
                    }
                    return null;
                }, mergedToggles);
            } catch (evalErr) {
                writeLog(`[Watchdog] ⚠️ Lỗi evaluate runSmartCycle: ${evalErr.message}`);
            }

            // Kiểm tra trạng thái dừng / bảo trì từ status
            if (status && (status.isMaintenance || status.hardStopped)) {
                sessionState.maintenanceDetected = !!status.isMaintenance;
                sessionState.stopRequested = true;
                sessionState.stopReason = status.maintenanceReason || (status.isMaintenance ? 'Máy chủ đang bảo trì' : 'Đã dừng AutoBot');
                const actRes = await handleHardStopOrMaintenance();
                if (actRes === 'EXIT_WORKFLOW') break;
                continue;
            }

            // Kiểm tra kick từ status (chỉ khi thực sự bị thiết bị khác đăng nhập)
            if (status && status.kickedByOtherDevice && CONFIG.settings.yield_on_kick) {
                sessionState.kickDetectedFromLog = true;
                sessionState.isYielding = true;
                continue;
            }

            // Kiểm tra yêu cầu làm mới phiên đăng nhập tức thì (hết hạn JoyPlay token / rớt mạng 4x / Hotfix _res=3)
            if (status && status.needFreshRelogin) {
                sessionState.freshReloginRequested = true;
                sessionState.freshReloginReason = status.freshReloginReason || 'hết hạn phiên mạng';
                continue;
            }

            // Watchdog chống treo màn hình "Đang tải..." / mất dữ liệu nhân vật / rớt sảnh
            const rawStats = (status && status.stats) ? status.stats : null;
            const isLobbyHealthy = !!(
                status &&
                status.ready &&
                !status.isDisconnected &&
                rawStats &&
                rawStats.roleName &&
                rawStats.roleName !== "Đang tải..." &&
                rawStats.roleName !== "---" &&
                rawStats.roleName !== "txt_30" &&
                (Number(rawStats.basePower || rawStats.power || 0) > 0 || Number(rawStats.level || 0) > 0 || Number(rawStats.roleId || 0) > 0)
            );

            if (!isLobbyHealthy) {
                sessionState.deadSessionStreak = (sessionState.deadSessionStreak || 0) + 1;
                if (sessionState.deadSessionStreak >= 3) {
                    writeLog(`[Watchdog] ⚠️ Phiên game chưa tải đủ sảnh / đang đồng bộ mạng (${sessionState.deadSessionStreak}/9)...`);
                }
                if (sessionState.deadSessionStreak === 4 && activePage && !activePage.isClosed()) {
                    try {
                        await activePage.evaluate(() => {
                            try {
                                const disp = (window.G_Mapping && window.G_Mapping.Dispatcher) || window.Dispatcher;
                                if (disp && typeof disp.dispatchEvent === "function") {
                                    disp.dispatchEvent("TransitionDegree_Update", { firstRes: 1 });
                                    disp.dispatchEvent("TransitionDegree_Update", { batteLevelRes: 1 });
                                }
                                if (window.AutoBot && typeof window.AutoBot.updateStats === "function") {
                                    window.AutoBot.updateStats();
                                }
                            } catch (e) {}
                        });
                    } catch (eSoft) {}
                }
                if (sessionState.deadSessionStreak >= 9) {
                    sessionState.deadSessionStreak = 0;
                    const sinceLastAuto = Date.now() - Number(sessionState.lastAutoReloginAt || 0);
                    if (CONFIG.settings.yield_on_kick && sessionState.lastAutoReloginAt && sinceLastAuto < 180000) {
                        writeLog(`📱 [Nhường Máy] Phiên lại tiếp tục mất kết nối chỉ sau ${Math.round(sinceLastAuto / 1000)}s kể từ lần tự đăng nhập lại -> Có thiết bị đang chơi, tạm nghỉ ${CONFIG.settings.yield_wait_minutes || 5} phút!`);
                        sessionState.kickDetectedFromLog = true;
                        sessionState.isYielding = true;
                        continue;
                    }
                    sessionState.lastAutoReloginAt = Date.now();
                    writeLog(`🔄 [Watchdog] Phát hiện kẹt trạng thái "Đang tải..." / mất kết nối quá 90s -> Đóng trình duyệt và tự động đăng nhập lại sạch 100%!`);
                    if (sessionState.lastKnownStats) {
                        sessionState.baseRescuedCount += Number(sessionState.lastKnownStats.rescuedCount || 0);
                        sessionState.baseRescuedKnb += Number(sessionState.lastKnownStats.rescuedKnbTotal || 0);
                        sessionState.baseInspectedHomes += Number(sessionState.lastKnownStats.inspectedHomesCount || sessionState.lastKnownStats.totalRescueScanned || 0);
                        sessionState.lastKnownStats.rescuedCount = 0;
                        sessionState.lastKnownStats.rescuedKnbTotal = 0;
                        sessionState.lastKnownStats.inspectedHomesCount = 0;
                        sessionState.lastKnownStats.totalRescueScanned = 0;
                    }
                    try { if (activeBrowser) await activeBrowser.close(); } catch (e) {}
                    activeBrowser = null;
                    activePage = null;
                    sessionState.activeBrowser = null;
                    sessionState.activePage = null;
                    const reSession = await safeLaunchAndEnterGame(sessionState);
                    if (reSession && reSession.browser && reSession.inGame) {
                        activeBrowser = reSession.browser;
                        activePage = reSession.page;
                        sessionState.activeBrowser = activeBrowser;
                        sessionState.activePage = activePage;
                        writeLog(`✅ [Watchdog] Đã tự động khôi phục kết nối vào lại sảnh chính thành công!`);
                    } else {
                        writeLog(`⚠️ [Watchdog] Đăng nhập lại chưa thành công, chờ 10s rồi thử tiếp...`);
                        await new Promise(r => setTimeout(r, 10000));
                    }
                    continue;
                }
            } else {
                sessionState.deadSessionStreak = 0;
            }

            if (status && status.stats) {
                const st = status.stats;
                if (isLobbyHealthy) {
                    sessionState.lastKnownStats = st;
                }

                if (sessionState.initialJade === null && Number(st.jade || 0) > 0) {
                    sessionState.initialJade = Number(st.jade);
                }
                const curRescuedCount = (sessionState.baseRescuedCount || 0) + Number(st.rescuedCount || 0);
                const curRescuedKnb = (sessionState.baseRescuedKnb || 0) + Number(st.rescuedKnbTotal || 0);
                const curInspectedHomes = (sessionState.baseInspectedHomes || 0) + Number(st.inspectedHomesCount || st.totalRescueScanned || 0);
                CONFIG.rescue_stats = {
                    total_rescued_count: curRescuedCount,
                    total_rescued_knb: curRescuedKnb,
                    total_inspected_homes: curInspectedHomes
                };

                // Đẩy Live Telemetry lên nhánh độc lập `telemetry` (lần đầu sau 1.2p vào sảnh, sau đó định kỳ mỗi 3p)
                if (isGitHubActions && process.env.GH_TOKEN && process.env.GH_REPO) {
                    const elapsedNowMin = Math.max(0.1, (Date.now() - sessionState.startTime) / 60000);
                    const firstTelReady = !sessionState._firstTelemetryPushed && isLobbyHealthy && elapsedNowMin >= 1.2;
                    const periodicTelReady = sessionState._lastTelemetryPushTime && (Date.now() - sessionState._lastTelemetryPushTime >= 180000);
                    if (firstTelReady || periodicTelReady) {
                        sessionState._firstTelemetryPushed = true;
                        sessionState._lastTelemetryPushTime = Date.now();
                        const telDispSt = isLobbyHealthy ? st : (sessionState.lastKnownStats || st);
                        const vnNow = new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19);
                        const curJadeNum = Number(telDispSt.jade || 0);
                        await pushLiveTelemetryToGitHub({
                            schemaVersion: '3.8',
                            runNumber: Number(process.env.GH_RUN_NUMBER || 0),
                            runId: Number(process.env.GH_RUN_ID || 0),
                            updatedAtIso: new Date().toISOString(),
                            updatedAtVn: vnNow,
                            uptimeMin: Number(elapsedNowMin.toFixed(2)),
                            server: CONFIG.server,
                            isLobbyHealthy,
                            roleName: telDispSt.roleName || null,
                            level: Number(telDispSt.level || 0),
                            stage: Number(telDispSt.stage || 0),
                            towerFloor: Number(telDispSt.towerFloor || 0),
                            basePower: Number(telDispSt.basePower || 0),
                            currentPower: Number(telDispSt.power || 0),
                            initialJade: sessionState.initialJade,
                            jade: curJadeNum,
                            deltaJade: (sessionState.initialJade !== null && curJadeNum > 0) ? (curJadeNum - Number(sessionState.initialJade)) : 0,
                            totalRescued: curRescuedCount,
                            totalRescuedKnb: curRescuedKnb,
                            knbPerHour: Number(((curRescuedKnb / Math.max(1, elapsedNowMin)) * 60).toFixed(1)),
                            rescuesPerHour: Number(((curRescuedCount / Math.max(1, elapsedNowMin)) * 60).toFixed(2)),
                            totalScanned: curInspectedHomes,
                            scansPerMin: Math.round(curInspectedHomes / elapsedNowMin),
                            rescueTelemetry: (status && status.rescueTelemetry) || null,
                            toggles: CONFIG.toggles,
                            recentLogs: RECENT_LOGS.slice(-35)
                        }, sessionState);
                    }
                }

                // Gửi báo cáo khởi động lần đầu ngay khi tải xong dữ liệu nhân vật VÀ số dư KNB thực tế
                sessionState.startupWaitTicks = (sessionState.startupWaitTicks || 0) + 1;
                const canSendStartup = !sessionState.startupReported && 
                    isLobbyHealthy &&
                    (Number(st.jade || 0) > 0 || sessionState.startupWaitTicks >= 8);
                if (canSendStartup) {
                    sessionState.startupReported = true;
                    sessionState.lastReportTime = Date.now();
                    const startSnap = path.join(CONFIG.screenshotDir, '03_bot_started.png');
                    const latestSnap = path.join(CONFIG.screenshotDir, 'latest.png');
                    try {
                        await activePage.screenshot({ path: startSnap });
                        fs.copyFileSync(startSnap, latestSnap);
                    } catch (e) {}
                    const html = buildTelegramReportHtml(
                        '🚀 3Q AUTOBOT v3.0 Final - ĐÃ VÀO GAME & BẮT ĐẦU TREO 24/7',
                        st,
                        sessionState,
                        '✅ <i>Anh có thể điều khiển trực tiếp trên cửa sổ GUI (http://127.0.0.1:3939) hoặc bấm các nút bên dưới trên Telegram!</i>'
                    );
                    await sendTelegramMessage(html, startSnap, sessionState);
                }
                if (cycle % 30 === 0) {
                    const dispSt = isLobbyHealthy ? st : Object.assign({}, sessionState.lastKnownStats || {}, {
                        rescuedCount: st.rescuedCount,
                        rescuedKnbTotal: st.rescuedKnbTotal,
                        inspectedHomesCount: st.inspectedHomesCount,
                        totalRescueScanned: st.totalRescueScanned
                    });
                    const totalRescued = sessionState.baseRescuedCount + Number(st.rescuedCount || 0);
                    const totalKnb = sessionState.baseRescuedKnb + Number(st.rescuedKnbTotal || 0);
                    const totalScanned = (sessionState.baseInspectedHomes || 0) + Number(st.inspectedHomesCount || st.totalRescueScanned || 0);
                    const elapsedMin = Math.max(0.1, (Date.now() - sessionState.startTime) / 60000);
                    const scanSpeed = Math.round(totalScanned / elapsedMin);
                    writeLog(`[Trạng Thái] ${dispSt.roleName || '---'} | Ải: ${dispSt.stage || 1} | LC: ${formatNum(dispSt.basePower || dispSt.power)} | KNB: ${formatNum(dispSt.jade)} | Giải cứu: ${totalRescued} lượt (+${totalKnb} KNB) | Đã quét: ${totalScanned.toLocaleString()} nhà (~${scanSpeed} nhà/p)`);

                    if (process.env.GITHUB_STEP_SUMMARY && cycle % 6 === 0) {
                        try {
                            const summaryMd = [
                                `## ⚡ 3Q AutoBot v3.0 Final - Trạng Thái Farm KNB Realtime`,
                                `| Chỉ số | Chi tiết |`,
                                `| :--- | :--- |`,
                                `| 👤 **Nhân vật** | **${dispSt.roleName || '---' }** (Server: ${CONFIG.server}) |`,
                                `| ⚔️ **Lực chiến** | ${formatNum(dispSt.basePower || dispSt.power)} |`,
                                `| 💎 **KNB hiện có** | **${formatNum(dispSt.jade)}** |`,
                                `| 🌾 **Đã giải cứu** | **${totalRescued} lượt (+${totalKnb.toLocaleString()} KNB)** |`,
                                `| 🔍 **Tổng gia viên đã quét** | **${totalScanned.toLocaleString()}** gia viên |`,
                                `| ⚡ **Tốc độ rà soát** | **~${scanSpeed.toLocaleString()}** nhà/phút |`,
                                `| ⏱️ **Thời gian hoạt động** | ${Math.floor(elapsedMin)} phút ${Math.round((elapsedMin % 1) * 60)} giây |`,
                                `| 📡 **Cập nhật lần cuối** | ${new Date().toLocaleTimeString("vi-VN")} |`
                            ].join("\n");
                            fs.writeFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMd, "utf8");
                        } catch (eSummary) {}
                    }
                }

                // Cập nhật ảnh màn hình cho GUI mỗi 20 giây (hoặc 2 phút trên GitHub Actions)
                const snapEveryCycles = isGitHubActions ? 12 : 2;
                if (cycle % snapEveryCycles === 0) {
                    const latestPath = path.join(CONFIG.screenshotDir, 'latest.png');
                    try {
                        await activePage.screenshot({ path: latestPath });
                    } catch (eSnap) {}
                }

                // Gửi báo cáo định kỳ về Telegram mỗi report_interval_min phút (mặc định 30 phút)
                const reportIntervalMs = Math.max(1, Number(CONFIG.telegram.report_interval_min) || 30) * 60 * 1000;
                if (Date.now() - sessionState.lastReportTime >= reportIntervalMs) {
                    sessionState.lastReportTime = Date.now();
                    const reportSnap = path.join(CONFIG.screenshotDir, 'latest.png');
                    try { await activePage.screenshot({ path: reportSnap }); } catch (e) {}
                    const periodicHtml = buildTelegramReportHtml(
                        `📊 BÁO CÁO ĐỊNH KỲ (${CONFIG.telegram.report_interval_min} PHÚT)`,
                        st,
                        sessionState,
                        isLobbyHealthy
                            ? `🟢 <i>Đang treo liên tục ổn định. Bấm nút bên dưới hoặc mở GUI nếu anh muốn đổi tính năng!</i>`
                            : `🔄 <i>Đang đồng bộ / kết nối lại sảnh game tự động (hiển thị số liệu gần nhất của phiên).</i>`
                    );
                    await sendTelegramMessage(periodicHtml, reportSnap, sessionState);
                }
            }
        }

        if (sessionState.stopRequested || sessionState.maintenanceDetected) {
            writeLog("🛑 Phiên chạy đã dừng hoàn toàn theo lệnh Dừng / Bảo trì (không tự động nối tiếp workflow).");
            return;
        }

        // Kết thúc phiên chạy: chụp ảnh & gửi báo cáo chuyển phiên về Telegram
        writeLog("====================================================================");
        writeLog(`🏁 Đã hoàn thành chu kỳ phiên (${CONFIG.durationMinutes} phút) -> Tự động nối tiếp phiên mới 24/7!`);
        const finalSnap = path.join(CONFIG.screenshotDir, 'final.png');
        if (activePage && !activePage.isClosed()) {
            try { await activePage.screenshot({ path: finalSnap }); } catch (e) {}
        }
        const finalHtml = buildTelegramReportHtml(
            `🔄 CHUYỂN PHIÊN TỰ ĐỘNG 24/7 (${CONFIG.durationMinutes} PHÚT)`,
            sessionState.lastKnownStats,
            sessionState,
            `♻️ <i>Phiên hiện tại đã hoàn tất và đang tự động khởi chạy phiên kế tiếp!</i>`
        );
        await sendTelegramMessage(finalHtml, fs.existsSync(finalSnap) ? finalSnap : null, sessionState);
        writeLog("====================================================================");

    } catch (err) {
        writeLog(`[Fatal Error] Phiên chạy gặp sự cố: ${err.message}`);
        console.error(err);
        const errSnap = path.join(CONFIG.screenshotDir, 'error.png');
        if (activePage && !activePage.isClosed()) {
            try { await activePage.screenshot({ path: errSnap }); } catch (e) {}
        }
        const errHtml = buildTelegramReportHtml(
            `⚠️ CẢNH BÁO SỰ CỐ PHIÊN TREO`,
            sessionState.lastKnownStats,
            sessionState,
            `❌ <b>Chi tiết lỗi:</b> <code>${String(err.message || err).replace(/[<>&]/g, '')}</code>`
        );
        await sendTelegramMessage(errHtml, fs.existsSync(errSnap) ? errSnap : null, sessionState);
        process.exitCode = 1;
    } finally {
        stopPoller();
        stopGuiServer();
        if (activeBrowser) {
            writeLog("[Browser] Đóng Chromium...");
            try { await activeBrowser.close(); } catch (e) {}
        }
        writeLog("[Runner] Hoàn tất vòng đời runner.");
    }
}

if (require.main === module) {
    run();
}

module.exports = { run, sendTelegramMessage, buildTelegramKeyboard, startLocalGuiServer };
