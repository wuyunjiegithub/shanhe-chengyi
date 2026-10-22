package com.ankon.shanhechengyi

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // 把系统相册只读桥挂到 WebView 上：JS 侧通过 window.ShanheMedia 调用。
  // 用 addJavascriptInterface 而不是 Tauri 插件，是因为后者需要独立的 Android 库项目
  // 加 Rust 侧 mobile.rs 桥接，代价远高于本 App 需要的两个只读查询。
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.settings.javaScriptEnabled = true
    webView.addJavascriptInterface(MediaBridge(this), "ShanheMedia")
  }
}
