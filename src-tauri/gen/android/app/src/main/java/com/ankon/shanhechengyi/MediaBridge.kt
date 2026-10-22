package com.ankon.shanhechengyi

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * 系统相册只读桥。
 *
 * WebView 里的 JS 拿不到 MediaStore，而本 App 的照片绑定键就是**相册名**
 * （Android 的相册名即照片所在目录名，相册之间平级、没有子相册），
 * 所以把「列出相册 / 列出某个相册的照片」做成 JS 接口，
 * 前端拿相册名与区县名做同名匹配即可自动绑定，不需要用户理解任何目录树。
 *
 * 注意：@JavascriptInterface 的方法跑在 WebView 线程，查询量级是「相册数 × 每相册照片数」，
 * 只在启动与打开照片墙时调用，同步返回足够快，不必引入回调复杂度。
 */
class MediaBridge(private val activity: Activity) {

  private val context: Context get() = activity
  private val imagesUri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI

  /** Android 13+ 用 READ_MEDIA_IMAGES，旧版用 READ_EXTERNAL_STORAGE */
  private fun permission(): String =
    if (Build.VERSION.SDK_INT >= 33) android.Manifest.permission.READ_MEDIA_IMAGES
    else android.Manifest.permission.READ_EXTERNAL_STORAGE

  @JavascriptInterface
  fun hasPermission(): Boolean {
    return ContextCompat.checkSelfPermission(context, permission()) == PackageManager.PERMISSION_GRANTED
  }

  /** 拉起系统权限弹窗；返回是否已具备权限 */
  @JavascriptInterface
  fun requestPermission(): Boolean {
    if (hasPermission()) return true
    ActivityCompat.requestPermissions(activity, arrayOf(permission()), 9911)
    return false
  }

  /** 全部相册（名 + 张数），JSON 数组字符串 */
  @JavascriptInterface
  fun listAlbums(): String {
    if (!hasPermission()) return "[]"
    val counts = linkedMapOf<String, Int>()
    val projection = arrayOf(MediaStore.Images.Media.BUCKET_DISPLAY_NAME)
    query(projection, null, null) { c ->
      val idx = c.getColumnIndex(MediaStore.Images.Media.BUCKET_DISPLAY_NAME)
      while (c.moveToNext()) {
        val name = if (idx >= 0) c.getString(idx) else null
        if (name.isNullOrEmpty()) continue
        counts[name] = (counts[name] ?: 0) + 1
      }
    }
    val arr = JSONArray()
    for ((name, count) in counts) {
      val o = JSONObject()
      o.put("name", name)
      o.put("count", count)
      arr.put(o)
    }
    return arr.toString()
  }

  /** 某个相册里的照片，JSON 数组字符串（按修改时间倒序） */
  @JavascriptInterface
  fun listAlbumPhotos(album: String): String {
    if (!hasPermission()) return "[]"
    val projection = arrayOf(
      MediaStore.Images.Media._ID,
      MediaStore.Images.Media.DISPLAY_NAME,
      MediaStore.Images.Media.DATA,
      MediaStore.Images.Media.DATE_MODIFIED,
      MediaStore.Images.Media.WIDTH,
      MediaStore.Images.Media.HEIGHT,
      MediaStore.Images.Media.MIME_TYPE,
    )
    val selection = "${MediaStore.Images.Media.BUCKET_DISPLAY_NAME} = ?"
    val sort = "${MediaStore.Images.Media.DATE_MODIFIED} DESC"
    val arr = JSONArray()
    query(projection, selection, arrayOf(album), sort) { c ->
      val iId = c.getColumnIndex(MediaStore.Images.Media._ID)
      val iName = c.getColumnIndex(MediaStore.Images.Media.DISPLAY_NAME)
      val iData = c.getColumnIndex(MediaStore.Images.Media.DATA)
      val iDate = c.getColumnIndex(MediaStore.Images.Media.DATE_MODIFIED)
      val iW = c.getColumnIndex(MediaStore.Images.Media.WIDTH)
      val iH = c.getColumnIndex(MediaStore.Images.Media.HEIGHT)
      val iMime = c.getColumnIndex(MediaStore.Images.Media.MIME_TYPE)
      while (c.moveToNext()) {
        // DATA 列在 Android 10+ 已废弃，但对相册里绝大多数照片仍返回绝对路径；
        // 拿不到路径的照片无法渲染，直接跳过（丢一条好过整块裂图）
        val data = if (iData >= 0) c.getString(iData) else null
        if (data.isNullOrEmpty()) continue
        val o = JSONObject()
        o.put("id", if (iId >= 0) c.getLong(iId) else 0)
        o.put("name", if (iName >= 0) c.getString(iName) else "")
        o.put("path", data)
        o.put("mtime", (if (iDate >= 0) c.getLong(iDate) else 0L) * 1000L)
        o.put("width", if (iW >= 0) c.getInt(iW) else 0)
        o.put("height", if (iH >= 0) c.getInt(iH) else 0)
        o.put("mime", if (iMime >= 0) c.getString(iMime) else "")
        arr.put(o)
      }
    }
    return arr.toString()
  }

  private fun query(
    projection: Array<String>,
    selection: String?,
    args: Array<String>?,
    sort: String? = null,
    block: (android.database.Cursor) -> Unit,
  ) {
    val resolver: ContentResolver = context.contentResolver
    try {
      resolver.query(imagesUri, projection, selection, args, sort)?.use(block)
    } catch (_: Exception) {
      /* 权限被拒或 MediaStore 异常：返回空结果，前端按「没有相册」处理 */
    }
  }
}
