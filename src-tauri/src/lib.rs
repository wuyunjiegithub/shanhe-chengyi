#[cfg(desktop)]
use tauri::Manager;

/// 应用入口。
/// `mobile_entry_point` 是后续打 Android APK 时必须的宏（桌面端自动忽略）。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());

    // 单实例：已经有一个进程在跑时，新进程不再开第二个窗口，
    // 而是把已有窗口取消最小化并拉到前台，然后自己退出。
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .setup(|app| {
            // 桌面端打开即铺满屏幕（保留任务栏，可随时还原窗口大小）
            #[cfg(desktop)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.maximize();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动山河城邑失败");
}
