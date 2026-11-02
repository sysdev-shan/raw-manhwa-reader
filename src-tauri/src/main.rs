#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::time::Duration;

use serde::Serialize;
use tauri::{PhysicalSize, WindowEvent};

// Portrait only: keep width/height between these ratios while resizing.
const MIN_RATIO: f64 = 0.45;
const MAX_RATIO: f64 = 0.62;

const MAX_BODY: usize = 8 * 1024 * 1024;

#[derive(Serialize)]
struct FetchOut {
    status: u16,
    body: String,
}

/// "outer: inner: root cause", so the UI can show why a request really failed.
fn chain(e: &dyn std::error::Error) -> String {
    let mut out = e.to_string();
    let mut cur = e.source();
    while let Some(s) = cur {
        out.push_str(": ");
        out.push_str(&s.to_string());
        cur = s.source();
    }
    out
}

/// The only network door extensions get (via the UI, which enforces each
/// extension's declared hosts). HTTPS only, no IP literals, capped size and time.
#[tauri::command]
async fn http_fetch(
    url: String,
    headers: Option<HashMap<String, String>>,
    binary: Option<bool>,
    method: Option<String>,
    body: Option<String>,
    hosts: Option<Vec<String>>,
) -> Result<FetchOut, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" {
        return Err("only https urls are allowed".into());
    }
    let host = parsed.host_str().ok_or("url has no host")?;
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    if bare.parse::<std::net::IpAddr>().is_ok() || bare.eq_ignore_ascii_case("localhost") || !bare.contains('.') {
        return Err("host not allowed".into());
    }

    // Redirects are followed only to https hosts the caller declared (or their subdomains).
    let allowed = hosts.unwrap_or_default();
    let policy = reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.error("too many redirects");
        }
        let ok = attempt.url().scheme() == "https"
            && attempt.url().host_str().is_some_and(|h| {
                allowed.iter().any(|a| h == a || h.ends_with(&format!(".{a}")))
            });
        if ok {
            attempt.follow()
        } else {
            let target = attempt.url().host_str().unwrap_or("?").to_string();
            attempt.error(format!("redirected to {target}, which this source did not declare"))
        }
    });
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("RAW-reader/0.1 (personal reader)")
        .redirect(policy)
        .build()
        .map_err(|e| e.to_string())?;
    let verb = match method.as_deref().unwrap_or("GET") {
        "POST" => reqwest::Method::POST,
        "GET" => reqwest::Method::GET,
        _ => return Err("only GET and POST are allowed".into()),
    };
    let mut req = client.request(verb, parsed);
    if let Some(b) = body {
        req = req.body(b);
    }
    for (k, v) in headers.unwrap_or_default() {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| chain(&e))?;
    let status = resp.status().as_u16();
    if resp.content_length().is_some_and(|n| n as usize > MAX_BODY) {
        return Err("response too large".into());
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BODY {
        return Err("response too large".into());
    }
    let body = if binary.unwrap_or(false) {
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes)
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    };
    Ok(FetchOut { status, body })
}

/// Opens an https link in the user's default browser. Only https, and no shell is involved.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() {
        return Err("only https links can be opened".into());
    }
    std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", parsed.as_str()])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![http_fetch, open_external])
        .on_window_event(|window, event| {
            if let WindowEvent::Resized(size) = event {
                if size.width == 0 || size.height == 0 {
                    return; // minimized
                }
                let ratio = size.width as f64 / size.height as f64;
                let width = if ratio > MAX_RATIO {
                    (size.height as f64 * MAX_RATIO) as u32
                } else if ratio < MIN_RATIO {
                    (size.height as f64 * MIN_RATIO) as u32
                } else {
                    return;
                };
                let _ = window.set_size(PhysicalSize::new(width, size.height));
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run RAW");
}
