# Nekos

Nekos is a small Tauri desktop app for restoring protected RPG Maker MV JSON files to readable JSON.

## Desktop app

Built files:

```text
C:\dev\nekos\src-tauri\target\release\nekos.exe
C:\dev\nekos\src-tauri\target\release\bundle\nsis\Nekos_1.0.0_x64-setup.exe
C:\dev\nekos\src-tauri\target\release\bundle\msi\Nekos_1.0.0_x64_en-US.msi
```

## Development

```powershell
cd C:\dev\nekos
npm run tauri:dev
```

## Build

```powershell
cd C:\dev\nekos
npm run tauri:build
```

Paste either the game `www` folder path, the `www\data` path, or another JSON folder such as `data_decoded`.

The app can decode protected JSON, encrypt readable JSON back into `{ uid, bid, data }`, and leaves source folders untouched.

Use `Clean manager` only after the game has readable JSON in `www\data`. Nekos creates a timestamped backup of `www\js\rpg_managers.js` before replacing the protected loader with the normal RPG Maker MV JSON loader.
