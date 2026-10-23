//! Android 系统相册只读桥（MediaStore，经 JNI）
//! --------------------------------------------
//! WebView 里的 JS 拿不到 MediaStore。手机端的照片绑定键是**相册名**：
//! Android 的相册名就是照片所在目录名，且相册之间平级、没有子相册，
//! 所以在系统相册里建一个叫「淳安县」的相册，App 里淳安县就有照片，
//! 不需要导入、不需要复制、也不需要理解任何目录结构。
//!
//! 前端侧见 `src/data/androidMedia.ts`（invoke 下面这些命令）：
//! - `media_permission_state`   是否已授权读相册
//! - `media_request_permission` 拉起系统权限弹窗（异步生效，前端在 resume 后复查）
//! - `media_list_albums`        全部相册（名称 + 张数）
//! - `media_all_photos`         全量照片（带所属相册名，用于建索引）
//! - `media_album_photos`       单个相册的照片
//! - `media_photo_bytes`        按 content:// URI 读原始字节（DATA 路径缺失时的兜底）
//!
//! 线程模型：Tauri 命令跑在 WebView 主线程，而 JNI 需要同一个线程的 env。
//! 这里用 `with_webview` → `JniHandle::exec` 把活儿抛回主线程消息队列，
//! 命令本体是 async，用 `spawn_blocking` 等结果，绝不阻塞主线程。

#![cfg(target_os = "android")]

use std::collections::HashMap;
use std::sync::mpsc;

use jni::objects::{JObject, JString, JValue};
use jni::sys::jsize;
use jni::JNIEnv;
use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager};

/// 全量拉取照片的行数上限（大相册一次拉完，别把内存吃穿）
const MAX_INDEX_ROWS: usize = 6000;
/// 单个相册查询的行数上限
const MAX_ALBUM_ROWS: usize = 800;

#[derive(Serialize, Clone, Debug)]
pub struct MediaAlbum {
    pub name: String,
    pub count: usize,
}

#[derive(Serialize, Clone, Debug)]
pub struct MediaPhoto {
    pub id: i64,
    /// 所属相册名（MediaStore.BUCKET_DISPLAY_NAME）
    pub bucket: String,
    pub name: String,
    /// MediaStore.DATA：文件系统路径；部分新机型返回空，此时用 uri 兜底
    pub path: String,
    /// content://media/external/images/media/<id>
    pub uri: String,
    /// 毫秒时间戳
    pub mtime: i64,
    pub width: i32,
    pub height: i32,
    pub mime: String,
}

/* ---------------- 主线程调度 ---------------- */

/// 把 JNI 活儿抛到主线程执行，返回一个接收端（命令在 async 里等它）。
fn dispatch<T, F>(app: &AppHandle, f: F) -> Option<mpsc::Receiver<T>>
where
    T: Send + 'static,
    F: FnOnce(&mut JNIEnv, &JObject) -> T + Send + 'static,
{
    let webview = app.get_webview_window("main")?;
    let (tx, rx) = mpsc::channel();
    webview
        .with_webview(move |w| {
            w.jni_handle().exec(move |env, activity, _webview| {
                let _ = tx.send(f(env, activity));
            });
        })
        .ok()?;
    Some(rx)
}

async fn await_dispatch<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce(&mut JNIEnv, &JObject) -> T + Send + 'static,
    what: &str,
) -> Result<T, String> {
    let rx = dispatch(app, f).ok_or_else(|| format!("{what}：窗口未就绪"))?;
    let joined = tauri::async_runtime::spawn_blocking(move || rx.recv().ok())
        .await
        .map_err(|e| e.to_string())?;
    joined.ok_or_else(|| format!("{what}：读取失败"))
}

/* ---------------- 权限 ---------------- */

fn sdk_int(env: &mut JNIEnv<'_>) -> i32 {
    let Ok(cls) = env.find_class("android/os/Build$VERSION") else {
        return 0;
    };
    env.get_static_field(cls, "SDK_INT", "I")
        .ok()
        .and_then(|v| v.i().ok())
        .unwrap_or(0)
}

/// Android 13（API 33）起拆出了 READ_MEDIA_IMAGES，之前用 READ_EXTERNAL_STORAGE
fn read_permission(env: &mut JNIEnv<'_>) -> String {
    if sdk_int(env) >= 33 {
        "android.permission.READ_MEDIA_IMAGES".to_owned()
    } else {
        "android.permission.READ_EXTERNAL_STORAGE".to_owned()
    }
}

fn check_permission(env: &mut JNIEnv<'_>, activity: &JObject<'_>) -> bool {
    let name = read_permission(env);
    let Ok(perm) = env.new_string(name) else {
        return false;
    };
    match env.call_method(
        activity,
        "checkSelfPermission",
        "(Ljava/lang/String;)I",
        &[(&perm).into()],
    ) {
        Ok(v) => v.i().unwrap_or(-1) == 0, // PackageManager.PERMISSION_GRANTED == 0
        Err(err) => {
            let _ = env.exception_clear();
            let _ = err;
            false
        }
    }
}

fn request_permission(env: &mut JNIEnv<'_>, activity: &JObject<'_>) {
    let name = read_permission(env);
    let Ok(perm) = env.new_string(name) else { return };
    let Ok(arr) = env.new_object_array(1, "java/lang/String", JObject::null()) else {
        return;
    };
    if env
        .set_object_array_element(&arr, 0, JObject::from(perm))
        .is_err()
    {
        let _ = env.exception_clear();
        return;
    }
    if env
        .call_method(
            activity,
            "requestPermissions",
            "([Ljava/lang/String;I)V",
            &[(&arr).into(), JValue::Int(1)],
        )
        .is_err()
    {
        let _ = env.exception_clear();
    }
}

/* ---------------- MediaStore 查询 ---------------- */

fn media_store_uri<'a>(env: &mut JNIEnv<'a>) -> Option<JObject<'a>> {
    let cls = env
        .find_class("android/provider/MediaStore$Images$Media")
        .ok()?;
    env.get_static_field(cls, "EXTERNAL_CONTENT_URI", "Landroid/net/Uri;")
        .ok()?
        .l()
        .ok()
}

fn content_resolver<'a, 'b>(env: &mut JNIEnv<'a>, activity: &JObject<'b>) -> Option<JObject<'a>> {
    env.call_method(
        activity,
        "getContentResolver",
        "()Landroid/content/ContentResolver;",
        &[],
    )
    .ok()?
    .l()
    .ok()
}

fn java_string_array<'a>(env: &mut JNIEnv<'a>, items: &[String]) -> Option<JObject<'a>> {
    let arr = env
        .new_object_array(items.len() as jsize, "java/lang/String", JObject::null())
        .ok()?;
    for (i, item) in items.iter().enumerate() {
        let s = env.new_string(item).ok()?;
        if env
            .set_object_array_element(&arr, i as jsize, JObject::from(s))
            .is_err()
        {
            let _ = env.exception_clear();
            return None;
        }
    }
    Some(JObject::from(arr))
}

#[allow(clippy::too_many_arguments)]
fn query_media<'a, 'b, 'c>(
    env: &mut JNIEnv<'a>,
    resolver: &JObject<'b>,
    uri: &JObject<'c>,
    projection: &[String],
    selection: Option<&str>,
    args: &[String],
    sort: Option<&str>,
) -> Option<JObject<'a>> {
    let proj = java_string_array(env, projection)?;
    let null_obj = JObject::null();
    let sel = match selection {
        Some(s) => env.new_string(s).ok()?,
        None => JString::default(),
    };
    let sel_arg = if selection.is_some() {
        (&sel).into()
    } else {
        (&null_obj).into()
    };
    let args_arr = java_string_array(env, args)?;
    let sort_s = match sort {
        Some(s) => env.new_string(s).ok()?,
        None => JString::default(),
    };
    let sort_arg = if sort.is_some() {
        (&sort_s).into()
    } else {
        (&null_obj).into()
    };

    let cursor = env
        .call_method(
            resolver,
            "query",
            "(Landroid/net/Uri;[Ljava/lang/String;Ljava/lang/String;[Ljava/lang/String;Ljava/lang/String;)Landroid/database/Cursor;",
            &[
                uri.into(),
                (&proj).into(),
                sel_arg,
                (&args_arr).into(),
                sort_arg,
            ],
        )
        .ok()?
        .l()
        .ok()?;
    if cursor.as_raw().is_null() {
        let _ = env.exception_clear();
        return None;
    }
    Some(cursor)
}

fn cursor_next(env: &mut JNIEnv<'_>, cursor: &JObject<'_>) -> bool {
    match env.call_method(cursor, "moveToNext", "()Z", &[]) {
        Ok(v) => v.z().unwrap_or(false),
        Err(_) => {
            let _ = env.exception_clear();
            false
        }
    }
}

fn cursor_column(env: &mut JNIEnv<'_>, cursor: &JObject<'_>, name: &str) -> i32 {
    let Ok(col) = env.new_string(name) else { return -1 };
    match env.call_method(
        cursor,
        "getColumnIndex",
        "(Ljava/lang/String;)I",
        &[(&col).into()],
    ) {
        Ok(v) => v.i().unwrap_or(-1),
        Err(_) => {
            let _ = env.exception_clear();
            -1
        }
    }
}

fn cursor_string(env: &mut JNIEnv<'_>, cursor: &JObject<'_>, index: i32) -> String {
    if index < 0 {
        return String::new();
    }
    let Ok(v) = env.call_method(cursor, "getString", "(I)Ljava/lang/String;", &[JValue::Int(index)])
    else {
        let _ = env.exception_clear();
        return String::new();
    };
    let Ok(obj) = v.l() else { return String::new() };
    if obj.as_raw().is_null() {
        return String::new();
    }
    let js: &JString = (&obj).into();
    env.get_string(js).map(Into::into).unwrap_or_default()
}

fn cursor_long(env: &mut JNIEnv<'_>, cursor: &JObject<'_>, index: i32) -> i64 {
    if index < 0 {
        return 0;
    }
    match env.call_method(cursor, "getLong", "(I)J", &[JValue::Int(index)]) {
        Ok(v) => v.j().unwrap_or(0),
        Err(_) => {
            let _ = env.exception_clear();
            0
        }
    }
}

fn cursor_int(env: &mut JNIEnv<'_>, cursor: &JObject<'_>, index: i32) -> i32 {
    if index < 0 {
        return 0;
    }
    match env.call_method(cursor, "getInt", "(I)I", &[JValue::Int(index)]) {
        Ok(v) => v.i().unwrap_or(0),
        Err(_) => {
            let _ = env.exception_clear();
            0
        }
    }
}

fn close_cursor(env: &mut JNIEnv<'_>, cursor: &JObject<'_>) {
    if env.call_method(cursor, "close", "()V", &[]).is_err() {
        let _ = env.exception_clear();
    }
}

/// 读一行 → MediaPhoto。放在局部帧里跑，避免几千行把 local ref 表撑爆。
fn read_photo_row(
    env: &mut JNIEnv<'_>,
    cursor: &JObject<'_>,
    uri_base: &JObject<'_>,
) -> Option<MediaPhoto> {
    env.with_local_frame(32, |env| -> Result<Option<MediaPhoto>, jni::errors::Error> {
        let c_id = cursor_column(env, cursor, "_id");
        let c_bucket = cursor_column(env, cursor, "bucket_display_name");
        let c_name = cursor_column(env, cursor, "_display_name");
        let c_data = cursor_column(env, cursor, "_data");
        let c_date = cursor_column(env, cursor, "date_modified");
        let c_w = cursor_column(env, cursor, "width");
        let c_h = cursor_column(env, cursor, "height");
        let c_mime = cursor_column(env, cursor, "mime_type");

        let id = cursor_long(env, cursor, c_id);
        if id <= 0 {
            return Ok(None);
        }
        let bucket = cursor_string(env, cursor, c_bucket);
        let name = cursor_string(env, cursor, c_name);
        let path = cursor_string(env, cursor, c_data);
        let mtime = cursor_long(env, cursor, c_date) * 1000;
        let width = cursor_int(env, cursor, c_w);
        let height = cursor_int(env, cursor, c_h);
        let mime = cursor_string(env, cursor, c_mime);

        // content://media/external/images/media/<id>
        let cu = env.find_class("android/content/ContentUris")?;
        let appended = env
            .call_static_method(
                cu,
                "withAppendedId",
                "(Landroid/net/Uri;J)Landroid/net/Uri;",
                &[uri_base.into(), JValue::Long(id)],
            )?
            .l()?;
        let s = env
            .call_method(&appended, "toString", "()Ljava/lang/String;", &[])?
            .l()?;
        let js: &JString = (&s).into();
        let uri: String = env.get_string(js)?.into();

        Ok(Some(MediaPhoto {
            id,
            bucket,
            name,
            path,
            uri,
            mtime,
            width,
            height,
            mime,
        }))
    })
    .ok()
    .flatten()
}

const PHOTO_PROJECTION: &[&str] = &[
    "_id",
    "bucket_display_name",
    "_display_name",
    "_data",
    "date_modified",
    "width",
    "height",
    "mime_type",
];

fn photo_projection() -> Vec<String> {
    PHOTO_PROJECTION.iter().map(|s| (*s).to_owned()).collect()
}

/* ---------------- 命令实现 ---------------- */

fn list_albums(env: &mut JNIEnv<'_>, activity: &JObject<'_>) -> Vec<MediaAlbum> {
    let mut out: Vec<MediaAlbum> = Vec::new();
    let Some(resolver) = content_resolver(env, activity) else {
        return out;
    };
    let Some(uri) = media_store_uri(env) else {
        return out;
    };
    let projection = vec!["bucket_display_name".to_owned()];
    let Some(cursor) = query_media(
        env,
        &resolver,
        &uri,
        &projection,
        None,
        &[],
        Some("date_modified DESC"),
    ) else {
        return out;
    };

    let mut counts: HashMap<String, usize> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    let mut rows = 0usize;
    while rows < MAX_INDEX_ROWS && cursor_next(env, &cursor) {
        rows += 1;
        let name = env
            .with_local_frame(16, |env| -> Result<String, jni::errors::Error> {
                let idx = cursor_column(env, &cursor, "bucket_display_name");
                Ok(cursor_string(env, &cursor, idx))
            })
            .unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        let entry = counts.entry(name.clone()).or_insert(0);
        if *entry == 0 {
            order.push(name);
        }
        *entry += 1;
    }
    close_cursor(env, &cursor);

    for name in order {
        if let Some(count) = counts.get(&name) {
            out.push(MediaAlbum {
                name,
                count: *count,
            });
        }
    }
    // 张数多的相册排前面：用户找「淳安县」时不用翻
    out.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    out
}

fn all_photos(env: &mut JNIEnv<'_>, activity: &JObject<'_>) -> Vec<MediaPhoto> {
    let mut out: Vec<MediaPhoto> = Vec::new();
    let Some(resolver) = content_resolver(env, activity) else {
        return out;
    };
    let Some(uri) = media_store_uri(env) else {
        return out;
    };
    let Some(cursor) = query_media(
        env,
        &resolver,
        &uri,
        &photo_projection(),
        None,
        &[],
        Some("date_modified DESC"),
    ) else {
        return out;
    };
    while out.len() < MAX_INDEX_ROWS && cursor_next(env, &cursor) {
        if let Some(p) = read_photo_row(env, &cursor, &uri) {
            out.push(p);
        }
    }
    close_cursor(env, &cursor);
    out
}

fn album_photos(env: &mut JNIEnv<'_>, activity: &JObject<'_>, album: &str) -> Vec<MediaPhoto> {
    let mut out: Vec<MediaPhoto> = Vec::new();
    if album.is_empty() {
        return out;
    }
    let Some(resolver) = content_resolver(env, activity) else {
        return out;
    };
    let Some(uri) = media_store_uri(env) else {
        return out;
    };
    let args = vec![album.to_owned()];
    let Some(cursor) = query_media(
        env,
        &resolver,
        &uri,
        &photo_projection(),
        Some("bucket_display_name = ?"),
        &args,
        Some("date_modified DESC"),
    ) else {
        return out;
    };
    while out.len() < MAX_ALBUM_ROWS && cursor_next(env, &cursor) {
        if let Some(p) = read_photo_row(env, &cursor, &uri) {
            out.push(p);
        }
    }
    close_cursor(env, &cursor);
    out
}

fn photo_bytes(env: &mut JNIEnv<'_>, activity: &JObject<'_>, uri_str: &str) -> Option<Vec<u8>> {
    let cls = env.find_class("android/net/Uri").ok()?;
    let s = env.new_string(uri_str).ok()?;
    let uri = env
        .call_static_method(
            cls,
            "parse",
            "(Ljava/lang/String;)Landroid/net/Uri;",
            &[(&s).into()],
        )
        .ok()?
        .l()
        .ok()?;
    let resolver = content_resolver(env, activity)?;
    let stream = env
        .call_method(
            &resolver,
            "openInputStream",
            "(Landroid/net/Uri;)Ljava/io/InputStream;",
            &[(&uri).into()],
        )
        .ok()?
        .l()
        .ok()?;
    if stream.as_raw().is_null() {
        let _ = env.exception_clear();
        return None;
    }

    let mut out: Vec<u8> = Vec::new();
    let Ok(buf) = env.new_byte_array(16 * 1024) else {
        return None;
    };
    loop {
        let n = match env.call_method(&stream, "read", "([B)I", &[(&buf).into()]) {
            Ok(v) => v.i().unwrap_or(-1),
            Err(_) => {
                let _ = env.exception_clear();
                break;
            }
        };
        if n <= 0 {
            break;
        }
        let chunk = env.convert_byte_array(&buf).unwrap_or_default();
        let take = (n as usize).min(chunk.len());
        out.extend_from_slice(&chunk[..take]);
        if out.len() > 64 * 1024 * 1024 {
            break; // 防御：单张不该超过 64MB
        }
    }
    let _ = env.call_method(&stream, "close", "()V", &[]);
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/* ---------------- Tauri 命令 ---------------- */

#[tauri::command]
pub async fn media_permission_state(app: AppHandle) -> Result<bool, String> {
    await_dispatch(&app, check_permission, "查询相册权限").await
}

/// 拉起系统权限弹窗。弹窗是异步的，这里只能返回「当前」状态；
/// 前端应在 `visibilitychange`（从权限弹窗回到 App）后再查一次。
#[tauri::command]
pub async fn media_request_permission(app: AppHandle) -> Result<bool, String> {
    await_dispatch(
        &app,
        |env, activity| {
            request_permission(env, activity);
            check_permission(env, activity)
        },
        "申请相册权限",
    )
    .await
}

#[tauri::command]
pub async fn media_list_albums(app: AppHandle) -> Result<Vec<MediaAlbum>, String> {
    await_dispatch(&app, list_albums, "读取相册列表").await
}

#[tauri::command]
pub async fn media_all_photos(app: AppHandle) -> Result<Vec<MediaPhoto>, String> {
    await_dispatch(&app, all_photos, "读取照片").await
}

#[tauri::command]
pub async fn media_album_photos(app: AppHandle, album: String) -> Result<Vec<MediaPhoto>, String> {
    await_dispatch(
        &app,
        move |env, activity| album_photos(env, activity, &album),
        "读取相册照片",
    )
    .await
}

/// 按 content:// URI 读原始字节（DATA 路径缺失时的兜底，也用于把照片复制进游记）
#[tauri::command]
pub async fn media_photo_bytes(app: AppHandle, uri: String) -> Result<Response, String> {
    let bytes = await_dispatch(
        &app,
        move |env, activity| photo_bytes(env, activity, &uri),
        "读取照片字节",
    )
    .await?;
    match bytes {
        Some(b) => Ok(Response::new(b)),
        None => Err("读取照片字节失败".to_string()),
    }
}
