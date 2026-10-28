/**
 * 3Q Đào Đào Đào - Local GUI & Cloud AutoBot Runner v3.9.32 (Puppeteer + Live GUI Dashboard + Interactive Telegram Control)
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
        yield_wait_minutes: Number(cfgSettings.yield_wait_minutes) || 15
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
                { text: '⚡ Dọn Sạch NV Ngày + Mua Vàng KNB + Nhận Full Quà', callback_data: 'action:one_click_daily' }
            ],
            [btn('auto_daily_rewards'), btn('auto_buy_gold')],
            [btn('auto_rescue_knb'), btn('auto_stage')],
            [btn('auto_longmach'), btn('auto_tower')],
            [btn('auto_host'), btn('auto_defjz')],
            [btn('auto_guild_mine'), btn('auto_touhu')],
            [btn('auto_feidao'), btn('auto_hongbao')],
            [btn('auto_treasure'), btn('auto_dispatch')],
            [
                { text: '📸 Xem Ảnh & Báo Cáo Ngay', callback_data: 'action:report_now' },
                (isYielding || isHardStopped)
                    ? { text: '▶️ Chạy Lại Ngay (Bỏ Chờ)', callback_data: 'action:resume_now' }
                    : { text: `⏸️ Nghỉ ${CONFIG.settings.yield_wait_minutes || 15}p Nhường Máy`, callback_data: 'action:pause_15m' }
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
                const form = new FormData();
                form.append('chat_id', String(chatId));
                form.append('caption', htmlText);
                form.append('parse_mode', 'HTML');
                form.append('reply_markup', JSON.stringify(replyMarkup));
                form.append('photo', new Blob([fileBuf], { type: 'image/png' }), path.basename(photoPath));

                const photoResp = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
                    method: 'POST',
                    body: form
                });
                const photoRes = await photoResp.json();
                if (photoRes && photoRes.ok) {
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

function buildTelegramReportHtml(title, stats, sessionState, extraNote = '') {
    const st = stats || {};
    const nowVn = new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19);
    const elapsedMin = Math.max(1, Math.round((Date.now() - sessionState.startTime) / 60000));
    const remainMin = Math.max(0, Math.round((sessionState.endTime - Date.now()) / 60000));

    const curJade = Number(st.jade || 0);
    const startJade = sessionState.initialJade !== null ? sessionState.initialJade : curJade;
    const deltaJade = curJade - startJade;
    const deltaJadeStr = deltaJade >= 0 ? `+${formatNum(deltaJade)}` : formatNum(deltaJade);

    const totalRescuedCount = (sessionState.baseRescuedCount || 0) + Number(st.rescuedCount || 0);
    const totalRescuedKnb = (sessionState.baseRescuedKnb || 0) + Number(st.rescuedKnbTotal || 0);
    const inspectedHomes = (sessionState.baseInspectedHomes || 0) + Number(st.inspectedHomesCount || st.totalRescueScanned || 0);

    const basePow = Number(st.basePower || st.power || 0);
    const curPow = Number(st.power || 0);
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
        `• <b>Gia viên đã dò:</b> ${formatNum(inspectedHomes)} nhà`,
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
                if (key === 'auto_stage' && typeof window.AutoBot.runAutoStageSmart === 'function') {
                    window.AutoBot.runAutoStageSmart();
                } else if (key === 'auto_longmach' && typeof window.AutoBot.runAutoLongMachSmart === 'function') {
                    window.AutoBot.runAutoLongMachSmart();
                } else if (key === 'auto_rescue_knb' && typeof window.AutoBot.runAutoRescueKnbSmart === 'function') {
                    window.AutoBot.runAutoRescueKnbSmart();
                } else if (key === 'auto_tower' && typeof window.AutoBot.runAutoTowerSmart === 'function') {
                    window.AutoBot.runAutoTowerSmart();
                } else if (key === 'auto_host' && typeof window.AutoBot.runAutoHostSmart === 'function') {
                    window.AutoBot.runAutoHostSmart();
                } else if (key === 'auto_defjz' && typeof window.AutoBot.runAutoDefJzSmart === 'function') {
                    window.AutoBot.runAutoDefJzSmart();
                } else if (key === 'auto_feidao' && typeof window.AutoBot.runAutoFeiDaoSmart === 'function') {
                    window.AutoBot.runAutoFeiDaoSmart();
                } else if (key === 'auto_buy_gold' && typeof window.AutoBot.runBuyAllGoldSmart === 'function') {
                    window.AutoBot.runBuyAllGoldSmart(true);
                } else if (key === 'auto_daily_rewards' && typeof window.AutoBot.runAutoDailyRewardsSmart === 'function') {
                    window.AutoBot.runAutoDailyRewardsSmart(true);
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
            try {
                const resp = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=2`);
                const data = await resp.json();
                if (data && data.ok && Array.isArray(data.result)) {
                    for (const upd of data.result) {
                        lastUpdateId = Math.max(lastUpdateId, upd.update_id);

                        // 1. Xử lý khi người dùng bấm nút trên bảng điều khiển Inline Keyboard
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

                                    const page = getActivePage();
                                    await applyTogglesToLivePage(page, key);

                                    writeLog(`🎛️ [Telegram Remote] Đã chuyển đổi [${label}] -> ${newVal ? 'BẬT' : 'TẮT'}`);

                                    // Phản hồi popup trên màn hình Telegram của điện thoại
                                    try {
                                        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                callback_query_id: cq.id,
                                                text: `⚡ Đã ${newVal ? 'BẬT ✅' : 'TẮT ❌'} ${label}!`,
                                                show_alert: false
                                            })
                                        });
                                    } catch (e) {}

                                    // Cập nhật trạng thái nút bấm ngay trên tin nhắn Telegram
                                    if (cq.message && cq.message.message_id) {
                                        try {
                                            await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                    chat_id: fromChatId,
                                                    message_id: cq.message.message_id,
                                                    reply_markup: buildTelegramKeyboard(sessionState)
                                                })
                                            });
                                        } catch (e) {}
                                    }
                                }
                            } else if (actionData === 'action:one_click_daily') {
                                try {
                                    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            callback_query_id: cq.id,
                                            text: '⚡ Đang làm hết NV Ngày + Mua hết lượt Vàng KNB + Nhận sạch Ưu Đãi & Quà...'
                                        })
                                    });
                                } catch (e) {}

                                writeLog('⚡ [Telegram Remote] Kích hoạt 1-Click: Làm Hết NV Ngày + Mua Hết Vàng KNB + Nhận Full Ưu Đãi/Quà...');
                                const page = getActivePage();
                                const snapPath = path.join(CONFIG.screenshotDir, 'latest.png');
                                let resData = null;
                                if (page && !page.isClosed()) {
                                    try {
                                        resData = await page.evaluate(async () => {
                                            if (window.AutoBot && typeof window.AutoBot.runOneClickAllDailyAndGifts === 'function') {
                                                return await window.AutoBot.runOneClickAllDailyAndGifts();
                                            }
                                            return null;
                                        });
                                        const stNow = await page.evaluate(() => window.AutoBot ? window.AutoBot.updateStats() : null);
                                        if (stNow) sessionState.lastKnownStats = stNow;
                                        await page.screenshot({ path: snapPath });
                                    } catch (e) {}
                                }
                                const noteLines = [
                                    '✅ <b>Đã chạy xong 1-Click All-in-One:</b>',
                                    '• Hoàn thành Trợ Lý Nhanh, Tặng/Nhận Tim Bạn Bè, Bái 7 BXH, Đấu Trường, Thám Hiểm, Gia Viên, Mỏ Bang, Lõi Tần Lĩnh, Tách Mảnh Tím.',
                                    '• Mua sạch 100% lượt <b>Điểm Kim Vàng (Free + KNB)</b> & Càn quét <b>Phó Bản Ngày</b>.',
                                    '• Nhận sạch <b>Nhiệm Vụ Ngày/Tuần/Bang/Đặc Quyền</b>, 5 Rương Sôi Nổi (20~100), Thẻ Tháng, Quỹ Trưởng Thành, Gói Ưu Đãi 0Đ, Chiến Lệnh & Thư!'
                                ];
                                if (resData && resData.ok) {
                                    const gDiff = Number(resData.goldDelta || 0);
                                    const kDiff = Number(resData.knbDelta || 0);
                                    noteLines.push(`📈 <b>Biến động tức thì:</b> Vàng <b>${gDiff >= 0 ? '+' : ''}${formatNum(gDiff)}</b> | KNB <b>${kDiff >= 0 ? '+' : ''}${formatNum(kDiff)}</b>`);
                                }
                                const html = buildTelegramReportHtml(
                                    '⚡ KẾT QUẢ 1-CLICK: NV NGÀY + MUA VÀNG KNB + FULL QUÀ',
                                    sessionState.lastKnownStats,
                                    sessionState,
                                    noteLines.join('\n')
                                );
                                await sendTelegramMessage(html, fs.existsSync(snapPath) ? snapPath : null, sessionState);
                            } else if (actionData === 'action:report_now') {
                                try {
                                    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            callback_query_id: cq.id,
                                            text: '📸 Đang chụp màn hình và gửi báo cáo mới nhất...'
                                        })
                                    });
                                } catch (e) {}

                                const page = getActivePage();
                                const snapPath = path.join(CONFIG.screenshotDir, 'latest.png');
                                if (page && !page.isClosed()) {
                                    try {
                                        const stNow = await page.evaluate(() => window.AutoBot ? window.AutoBot.updateStats() : null);
                                        if (stNow) sessionState.lastKnownStats = stNow;
                                        await page.screenshot({ path: snapPath });
                                    } catch (e) {}
                                }
                                const html = buildTelegramReportHtml(
                                    '📸 BÁO CÁO TRẠNG THÁI TỨC THÌ (THEO YÊU CẦU)',
                                    sessionState.lastKnownStats,
                                    sessionState,
                                    sessionState.isHardStopped
                                        ? '🛑 <i>Bot hiện đã DỪNG HẲN toàn bộ kết nối theo lệnh điều khiển.</i>'
                                        : sessionState.isMaintenance
                                            ? '🛠️ <i>Máy chủ đang bảo trì — Bot đã ngắt toàn bộ lệnh login tránh lag.</i>'
                                            : sessionState.isYielding
                                                ? '⏸️ <i>Bot hiện đang trong thời gian tạm dừng nhường máy.</i>'
                                                : '🟢 <i>Bot đang hoạt động trực tuyến bình thường.</i>'
                                );
                                await sendTelegramMessage(html, fs.existsSync(snapPath) ? snapPath : null, sessionState);
                            } else if (actionData === 'action:pause_15m') {
                                sessionState.manualYieldRequested = true;
                                try {
                                    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            callback_query_id: cq.id,
                                            text: `⏸️ Đang tạm dừng Bot ${CONFIG.settings.yield_wait_minutes || 15} phút để nhường máy...`
                                        })
                                    });
                                } catch (e) {}
                            } else if (actionData === 'action:stop_bot') {
                                sessionState.stopRequested = true;
                                sessionState.isHardStopped = true;
                                CONFIG.settings.bot_stopped = true;
                                saveConfigToDisk();
                                try { fs.writeFileSync(path.join(__dirname, '.bot_stopped'), '1', 'utf8'); } catch (e) {}
                                try {
                                    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            callback_query_id: cq.id,
                                            text: '🛑 Đã dừng hẳn Bot & ngắt toàn bộ lệnh đăng nhập/kết nối!'
                                        })
                                    });
                                } catch (e) {}
                            } else if (actionData === 'action:resume_now') {
                                sessionState.stopRequested = false;
                                sessionState.isHardStopped = false;
                                sessionState.isMaintenance = false;
                                sessionState.maintenanceDetected = false;
                                sessionState.forceResumeFromYield = true;
                                CONFIG.settings.bot_stopped = false;
                                saveConfigToDisk();
                                try { fs.unlinkSync(path.join(__dirname, '.bot_stopped')); } catch (e) {}
                                try {
                                    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            callback_query_id: cq.id,
                                            text: '▶️ Đang kết nối vào lại game ngay lập tức!'
                                        })
                                    });
                                } catch (e) {}
                            }
                        }

                        // 2. Xử lý tin nhắn văn bản gửi tới Bot (/menu, /status, /daily, /pause, /stop, /resume)
                        if (upd.message && upd.message.text) {
                            const fromChatId = String((upd.message.chat && upd.message.chat.id) || '');
                            if (fromChatId !== allowedChatId) continue;
                            const txt = upd.message.text.trim().toLowerCase();

                            if (txt === '/menu' || txt === '/settings' || txt === '/start' || txt === '/status' || txt === '/report') {
                                const page = getActivePage();
                                const snapPath = path.join(CONFIG.screenshotDir, 'latest.png');
                                if (page && !page.isClosed()) {
                                    try {
                                        const stNow = await page.evaluate(() => window.AutoBot ? window.AutoBot.updateStats() : null);
                                        if (stNow) sessionState.lastKnownStats = stNow;
                                        await page.screenshot({ path: snapPath });
                                    } catch (e) {}
                                }
                                const html = buildTelegramReportHtml(
                                    '🎛️ BẢNG ĐIỀU KHIỂN TRỰC TUYẾN 3Q AUTOBOT v3.9.34',
                                    sessionState.lastKnownStats,
                                    sessionState
                                );
                                await sendTelegramMessage(html, fs.existsSync(snapPath) ? snapPath : null, sessionState);
                            } else if (txt === '/daily' || txt === '/nhanh' || txt === '/nvngay' || txt === '/muavang') {
                                const page = getActivePage();
                                const snapPath = path.join(CONFIG.screenshotDir, 'latest.png');
                                let resData = null;
                                if (page && !page.isClosed()) {
                                    try {
                                        resData = await page.evaluate(async () => {
                                            if (window.AutoBot && typeof window.AutoBot.runOneClickAllDailyAndGifts === 'function') {
                                                return await window.AutoBot.runOneClickAllDailyAndGifts();
                                            }
                                            return null;
                                        });
                                        const stNow = await page.evaluate(() => window.AutoBot ? window.AutoBot.updateStats() : null);
                                        if (stNow) sessionState.lastKnownStats = stNow;
                                        await page.screenshot({ path: snapPath });
                                    } catch (e) {}
                                }
                                const html = buildTelegramReportHtml(
                                    '⚡ ĐÃ DỌN SẠCH NV NGÀY + MUA VÀNG KNB + NHẬN FULL QUÀ',
                                    sessionState.lastKnownStats,
                                    sessionState,
                                    resData && resData.ok
                                        ? `📈 Biến động: Vàng <b>+${formatNum(resData.goldDelta || 0)}</b> | KNB <b>${(resData.knbDelta || 0) >= 0 ? '+' : ''}${formatNum(resData.knbDelta || 0)}</b>`
                                        : '✅ Đã kích hoạt toàn bộ chuỗi Nhiệm Vụ Ngày, Điểm Kim KNB & Nhận Quà Ưu Đãi!'
                                );
                                await sendTelegramMessage(html, fs.existsSync(snapPath) ? snapPath : null, sessionState);
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
            } catch (ePoll) {}
            await new Promise(r => setTimeout(r, 2500));
        }
    })();

    return () => { stopped = true; };
}

// Kiểm tra nếu người dùng sửa file config.json trực tiếp trên web GitHub và bấm Commit
let lastGitConfigHash = '';
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
                    return;
                }
                if (hash !== lastGitConfigHash) {
                    lastGitConfigHash = hash;
                    const parsed = JSON.parse(remoteCfgRaw);
                    const changes = [];
                    if (parsed.toggles) {
                        for (const [k, v] of Object.entries(parsed.toggles)) {
                            const boolV = !!v;
                            if (CONFIG.toggles[k] !== undefined && CONFIG.toggles[k] !== boolV) {
                                CONFIG.toggles[k] = boolV;
                                changes.push(`${TOGGLE_LABELS[k] || k}: <b>${boolV ? 'BẬT ✅' : 'TẮT ❌'}</b>`);
                            }
                        }
                    }
                    if (parsed.settings) {
                        if (parsed.settings.speed_hack !== undefined) CONFIG.settings.speed_hack = Number(parsed.settings.speed_hack) || 2;
                        if (parsed.settings.yield_on_kick !== undefined) CONFIG.settings.yield_on_kick = !!parsed.settings.yield_on_kick;
                        if (parsed.settings.yield_wait_minutes !== undefined) CONFIG.settings.yield_wait_minutes = Number(parsed.settings.yield_wait_minutes) || 15;
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
        if (m) writeLog(`[AutoBot] ${entry.time || ''} ${m}`);
        const isKick = entry.kickNow === true ||
            m.includes('[Nhường Máy]') ||
            m.includes('close_after_kick') ||
            m.includes('Nhận thông điệp kick từ máy chủ') ||
            m.includes('vui lòng đăng nhập lại') ||
            m.includes('thiết bị khác') ||
            m.includes('trùng lặp') ||
            m.includes('phiên khác');
        if (isKick) {
            sessionState.kickDetectedFromLog = true;
            const br = sessionState.activeBrowser || sessionState.currentBrowser;
            if (br && !sessionState.closingBrowserForYield) {
                sessionState.closingBrowserForYield = true;
                writeLog(`📱 [Nhường Máy] Nhận tín hiệu KICK khẩn cấp từ game -> Đóng Chromium ngay lập tức để giải phóng kết nối cho Điện thoại!`);
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

    page.on('pageerror', err => {
        writeLog(`[WebError] ${err.toString()}`);
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
        if (sessionState && (sessionState.stopRequested || sessionState.manualYieldRequested)) {
            writeLog("[Login] 🛑 Nhận lệnh Dừng trong lúc tải màn hình đăng nhập -> Ngắt ngay lập tức!");
            return { browser, page };
        }
        attempts++;
        await new Promise(r => setTimeout(r, 2000));

        try {
            loginReady = await page.evaluate((sInfo, tick) => {
                function safeReq(name) {
                    if (typeof window.__require === "function") {
                        try {
                            const mod = window.__require(name);
                            if (mod) return mod[name] || mod.default || mod;
                        } catch (e) {}
                    }
                    if (window[name]) return window[name];
                    if (window.G_Mapping && window.G_Mapping[name]) return window.G_Mapping[name];
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
                    const rInfo = typeof mm.PlayerModel.getRoleInfo === "function"
                        ? mm.PlayerModel.getRoleInfo()
                        : mm.PlayerModel.roleInfo;
                    if (rInfo && (rInfo.roleId || rInfo.rid || rInfo.name || rInfo.roleName || rInfo.level)) {
                        return "IN_GAME";
                    }
                }

                const loginView = (vm && typeof vm.getView === "function") ? vm.getView("LoginView") : null;
                if (loginView) {
                    const btnReady = !!(loginView.loginBtn && loginView.loginBtn.visible !== false);
                    const barDone = !loginView.barNode || loginView.barNode.visible === false;
                    if ((btnReady && barDone) || tick >= 25) {
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

    if (sessionState && (sessionState.stopRequested || sessionState.manualYieldRequested)) {
        writeLog("[Login] 🛑 Đã nhận lệnh Dừng -> Không bấm Vào Game nữa!");
        return { browser, page, inGame: false };
    }

    let inGame = (loginReady === "IN_GAME");
    if (!inGame) {
        writeLog(`[Server] Đang chọn máy chủ: [${CONFIG.server}] và kích hoạt Vào Game...`);
        const selectRes = await page.evaluate((targetSrv, sInfo) => {
            function safeReq(name) {
                if (typeof window.__require === "function") {
                    try {
                        const mod = window.__require(name);
                        if (mod) return mod[name] || mod.default || mod;
                    } catch (e) {}
                }
                if (window[name]) return window[name];
                if (window.G_Mapping && window.G_Mapping[name]) return window.G_Mapping[name];
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
        for (let i = 0; i < 8; i++) {
            if (sessionState && (sessionState.stopRequested || sessionState.manualYieldRequested)) {
                writeLog("[Login] 🛑 Nhận lệnh Dừng trong lúc đợi vào sảnh -> Ngắt ngay lập tức!");
                return { browser, page, inGame: false };
            }
            await new Promise(r => setTimeout(r, 2000));
            try {
                const hasPlayer = await page.evaluate(() => {
                    function safeReq(name) {
                        if (typeof window.__require === "function") {
                            try {
                                const mod = window.__require(name);
                                if (mod) return mod[name] || mod.default || mod;
                            } catch (e) {}
                        }
                        if (window[name]) return window[name];
                        if (window.G_Mapping && window.G_Mapping[name]) return window.G_Mapping[name];
                        return null;
                    }
                    const mm = safeReq("ModelManager");
                    if (mm && mm.PlayerModel) {
                        const rInfo = typeof mm.PlayerModel.getRoleInfo === "function" ? mm.PlayerModel.getRoleInfo() : mm.PlayerModel.roleInfo;
                        if (rInfo && (rInfo.roleId || rInfo.rid || rInfo.name || rInfo.roleName || rInfo.level)) return true;
                    }
                    return false;
                });
                if (hasPlayer) break;
            } catch (e) {}
        }
        try {
            await page.click('#GameCanvas', { offset: { x: 225, y: 700 } });
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) {}
    }

    if (sessionState && (sessionState.stopRequested || sessionState.manualYieldRequested)) {
        return { browser, page, inGame: false };
    }

    const payloadFile = fs.existsSync(path.join(__dirname, 'injected_agent.js'))
        ? path.join(__dirname, 'injected_agent.js')
        : path.join(__dirname, 'bot-payload.js');
    writeLog(`[Bot] Đang nạp mã nguồn ${path.basename(payloadFile)} (AutoBot v3.9.34)...`);
    const botPayloadCode = fs.readFileSync(payloadFile, 'utf8');

    await page.evaluate((code, cfg) => {
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
    }, botPayloadCode, { settings: CONFIG.settings, toggles: CONFIG.toggles });

    writeLog("[Bot] ✅ AutoBot v3.9.34 (Anti-Lag Stop & Pre-Unlock Bypass Edition) đã kích hoạt!");
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
        if (sessionState.stopRequested) return { browser: null, page: null, inGame: false };
        try {
            writeLog(`[Session] Đang khởi tạo phiên đăng nhập (Lần thử ${attempt}/${maxAttempts})...`);
            const session = await launchAndEnterGame(sessionState);
            if (session && session.browser) {
                return session;
            }
        } catch (err) {
            writeLog(`⚠️ [Session] Lỗi khởi tạo phiên lần ${attempt}: ${err.message}`);
            try {
                const { execSync } = require('child_process');
                execSync('pkill -f chrome || true');
            } catch (eKill) {}
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
                    res.end('3Q AutoBot GUI v3.9.34 is running.');
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
                    writeLog(`⏸️ [GUI Control] Đã yêu cầu tạm dừng ${CONFIG.settings.yield_wait_minutes || 15} phút để nhường máy!`);
                    return sendJson(res, { ok: true, message: `Đã kích hoạt chế độ nghỉ ${CONFIG.settings.yield_wait_minutes || 15} phút nhường máy!` });
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
                            if (stNow) sessionState.lastKnownStats = stNow;
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
                        if (stNow) sessionState.lastKnownStats = stNow;
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
                if (body.yield_wait_minutes) CONFIG.settings.yield_wait_minutes = Math.max(1, Number(body.yield_wait_minutes) || 15);
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
    writeLog("🚀 KHỞI ĐỘNG 3Q ĐÀO ĐÀO ĐÀO - AUTOBOT GUI & CLOUD v3.9.34 (ANTI-LAG STOP & BYPASS)");
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
        }
        try { if (activeBrowser) await activeBrowser.close(); } catch (e) {}
        activeBrowser = null;
        activePage = null;

        const stopHtml = buildTelegramReportHtml(
            `🛑 [DỪNG HẲN BOT / BẢO TRÌ] ĐÃ NGẮT KẾT NỐI 100%`,
            Object.assign({}, sessionState.lastKnownStats || {}, { rescuedCount: 0, rescuedKnbTotal: 0, inspectedHomesCount: 0 }),
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
        if (resumed && (resumed.browser || resumed.inGame)) {
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
                    sessionState.isYielding = false;
                    sessionState.yieldEndTime = 0;
                    sessionState.forceResumeFromYield = false;
                }
                try { fs.unlinkSync(yieldFile); } catch (e) {}
            } catch (e) {}
        }

        const session = await safeLaunchAndEnterGame(sessionState);
        if (session && session.browser) {
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
            // Chu kỳ kiểm tra 10 giây, phản ứng ngay lập tức trong 250ms nếu bị KICK, nhận lệnh dừng hoặc yield
            for (let s = 0; s < 40; s++) {
                if (sessionState.kickDetectedFromLog || sessionState.manualYieldRequested || sessionState.stopRequested || sessionState.maintenanceDetected || !activeBrowser || (activePage && activePage.isClosed())) {
                    break;
                }
                await new Promise(r => setTimeout(r, 250));
            }

            if (sessionState.stopRequested || sessionState.maintenanceDetected) {
                const actRes = await handleHardStopOrMaintenance();
                if (actRes === 'EXIT_WORKFLOW') break;
                continue;
            }

            // Xử lý yêu cầu khởi động lại cửa sổ trình duyệt từ GUI (đổi chế độ ẩn/hiện hoặc tải lại)
            if (sessionState.restartBrowserRequested) {
                sessionState.restartBrowserRequested = false;
                writeLog("[GUI] Đang khởi tạo lại cửa sổ trình duyệt theo yêu cầu...");
                if (sessionState.lastKnownStats) {
                    sessionState.baseRescuedCount += Number(sessionState.lastKnownStats.rescuedCount || 0);
                    sessionState.baseRescuedKnb += Number(sessionState.lastKnownStats.rescuedKnbTotal || 0);
                    sessionState.baseInspectedHomes += Number(sessionState.lastKnownStats.inspectedHomesCount || sessionState.lastKnownStats.totalRescueScanned || 0);
                }
                try { if (activeBrowser) await activeBrowser.close(); } catch (e) {}
                activeBrowser = null;
                activePage = null;
                const reSession = await safeLaunchAndEnterGame(sessionState);
                if (reSession && (reSession.browser || reSession.inGame)) {
                    activeBrowser = reSession.browser;
                    activePage = reSession.page;
                    sessionState.activeBrowser = activeBrowser;
                    sessionState.activePage = activePage;
                } else {
                    writeLog("⚠️ [Watchdog] Khởi tạo lại phiên chưa thành công, chờ 10s trước khi thử lại...");
                    await new Promise(r => setTimeout(r, 10000));
                }
                continue;
            }

            // Kiểm tra Hot-Reload nếu sửa config.json mỗi 30 giây
            if (cycle % 3 === 0) {
                await checkGitConfigHotReload(activePage, sessionState);
            }

            if (!activePage || activePage.isClosed()) {
                if (sessionState.stopRequested || sessionState.maintenanceDetected) {
                    const actRes = await handleHardStopOrMaintenance();
                    if (actRes === 'EXIT_WORKFLOW') break;
                    continue;
                }
                writeLog("[Watchdog] Trang trình duyệt đã đóng, đang khởi tạo lại phiên...");
                try { if (activeBrowser) await activeBrowser.close(); } catch (e) {}
                activeBrowser = null;
                activePage = null;
                const reSession = await safeLaunchAndEnterGame(sessionState);
                if (reSession && (reSession.browser || reSession.inGame)) {
                    activeBrowser = reSession.browser;
                    activePage = reSession.page;
                    sessionState.activeBrowser = activeBrowser;
                    sessionState.activePage = activePage;
                } else {
                    writeLog("⚠️ [Watchdog] Khởi tạo lại phiên chưa thành công, chờ 10s trước khi thử lại...");
                    await new Promise(r => setTimeout(r, 10000));
                }
                continue;
            }

            const mergedToggles = Object.assign({}, CONFIG.settings, CONFIG.toggles);
            let status = null;
            try {
                status = await activePage.evaluate(async (t) => {
                    if (window.AutoBot && typeof window.AutoBot.runSmartCycle === "function") {
                        return await window.AutoBot.runSmartCycle(t);
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

            // 1. KIỂM TRA NHƯỜNG MÁY NGAY LẬP TỨC (Khi Điện thoại đăng nhập hoặc nhận lệnh từ Telegram / GUI)
            const isKickDetected = !!(
                (status && status.kickedByOtherDevice) ||
                sessionState.kickDetectedFromLog
            );

            if ((isKickDetected && CONFIG.settings.yield_on_kick) || sessionState.manualYieldRequested) {
                const isManual = sessionState.manualYieldRequested;
                sessionState.manualYieldRequested = false;
                sessionState.kickDetectedFromLog = false;
                sessionState.isYielding = true;
                sessionState.forceResumeFromYield = false;

                const waitMin = Math.max(1, Number(CONFIG.settings.yield_wait_minutes) || 15);
                writeLog(`📱 [Nhường Máy] ${isManual ? 'Nhận lệnh tạm dừng từ người dùng' : 'Phát hiện tài khoản đăng nhập từ Điện thoại/PC'}! Đóng trình duyệt ngay, tạm dừng ${waitMin} phút rồi tự động chạy tiếp...`);

                // Lưu cộng dồn chỉ số Farm KNB trước khi đóng trình duyệt
                if (sessionState.lastKnownStats) {
                    sessionState.baseRescuedCount += Number(sessionState.lastKnownStats.rescuedCount || 0);
                    sessionState.baseRescuedKnb += Number(sessionState.lastKnownStats.rescuedKnbTotal || 0);
                    sessionState.baseInspectedHomes += Number(sessionState.lastKnownStats.inspectedHomesCount || sessionState.lastKnownStats.totalRescueScanned || 0);
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

                sessionState.isYielding = false;
                sessionState.yieldEndTime = 0;
                sessionState.forceResumeFromYield = false;
                try { fs.unlinkSync(yieldFile); } catch (e) {}

                if (sessionState.stopRequested || sessionState.maintenanceDetected) {
                    const actRes = await handleHardStopOrMaintenance();
                    if (actRes === 'EXIT_WORKFLOW') break;
                    continue;
                }

                if (Date.now() >= endTime) {
                    writeLog(`[Nhường Máy] Đã hết thời lượng phiên chạy hiện tại, chuyển sang phiên kế tiếp...`);
                    break;
                }

                writeLog(`🔄 [Nhường Máy] ${sessionState.forceResumeFromYield ? "Nhận lệnh Chạy Lại Ngay" : "Đã hết " + waitMin + " phút nhường máy"}! Đang đăng nhập lại mới 100%...`);
                sessionState.forceResumeFromYield = false;

                const resumed = await safeLaunchAndEnterGame(sessionState);
                if (resumed && resumed.browser) {
                    activeBrowser = resumed.browser;
                    activePage = resumed.page;
                    sessionState.activeBrowser = activeBrowser;
                    sessionState.activePage = activePage;
                    const resumeSnap = path.join(CONFIG.screenshotDir, 'latest.png');
                    try { await activePage.screenshot({ path: resumeSnap }); } catch (e) {}
                    const resumeHtml = buildTelegramReportHtml(
                        `🟢 [KẾT NỐI LẠI] ĐÃ VÀO LẠI GAME SAU KHI NHƯỜNG MÁY`,
                        sessionState.lastKnownStats || {},
                        sessionState,
                        `✅ <i>Điện thoại đã nghỉ, Bot đã tự động đăng nhập lại sảnh chính thành công và tiếp tục treo 24/7!</i>`
                    );
                    await sendTelegramMessage(resumeHtml, fs.existsSync(resumeSnap) ? resumeSnap : null, sessionState);
                    sessionState.lastReportTime = Date.now();
                }
                continue;
            }

            if (status && status.stats) {
                const st = status.stats;
                if (st.roleName && st.roleName !== "Đang tải...") {
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

                // Gửi báo cáo khởi động lần đầu ngay khi tải xong dữ liệu nhân vật VÀ số dư KNB thực tế
                sessionState.startupWaitTicks = (sessionState.startupWaitTicks || 0) + 1;
                const canSendStartup = !sessionState.startupReported && 
                    st.roleName && st.roleName !== "Đang tải..." && 
                    Number(st.power || 0) > 0 && 
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
                        '🚀 3Q AUTOBOT v3.9.34 - ĐÃ VÀO GAME & BẮT ĐẦU TREO 24/7',
                        st,
                        sessionState,
                        '✅ <i>Anh có thể điều khiển trực tiếp trên cửa sổ GUI (http://127.0.0.1:3939) hoặc bấm các nút bên dưới trên Telegram!</i>'
                    );
                    await sendTelegramMessage(html, startSnap, sessionState);
                }
                if (cycle % 3 === 0) {
                    const totalRescued = sessionState.baseRescuedCount + Number(st.rescuedCount || 0);
                    const totalKnb = sessionState.baseRescuedKnb + Number(st.rescuedKnbTotal || 0);
                    const totalScanned = (sessionState.baseInspectedHomes || 0) + Number(st.inspectedHomesCount || st.totalRescueScanned || 0);
                    const elapsedMin = Math.max(0.1, (Date.now() - sessionState.startTime) / 60000);
                    const scanSpeed = Math.round(totalScanned / elapsedMin);
                    writeLog(`[Trạng Thái] ${st.roleName || '---'} | Ải: ${st.stage || 1} | LC: ${formatNum(st.basePower || st.power)} | KNB: ${formatNum(st.jade)} | Giải cứu: ${totalRescued} lượt (+${totalKnb} KNB) | Đã quét: ${totalScanned.toLocaleString()} nhà (~${scanSpeed} nhà/p)`);

                    if (process.env.GITHUB_STEP_SUMMARY && cycle % 6 === 0) {
                        try {
                            const summaryMd = [
                                `## ⚡ 3Q AutoBot v3.9.35 - Trạng Thái Farm KNB Realtime`,
                                `| Chỉ số | Chi tiết |`,
                                `| :--- | :--- |`,
                                `| 👤 **Nhân vật** | **${st.roleName || '---' }** (Server: ${CONFIG.server}) |`,
                                `| ⚔️ **Lực chiến** | ${formatNum(st.basePower || st.power)} |`,
                                `| 💎 **KNB hiện có** | **${formatNum(st.jade)}** |`,
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
                        `🟢 <i>Đang treo liên tục ổn định. Bấm nút bên dưới hoặc mở GUI nếu anh muốn đổi tính năng!</i>`
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
