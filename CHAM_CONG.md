# Chấm công nội bộ bằng JavaScript

Hệ thống dùng Node.js thuần, không dùng Python và không cần cài thư viện npm. Giao diện gồm `index2.html`, `appjs2.js`, `css2.css`; máy chủ là `attendance_server.js`. Tài khoản và lịch sử tiếp tục được lưu trong `attendance.sqlite3`, tách khỏi Sổ nước.

## Mở hệ thống

Yêu cầu Node.js 24 trở lên. Trong Terminal của VS Code, tại thư mục `nhapmuoc`, chạy:

```sh
npm start
```

- Trên máy chủ: mở http://localhost:8002/index2.html
- Nhân viên cùng mạng: mở http://192.168.1.170:8002/index2.html
- `192.168.1.170` là địa chỉ máy tại thời điểm cấu hình. Nếu router cấp IP mới, dùng IP mới của máy.
- Chọn **Quản lý**, nhập mã quản lý được in trong Terminal. Mã ngẫu nhiên này đổi mỗi lần khởi động; giữ riêng.
- Quản lý tạo mã nhân viên, họ tên và PIN 6–12 số. Nhân viên dùng mã/PIN để đăng nhập.
- Giữ Terminal chạy và máy chủ thức. Nhấn Ctrl+C để dừng.

Không mở HTML bằng cách nhấp đúp hoặc dùng Live Server vì thao tác chấm công phải qua máy chủ.

## Cách chấm công và tính giờ

- Khi chưa có ca mở, nút **Chấm công vào** được bật và **Check-out** bị khóa.
- Sau khi chấm công vào thành công, **Chấm công vào** bị khóa và **Check-out** được bật.
- Mốc vào/ra lấy từ đồng hồ máy chủ. Trình duyệt của nhân viên không thể tự gửi giờ chấm công.
- Dữ liệu lưu theo UTC và hiển thị theo Việt Nam `Asia/Ho_Chi_Minh` (UTC+7). Hãy bật ngày giờ tự động trên máy chủ.
- Giờ làm = `(check-out − check-in) / 3.600`. Ví dụ 08:00 đến 17:30 là **9,50 giờ**.
- Một nhân viên chỉ có một ca đang mở. Có thể có nhiều ca trong ngày.
- Ca qua nửa đêm vẫn tính liên tục và thuộc ngày/tháng check-in.
- Tổng tháng chỉ cộng ca đã check-out. Hệ thống không tự trừ nghỉ trưa và không tự đoán giờ ra.
- Quản lý xem được toàn bộ nhân viên, lọc lịch sử và tổng giờ. Nhân viên chỉ xem được lịch sử của mình.

## Bảo mật và dữ liệu lương

- PIN được băm PBKDF2 kèm salt riêng; cơ sở dữ liệu không lưu PIN gốc.
- Phiên đăng nhập dùng cookie `HttpOnly`, `SameSite=Strict`, tự hết hạn sau 12 giờ.
- Máy chủ giới hạn thử sai đăng nhập, kiểm tra nguồn yêu cầu, không tin IP hay thời gian do trình duyệt gửi lên.
- Chỉ các tệp giao diện được công khai; cơ sở dữ liệu và mã máy chủ không thể tải qua web.
- Chỉ thiết bị trong dải mạng nội bộ cấu hình mới truy cập được. Không mở cổng 8002 ra Internet.
- File cơ sở dữ liệu được đặt quyền chỉ tài khoản đang chạy máy chủ có thể đọc/ghi. Nên dừng máy chủ rồi sao lưu `attendance.sqlite3` định kỳ.
- Các ca đã lưu không có chức năng sửa/xóa trên giao diện, giúp tránh thay đổi nhầm dữ liệu tính lương.

HTTP trong mạng nội bộ không mã hóa đường truyền. Nếu phải dùng qua Internet hoặc Wi-Fi không tin cậy, cần đặt máy chủ sau HTTPS/VPN và không chuyển tiếp trực tiếp cổng 8002.

Mặc định chỉ cho phép mạng `192.168.1.0/24`. Khi đổi mạng, chạy:

```sh
node attendance_server.js --subnet 192.168.0.0/24
```

Có thể giữ cố định mã quản lý qua biến môi trường dài ít nhất 24 ký tự:

```sh
ATTENDANCE_ADMIN_KEY='mot-ma-rat-dai-va-bi-mat-o-day' npm start
```

Không ghi mã này vào mã nguồn hoặc gửi cho nhân viên.

## Kiểm thử

```sh
npm test
node --check attendance_server.js
node --check appjs2.js
```
