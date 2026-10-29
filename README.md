# 3Q Đào Đào Đào - Cloud AutoBot v3.9.32 (GitHub Actions & Telegram Report Edition)

> 🤖 **Hệ thống Treo Bot Tự Động Hóa 3Q Đào Đào Đào v3.9.32 (Farm KNB Giải Cứu Gia Viên)** chạy 24/7 trên đám mây **GitHub Actions** hoặc trực tiếp trên máy tính (Mac/Windows). Tích hợp **Báo cáo tiến trình & ảnh chụp màn hình về Telegram mỗi 30 phút** và cơ chế **Tự động nhường máy 15 phút (`yield_on_kick`)** khi bạn đăng nhập trên điện thoại!

---

## 🌟 1. Tính Năng Nổi Bật (AutoBot Engine v3.9.32)

| Nhóm Tính Năng | Cơ Chế Hoạt Động Thông Minh |
| :--- | :--- |
| 💎 **Farm KNB Giải Cứu Gia Viên (`auto_rescue_knb`)** | Tự động tuần tra danh sách Gia Viên, dùng **Đội Hình Dò 2 Tướng (Hạ Lực Chiến)** để làm mới danh sách đối thủ có lực chiến phù hợp, tự động **Khôi Phục 100% Đội Hình Chính** trước khi đánh đuổi quân chiếm đóng để nhận **+50 KNB/lượt không giới hạn**. |
| 📱 **Nhường Máy Thông Minh (`yield_on_kick`)** | Khi phát hiện bạn đăng nhập tài khoản trên Điện thoại/PC (`onLoginKickSc`), Bot lập tức ngắt kết nối, gửi thông báo về Telegram và **tạm nghỉ đúng 15 phút (`yield_wait_minutes`)** trước khi tự động đăng nhập lại. |
| 📡 **Báo Cáo Telegram Định Kỳ (`telegram`)** | Gửi báo cáo chi tiết kèm ảnh chụp màn hình về Telegram khi **Bắt đầu phiên**, **Định kỳ mỗi 30 phút**, khi **Nhường máy / Kết nối lại**, và khi **Kết thúc phiên** (Thống kê KNB hiện có, độ lệch KNB, số lượt Giải cứu thành công & tổng KNB farm được). |
| 🛡️ **Auto Bí Cảnh & Chọn Lõi (`auto_defjz` / `auto_yyzq_core`)** | Tự động tham gia Bí Cảnh Tần Lĩnh / Bảo Vệ Kinh Châu và tự động chọn Lõi kỹ năng tối ưu nhất. |
| 🌾 **Mỏ Bang 2 Đội (`auto_guild_mine`)** | Mở khóa sử dụng đồng thời cả 2 đội hình chiếm mỏ và tự động thu hoạch tài nguyên định kỳ. |
| 🎯 **Thần Xạ Aim-bot & Long Hổ Max (`auto_touhu` / `auto_skvs`)** | Tự động ném trúng 100% Thần Xạ, tự động bốc lì xì và dự đoán Long Hổ Tranh Bá. |
| 🎁 **Quà Ngày, Quay Free, Bái 7 BXH & Tách Mảnh** | Tự động nhận toàn bộ quà ngày, rương mốc năng động, cây tiền, quay miễn phí Tàng Bảo Các/Thần Binh, bái kiến 7 BXH và tự động tách mảnh tướng Cam/Tím trở xuống. |

---

## ⚙️ 2. Cấu Hình Sẵn Có (`config.json`)

Toàn bộ cấu hình tài khoản, Telegram và danh sách tính năng đã được thiết lập sẵn trong tệp `config.json`:

- **Tài khoản**: `dungby5@gmail.com` — Máy chủ: `Tam Quốc S6`
- **Telegram Bot**: Tự động gửi báo cáo về `chat_id: 7182418544` mỗi `30 phút`
- **Nhường máy (`yield_on_kick`)**: `true` (Tạm dừng `15 phút` khi bạn vào game trên thiết bị khác)

---

## 🚀 3. Hướng Dẫn Chạy Treo 24/7 Trên GitHub Actions

1. Tạo một **Repository Private** mới trên GitHub của bạn.
2. Tải (Upload) toàn bộ các file trong bộ code này lên Repository (bao gồm cả thư mục `.github/workflows/auto.yml`, `config.json`, `runner.js`, `injected_agent.js`, `bot-payload.js`, `package.json`, `test-auth.js`, `test-telegram.js`).
3. Vào tab **Actions** trên GitHub Repository:
   - Chọn workflow **3Q Dao Dao Dao - Cloud AutoBot v3.9.32 (24/7 Farm KNB & Telegram)** ở cột bên trái.
   - Bấm nút **Run workflow** -> Nhấn **Run workflow** màu xanh lá để khởi chạy ngay lập tức!
4. Mỗi phiên trên GitHub Actions sẽ chạy liên tục **330 phút (5.5 giờ)** và tự động nối tiếp phiên mới 24/7 nhờ lịch trình `cron`.

---

## 💻 4. Chạy Trực Tiếp Trên Máy Tính (Mac / Windows)

Nếu muốn chạy trực tiếp trên máy tính (có hiển thị cửa sổ trình duyệt theo `"show_browser": true` trong `config.json`):

```bash
npm install
npm run test-auth
npm run test-telegram
npm start
```
