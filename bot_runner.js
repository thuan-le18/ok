// ===== bot_runner.js =====
// Cài đặt: npm install node-telegram-bot-api firebase-admin

const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json'); // Tải từ Firebase Console

// Khởi tạo Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://your-project.firebaseio.com' // THAY
});
const db = admin.database();

// Danh sách bot đang chạy
const botInstances = {};

// Hàm khởi tạo bot với polling
async function startBot(token) {
  if (botInstances[token]) {
    console.log(`Bot ${token} đã chạy.`);
    return;
  }

  try {
    const bot = new TelegramBot(token, { polling: true });
    botInstances[token] = bot;

    // Cập nhật trạng thái online
    await db.ref(`bots/${token}/online`).set(true);
    console.log(`✅ Bot ${token} đã khởi động polling.`);

    // Xử lý lệnh /start
    bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const username = msg.from.username || '';
      const firstName = msg.from.first_name || '';
      const lastName = msg.from.last_name || '';

      // 1. Lưu user (chỉ 1 lần)
      const userRef = db.ref(`bot_users/${token}/${userId}`);
      const snapshot = await userRef.once('value');
      if (!snapshot.exists()) {
        await userRef.set({
          username,
          first_name: firstName,
          last_name: lastName,
          started_at: new Date().toISOString()
        });
        console.log(`📥 Đã lưu user mới: ${userId} (${username})`);
      }

      // 2. Lưu log chat
      const logRef = db.ref(`bot_chat_logs/${token}/${userId}`).push();
      await logRef.set({
        from: 'user',
        text: '/start',
        timestamp: new Date().toISOString()
      });

      // 3. Gửi lời chào + nút miniapp
      const keyboard = {
        inline_keyboard: [[{
          text: '🚀 Mở ứng dụng',
          web_app: { url: 'https://t.me/Muatienbanbot/website' } // THAY bằng link miniapp của bạn
        }]]
      };
      await bot.sendMessage(chatId, 
        `👋 Chào bạn ${firstName || 'bạn'}!\n\nHãy bấm nút bên dưới để mở ứng dụng TIENBAN và bắt đầu giao dịch nhé.`,
        { reply_markup: keyboard, parse_mode: 'HTML' }
      );
      console.log(`📨 Đã gửi lời chào đến ${userId}`);
    });

    // Xử lý tất cả tin nhắn (lưu log)
    bot.on('message', async (msg) => {
      // Bỏ qua tin nhắn không có text (ảnh, sticker...)
      if (!msg.text) return;
      if (msg.text === '/start') return; // đã xử lý ở trên

      const userId = msg.from.id;
      const logRef = db.ref(`bot_chat_logs/${token}/${userId}`).push();
      await logRef.set({
        from: 'user',
        text: msg.text,
        timestamp: new Date().toISOString()
      });
    });

    // Xử lý lỗi polling
    bot.on('polling_error', (error) => {
      console.error(`❌ Polling error (${token}):`, error.message);
      db.ref(`bots/${token}/online`).set(false);
    });

  } catch (error) {
    console.error(`❌ Không thể khởi động bot ${token}:`, error.message);
    await db.ref(`bots/${token}/online`).set(false);
  }
}

// Hàm dừng bot
async function stopBot(token) {
  if (botInstances[token]) {
    try {
      await botInstances[token].stopPolling();
      delete botInstances[token];
      await db.ref(`bots/${token}/online`).set(false);
      console.log(`⏹️ Đã dừng bot ${token}`);
    } catch (e) {
      console.error(`Lỗi khi dừng bot ${token}:`, e);
    }
  }
}

// Lắng nghe thay đổi danh sách bot từ Firebase
db.ref('bots').on('child_added', async (snapshot) => {
  const token = snapshot.key;
  const data = snapshot.val();
  if (data && !botInstances[token]) {
    await startBot(token);
  }
});

db.ref('bots').on('child_removed', async (snapshot) => {
  const token = snapshot.key;
  if (botInstances[token]) {
    await stopBot(token);
  }
});

// Khởi động các bot đã có sẵn
async function initBots() {
  const snapshot = await db.ref('bots').once('value');
  const bots = snapshot.val();
  if (bots) {
    for (const token of Object.keys(bots)) {
      if (!botInstances[token]) {
        await startBot(token);
      }
    }
  }
  console.log('🚀 Bot runner đã sẵn sàng!');
}

// Chạy
initBots();

// Tự động kiểm tra trạng thái online mỗi 5 phút (đã có polling)
// Ngoài ra, có thể thêm cron job để restart bot nếu cần
