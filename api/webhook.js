/* ============================================================
   TELEGRAM WEBHOOK HANDLER - Multi-bot
   - Nhận update từ Telegram qua ?token=BOT_TOKEN
   - Ghi log chat vào Firebase REST
   - /start: gửi chào + nút MiniApp
   - Không cần Firebase Admin SDK (dùng REST API)
   ============================================================ */

const https = require('https');

// ================== CẤU HÌNH ==================
const FIREBASE_URL = 'https://checktime-3a697-default-rtdb.firebaseio.com';
const MINIAPP_URL = 'https://tienbanccv.vercel.app/';
const WELCOME_TEXT = (name) =>
    `👋 <b>Xin chào ${name}!</b>\n\n` +
    `Chào mừng bạn đến với <b>BLACKMARKET</b>!\n\n` +
    `📲 Bấm nút bên dưới để mở ứng dụng:`;
const WEBAPP_BUTTON = 'Mở Web';
// ==============================================

// ============ HTTPS HELPERS ============
function httpRequest(options, body) {
    return new Promise((resolve) => {
        const req = https.request(options, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve({ ok: true, status: res.statusCode, data: JSON.parse(d) }); }
                catch (e) { resolve({ ok: false, status: res.statusCode, data: d }); }
            });
        });
        req.on('error', (e) => resolve({ ok: false, error: e.message }));
        req.setTimeout(8000, () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
        if (body) req.write(body);
        req.end();
    });
}

// ============ FIREBASE REST ============
function fbGet(path) {
    const u = new URL(FIREBASE_URL + path + '.json');
    return httpRequest({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET' })
        .then(r => r.data);
}

function fbPut(path, value) {
    const u = new URL(FIREBASE_URL + path + '.json');
    const body = JSON.stringify(value);
    return httpRequest({
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, body);
}

function fbPush(path, value) {
    const u = new URL(FIREBASE_URL + path + '.json');
    const body = JSON.stringify(value);
    return httpRequest({
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, body);
}

// ============ TELEGRAM API ============
function tgApi(token, method, payload) {
    const u = new URL(`https://api.telegram.org/bot${token}/${method}`);
    const body = JSON.stringify(payload);
    return httpRequest({
        hostname: u.hostname,
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, body);
}

// ============ HELPERS ============
async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
}

function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============ XỬ LÝ /start ============
async function handleStart(token, msg) {
    const from = msg.from || {};
    const userId = from.id;
    const chatId = msg.chat.id;

    if (!userId || !chatId) return;

    // Lưu user nếu chưa có
    const existing = await fbGet(`bot_users/${token}/${userId}`);
    if (!existing) {
        await fbPut(`bot_users/${token}/${userId}`, {
            username: from.username || '',
            first_name: from.first_name || '',
            last_name: from.last_name || '',
            started_at: new Date().toISOString(),
        });
    }

    const firstName = escapeHtml(from.first_name || 'bạn');

    // Gửi tin chào + nút MiniApp
    await tgApi(token, 'sendMessage', {
        chat_id: chatId,
        text: WELCOME_TEXT(firstName),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
            inline_keyboard: [[
                { text: WEBAPP_BUTTON, web_app: { url: MINIAPP_URL } }
            ]]
        },
    });
}

// ============ XỬ LÝ COMMAND KHÁC ============
async function handleCommand(token, msg) {
    const text = (msg.text || '').trim();
    const chatId = msg.chat.id;

    if (text === '/help') {
        await tgApi(token, 'sendMessage', {
            chat_id: chatId,
            text: '📖 <b>HƯỚNG DẪN</b>\n━━━━━━━━━━━━━━━━━━\n' +
                  '/start — Bắt đầu\n' +
                  '/help — Trợ giúp',
            parse_mode: 'HTML',
        });
    }
}

// ============ HANDLER ============
module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();

    const token = (req.query && req.query.token) || '';

    // ---------- GET: info ----------
    if (req.method === 'GET') {
        const host = req.headers.host || 'your-domain.vercel.app';
        return res.status(200).json({
            ok: true,
            service: 'Telegram Bot Webhook',
            token_provided: !!token,
            hint: 'Set webhook: https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://' + host + '/api/webhook?token=<TOKEN>',
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    if (!token) {
        return res.status(400).json({ ok: false, error: 'Missing ?token= in URL' });
    }

    // ---------- Đọc body ----------
    let update = req.body;
    if (!update || typeof update === 'string') {
        try {
            const raw = await readBody(req);
            update = JSON.parse(raw);
        } catch (e) { update = null; }
    }

    if (!update || !update.message) {
        return res.status(200).send('OK');
    }

    const msg = update.message;
    const from = msg.from || {};
    const userId = from.id;
    const text = (msg.text || '').trim();

    // ---------- Ghi log chat (không chờ) ----------
    if (userId && text) {
        fbPush(`bot_chat_logs/${token}/${userId}`, {
            from: 'user',
            text: text,
            timestamp: new Date().toISOString(),
        }).catch(() => {});
    }

    // ---------- Xử lý command ----------
    try {
        if (text === '/start' || text.startsWith('/start ')) {
            // Không await để return nhanh cho Telegram
            handleStart(token, msg).catch(e => console.error('handleStart:', e));
        } else if (text.startsWith('/')) {
            handleCommand(token, msg).catch(e => console.error('handleCommand:', e));
        }
    } catch (e) {
        console.error('Handler error:', e);
    }

    // ---------- Response nhanh cho Telegram ----------
    return res.status(200).send('OK');
};
