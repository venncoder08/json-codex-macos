# JSON Codex trên macOS

## Mapping từ Windows

| Thành phần | Windows | macOS |
| --- | --- | --- |
| Bộ cài | `json-codex-window.exe` (NSIS) | `json-codex-macos-universal.dmg` |
| Ứng dụng | `JSON Codex.exe` trong thư mục cài đặt | `/Applications/JSON Codex.app` |
| Executable trong bundle | File `.exe` | `/Applications/JSON Codex.app/Contents/MacOS/JSON Codex` |
| Cấu hình mặc định | `%USERPROFILE%\.codex\config.toml` | `$HOME/.codex/config.toml` |
| Dữ liệu ứng dụng mặc định | `%APPDATA%\json-codex` | `$HOME/Library/Application Support/json-codex` |
| Credential đã mã hóa | `credential.bin`, bảo vệ bằng DPAPI | `credential.bin`, bảo vệ bằng Electron `safeStorage` và macOS Keychain |
| Credential helper | `print-token.cmd` trong dữ liệu ứng dụng | `print-token.sh` trong dữ liệu ứng dụng |
| Shell | Command Prompt cho wrapper Windows | `/bin/sh` cho wrapper macOS |
| CLI thường gặp | `codex.exe` / `codex.cmd` trên PATH | `codex` trên PATH, `/opt/homebrew/bin`, `/usr/local/bin`, `$HOME/.local/bin` |

Ứng dụng dùng đường dẫn thực tế do Electron `app.getPath("userData")` cung cấp; mặc định dựa trên tên package `json-codex`, không dựa trên tên hiển thị `JSON Codex`. Switch `--user-data-dir` có thể thay đổi thư mục này khi kiểm thử.

`CODEX_HOME`, khi có trong môi trường của tiến trình, thay thế `$HOME/.codex`. Catalog nằm ở `<CODEX_HOME>/9router-model-catalog.json`; backup nằm ở `<CODEX_HOME>/json-codex-backups/<timestamp>/`. Không đưa đường dẫn `C:\...`, `%APPDATA%` hoặc wrapper `.cmd` vào cấu hình trên Mac. JSON Codex ghi đường dẫn tuyệt đối và giữ nguyên khoảng trắng trong đường dẫn.

`credential.bin` chứa ciphertext, không phải mục Keychain có thể tự chép giữa hệ điều hành. Keychain bảo vệ khóa dùng để giải mã dữ liệu của ứng dụng. Khi chuyển máy/hệ điều hành, cài ứng dụng trên Mac rồi nhập lại API key trong GUI. Không sao chép kho DPAPI của Windows hoặc ghi key vào terminal/config. Không chạy helper trực tiếp vì chức năng của nó là xuất token ra stdout cho Codex.

## Cài đặt và cấu hình

1. Mở DMG và kéo `JSON Codex.app` vào `/Applications` (hoặc `~/Applications` nếu cài cho riêng người dùng).
2. Eject DMG, mở ứng dụng từ thư mục Applications. macOS có thể yêu cầu quyền truy cập Keychain khi lưu hoặc dùng key; xử lý yêu cầu trong phiên đăng nhập của chính người dùng.
3. Kiểm tra đường dẫn config hiển thị, địa chỉ 9Router và trạng thái Codex CLI. 9Router cần chạy hoặc truy cập được từ Mac; `localhost` luôn chỉ máy Mac đang chạy ứng dụng, không chỉ PC cũ.
4. Nhập key trong GUI, fetch model, xem preview rồi Apply. Mở lại phiên Codex/IDE để nạp cấu hình.

Ứng dụng chặn Apply nếu đang chạy trong DMG, App Translocation hoặc ngoài Applications để tránh lưu đường dẫn helper tới vị trí tạm. Nếu đổi vị trí hoặc tên bundle sau khi cấu hình, mở lại ứng dụng tại vị trí hợp lệ rồi Apply lại. Đóng cửa sổ trên macOS giữ ứng dụng chạy; dùng `Cmd+Q` để thoát.

Không tự ghi đè `config.toml` của Mac bằng bản Windows vì các đường dẫn catalog/helper khác nhau. Có thể chuyển riêng các lựa chọn không phụ thuộc nền tảng sau khi kiểm tra. Backup/rollback chỉ phục hồi config và catalog; không chuyển đổi hay phục hồi API key đã mã hóa. Ứng dụng không tự xóa key cũ trong `.env`/`auth.json`/biến môi trường; kiểm tra cảnh báo và tự loại bỏ nguồn key cũ sau khi cấu hình mới hoạt động.

## Finder, Terminal và Codex CLI

Ứng dụng mở qua Finder không nhất thiết nhận `PATH` hoặc `CODEX_HOME` được khai báo trong `.zshrc`. App tìm executable trên PATH của chính tiến trình, PATH khôi phục từ shell và các vị trí macOS thường gặp; Apple Silicon thường dùng Homebrew ở `/opt/homebrew`, Intel thường dùng `/usr/local`.

Để nhận CLI cài qua nvm/asdf/mise, app chạy login shell ở chế độ interactive với một lệnh cố định chỉ lấy `PATH`. Các startup file của shell có thể chạy trong bước này. Thao tác có timeout 2,5 giây; nếu lỗi hoặc hết thời gian, app vẫn tìm theo PATH hiện có và các thư mục phổ biến. App chỉ nhận PATH từ kết quả đó, không nhập `CODEX_HOME` hay secret từ shell vào môi trường ứng dụng.

Nếu dùng một `CODEX_HOME` riêng hoặc Codex trong thư mục nvm/custom prefix, thoát JSON Codex trước rồi chạy executable từ Terminal đang có môi trường tương ứng:

```sh
CODEX_HOME="$HOME/my-codex-home" "/Applications/JSON Codex.app/Contents/MacOS/JSON Codex"
```

Lệnh trên chỉ truyền đường dẫn, không truyền API key. Đảm bảo Codex CLI và IDE cũng nhận cùng `CODEX_HOME`; kiểm tra đường dẫn hiển thị trong GUI trước Apply. Việc mở ứng dụng bằng Finder không tự cài Codex CLI; bước khôi phục PATH không thay thế việc truyền `CODEX_HOME` cho đúng tiến trình.

## Build

Build trên macOS, dùng Node.js 24 LTS và Xcode Command Line Tools. Node.js nhánh 22 cần từ 22.12.0 trở lên theo engines của Electron/Vite/Vitest đang khóa trong repo.

```sh
npm ci
npm test
npm run build:mac
```

| Script | Kiến trúc | Artifact |
| --- | --- | --- |
| `npm run build:mac` | Universal (`arm64` + `x86_64`) | `release/json-codex-macos-universal.dmg` |
| `npm run build:mac:arm64` | Apple Silicon | `release/json-codex-macos-arm64.dmg` |
| `npm run build:mac:x64` | Intel | `release/json-codex-macos-x64.dmg` |

Mỗi kiến trúc có tên riêng để không ghi đè artifact của kiến trúc khác. App kế thừa yêu cầu macOS tối thiểu từ Electron được đóng gói; dự án không hạ `LSMinimumSystemVersion` bằng một giá trị đoán. `npm run verify:mac` đọc và in giá trị thực tế từ bundle. Universal chỉ xác nhận hai kiến trúc, không tự bảo đảm mọi phiên bản macOS đều tương thích.

## Chữ ký và notarization

Bản phát hành công khai cần Developer ID Application và Apple notarization. Build mặc định bật Hardened Runtime và dùng entitlement `com.apple.security.cs.allow-jit` cho Electron/V8. Không thêm quyền camera, microphone, location hay tắt library validation vào bản phát hành này.

electron-builder nhận chứng chỉ qua `CSC_LINK` (đường dẫn hoặc dữ liệu chứng chỉ theo định dạng builder hỗ trợ) và `CSC_KEY_PASSWORD`, hoặc một Developer ID đã cài trong Keychain. Notarization tự chạy khi cung cấp đủ một bộ biến môi trường:

- `APPLE_API_KEY` (đường dẫn file `.p8`), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.
- Hoặc `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- Hoặc `APPLE_KEYCHAIN_PROFILE` và tùy chọn `APPLE_KEYCHAIN` theo cấu hình keychain của môi trường build.

Đưa các giá trị đó qua secret manager/môi trường build riêng; không ghi vào repository, script hay log. Sau khi nạp môi trường, chạy `npm run build:mac`, rồi kiểm tra app bằng `codesign --verify --deep --strict`, `spctl --assess --type execute` và `xcrun stapler validate` trên bundle/DMG phù hợp. Kiểm tra Gatekeeper trên một máy nhận bản tải xuống thực tế trước khi phát hành.

CI hiện cố ý không dùng chứng chỉ hoặc secrets. Nó build ad-hoc với:

```sh
npm run build:mac -- -c.mac.identity=- -c.mac.hardenedRuntime=false
```

Chữ ký ad-hoc dùng cho kiểm thử cục bộ, không xác nhận nhà phát hành và không phải notarization. Artifact CI có thể bị Gatekeeper chặn khi tải xuống. Cần bản Developer ID đã notarize để phân phối thông thường; không tắt Gatekeeper hoặc xóa quarantine hàng loạt. `gatekeeperAssess: false` trong cấu hình builder chỉ bỏ bước đánh giá của công cụ trong lúc ký, không tắt Gatekeeper của macOS.

## Kiểm thử và giới hạn

Workflow CI được cấu hình để chạy unit tests, build Universal và `npm run verify:mac` trên cả runner Apple Silicon (`macos-15`) và Intel (`macos-15-intel`). Script kiểm tra `app.asar`, kiến trúc của executable/framework/helper bundle bằng `lipo`, xác minh chữ ký và chạy hai smoke test: helper trả lỗi khi chưa có credential, tiến trình GUI sống qua 5 giây khởi động. HOME, CODEX_HOME và userData đều được cô lập vào thư mục tạm; không cần key thật và không thử giải mã Keychain. Cần xem kết quả thực tế của workflow để xác nhận các kiểm tra native đã pass.

Với build riêng kiến trúc, truyền bundle và kiến trúc tương ứng, ví dụ:

```sh
node scripts/verify-macos.mjs "release/mac-arm64/JSON Codex.app" arm64
node scripts/verify-macos.mjs "release/mac/JSON Codex.app" x64
```

Smoke test tiến trình không thay thế kiểm thử giao diện hoặc Keychain. Trước khi phát hành, kiểm tra trên Mac thật: cài vào Applications, mở bằng Finder, titlebar/menu/phím tắt, lưu credential trong Keychain, helper qua Codex không hiện cửa sổ và không lẫn thông báo vào token, Apply/rollback, restart app/IDE, cùng môi trường CODEX_HOME và trường hợp người dùng từ chối Keychain. Không có test native macOS nào được coi là đã chạy chỉ vì unit tests/build web thành công trên Windows.

Nguồn kỹ thuật: cấu hình `MacConfiguration` của electron-builder cài trong lockfile (`node_modules/app-builder-lib/out/options/macOptions.d.ts`), entitlement của `@electron/osx-sign`, Info.plist từ Electron thực tế đóng gói, và danh sách runner chính thức của GitHub Actions (`actions/runner-images`).
