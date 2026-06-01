use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SampleFile {
    file: String,
    mode: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileError {
    file: String,
    error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanResult {
    data_dir: String,
    files: usize,
    wrapped: usize,
    plain: usize,
    failed: Vec<FileError>,
    sample: Vec<SampleFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DecodeResult {
    app: String,
    created_at: String,
    source: String,
    output: String,
    decoded: usize,
    copied_plain: usize,
    failed: Vec<FileError>,
    files: usize,
    written: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EncryptResult {
    app: String,
    created_at: String,
    source: String,
    output: String,
    encrypted: usize,
    copied_wrapped: usize,
    failed: Vec<FileError>,
    files: usize,
    written: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PatchResult {
    changed: bool,
    manager: String,
    backup: Option<String>,
    message: String,
}

fn normalize_input(input: &str) -> PathBuf {
    let trimmed = input.trim().trim_matches('"');
    PathBuf::from(trimmed)
}

fn resolve_data_dir(input: &str) -> Result<PathBuf, String> {
    if input.trim().is_empty() {
        return Err("Missing path".to_string());
    }

    let resolved = normalize_input(input);
    let mut candidates = Vec::new();

    if resolved
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("data"))
        .unwrap_or(false)
    {
        candidates.push(resolved.clone());
    } else {
        candidates.push(resolved.join("data"));
    }

    candidates.push(resolved.join("www").join("data"));
    candidates.push(resolved.join("game").join("www").join("data"));
    candidates.push(resolved.clone());

    if resolved.is_dir() {
        if let Ok(entries) = fs::read_dir(&resolved) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    candidates.push(path.join("game").join("www").join("data"));
                    candidates.push(path.join("www").join("data"));
                }
            }
        }
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.is_dir() && dir_has_json(candidate))
        .ok_or_else(|| {
            "No JSON folder found. Use the product folder, game www path, data path, or a decoded JSON folder.".to_string()
        })
}

fn dir_has_json(dir: &Path) -> bool {
    fs::read_dir(dir)
        .map(|entries| {
            entries.flatten().any(|entry| {
                entry
                    .path()
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case("json"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn resolve_www_dir(input: &str) -> Result<PathBuf, String> {
    let data_dir = resolve_data_dir(input)?;
    data_dir
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Unable to find www folder".to_string())
}

fn list_json_files(data_dir: &Path) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    let entries = fs::read_dir(data_dir).map_err(|error| error.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("json"))
            .unwrap_or(false)
        {
            if let Some(file_name) = path.file_name().and_then(|name| name.to_str()) {
                files.push(file_name.to_string());
            }
        }
    }

    files.sort_by(|a, b| natord::compare(a, b));
    Ok(files)
}

fn vanilla_load_data_file() -> &'static str {
    r#"DataManager.loadDataFile = function(name, src) {
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
"#
}

fn decode_wrapped_json(file_name: &str, text: &str) -> Result<(Value, bool), String> {
    let container: Value = serde_json::from_str(text).map_err(|error| error.to_string())?;
    let Some(data) = container.get("data").and_then(|value| value.as_str()) else {
        return Ok((container, false));
    };

    let mut bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|error| error.to_string())?;

    let base_name = file_name
        .strip_suffix(".json")
        .or_else(|| file_name.strip_suffix(".JSON"))
        .unwrap_or(file_name);

    let mut hash: i32 = 0;
    for unit in base_name.encode_utf16() {
        hash = hash
            .wrapping_shl(5)
            .wrapping_sub(hash)
            .wrapping_add(unit as i32);
    }

    let first_key = 211_i32 ^ (hash & 255);
    let mut last_value = first_key;

    for (index, byte) in bytes.iter_mut().enumerate() {
        let rotated = (last_value << 4) ^ ((last_value as u32) >> 2) as i32;
        let term = (first_key ^ 60)
            .wrapping_add((index % 256) as i32)
            .wrapping_add(rotated);
        let key = ((term ^ 122).wrapping_add(19)) & 255;
        let value = (*byte as i32 ^ key) & 255;
        *byte = value as u8;
        last_value = value;
    }

    let raw = String::from_utf8(bytes)
        .map_err(|error| error.to_string())?
        .trim_start_matches('\u{feff}')
        .trim()
        .to_string();
    let parsed = serde_json::from_str(&raw).map_err(|error| error.to_string())?;

    Ok((parsed, true))
}

fn encode_wrapped_json(file_name: &str, text: &str) -> Result<(Value, bool), String> {
    let parsed: Value = serde_json::from_str(text).map_err(|error| error.to_string())?;
    if parsed.get("data").and_then(|value| value.as_str()).is_some() {
        return Ok((parsed, false));
    }

    let compact = serde_json::to_string(&parsed).map_err(|error| error.to_string())?;
    let mut bytes = compact.into_bytes();

    let base_name = file_name
        .strip_suffix(".json")
        .or_else(|| file_name.strip_suffix(".JSON"))
        .unwrap_or(file_name);

    let mut hash: i32 = 0;
    for unit in base_name.encode_utf16() {
        hash = hash
            .wrapping_shl(5)
            .wrapping_sub(hash)
            .wrapping_add(unit as i32);
    }

    let first_key = 211_i32 ^ (hash & 255);
    let mut last_plain = first_key;

    for (index, byte) in bytes.iter_mut().enumerate() {
        let plain = *byte as i32;
        let rotated = (last_plain << 4) ^ ((last_plain as u32) >> 2) as i32;
        let term = (first_key ^ 60)
            .wrapping_add((index % 256) as i32)
            .wrapping_add(rotated);
        let key = ((term ^ 122).wrapping_add(19)) & 255;
        *byte = ((plain ^ key) & 255) as u8;
        last_plain = plain;
    }

    let data = base64::engine::general_purpose::STANDARD.encode(bytes);
    let uid = make_uid(file_name, &data);
    let wrapped = serde_json::json!({
        "uid": uid,
        "bid": "MV.1.6.2",
        "data": data
    });

    Ok((wrapped, true))
}

fn make_uid(file_name: &str, data: &str) -> String {
    let mut value = OffsetDateTime::now_utc().unix_timestamp_nanos() as u64;
    for byte in file_name.bytes().chain(data.bytes().take(64)) {
        value = value.rotate_left(5) ^ byte as u64;
        value = value.wrapping_mul(0x9E37_79B1);
    }
    format!("{:08x}", value as u32)
}

#[tauri::command]
fn patch_manager(path: String) -> Result<PatchResult, String> {
    let www_dir = resolve_www_dir(&path)?;
    let manager_path = www_dir.join("js").join("rpg_managers.js");

    if !manager_path.is_file() {
        return Err("rpg_managers.js was not found under www/js.".to_string());
    }

    let text = fs::read_to_string(&manager_path).map_err(|error| error.to_string())?;
    let start_marker = "DataManager.loadDataFile = function(name, src) {";
    let end_marker = "DataManager.isDatabaseLoaded = function()";
    let start = text
        .find(start_marker)
        .ok_or_else(|| "DataManager.loadDataFile was not found.".to_string())?;
    let end = text[start..]
        .find(end_marker)
        .map(|offset| start + offset)
        .ok_or_else(|| "DataManager.isDatabaseLoaded marker was not found.".to_string())?;
    let current_block = &text[start..end];

    let looks_protected = current_block.contains("Buffer.from(c.data")
        || current_block.contains("window._K")
        || current_block.contains("JSON.parse(xhr.responseText); var b")
        || current_block.contains("process.exit()");

    if !looks_protected {
        return Ok(PatchResult {
            changed: false,
            manager: manager_path.to_string_lossy().to_string(),
            backup: None,
            message: "The manager loader does not look protected.".to_string(),
        });
    }

    let timestamp = OffsetDateTime::now_utc().unix_timestamp();
    let backup_path = manager_path.with_extension(format!("js.nekos_backup_{}", timestamp));
    fs::copy(&manager_path, &backup_path).map_err(|error| error.to_string())?;

    let mut patched = String::with_capacity(text.len());
    patched.push_str(&text[..start]);
    patched.push_str(vanilla_load_data_file());
    patched.push('\n');
    patched.push_str(&text[end..]);

    fs::write(&manager_path, patched).map_err(|error| error.to_string())?;

    Ok(PatchResult {
        changed: true,
        manager: manager_path.to_string_lossy().to_string(),
        backup: Some(backup_path.to_string_lossy().to_string()),
        message: "Protected loader replaced with the vanilla RPG Maker MV loader.".to_string(),
    })
}

#[tauri::command]
fn scan_path(path: String) -> Result<ScanResult, String> {
    let data_dir = resolve_data_dir(&path)?;
    let files = list_json_files(&data_dir)?;
    let mut wrapped = 0;
    let mut plain = 0;
    let mut failed = Vec::new();
    let mut sample = Vec::new();

    for file in &files {
        let file_path = data_dir.join(file);
        match fs::read_to_string(&file_path) {
            Ok(text) => match serde_json::from_str::<Value>(&text) {
                Ok(json) => {
                    let is_wrapped = json.get("data").and_then(|value| value.as_str()).is_some();
                    if is_wrapped {
                        wrapped += 1;
                    } else {
                        plain += 1;
                    }
                    if sample.len() < 8 {
                        let size = fs::metadata(&file_path).map(|meta| meta.len()).unwrap_or(0);
                        sample.push(SampleFile {
                            file: file.clone(),
                            mode: if is_wrapped { "wrapped" } else { "plain" }.to_string(),
                            size,
                        });
                    }
                }
                Err(error) => failed.push(FileError {
                    file: file.clone(),
                    error: error.to_string(),
                }),
            },
            Err(error) => failed.push(FileError {
                file: file.clone(),
                error: error.to_string(),
            }),
        }
    }

    Ok(ScanResult {
        data_dir: data_dir.to_string_lossy().to_string(),
        files: files.len(),
        wrapped,
        plain,
        failed,
        sample,
    })
}

#[tauri::command]
fn decode_path(path: String, output_name: String) -> Result<DecodeResult, String> {
    let data_dir = resolve_data_dir(&path)?;
    let parent_dir = data_dir
        .parent()
        .ok_or_else(|| "Unable to find parent folder".to_string())?;
    let safe_output = sanitize_output_name(&output_name);
    let output_dir = parent_dir.join(safe_output);

    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

    let files = list_json_files(&data_dir)?;
    let mut failed = Vec::new();
    let mut written = Vec::new();
    let mut decoded = 0;
    let mut copied_plain = 0;

    for file in &files {
        let input_file = data_dir.join(file);
        let output_file = output_dir.join(file);
        match fs::read_to_string(&input_file)
            .map_err(|error| error.to_string())
            .and_then(|text| decode_wrapped_json(file, &text))
        {
            Ok((json, wrapped)) => {
                match serde_json::to_string_pretty(&json)
                    .map_err(|error| error.to_string())
                    .and_then(|pretty| fs::write(&output_file, pretty).map_err(|error| error.to_string()))
                {
                    Ok(()) => {
                        if wrapped {
                            decoded += 1;
                        } else {
                            copied_plain += 1;
                        }
                        if written.len() < 12 {
                            written.push(file.clone());
                        }
                    }
                    Err(error) => failed.push(FileError {
                        file: file.clone(),
                        error,
                    }),
                }
            }
            Err(error) => failed.push(FileError {
                file: file.clone(),
                error,
            }),
        }
    }

    let created_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string());
    let report = DecodeResult {
        app: "Nekos".to_string(),
        created_at,
        source: data_dir.to_string_lossy().to_string(),
        output: output_dir.to_string_lossy().to_string(),
        decoded,
        copied_plain,
        failed,
        files: files.len(),
        written,
    };

    let report_text = serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?;
    fs::write(output_dir.join("_nekos_report.json"), report_text).map_err(|error| error.to_string())?;

    Ok(report)
}

#[tauri::command]
fn encrypt_path(path: String, output_name: String) -> Result<EncryptResult, String> {
    let data_dir = resolve_data_dir(&path)?;
    let parent_dir = data_dir
        .parent()
        .ok_or_else(|| "Unable to find parent folder".to_string())?;
    let safe_output = sanitize_output_name(&output_name);
    let output_dir = parent_dir.join(safe_output);

    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

    let files = list_json_files(&data_dir)?;
    let mut failed = Vec::new();
    let mut written = Vec::new();
    let mut encrypted = 0;
    let mut copied_wrapped = 0;

    for file in &files {
        let input_file = data_dir.join(file);
        let output_file = output_dir.join(file);
        match fs::read_to_string(&input_file)
            .map_err(|error| error.to_string())
            .and_then(|text| encode_wrapped_json(file, &text))
        {
            Ok((json, was_encrypted)) => {
                match serde_json::to_string_pretty(&json)
                    .map_err(|error| error.to_string())
                    .and_then(|pretty| fs::write(&output_file, pretty).map_err(|error| error.to_string()))
                {
                    Ok(()) => {
                        if was_encrypted {
                            encrypted += 1;
                        } else {
                            copied_wrapped += 1;
                        }
                        if written.len() < 12 {
                            written.push(file.clone());
                        }
                    }
                    Err(error) => failed.push(FileError {
                        file: file.clone(),
                        error,
                    }),
                }
            }
            Err(error) => failed.push(FileError {
                file: file.clone(),
                error,
            }),
        }
    }

    let created_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string());
    let report = EncryptResult {
        app: "Nekos".to_string(),
        created_at,
        source: data_dir.to_string_lossy().to_string(),
        output: output_dir.to_string_lossy().to_string(),
        encrypted,
        copied_wrapped,
        failed,
        files: files.len(),
        written,
    };

    let report_text = serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?;
    fs::write(output_dir.join("_nekos_report.json"), report_text).map_err(|error| error.to_string())?;

    Ok(report)
}

fn sanitize_output_name(input: &str) -> String {
    let sanitized: String = input
        .trim()
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect();

    if sanitized.is_empty() {
        "data_decoded".to_string()
    } else {
        sanitized
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_path,
            decode_path,
            encrypt_path,
            patch_manager
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nekos");
}

mod natord {
    use std::cmp::Ordering;

    pub fn compare(left: &str, right: &str) -> Ordering {
        let mut left_chars = left.chars().peekable();
        let mut right_chars = right.chars().peekable();

        loop {
            match (left_chars.peek(), right_chars.peek()) {
                (None, None) => return Ordering::Equal,
                (None, Some(_)) => return Ordering::Less,
                (Some(_), None) => return Ordering::Greater,
                (Some(a), Some(b)) if a.is_ascii_digit() && b.is_ascii_digit() => {
                    let left_num = take_number(&mut left_chars);
                    let right_num = take_number(&mut right_chars);
                    match left_num.cmp(&right_num) {
                        Ordering::Equal => continue,
                        other => return other,
                    }
                }
                (Some(_), Some(_)) => {
                    let a = left_chars.next().unwrap().to_ascii_lowercase();
                    let b = right_chars.next().unwrap().to_ascii_lowercase();
                    match a.cmp(&b) {
                        Ordering::Equal => continue,
                        other => return other,
                    }
                }
            }
        }
    }

    fn take_number<I>(chars: &mut std::iter::Peekable<I>) -> u64
    where
        I: Iterator<Item = char>,
    {
        let mut value = 0_u64;
        while let Some(character) = chars.peek() {
            if character.is_ascii_digit() {
                value = value
                    .saturating_mul(10)
                    .saturating_add(character.to_digit(10).unwrap_or(0) as u64);
                chars.next();
            } else {
                break;
            }
        }
        value
    }
}
