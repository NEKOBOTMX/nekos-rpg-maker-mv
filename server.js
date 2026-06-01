const fs = require("fs");
const http = require("http");
const path = require("path");
const url = require("url");

const PORT = Number(process.env.PORT || 4177);
const PUBLIC_DIR = path.join(__dirname, "public");

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendStatic(req, res) {
  const parsed = url.parse(req.url);
  const requested = decodeURIComponent(parsed.pathname === "/" ? "/index.html" : parsed.pathname);
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml"
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function xor(a, b) {
  return (a | b) & ~(a & b);
}

function decodeWrappedJson(fileName, text) {
  const container = JSON.parse(text);
  if (!container || typeof container.data !== "string") {
    const parsed = JSON.parse(text);
    return { parsed, wrapped: false };
  }

  const bytes = Buffer.from(container.data, "base64");
  const baseName = fileName.replace(/\.json$/i, "");
  let hash = 0;

  for (let index = 0; index < baseName.length; index += 1) {
    hash = ((hash << 5) - hash + baseName.charCodeAt(index)) | 0;
  }

  const firstKey = xor(211, hash & 255);
  let lastValue = firstKey;

  for (let index = 0; index < bytes.length; index += 1) {
    const rotated = xor(lastValue << 4, lastValue >>> 2);
    const term = (xor(firstKey, 60) + (index % 256) + rotated) | 0;
    const key = (xor(term, 122) + 19) & 255;
    const value = xor(bytes[index], key) & 255;
    bytes[index] = value;
    lastValue = value;
  }

  const raw = bytes.toString("utf8").replace(/^\uFEFF/, "").trim();
  return { parsed: JSON.parse(raw), wrapped: true };
}

function encodeWrappedJson(fileName, text) {
  const parsed = JSON.parse(text);
  if (parsed && typeof parsed.data === "string") {
    return { encoded: parsed, encrypted: false };
  }

  const bytes = Buffer.from(JSON.stringify(parsed), "utf8");
  const baseName = fileName.replace(/\.json$/i, "");
  let hash = 0;

  for (let index = 0; index < baseName.length; index += 1) {
    hash = ((hash << 5) - hash + baseName.charCodeAt(index)) | 0;
  }

  const firstKey = xor(211, hash & 255);
  let lastPlain = firstKey;

  for (let index = 0; index < bytes.length; index += 1) {
    const plain = bytes[index];
    const rotated = xor(lastPlain << 4, lastPlain >>> 2);
    const term = (xor(firstKey, 60) + (index % 256) + rotated) | 0;
    const key = (xor(term, 122) + 19) & 255;
    bytes[index] = xor(plain, key) & 255;
    lastPlain = plain;
  }

  const data = bytes.toString("base64");
  return {
    encoded: {
      uid: makeUid(fileName, data),
      bid: "MV.1.6.2",
      data
    },
    encrypted: true
  };
}

function makeUid(fileName, data) {
  let value = BigInt(Date.now());
  for (const ch of `${fileName}${data.slice(0, 64)}`) {
    value = ((value << 5n) | (value >> 27n)) ^ BigInt(ch.charCodeAt(0));
    value = (value * 2654435761n) & 0xffffffffn;
  }
  return value.toString(16).padStart(8, "0").slice(-8);
}

function resolveDataDir(inputPath) {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("Missing path");
  }

  const resolved = path.resolve(inputPath.trim().replace(/^"|"$/g, ""));
  const candidates = [
    path.basename(resolved).toLowerCase() === "data" ? resolved : path.join(resolved, "data"),
    path.join(resolved, "www", "data"),
    path.join(resolved, "game", "www", "data"),
    resolved
  ];

  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        candidates.push(path.join(resolved, entry.name, "game", "www", "data"));
        candidates.push(path.join(resolved, entry.name, "www", "data"));
      }
    }
  }

  const dataDir = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory() && dirHasJson(candidate));

  if (!dataDir) {
    throw new Error("No JSON folder found. Use the product folder, game www path, data path, or a decoded JSON folder.");
  }

  return dataDir;
}

function dirHasJson(dir) {
  try {
    return fs.readdirSync(dir).some(file => file.toLowerCase().endsWith(".json"));
  } catch {
    return false;
  }
}

function listJsonFiles(dataDir) {
  return fs.readdirSync(dataDir)
    .filter(file => file.toLowerCase().endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function inspectFiles(dataDir) {
  const files = listJsonFiles(dataDir);
  let wrapped = 0;
  let plain = 0;
  const failed = [];
  const sample = [];

  for (const file of files) {
    try {
      const text = fs.readFileSync(path.join(dataDir, file), "utf8");
      const json = JSON.parse(text);
      const isWrapped = Boolean(json && typeof json.data === "string");
      if (isWrapped) wrapped += 1;
      else plain += 1;
      if (sample.length < 8) {
        sample.push({
          file,
          mode: isWrapped ? "wrapped" : "plain",
          size: Buffer.byteLength(text)
        });
      }
    } catch (error) {
      failed.push({ file, error: error.message });
    }
  }

  return { files: files.length, wrapped, plain, failed, sample };
}

function resolveWwwDir(inputPath) {
  return path.dirname(resolveDataDir(inputPath));
}

function vanillaLoadDataFile() {
  return `DataManager.loadDataFile = function(name, src) {
    var xhr = new XMLHttpRequest();
    var url = 'data/' + src;
    xhr.open('GET', url);
    xhr.overrideMimeType('application/json');
    xhr.onload = function() {
        if (xhr.status < 400) {
            window[name] = JSON.parse(xhr.responseText);
            DataManager.onLoad(window[name]);
        }
    };
    xhr.onerror = this._mapLoader || function() {
        DataManager._errorUrl = DataManager._errorUrl || url;
    };
    window[name] = null;
    xhr.send();
};
`;
}

function patchManager(inputPath) {
  const wwwDir = resolveWwwDir(inputPath);
  const managerPath = path.join(wwwDir, "js", "rpg_managers.js");

  if (!fs.existsSync(managerPath)) {
    throw new Error("rpg_managers.js was not found under www/js.");
  }

  const text = fs.readFileSync(managerPath, "utf8");
  const startMarker = "DataManager.loadDataFile = function(name, src) {";
  const endMarker = "DataManager.isDatabaseLoaded = function()";
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error("DataManager.loadDataFile was not found.");
  const end = text.indexOf(endMarker, start);
  if (end < 0) throw new Error("DataManager.isDatabaseLoaded marker was not found.");

  const currentBlock = text.slice(start, end);
  const looksProtected = currentBlock.includes("Buffer.from(c.data")
    || currentBlock.includes("window._K")
    || currentBlock.includes("JSON.parse(xhr.responseText); var b")
    || currentBlock.includes("process.exit()");

  if (!looksProtected) {
    return {
      changed: false,
      manager: managerPath,
      backup: null,
      message: "The manager loader does not look protected."
    };
  }

  const backupPath = `${managerPath}.nekos_backup_${Date.now()}`;
  fs.copyFileSync(managerPath, backupPath);
  const patched = text.slice(0, start) + vanillaLoadDataFile() + "\n" + text.slice(end);
  fs.writeFileSync(managerPath, patched, "utf8");

  return {
    changed: true,
    manager: managerPath,
    backup: backupPath,
    message: "Protected loader replaced with the vanilla RPG Maker MV loader."
  };
}

function decodeFolder(inputPath, outputName) {
  const dataDir = resolveDataDir(inputPath);
  const parentDir = path.dirname(dataDir);
  const safeOutput = (outputName || "data_decoded").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") || "data_decoded";
  const outputDir = path.join(parentDir, safeOutput);

  fs.mkdirSync(outputDir, { recursive: true });

  const files = listJsonFiles(dataDir);
  const failed = [];
  const written = [];
  let decoded = 0;
  let copiedPlain = 0;

  for (const file of files) {
    try {
      const text = fs.readFileSync(path.join(dataDir, file), "utf8");
      const result = decodeWrappedJson(file, text);
      fs.writeFileSync(path.join(outputDir, file), JSON.stringify(result.parsed, null, 2), "utf8");
      if (result.wrapped) decoded += 1;
      else copiedPlain += 1;
      if (written.length < 12) written.push(file);
    } catch (error) {
      failed.push({ file, error: error.message });
    }
  }

  const report = {
    app: "Nekos",
    createdAt: new Date().toISOString(),
    source: dataDir,
    output: outputDir,
    decoded,
    copiedPlain,
    failed
  };
  fs.writeFileSync(path.join(outputDir, "_nekos_report.json"), JSON.stringify(report, null, 2), "utf8");

  return { ...report, files: files.length, written };
}

function encryptFolder(inputPath, outputName) {
  const dataDir = resolveDataDir(inputPath);
  const parentDir = path.dirname(dataDir);
  const safeOutput = (outputName || "data_encoded").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") || "data_encoded";
  const outputDir = path.join(parentDir, safeOutput);

  fs.mkdirSync(outputDir, { recursive: true });

  const files = listJsonFiles(dataDir);
  const failed = [];
  const written = [];
  let encrypted = 0;
  let copiedWrapped = 0;

  for (const file of files) {
    try {
      const text = fs.readFileSync(path.join(dataDir, file), "utf8");
      const result = encodeWrappedJson(file, text);
      fs.writeFileSync(path.join(outputDir, file), JSON.stringify(result.encoded, null, 2), "utf8");
      if (result.encrypted) encrypted += 1;
      else copiedWrapped += 1;
      if (written.length < 12) written.push(file);
    } catch (error) {
      failed.push({ file, error: error.message });
    }
  }

  const report = {
    app: "Nekos",
    createdAt: new Date().toISOString(),
    source: dataDir,
    output: outputDir,
    encrypted,
    copiedWrapped,
    failed,
    files: files.length,
    written
  };
  fs.writeFileSync(path.join(outputDir, "_nekos_report.json"), JSON.stringify(report, null, 2), "utf8");

  return report;
}

async function handleApi(req, res) {
  try {
    const body = JSON.parse(await readBody(req) || "{}");
    if (req.url === "/api/scan") {
      const dataDir = resolveDataDir(body.path);
      sendJson(res, 200, { dataDir, ...inspectFiles(dataDir) });
      return;
    }
    if (req.url === "/api/decode") {
      sendJson(res, 200, decodeFolder(body.path, body.outputName));
      return;
    }
    if (req.url === "/api/encrypt") {
      sendJson(res, 200, encryptFolder(body.path, body.outputName));
      return;
    }
    if (req.url === "/api/patch-manager") {
      sendJson(res, 200, patchManager(body.path));
      return;
    }
    sendJson(res, 404, { error: "Unknown API route" });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }
  if (req.method === "GET") {
    sendStatic(req, res);
    return;
  }
  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Nekos is running at http://127.0.0.1:${PORT}`);
});
