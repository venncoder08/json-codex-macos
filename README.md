# JSON Codex

Ứng dụng desktop cấu hình Codex CLI và Codex IDE extension để dùng 9Router mà không yêu cầu nhập API key trong terminal.

## Tính năng

- Nhập API key bằng ô mật khẩu trong GUI.
- Mã hóa key bằng Electron `safeStorage` (DPAPI trên Windows, Keychain trên macOS).
- Fetch model từ endpoint OpenAI-compatible `/v1/models`.
- Chỉ giữ model `cx/*` và loại toàn bộ alias chứa `[1m]`.
- Tạo `9router-model-catalog.json` và cập nhật user-level `config.toml`.
- Dùng command-backed credential helper thay cho key plaintext hoặc `env_key`.
- Backup config/catalog trước khi apply và hỗ trợ rollback.
- Cấu hình dùng chung cho Codex CLI, VS Code extension và VS Code terminal.

## Bảo mật

API key không được ghi vào `config.toml`, model catalog, log hoặc command line. File cấu hình chỉ trỏ tới credential helper cục bộ:

```toml
[model_providers."9router".auth]
command = "<absolute path to print-token.cmd or print-token.sh>"
args = ["--json-codex-print-token"]
```

Khi Codex cần xác thực, helper gọi ứng dụng đã cài đặt ở chế độ không mở cửa sổ, giải mã key bằng kho bảo mật của hệ điều hành, ghi token vào stdout rồi thoát. Không chạy helper thủ công để tránh hiển thị key trong terminal.

## Phát triển

Dùng Node.js 24 LTS; các dependency hiện tại yêu cầu tối thiểu Node.js 22.12.0 nếu dùng nhánh 22. Cài dependency đúng lockfile bằng `npm ci`.

```powershell
npm ci
npm test
npm run build:web
npm run dev
```

## Build Windows

```powershell
npm run build:win
```

Artifact: `release/json-codex-window.exe`.

## Build macOS

Build macOS phải chạy trên máy hoặc runner macOS:

```bash
npm ci
npm run build:mac
```

Artifact mặc định: `release/json-codex-macos-universal.dmg`, chứa cả Apple Silicon và Intel. Có thể build riêng bằng `npm run build:mac:arm64` hoặc `npm run build:mac:x64`, tạo DMG có hậu tố kiến trúc tương ứng.

Mở DMG, kéo `JSON Codex.app` vào `/Applications`, rồi mở bản đã cài đặt trước khi Apply. Không Apply trực tiếp trong DMG hoặc Downloads. Khi chuyển từ Windows sang Mac, nhập lại API key trong GUI; không chép `credential.bin` đã mã hóa bằng DPAPI sang Mac.

Xem [hướng dẫn macOS](docs/macOS.md) để biết mapping đường dẫn, Keychain, `CODEX_HOME`, cách tìm Codex CLI, build và kiểm thử native. CI tạo bản ad-hoc phục vụ kiểm thử; đó không phải bản phát hành đã được Apple notarize.

Để phát hành công khai, cấu hình chứng chỉ Authenticode cho Windows và Developer ID/notarization cho macOS trong môi trường build phát hành riêng; workflow hiện tại tạo artifact kiểm thử và không tự sử dụng signing secrets.

## Vị trí được cập nhật

- Windows: `%USERPROFILE%\.codex\config.toml`
- macOS: `$HOME/.codex/config.toml`
- Catalog: `<CODEX_HOME>/9router-model-catalog.json`
- Backup: `<CODEX_HOME>/json-codex-backups/<timestamp>/`

Ứng dụng không xóa key cũ khỏi `.codex/.env`. Sau khi xác nhận cấu hình mới hoạt động, người dùng có thể tự loại bỏ biến `NINEROUTER_API_KEY` cũ.

## Tài liệu

- [Codex config basics](https://learn.chatgpt.com/docs/config-file/config-basic)
- [Custom model providers](https://learn.chatgpt.com/docs/config-file/config-advanced#custom-model-providers)
- [Codex IDE settings](https://learn.chatgpt.com/docs/developer-settings?surface=ide)
- [Gateway compatibility](https://learn.chatgpt.com/docs/enterprise/gateway-compatibility)
