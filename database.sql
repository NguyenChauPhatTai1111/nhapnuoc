-- CÀI ĐẶT LOCAL: có thể chạy nguyên tệp này trong MySQL Workbench.
-- KHI DÙNG HOSTING: hosting thường cấp tên database có tiền tố riêng.
-- Hãy thay cả hai chữ `nhap_nuoc` bên dưới bằng đúng tên database được cấp.
-- Nếu hosting không cho phép CREATE DATABASE, hãy xóa lệnh CREATE DATABASE,
-- chọn database trong phpMyAdmin rồi giữ lại lệnh USE với đúng tên database.

CREATE DATABASE IF NOT EXISTS nhap_nuoc
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE nhap_nuoc;

-- Tên bảng không dấu giúp tương thích tốt với mọi hosting.

CREATE TABLE IF NOT EXISTS nguoi_dung (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    ten_dang_nhap VARCHAR(100) NOT NULL,
    mat_khau_hash VARCHAR(255) NOT NULL,
    dang_hoat_dong TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_nguoi_dung_ten_dang_nhap (ten_dang_nhap)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ho_dan (
    id INT UNSIGNED NOT NULL,
    ten_ho VARCHAR(100) NOT NULL,
    dang_hoat_dong TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT chk_ho_dan_ten CHECK (CHAR_LENGTH(TRIM(ten_ho)) BETWEEN 1 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chi_so_nuoc (
    ho_dan_id INT UNSIGNED NOT NULL,
    nam SMALLINT UNSIGNED NOT NULL,
    thang TINYINT UNSIGNED NOT NULL,
    chi_so_cu DECIMAL(16,3) NOT NULL,
    chi_so_moi DECIMAL(16,3) NOT NULL,
    thang_bat_dau CHAR(7) NULL,
    tien_no BIGINT UNSIGNED NOT NULL DEFAULT 0,
    ghi_chu VARCHAR(1000) NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (ho_dan_id, nam, thang),
    KEY idx_chi_so_ky (nam, thang),
    CONSTRAINT fk_chi_so_ho_dan FOREIGN KEY (ho_dan_id) REFERENCES ho_dan(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_chi_so_thang CHECK (thang BETWEEN 1 AND 12),
    CONSTRAINT chk_chi_so_hop_le CHECK (chi_so_cu >= 0 AND chi_so_moi >= chi_so_cu),
    CONSTRAINT chk_chi_so_thang_bat_dau CHECK (
        thang_bat_dau IS NULL OR thang_bat_dau REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tạo sẵn 200 hộ dân. INSERT IGNORE giúp chạy lại file mà không ghi đè
-- những tên hộ bạn đã sửa. Bảng chi_so_nuoc vẫn hoàn toàn trống.
INSERT IGNORE INTO ho_dan (id, ten_ho, dang_hoat_dong)
WITH RECURSIVE danh_sach_ho AS (
    SELECT 1 AS id
    UNION ALL
    SELECT id + 1 FROM danh_sach_ho WHERE id < 200
)
SELECT id, CONCAT('Hộ dân ', LPAD(id, 3, '0')), 1
FROM danh_sach_ho;
