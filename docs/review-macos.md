# Kết quả main-agent review — 2026-10-09

Ba sub-agents triển khai runtime/helper, platform/UI và packaging/tài liệu. Main-agent đối chiếu thay đổi với bản nguồn ban đầu, yêu cầu sửa các điểm chưa khớp rồi chạy kiểm tra tổng.

## Các điểm đã rà soát

- Đường dẫn macOS dùng quy tắc POSIX, tôn trọng `CODEX_HOME`, từ chối đường dẫn Windows bị mang sang Mac.
- Dữ liệu Electron mặc định dùng tên package `json-codex`. Main-agent đã chạy probe trên Electron thực tế và đọc metadata của bản Windows đóng gói để xác nhận `app.setName("JSON Codex")` không đổi userData đã được khởi tạo.
- Helper macOS nằm trong userData, gọi executable đã cài đặt qua đường dẫn quote an toàn; giữ lỗi của tiến trình con, không xuất token khi tiến trình thất bại. Token chỉ được dùng trong bộ test giả lập.
- Chặn Apply khi app macOS chưa nằm trong Applications; kiểm tra lifecycle và menu bằng Electron mock, không coi đây là kiểm thử native.
- Giữ ưu tiên tìm executable Windows đã có. Tìm Codex trên Mac qua PATH, login shell có timeout và các vị trí thường gặp; không nhập CODEX_HOME từ login shell.
- Tài liệu được sửa để phản ánh đúng việc login shell có thực thi startup files.
- Không di chuyển credential DPAPI sang Keychain. Không sử dụng API key thật hoặc sửa cấu hình Codex thật trong quá trình kiểm thử.

## Kiểm tra thực sự đã chạy trên Windows

| Kiểm tra | Kết quả |
| --- | --- |
| `npm test` | 52 pass, 1 skip, tổng 53 test trong 5 file |
| Test shell helper qua Git Bash | Pass: đường dẫn có khoảng trắng, dấu nháy, `$()` và backtick; stdout/CRLF; exit code; đầu ra trống |
| `npm run build:web` | TypeScript và Vite pass |
| `node --check` cho main, platform, helper và script macOS | Pass |
| Schema cấu hình qua electron-builder đã cài | Pass |
| Parse workflow YAML, config sinh ra bằng Python tomllib, entitlement bằng plistlib | Pass |
| Electron thật, helper dùng profile tạm chưa có key | Exit 1, stdout không có token, thông báo thiếu credential đúng |
| Electron thật, renderer dùng profile và CODEX_HOME tạm | Mở được, chụp ảnh và main-agent đã xem ảnh |

Test bị skip kiểm tra mode `0700` trên filesystem POSIX; nó được bật khi chạy suite trên macOS. Các test lifecycle macOS trên Windows dùng mock; kiểm tra shell bằng Git Bash không thay thế macOS `/bin/sh` thực tế.

## Chưa kiểm chứng trong phiên này

Không có máy/runner macOS được kết nối, vì vậy chưa tạo DMG, chưa chạy `npm run verify:mac`, chưa kiểm chứng Keychain thật, Gatekeeper/notarization, traffic lights/menu trên Mac hoặc kết nối 9Router thật. Workflow được chuẩn bị cho cả Apple Silicon và Intel nhưng chưa được chạy trong phiên này. Xem `macOS.md` để build và kiểm thử native.

Bản bàn giao `json-codex-macos` là mã nguồn để cài dependency và build trên Mac, không phải bộ cài DMG. Nó không chứa `node_modules`, artifact Windows hoặc credential.
