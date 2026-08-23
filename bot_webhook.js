// api/webhook.js (Vercel Serverless Function)
const admin = require('firebase-admin');

// Khởi tạo Firebase Admin (chỉ 1 lần)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}
const db = admin.database();

// Hàm gửi tin nhắn Telegram
async function sendTelegramMessage(botToken, chatId, text, replyMarkup = null) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const update = req.body;
  const botToken = req.query.token; // Lấy token từ URL: /api/webhook?token=YOUR_TOKEN

  if (!botToken) {
    return res.status(400).json({ error: 'Missing bot token' });
  }

  if (!update.message) {
    return res.status(200).send('OK');
  }

  const from = update.message.from;
  const userId = from.id;
  const chatId = update.message.chat.id;
  const text = update.message.text || '';

  // 1. Lưu log chat
  const logRef = db.ref(`bot_chat_logs/${botToken}/${userId}`).push();
  await logRef.set({
    from: 'user',
    text: text,
    timestamp: new Date().toISOString()
  });

  // 2. Nếu là /start
  if (text === '/start') {
    const userRef = db.ref(`bot_users/${botToken}/${userId}`);
    const snapshot = await userRef.once('value');
    if (!snapshot.exists()) {
      await userRef.set({
        username: from.username || '',
        first_name: from.first_name || '',
        last_name: from.last_name || '',
        started_at: new Date().toISOString()
      });
    }

    // Gửi lời chào + miniapp
    const keyboard = {
      inline_keyboard: [[{
        text: 'BlackMarket',
        web_app: { url: process.env.MINIAPP_URL || 'https://t.me/Muatienbanbot/website' }
      }]]
    };
    await sendTelegramMessage(
      botToken,
      chatId,
      `👋 Chào bạn ${from.first_name || ''}!\n\nHãy bấm nút bên dưới để mở website`,
      keyboard
    );
  }

  res.status(200).send('OK');
}
