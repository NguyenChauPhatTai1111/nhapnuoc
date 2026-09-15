<?php
declare(strict_types=1);

// Sao chép tệp này thành config.php rồi điền thông tin do hosting cung cấp.
// Tạo mật khẩu băm bằng lệnh:
// php -r "echo password_hash('MAT_KHAU_CUA_BAN', PASSWORD_DEFAULT), PHP_EOL;"
return [
    'db_host' => 'localhost',
    'db_port' => 3306,
    'db_name' => 'TEN_DATABASE_TREN_HOSTING',
    'db_user' => 'TEN_USER_DATABASE',
    'db_password' => 'MAT_KHAU_DATABASE',
    'admin_username' => 'admin',
    'admin_password_hash' => 'DAN_GIA_TRI_PASSWORD_HASH_VAO_DAY',
];

