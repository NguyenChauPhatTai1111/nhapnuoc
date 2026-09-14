# Cài đặt Supabase

Supabase lưu danh sách hộ trong bảng `water_households` và lưu từng chỉ số theo tháng/năm trong bảng `water_readings`. Mỗi dòng chỉ số có mã hộ, năm, tháng, chỉ số cũ, chỉ số mới và mức tiêu thụ tự tính. Đăng nhập cùng một tài khoản trên nhiều thiết bị để dùng chung dữ liệu; IndexedDB vẫn giữ bản cục bộ dự phòng.

## Thiết lập

1. Tạo một project tại Supabase.
2. Mở **SQL Editor**, dán và chạy lại toàn bộ nội dung tệp `supabase.sql`, kể cả khi đã chạy phiên bản cũ.
3. Vào **Authentication → Users** và tạo một tài khoản quản trị bằng email/mật khẩu.
4. Trong **Project Settings → API**, sao chép Project URL và Publishable key. Nếu project cũ chưa có Publishable key, có thể dùng `anon` key.
5. Điền hai giá trị vào `supabase-config.js`:

```js
window.SUPABASE_CONFIG = Object.freeze({
  url: 'https://PROJECT_ID.supabase.co',
  publishableKey: 'SB_PUBLISHABLE_KEY'
});
```

6. Deploy lên Vercel và đăng nhập bằng tài khoản đã tạo ở bước 3. Khi thành công, góc trên màn hình hiện **Đã đồng bộ Supabase**.

Sau lần đồng bộ đầu tiên, mở **Table Editor → water_readings** để xem từng hộ/tháng. Cột `consumption` do PostgreSQL tự tính bằng `current_reading - previous_reading`, không nhập thủ công.

## An toàn

- Không bao giờ đặt `service_role` key hoặc secret key trong mã nguồn.
- Tệp SQL đã bật Row Level Security: mỗi tài khoản chỉ truy cập được dữ liệu của chính tài khoản đó.
- Nếu muốn nhiều thiết bị dùng chung một sổ, đăng nhập cùng một tài khoản quản trị trên các thiết bị đó.
- Trước lần đồng bộ đầu tiên, nên dùng **Xuất sao lưu** để giữ một bản JSON riêng.
