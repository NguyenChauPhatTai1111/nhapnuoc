# Hệ thống chấm công nội bộ

Ứng dụng dùng Node.js 24 và SQLite, không cần cài thêm thư viện. Dữ liệu nhân viên, ca làm và nhật ký quản trị nằm trong `chamcong/attendance.sqlite3`. Bản nâng cấp tự bổ sung cột mới, không xóa bảng hay lịch sử cũ; PIN PBKDF2 cũ được nâng cấp sang scrypt sau lần đăng nhập hợp lệ đầu tiên.

## Chạy trong mạng nội bộ

Từ thư mục gốc `nhapnuoc`:

```powershell
npm start
```

- Quản trị trên máy chủ: `http://localhost:8002/`
- Nhân viên: `http://IP-MAY-CHU:8002/`
- Không mở `index2.html` trực tiếp và không dùng Live Server.
- Mã quản trị là mã cố định được cấp riêng, không đổi sau khi khởi động lại và không được in ra Terminal hay lưu dạng rõ trong mã nguồn.
- Nhân viên chỉ đăng nhập/chấm công khi IP thật thuộc dải mạng đã cấu hình. `localhost` chỉ được phép quản trị, không được chấm công nhân viên.

Mặc định dải được phép là `192.168.1.0/24`. Nếu Wi-Fi công ty dùng dải khác:

```powershell
node chamcong/attendance_server.js --subnet 192.168.0.0/24
```

Hãy kiểm tra IP máy chủ bằng `ipconfig`, đặt IP tĩnh/DHCP reservation và không mở trực tiếp cổng 8002 ra Internet.

## Quy trình nhân viên và quản trị

- Quản trị tạo mã nhân viên, họ tên và PIN 8–12 chữ số; có thể đổi tên, khóa/mở tài khoản và đặt lại PIN.
- Nhân viên chỉ có thể mở một ca. Chấm ra kết thúc đúng ca đang mở; thao tác lặp bị từ chối bằng giao dịch SQLite.
- Thời gian lấy hoàn toàn từ máy chủ, lưu UTC và hiển thị theo `Asia/Ho_Chi_Minh`.
- Nhân viên chỉ xem lịch sử của mình. Quản trị xem tất cả, lọc theo tháng/nhân viên, xem IP vào/ra và nhật ký đăng nhập/thao tác.
- Khóa tài khoản hoặc đổi PIN sẽ vô hiệu hóa ngay các phiên đang đăng nhập của nhân viên đó.
- Không có sửa/xóa ca trên giao diện để tránh sửa nhầm dữ liệu chấm công.

## Sao lưu và phục hồi dữ liệu

Trước khi cập nhật hoặc sao chép dữ liệu, dừng máy chủ bằng `Ctrl+C`. Sao lưu cả tệp chính và các tệp `-wal`, `-shm` nếu chúng tồn tại, hoặc dùng bản sao lưu đã tạo trong `chamcong/backups`.

Không xóa `attendance.sqlite3`. Muốn phục hồi, dừng máy chủ, giữ lại bản hiện tại rồi sao chép bản sao lưu về đúng tên. Nên tự động sao lưu hằng ngày sang ổ đĩa khác và thử phục hồi định kỳ.

## Triển khai production

Không thể bảo đảm phần mềm “không có một lỗ hổng nào”. Cấu hình tối thiểu an toàn là:

1. Chạy sau HTTPS hoặc VPN; đặt `NODE_ENV=production` để bật cookie `Secure`.
2. Chỉ reverse proxy được phép kết nối tới Node; firewall không công khai cổng 8002.
3. Đặt đúng origin và IP proxy tin cậy, ví dụ:

```powershell
$env:NODE_ENV='production'
$env:ATTENDANCE_ORIGIN='https://chamcong.example.vn'
node chamcong/attendance_server.js --host 127.0.0.1 --subnet 203.0.113.20/32 --trusted-proxy 127.0.0.1/32
```

Proxy tin cậy phải **ghi đè**, không nối tiếp header `X-Forwarded-For` do người dùng gửi. `--subnet` phải là IP nguồn mà máy chủ thực sự nhìn thấy từ Wi-Fi công ty; với NAT thường là IP Internet tĩnh của công ty `/32`. Nếu IP công ty thay đổi, ưu tiên VPN có dải IP riêng ổn định.

Các lớp bảo vệ hiện có: scrypt kèm salt cho bí mật, so sánh constant-time, cookie HttpOnly/SameSite, CSRF token, phiên gắn với IP, CSP và các security header, giới hạn kích thước request/thời gian kết nối, rate limit đăng nhập và request, phân quyền API, nhật ký audit, truy vấn tham số hóa và giao dịch SQLite.

## Kiểm thử

```powershell
npm test
node --check chamcong/attendance_server.js
node --check chamcong/appjs2.js
```
