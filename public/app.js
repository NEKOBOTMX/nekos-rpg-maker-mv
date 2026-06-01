const translations = {
  es: {
    eyebrow: "RPG Maker MV",
    kicker: "Decodificador local",
    title: "Devuelve tus JSON a formato legible",
    ready: "Listo",
    busy: "Trabajando",
    pathTitle: "Carpeta del juego",
    pathHint: "Pega la ruta del directorio www o directamente la carpeta data.",
    sourcePath: "Ruta origen",
    outputName: "Carpeta de salida",
    scan: "Escanear",
    decode: "Decodificar",
    encrypt: "Encriptar",
    patchManager: "Limpiar manager",
    managerTitle: "rpg_managers.js",
    managerHint: "Quita el loader protegido y restaura la carga normal de JSON. Usa esto despues de poner JSON legibles en www/data.",
    summary: "Resumen",
    files: "Archivos",
    wrapped: "Protegidos",
    plain: "Planos",
    errors: "Errores",
    activity: "Actividad",
    preview: "Vista previa",
    noActivity: "Aun no hay actividad.",
    noPreview: "Escanea una carpeta para ver ejemplos.",
    scanning: "Escaneando carpeta...",
    decoding: "Decodificando archivos...",
    encrypting: "Encriptando archivos...",
    patching: "Limpiando rpg_managers.js...",
    scanDone: "Escaneo completo.",
    decodeDone: "Decodificacion completa.",
    encryptDone: "Encriptacion completa.",
    patchDone: "Manager limpio.",
    unchanged: "Sin cambios",
    backup: "Backup",
    output: "Salida",
    error: "Error"
  },
  en: {
    eyebrow: "RPG Maker MV",
    kicker: "Local decoder",
    title: "Restore your JSON files to readable form",
    ready: "Ready",
    busy: "Working",
    pathTitle: "Game folder",
    pathHint: "Paste the www directory path or the data folder directly.",
    sourcePath: "Source path",
    outputName: "Output folder",
    scan: "Scan",
    decode: "Decode",
    encrypt: "Encrypt",
    patchManager: "Clean manager",
    managerTitle: "rpg_managers.js",
    managerHint: "Removes the protected loader and restores normal JSON loading. Use this after placing readable JSON in www/data.",
    summary: "Summary",
    files: "Files",
    wrapped: "Wrapped",
    plain: "Plain",
    errors: "Errors",
    activity: "Activity",
    preview: "Preview",
    noActivity: "No activity yet.",
    noPreview: "Scan a folder to see examples.",
    scanning: "Scanning folder...",
    decoding: "Decoding files...",
    encrypting: "Encrypting files...",
    patching: "Cleaning rpg_managers.js...",
    scanDone: "Scan complete.",
    decodeDone: "Decode complete.",
    encryptDone: "Encrypt complete.",
    patchDone: "Manager cleaned.",
    unchanged: "Unchanged",
    backup: "Backup",
    output: "Output",
    error: "Error"
  },
  ja: {
    eyebrow: "RPG Maker MV",
    kicker: "Local decoder",
    title: "JSON readable restore",
    ready: "Ready",
    busy: "Working",
    pathTitle: "Game folder",
    pathHint: "www folder or data folder path.",
    sourcePath: "Source path",
    outputName: "Output folder",
    scan: "Scan",
    decode: "Decode",
    encrypt: "Encrypt",
    patchManager: "Clean manager",
    managerTitle: "rpg_managers.js",
    managerHint: "Protected loader restore to normal JSON loader.",
    summary: "Summary",
    files: "Files",
    wrapped: "Wrapped",
    plain: "Plain",
    errors: "Errors",
    activity: "Log",
    preview: "Preview",
    noActivity: "No activity yet.",
    noPreview: "Scan a folder to see examples.",
    scanning: "Scanning folder...",
    decoding: "Decoding files...",
    encrypting: "Encrypting files...",
    patching: "Cleaning rpg_managers.js...",
    scanDone: "Scan complete.",
    decodeDone: "Decode complete.",
    encryptDone: "Encrypt complete.",
    patchDone: "Manager cleaned.",
    unchanged: "Unchanged",
    backup: "Backup",
    output: "Output",
    error: "Error"
  }
};

const state = {
  lang: localStorage.getItem("nekos-language") || "es"
};

const elements = {
  language: document.querySelector("#language"),
  sourcePath: document.querySelector("#sourcePath"),
  outputName: document.querySelector("#outputName"),
  scanButton: document.querySelector("#scanButton"),
  decodeButton: document.querySelector("#decodeButton"),
  encryptButton: document.querySelector("#encryptButton"),
  patchButton: document.querySelector("#patchButton"),
  serverState: document.querySelector("#serverState"),
  log: document.querySelector("#log"),
  sampleList: document.querySelector("#sampleList"),
  metricFiles: document.querySelector("#metricFiles"),
  metricWrapped: document.querySelector("#metricWrapped"),
  metricPlain: document.querySelector("#metricPlain"),
  metricErrors: document.querySelector("#metricErrors")
};

function t(key) {
  return translations[state.lang][key] || translations.es[key] || key;
}

function applyLanguage() {
  document.documentElement.lang = state.lang;
  elements.language.value = state.lang;
  document.querySelectorAll("[data-i18n]").forEach(node => {
    node.textContent = t(node.dataset.i18n);
  });
  if (!elements.log.children.length) elements.log.textContent = t("noActivity");
  if (!elements.sampleList.children.length) elements.sampleList.textContent = t("noPreview");
}

function setBusy(isBusy) {
  elements.scanButton.disabled = isBusy;
  elements.decodeButton.disabled = isBusy;
  elements.encryptButton.disabled = isBusy;
  elements.patchButton.disabled = isBusy;
  elements.serverState.textContent = isBusy ? t("busy") : t("ready");
}

function addLog(message, isError = false) {
  if (elements.log.textContent === t("noActivity")) elements.log.textContent = "";
  const entry = document.createElement("div");
  entry.className = `log-entry${isError ? " error" : ""}`;
  entry.textContent = message;
  elements.log.prepend(entry);
}

function setMetrics(payload = {}) {
  elements.metricFiles.textContent = payload.files ?? "-";
  elements.metricWrapped.textContent = payload.wrapped ?? payload.decoded ?? "-";
  elements.metricPlain.textContent = payload.plain ?? payload.copiedPlain ?? "-";
  elements.metricErrors.textContent = payload.failed?.length ?? "-";
}

function setPreview(sample = []) {
  elements.sampleList.textContent = "";
  if (!sample.length) {
    elements.sampleList.textContent = t("noPreview");
    return;
  }

  for (const item of sample) {
    const row = document.createElement("div");
    row.className = "sample-item";

    const name = document.createElement("span");
    name.textContent = item.file;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = item.mode;

    row.append(name, badge);
    elements.sampleList.append(row);
  }
}

async function postJson(endpoint, payload) {
  if (window.__TAURI__?.core?.invoke) {
    const commands = {
      "/api/scan": "scan_path",
      "/api/decode": "decode_path",
      "/api/encrypt": "encrypt_path",
      "/api/patch-manager": "patch_manager"
    };
    const command = commands[endpoint];
    const args = endpoint === "/api/decode" || endpoint === "/api/encrypt"
      ? { path: payload.path, outputName: payload.outputName }
      : { path: payload.path };
    return window.__TAURI__.core.invoke(command, args);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function scan() {
  setBusy(true);
  addLog(t("scanning"));
  try {
    const payload = await postJson("/api/scan", { path: elements.sourcePath.value });
    setMetrics(payload);
    setPreview(payload.sample);
    addLog(`${t("scanDone")} ${payload.dataDir}`);
  } catch (error) {
    addLog(`${t("error")}: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function decode() {
  setBusy(true);
  addLog(t("decoding"));
  try {
    const payload = await postJson("/api/decode", {
      path: elements.sourcePath.value,
      outputName: elements.outputName.value
    });
    setMetrics(payload);
    setPreview(payload.written.map(file => ({ file, mode: "json" })));
    addLog(`${t("decodeDone")} ${t("output")}: ${payload.output}`);
  } catch (error) {
    addLog(`${t("error")}: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function encrypt() {
  setBusy(true);
  addLog(t("encrypting"));
  try {
    const payload = await postJson("/api/encrypt", {
      path: elements.sourcePath.value,
      outputName: elements.outputName.value
    });
    setMetrics({
      files: payload.files,
      wrapped: payload.encrypted + payload.copiedWrapped,
      plain: 0,
      failed: payload.failed
    });
    setPreview(payload.written.map(file => ({ file, mode: "wrapped" })));
    addLog(`${t("encryptDone")} ${t("output")}: ${payload.output}`);
  } catch (error) {
    addLog(`${t("error")}: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function patchManager() {
  setBusy(true);
  addLog(t("patching"));
  try {
    const payload = await postJson("/api/patch-manager", { path: elements.sourcePath.value });
    if (payload.changed) {
      addLog(`${t("patchDone")} ${t("backup")}: ${payload.backup}`);
    } else {
      addLog(`${t("unchanged")}: ${payload.message}`);
    }
  } catch (error) {
    addLog(`${t("error")}: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

elements.language.addEventListener("change", event => {
  state.lang = event.target.value;
  localStorage.setItem("nekos-language", state.lang);
  applyLanguage();
});

elements.scanButton.addEventListener("click", scan);
elements.decodeButton.addEventListener("click", decode);
elements.encryptButton.addEventListener("click", encrypt);
elements.patchButton.addEventListener("click", patchManager);
elements.sourcePath.addEventListener("keydown", event => {
  if (event.key === "Enter") scan();
});

elements.sourcePath.value = localStorage.getItem("nekos-last-path") || "";
elements.sourcePath.addEventListener("change", () => {
  localStorage.setItem("nekos-last-path", elements.sourcePath.value);
});

applyLanguage();
