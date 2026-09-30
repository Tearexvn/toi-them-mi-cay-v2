# A0.1 — Vercel + Supabase

Bản này giữ giao diện và luật chơi hiện tại, chuyển lớp database từ MySQL sang PostgreSQL, đồng thời tách Express API thành entrypoint Vercel. Website Manus/main không bị thay đổi khi chỉ thử nhánh này.

## Trước khi thử

- Tạo **Supabase project riêng cho thử nghiệm**, không dùng chung database production trong lúc kiểm tra.
- Chọn region của Supabase gần region function trên Vercel. Vercel Hobby chỉ cho chọn một region; đặt hai đầu gần nhau giúp giảm độ trễ các request BXH.
- Không dán bất kỳ database password, service-role key hoặc connection string vào GitHub, issue, chat hay mã trình duyệt.
- Nhánh này chưa tự deploy hay chuyển database live. Cần credentials/project do chủ dự án quản lý.

## Tạo schema PostgreSQL

1. Copy `.env.example` thành `.env` ở máy cá nhân. Điền `DIRECT_URL` bằng connection string của Supabase lấy từ nút **Connect** trong Dashboard. Ưu tiên Direct connection; nếu mạng chỉ có IPv4, dùng Session pooler cho migrations.
2. Chạy `pnpm install` rồi `pnpm db:push`. Lệnh tạo migration PostgreSQL trong `drizzle/postgres/` và áp dụng migration vào database được chỉ bởi `DIRECT_URL`.
3. Với request runtime, dùng riêng `DATABASE_URL` từ **Transaction pooler** của Supabase (thường port `6543`). Driver đã tắt prepared statements và dùng pool rất nhỏ để phù hợp serverless. Không đưa `DATABASE_URL` vào biến `VITE_*`.

Các migration MySQL cũ vẫn được giữ nguyên trong thư mục `drizzle/` ở nhánh này để tham khảo và không được chạy lên PostgreSQL. Bộ schema mới dùng `drizzle/postgres/`.

## Chuyển điểm chơi từ MySQL cũ (không bắt buộc cho bản preview mới)

Việc này chỉ cần nếu muốn giữ tên người chơi, điểm, thành tựu và trạng thái anti-bot trên website cũ.

1. Đảm bảo schema MySQL nguồn có các cột cốt lõi (`id`, `displayName`, `nameKey`, `loginTokenHash`, `totalClicks`; và `id`, `openId` trong bảng `users`). Cột mới chưa có từ migration cũ được gán giá trị mặc định an toàn; honeypot key được cấp ngẫu nhiên.
2. Dùng một Supabase database thử nghiệm vừa tạo, đã chạy `pnpm db:push` và đang trống.
3. Điền `SOURCE_MYSQL_URL` (chỉ đọc nguồn) và `SUPABASE_DIRECT_URL` (đích direct) trong `.env` cục bộ.
4. Kiểm tra trước bằng `pnpm migrate:mysql-to-supabase -- --dry-run`.
5. Nếu số dòng hợp lý, chạy `pnpm migrate:mysql-to-supabase`. Script chỉ đọc MySQL, upsert theo ID vào Supabase, cập nhật sequence ID, và **không xóa hay sửa nguồn**. Đích không trống sẽ bị từ chối, trừ khi cố ý đặt `ALLOW_NON_EMPTY_SUPABASE=1` để tiếp tục/merge; chỉ làm vậy khi hiểu rõ khả năng ghi đè các hàng trùng ID.
6. So sánh số dòng và kiểm thử BXH trước khi đổi traffic. Giữ backup/export MySQL cho đến khi xác nhận dữ liệu đầy đủ.

## Preview trên Vercel

1. Kết nối repo GitHub `Tearexvn/toi-them-mi-cay-v2` với Vercel.
2. Giữ production branch là `main`; tạo Preview Deployment cho nhánh `manus/vercel-supabase-a0.1`.
3. Trong **Preview Environment** chỉ, đặt `DATABASE_URL` thành URL Transaction pooler của Supabase thử nghiệm. Không đặt production database cho preview.
4. Để `DIRECT_URL` trống trên Vercel. Chạy migrations từ máy cá nhân bằng secret `.env`.
5. Build command đã được cấu hình là `pnpm build:vercel`; Vite ghi asset ra root `public/`, Express API được export từ root `server.ts`.
6. Mở deployment URL, kiểm tra `/api/health`, vào game bằng một tên mới, cộng điểm từng vị, tải BXH, challenge robot và trạng thái soft-hide. Kiểm tra cả trình duyệt mobile.
7. Sau khi preview đạt, mới cân nhắc chuyển dữ liệu/domain và production variables. Không tắt website cũ trước khi có đường quay lại.

## Biến môi trường Vercel

- **Required for leaderboard:** `DATABASE_URL` (Supabase Transaction pooler, server-side only).
- **Optional for Manus owner login/moderation:** `VITE_OAUTH_PORTAL_URL`, `VITE_APP_ID`, `OAUTH_SERVER_URL`, `JWT_SECRET`, `OWNER_OPEN_ID`. Nếu không cấu hình, game công khai vẫn hoạt động; liên kết đăng nhập quản lý sẽ được ẩn.
- `DIRECT_URL`, `SOURCE_MYSQL_URL`, `SUPABASE_DIRECT_URL` chỉ dùng khi chạy migration từ máy cá nhân; không đưa vào browser.

## Ghi chú vận hành

- Vercel phục vụ `public/**` bằng CDN; Express serverless Function chỉ xử lý API. Không dùng filesystem để lưu dữ liệu game.
- Supabase Free có thể tự tạm dừng project khi database ít hoạt động trong khoảng một tuần; preview không được coi là bảo đảm uptime production.
- Nếu BXH vẫn lỗi, kiểm tra log Function và Supabase database logs; lỗi từ MySQL migrations cũ không áp dụng cho PostgreSQL mới. `/api/health` chỉ xác nhận app process trả lời, còn truy vấn leaderboard mới xác nhận database kết nối được.

## Tài liệu chính thức

- [Express trên Vercel](https://vercel.com/docs/frameworks/backend/express)
- [Kết nối PostgreSQL trên Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Cơ chế tạm dừng project miễn phí của Supabase](https://supabase.com/docs/guides/platform/free-project-pausing)
