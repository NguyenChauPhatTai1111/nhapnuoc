# Cài đặt Supabase

Supabase lưu toàn bộ danh sách hộ và chỉ số nước theo tài khoản quản trị. Đăng nhập cùng một tài khoản trên nhiều thiết bị để dùng chung dữ liệu; IndexedDB vẫn giữ bản cục bộ dự phòng.

## Thiết lập

1. Tạo một project tại Supabase.
2. Mở **SQL Editor**, dán và chạy toàn bộ nội dung tệp `supabase.sql`.
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

## An toàn

- Không bao giờ đặt `service_role` key hoặc secret key trong mã nguồn.
- Tệp SQL đã bật Row Level Security: mỗi tài khoản chỉ truy cập được dữ liệu của chính tài khoản đó.
- Nếu muốn nhiều thiết bị dùng chung một sổ, đăng nhập cùng một tài khoản quản trị trên các thiết bị đó.
- Trước lần đồng bộ đầu tiên, nên dùng **Xuất sao lưu** để giữ một bản JSON riêng.
