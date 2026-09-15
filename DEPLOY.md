# Đưa Sổ nước lên hosting PHP/MySQL

Hosting cần có PHP 8.1 trở lên, extension `pdo_mysql`, MySQL 8/MariaDB và HTTPS. Không deploy dự án này lên dịch vụ chỉ phục vụ file tĩnh.

## 1. Giữ dữ liệu đang có trên Supabase

Trước khi thay website cũ, mở website hiện tại và bấm **Xuất sao lưu**. Giữ tệp `so-nuoc-YYYY-MM-DD.json`; sau khi website MySQL hoạt động, đăng nhập và bấm **Nhập sao lưu** để chuyển toàn bộ hộ dân/chỉ số vào MySQL.

## 2. Tạo bảng

Trong trang quản lý hosting, tạo một MySQL database và một user có toàn quyền trên database đó. Mở [`database.sql`](database.sql), thay hai chỗ `nhap_nuoc` ở đầu tệp bằng đúng tên database hosting đã cấp, rồi import tệp bằng phpMyAdmin. Nếu hosting chặn quyền `CREATE DATABASE`, xóa riêng câu lệnh `CREATE DATABASE`, chọn database trong phpMyAdmin và chạy phần còn lại.

Database có bảng `nguoi_dung` dành cho đăng nhập và chứa quan hệ dữ liệu nước:

```text
ho_dan (1) ──────< (n) chi_so_nuoc
   id                 ho_dan_id + nam + thang
```

Mỗi hộ/tháng chỉ có một dòng. Lưu lại cùng hộ/tháng sẽ chạy `UPDATE`; hộ/tháng mới sẽ chạy `INSERT`.

## 3. Cấu hình

Sao chép `config.example.php` thành `config.php` và điền host, port, tên database, user và mật khẩu do hosting cấp.

Tạo mật khẩu quản trị dạng băm trên máy có PHP:

```bash
php -r "echo password_hash('MAT_KHAU_CUA_BAN', PASSWORD_DEFAULT), PHP_EOL;"
```

Chép kết quả vào `admin_password_hash`. Không điền mật khẩu quản trị dạng chữ thường vào source.

Ở lần đăng nhập thành công đầu tiên, API tự tạo tài khoản đó trong bảng `nguoi_dung`. Các lần sau, việc đăng nhập được kiểm tra trực tiếp từ MySQL. Không xóa tài khoản cuối cùng trong bảng này nếu chưa chuẩn bị tài khoản thay thế.

## 4. Upload và kiểm tra

Upload `index.html`, `app.js`, `style.css`, `api.php`, `config.php` và `.htaccess` vào cùng thư mục public của hosting. `database.sql`, `config.example.php`, tài liệu và các tệp Node.js không bắt buộc phải upload.

Mở domain bằng HTTPS, đăng nhập và kiểm tra góc trên hiển thị **Đã kết nối MySQL**. Thử đổi tên một hộ, tải lại trang và kiểm tra trong bảng `ho_dan`; thử lưu chỉ số và kiểm tra bảng `chi_so_nuoc`.

Nếu hosting dùng Nginx hoặc không cho `.htaccess`, đặt `config.php` ra ngoài thư mục public rồi sửa đường dẫn trong `api.php`, hoặc dùng chức năng bảo vệ file của hosting.
