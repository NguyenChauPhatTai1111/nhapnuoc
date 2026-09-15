# Triển khai an toàn

Ứng dụng chỉ phục vụ ba tài nguyên tĩnh trong whitelist và lưu dữ liệu tại trình duyệt của từng thiết bị. Không có tài khoản, API hay cơ sở dữ liệu trung tâm.

## Production

1. Dùng Node.js 24 trở lên và chạy `npm start`. Server mặc định chỉ nghe tại `127.0.0.1:3000`.
2. Đặt server sau reverse proxy/CDN có HTTPS hợp lệ. Chỉ proxy đến cổng nội bộ; không mở trực tiếp cổng Node ra Internet.
3. Nếu reverse proxy nằm trong container hoặc máy khác, đặt `HOST=0.0.0.0` và khóa cổng bằng firewall/security group để chỉ proxy truy cập được.
4. Có thể đặt `PORT` và `RATE_LIMIT` (10–10.000 request/phút/IP). Reverse proxy cũng cần rate limit vì server cố ý không tin header `X-Forwarded-For` do client gửi.
5. Không nới CSP hoặc thêm script/CDN bên ngoài nếu chưa đánh giá lại XSS và quyền riêng tư.

Ví dụ PowerShell để kiểm thử nội bộ:

```powershell
$env:PORT = '3000'
npm.cmd start
```

Chạy `npm.cmd test` trước mỗi lần triển khai.

## Giới hạn mô hình bảo mật

Dữ liệu và thông tin đăng nhập cố định trong mã nguồn không phải kho bí mật: người có quyền truy cập thiết bị, mã nguồn hoặc hồ sơ trình duyệt vẫn có thể đọc dữ liệu. Khi dùng chung máy, hãy bảo vệ tài khoản hệ điều hành, bật mã hóa ổ đĩa và khóa màn hình. HTTPS là bắt buộc khi đưa ứng dụng lên mạng.
