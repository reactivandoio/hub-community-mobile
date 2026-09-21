package expo.modules.topwisescanner

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.os.Parcel
import android.widget.ImageView
import com.topwise.cloudpos.aidl.camera.AidlDecodeCallBack
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.ByteArrayOutputStream

/**
 * A live preview that stays inside our own layout.
 *
 * `scanCode` — the other entry point on the vendor service — takes the whole
 * screen for itself. `startDecode` instead streams the camera to
 * `AidlDecodeCallBack`: `onResult` for a decoded payload and `onPreview` for the
 * raw frames, which is what lets the preview live in a card next to the rest of
 * the kiosk.
 */
private const val CAMERA_DESCRIPTOR = "com.topwise.cloudpos.aidl.camera.AidlCameraScanCode"
private const val TX_START_DECODE = 3
private const val TX_STOP_DECODE = 4
private const val TX_SET_PREVIEW_ENABLE = 11

// A totem queue does not need 30 fps, and this device has 2 GB of RAM: every
// frame costs a YUV→JPEG→Bitmap round trip on the main-thread handler.
private const val MIN_FRAME_GAP_MS = 100L

class TopwiseScannerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onScanned by EventDispatcher()
  private val onScanError by EventDispatcher()

  private val preview = ImageView(context).apply {
    scaleType = ImageView.ScaleType.CENTER_CROP
  }

  private var lastFrameAt = 0L
  private var running = false

  var cameraId: Int = 0
  var paused: Boolean = false

  init {
    addView(preview)
  }

  private val callback = object : AidlDecodeCallBack.Stub() {
    override fun onResult(result: String?) {
      if (result.isNullOrBlank() || paused) return
      post { onScanned(mapOf("payload" to result)) }
    }

    override fun onError(error: Int) {
      post { onScanError(mapOf("code" to error)) }
    }

    override fun onPreview(frame: ByteArray?, width: Int, height: Int) {
      if (frame == null || width <= 0 || height <= 0) return
      val now = System.currentTimeMillis()
      if (now - lastFrameAt < MIN_FRAME_GAP_MS) return
      lastFrameAt = now

      val jpeg = ByteArrayOutputStream()
      // The service hands over NV21, the format Android cameras preview in.
      YuvImage(frame, ImageFormat.NV21, width, height, null)
        .compressToJpeg(Rect(0, 0, width, height), 80, jpeg)
      val bytes = jpeg.toByteArray()
      val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return
      post { preview.setImageBitmap(bitmap) }
    }
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    preview.layout(0, 0, r - l, b - t)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    start()
  }

  override fun onDetachedFromWindow() {
    stop()
    super.onDetachedFromWindow()
  }

  fun start() {
    if (running) return
    running = true
    TopwiseScannerService.withCamera(context) { scanner -> beginDecode(scanner.asBinder()) }
  }

  private fun beginDecode(binder: android.os.IBinder) {
    transact(binder, TX_SET_PREVIEW_ENABLE) { it.writeInt(1) }

    val vendor = TopwiseScannerService.vendorClassLoader(context)
    val parameterClass = vendor.loadClass("com.topwise.cloudpos.aidl.camera.DecodeParameter")
    val modeClass = vendor.loadClass("com.topwise.cloudpos.aidl.camera.DecodeMode")
    val parameter = parameterClass.getConstructor().newInstance()
    runCatching {
      val continuous = modeClass.getField("MODE_CONTINUE_SCAN_CODE").get(null)
      parameterClass.getMethod("setDecodeMode", modeClass).invoke(parameter, continuous)
    }

    transact(binder, TX_START_DECODE) { data ->
      data.writeInt(1)
      // The vendor object writes itself: DecodeParameter's parcel layout is its
      // own business, and guessing it from the field order would be a coin flip.
      parameterClass
        .getMethod("writeToParcel", Parcel::class.java, Int::class.javaPrimitiveType)
        .invoke(parameter, data, 0)
      data.writeStrongBinder(callback.asBinder())
    }
  }

  fun stop() {
    if (!running) return
    TopwiseScannerService.cameraManager(context)?.let { transact(it.asBinder(), TX_STOP_DECODE) {} }
    running = false
  }

  private fun transact(binder: android.os.IBinder, code: Int, write: (Parcel) -> Unit) {
    val data = Parcel.obtain()
    val reply = Parcel.obtain()
    try {
      data.writeInterfaceToken(CAMERA_DESCRIPTOR)
      write(data)
      binder.transact(code, data, reply, 0)
      reply.readException()
    } finally {
      data.recycle()
      reply.recycle()
    }
  }
}
