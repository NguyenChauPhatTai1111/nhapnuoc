<?php
declare(strict_types=1);

const MAX_BODY_BYTES = 6 * 1024 * 1024;
const MAX_MUTATIONS = 260000;

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

session_set_cookie_params([
    'httponly' => true,
    'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
    'samesite' => 'Strict',
    'path' => '/',
]);
session_start();

function respond(int $status, array $data): never
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function body(): array
{
    $length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > MAX_BODY_BYTES) respond(413, ['error' => 'Dữ liệu gửi lên quá lớn.']);
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > MAX_BODY_BYTES) respond(413, ['error' => 'Dữ liệu gửi lên quá lớn.']);
    $value = json_decode($raw, true);
    if (!is_array($value)) respond(400, ['error' => 'Nội dung JSON không hợp lệ.']);
    return $value;
}

function config(): array
{
    $path = __DIR__ . '/config.php';
    if (!is_file($path)) respond(503, ['error' => 'Máy chủ chưa có config.php. Hãy sao chép config.example.php và điền cấu hình.']);
    $value = require $path;
    if (!is_array($value)) respond(500, ['error' => 'config.php không hợp lệ.']);
    foreach (['db_host', 'db_name', 'db_user', 'admin_username', 'admin_password_hash'] as $key) {
        if (!isset($value[$key]) || !is_string($value[$key]) || $value[$key] === '') {
            respond(500, ['error' => "Thiếu cấu hình {$key}."]);
        }
    }
    // MySQL local (ví dụ Laragon) có thể dùng mật khẩu rỗng.
    if (!array_key_exists('db_password', $value) || !is_string($value['db_password'])) {
        respond(500, ['error' => 'Thiếu cấu hình db_password.']);
    }
    return $value;
}

function database(array $config): PDO
{
    try {
        return new PDO(
            sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $config['db_host'], (int) ($config['db_port'] ?? 3306), $config['db_name']),
            $config['db_user'],
            $config['db_password'],
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );
    } catch (PDOException $error) {
        error_log('MySQL connection failed: ' . $error->getMessage());
        respond(503, ['error' => 'Không kết nối được cơ sở dữ liệu MySQL.']);
    }
}

function authenticated(): bool
{
    return isset($_SESSION['authenticated']) && $_SESSION['authenticated'] === true;
}

function require_auth(): void
{
    if (!authenticated()) respond(401, ['error' => 'Phiên đăng nhập đã hết hạn.']);
}

function csrf(): string
{
    if (!isset($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
    return $_SESSION['csrf'];
}

function require_csrf(): void
{
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($sent) || !hash_equals(csrf(), $sent)) respond(403, ['error' => 'Yêu cầu bảo mật không hợp lệ. Hãy tải lại trang.']);
}

function positive_id(mixed $value): int
{
    if ((is_int($value) || is_string($value)) && preg_match('/^[1-9][0-9]*$/', (string) $value)) {
        $id = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 4294967295]]);
        if ($id !== false) return (int) $id;
    }
    throw new InvalidArgumentException('Mã hộ không hợp lệ.');
}

function period(mixed $value): array
{
    if (!is_string($value) || !preg_match('/^([1-9][0-9]{3})-(0[1-9]|1[0-2])$/', $value, $parts)) {
        throw new InvalidArgumentException('Kỳ ghi không hợp lệ.');
    }
    return [(int) $parts[1], (int) $parts[2]];
}

function finite_number(mixed $value, string $label, float $max = 1000000000000): float
{
    if (!is_int($value) && !is_float($value) && !is_string($value)) throw new InvalidArgumentException("{$label} không hợp lệ.");
    if (!is_numeric($value)) throw new InvalidArgumentException("{$label} không hợp lệ.");
    $number = (float) $value;
    if (!is_finite($number) || $number < 0 || $number > $max) throw new InvalidArgumentException("{$label} không hợp lệ.");
    return $number;
}

function text_length(string $value): int
{
    return function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
}

function read_state(PDO $db): array
{
    $households = [];
    foreach ($db->query('SELECT id, ten_ho, dang_hoat_dong FROM ho_dan ORDER BY id') as $row) {
        $households[(string) $row['id']] = ['name' => $row['ten_ho'], 'active' => (bool) $row['dang_hoat_dong']];
    }
    $records = [];
    $sql = 'SELECT ho_dan_id, nam, thang, chi_so_cu, chi_so_moi, thang_bat_dau, tien_no, ghi_chu FROM chi_so_nuoc ORDER BY nam, thang, ho_dan_id';
    foreach ($db->query($sql) as $row) {
        $key = sprintf('%04d-%02d', $row['nam'], $row['thang']);
        $record = [
            'previous' => (float) $row['chi_so_cu'],
            'current' => (float) $row['chi_so_moi'],
            'debt' => (int) $row['tien_no'],
            'note' => $row['ghi_chu'],
        ];
        if ($row['thang_bat_dau'] !== null && $row['thang_bat_dau'] !== $key) $record['startMonth'] = $row['thang_bat_dau'];
        $records[$key][(string) $row['ho_dan_id']] = $record;
    }
    // Hai trường này là bản đồ khóa theo mã hộ/kỳ ghi. Ép sang object để khi
    // bảng rỗng JSON vẫn trả về `{}` thay vì `[]`, đúng với hợp đồng phía client.
    return ['version' => 1, 'households' => (object) $households, 'records' => (object) $records];
}

function apply_mutations(PDO $db, array $mutations): void
{
    if (count($mutations) > MAX_MUTATIONS) throw new InvalidArgumentException('Có quá nhiều thay đổi trong một lần lưu.');
    $householdUpsert = $db->prepare(
        'INSERT INTO ho_dan (id, ten_ho, dang_hoat_dong) VALUES (?, ?, ?) '
        . 'ON DUPLICATE KEY UPDATE ten_ho = VALUES(ten_ho), dang_hoat_dong = VALUES(dang_hoat_dong)'
    );
    $householdDelete = $db->prepare('DELETE FROM ho_dan WHERE id = ?');
    $readingUpsert = $db->prepare(
        'INSERT INTO chi_so_nuoc (ho_dan_id, nam, thang, chi_so_cu, chi_so_moi, thang_bat_dau, tien_no, ghi_chu) '
        . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE '
        . 'chi_so_cu = VALUES(chi_so_cu), chi_so_moi = VALUES(chi_so_moi), thang_bat_dau = VALUES(thang_bat_dau), '
        . 'tien_no = VALUES(tien_no), ghi_chu = VALUES(ghi_chu)'
    );
    $readingDelete = $db->prepare('DELETE FROM chi_so_nuoc WHERE ho_dan_id = ? AND nam = ? AND thang = ?');

    // Khóa ngoại yêu cầu thêm hộ trước, xóa chỉ số trước khi xóa hộ.
    foreach ($mutations as $mutation) {
        if (!is_array($mutation) || ($mutation['type'] ?? '') !== 'household_upsert') continue;
        $id = positive_id($mutation['id'] ?? null);
        $name = trim((string) ($mutation['name'] ?? ''));
        if ($name === '' || text_length($name) > 100 || !is_bool($mutation['active'] ?? null)) throw new InvalidArgumentException("Thông tin hộ {$id} không hợp lệ.");
        $householdUpsert->execute([$id, $name, $mutation['active'] ? 1 : 0]);
    }
    foreach ($mutations as $mutation) {
        if (!is_array($mutation) || ($mutation['type'] ?? '') !== 'reading_delete') continue;
        $id = positive_id($mutation['householdId'] ?? null);
        [$year, $month] = period($mutation['period'] ?? null);
        $readingDelete->execute([$id, $year, $month]);
    }
    foreach ($mutations as $mutation) {
        if (!is_array($mutation) || ($mutation['type'] ?? '') !== 'reading_upsert') continue;
        $id = positive_id($mutation['householdId'] ?? null);
        [$year, $month] = period($mutation['period'] ?? null);
        $previous = finite_number($mutation['previous'] ?? null, 'Chỉ số cũ');
        $current = finite_number($mutation['current'] ?? null, 'Chỉ số mới');
        if ($current < $previous) throw new InvalidArgumentException('Chỉ số mới không được nhỏ hơn chỉ số cũ.');
        $start = $mutation['startMonth'] ?? null;
        if ($start !== null && $start !== '') {
            period($start);
            if ($start > $mutation['period']) throw new InvalidArgumentException('Tháng bắt đầu không hợp lệ.');
        } else $start = null;
        $debt = finite_number($mutation['debt'] ?? 0, 'Tiền nợ');
        if (floor($debt) !== $debt) throw new InvalidArgumentException('Tiền nợ phải là số nguyên.');
        $note = (string) ($mutation['note'] ?? '');
        if (text_length($note) > 1000) throw new InvalidArgumentException('Ghi chú tối đa 1.000 ký tự.');
        $readingUpsert->execute([$id, $year, $month, $previous, $current, $start, (int) $debt, $note]);
    }
    foreach ($mutations as $mutation) {
        if (!is_array($mutation) || ($mutation['type'] ?? '') !== 'household_delete') continue;
        $householdDelete->execute([positive_id($mutation['id'] ?? null)]);
    }
    $known = ['household_upsert', 'household_delete', 'reading_upsert', 'reading_delete'];
    foreach ($mutations as $mutation) {
        if (!is_array($mutation) || !in_array($mutation['type'] ?? '', $known, true)) throw new InvalidArgumentException('Loại thay đổi không hợp lệ.');
    }
}

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$config = config();

if ($action === 'session' && $method === 'GET') {
    respond(200, ['authenticated' => authenticated(), 'csrfToken' => authenticated() ? csrf() : null]);
}
if ($action === 'login' && $method === 'POST') {
    $input = body();
    $username = (string) ($input['username'] ?? '');
    $password = (string) ($input['password'] ?? '');
    $db = database($config);
    try {
        $statement = $db->prepare('SELECT id, ten_dang_nhap, mat_khau_hash, dang_hoat_dong FROM nguoi_dung WHERE ten_dang_nhap = ? LIMIT 1');
        $statement->execute([$username]);
        $user = $statement->fetch();

        // Lần chạy đầu tiên: tạo quản trị viên từ config.php nếu bảng chưa có tài khoản.
        if (!$user && hash_equals($config['admin_username'], $username)) {
            $count = (int) $db->query('SELECT COUNT(*) FROM nguoi_dung')->fetchColumn();
            if ($count === 0 && password_verify($password, $config['admin_password_hash'])) {
                $insert = $db->prepare('INSERT INTO nguoi_dung (ten_dang_nhap, mat_khau_hash, dang_hoat_dong) VALUES (?, ?, 1)');
                $insert->execute([$config['admin_username'], $config['admin_password_hash']]);
                $user = [
                    'id' => (int) $db->lastInsertId(),
                    'ten_dang_nhap' => $config['admin_username'],
                    'mat_khau_hash' => $config['admin_password_hash'],
                    'dang_hoat_dong' => 1,
                ];
            }
        }
    } catch (PDOException $error) {
        error_log('User login query failed: ' . $error->getMessage());
        respond(500, ['error' => 'Không đọc được bảng người dùng. Hãy chạy lại database.sql.']);
    }
    if (!$user || !(bool) $user['dang_hoat_dong'] || !password_verify($password, $user['mat_khau_hash'])) {
        usleep(250000);
        respond(401, ['error' => 'Tên đăng nhập hoặc mật khẩu chưa đúng.']);
    }
    session_regenerate_id(true);
    $_SESSION['authenticated'] = true;
    $_SESSION['user_id'] = (int) $user['id'];
    $_SESSION['username'] = $user['ten_dang_nhap'];
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
    respond(200, ['authenticated' => true, 'csrfToken' => $_SESSION['csrf']]);
}
if ($action === 'logout' && $method === 'POST') {
    require_auth();
    require_csrf();
    $_SESSION = [];
    session_destroy();
    respond(200, ['ok' => true]);
}

require_auth();
$db = database($config);

if ($action === 'state' && $method === 'GET') respond(200, read_state($db));
if ($action === 'mutations' && $method === 'POST') {
    require_csrf();
    $input = body();
    $mutations = $input['mutations'] ?? null;
    if (!is_array($mutations)) respond(400, ['error' => 'Danh sách thay đổi không hợp lệ.']);
    try {
        $db->beginTransaction();
        apply_mutations($db, $mutations);
        $db->commit();
        respond(200, ['ok' => true]);
    } catch (InvalidArgumentException $error) {
        if ($db->inTransaction()) $db->rollBack();
        respond(422, ['error' => $error->getMessage()]);
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('MySQL mutation failed: ' . $error->getMessage());
        respond(500, ['error' => 'Không thể lưu thay đổi vào MySQL.']);
    }
}

header('Allow: GET, POST');
respond(404, ['error' => 'API không tồn tại.']);
