/// 应用入口。
/// `mobile_entry_point` 是后续打 Android APK 时必须的宏（桌面端自动忽略）。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("启动山河城邑失败");
}
