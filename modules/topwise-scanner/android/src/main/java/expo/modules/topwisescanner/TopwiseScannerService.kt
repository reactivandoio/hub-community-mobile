package expo.modules.topwisescanner

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import com.topwise.cloudpos.aidl.AidlDeviceService
import com.topwise.cloudpos.aidl.camera.AidlCameraScanCode

/**
 * The single connection to the totem's vendor service, shared by the module and
 * the preview view. Binding is asynchronous, so callers hand in what they want
 * done once the camera manager is up rather than blocking the main thread.
 */
const val SERVICE_ACTION = "topwise_cloudpos_device_service"
const val SERVICE_PACKAGE = "com.android.topwise.topusdkservice"

object TopwiseScannerService {
  private var deviceService: AidlDeviceService? = null
  private var connection: ServiceConnection? = null
  private val waiting = mutableListOf<(AidlCameraScanCode) -> Unit>()

  fun isAvailable(context: Context): Boolean {
    val intent = Intent(SERVICE_ACTION).setPackage(SERVICE_PACKAGE)
    return context.packageManager.queryIntentServices(intent, 0).isNotEmpty()
  }

  /** The vendor's own classes: its Parcelables know their wire format, we do not. */
  fun vendorClassLoader(context: Context): ClassLoader =
    context
      .createPackageContext(SERVICE_PACKAGE, Context.CONTEXT_INCLUDE_CODE or Context.CONTEXT_IGNORE_SECURITY)
      .classLoader

  /** Already-bound camera manager, or null while the connection is still coming up. */
  fun cameraManager(context: Context): AidlCameraScanCode? =
    deviceService?.let { AidlCameraScanCode.Stub.asInterface(it.cameraManager) }

  fun withCamera(context: Context, block: (AidlCameraScanCode) -> Unit) {
    cameraManager(context)?.let {
      block(it)
      return
    }

    waiting += block
    if (connection != null) return

    val bound = object : ServiceConnection {
      override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
        deviceService = AidlDeviceService.Stub.asInterface(binder)
        val camera = cameraManager(context) ?: return
        val pending = waiting.toList()
        waiting.clear()
        pending.forEach { it(camera) }
      }

      override fun onServiceDisconnected(name: ComponentName?) {
        deviceService = null
      }
    }

    connection = bound
    val intent = Intent(SERVICE_ACTION).setPackage(SERVICE_PACKAGE)
    if (!context.applicationContext.bindService(intent, bound, Context.BIND_AUTO_CREATE)) {
      connection = null
      waiting.clear()
      throw IllegalStateException("Could not bind $SERVICE_PACKAGE ($SERVICE_ACTION)")
    }
  }
}

/**
 * Continuous decoding, with no preview and no view.
 *
 * The reader on this totem is a fixed spot below the screen, not a camera the
 * person aims — so there is nothing useful to show, and the earlier in-screen
 * preview only ever rendered black anyway. The session streams results straight
 * to [onResult] until [stopDecode].
 */
object TopwiseDecoder {
  private const val CAMERA_DESCRIPTOR = "com.topwise.cloudpos.aidl.camera.AidlCameraScanCode"
  private const val TX_START_DECODE = 3
  private const val TX_STOP_DECODE = 4

  private var running = false
  private var callback: com.topwise.cloudpos.aidl.camera.AidlDecodeCallBack.Stub? = null

  fun start(context: Context, onResult: (String) -> Unit, onError: (Int) -> Unit) {
    if (running) return
    running = true

    val stub = object : com.topwise.cloudpos.aidl.camera.AidlDecodeCallBack.Stub() {
      override fun onResult(result: String?) {
        if (!result.isNullOrBlank()) onResult(result)
      }

      override fun onError(error: Int) = onError(error)

      // Frames arrive whether or not anyone draws them; dropping them here keeps
      // a 2 GB device from paying for a preview nobody sees.
      override fun onPreview(frame: ByteArray?, width: Int, height: Int) = Unit
    }
    callback = stub

    TopwiseScannerService.withCamera(context) { camera ->
      val vendor = TopwiseScannerService.vendorClassLoader(context)
      val parameterClass = vendor.loadClass("com.topwise.cloudpos.aidl.camera.DecodeParameter")
      val modeClass = vendor.loadClass("com.topwise.cloudpos.aidl.camera.DecodeMode")
      val parameter = parameterClass.getConstructor().newInstance()
      runCatching {
        val continuous = modeClass.getField("MODE_CONTINUE_SCAN_CODE").get(null)
        parameterClass.getMethod("setDecodeMode", modeClass).invoke(parameter, continuous)
      }

      transact(camera.asBinder(), TX_START_DECODE) { data ->
        data.writeInt(1)
        // The vendor object writes itself: DecodeParameter's parcel layout is its
        // own business, and guessing it from field order would be a coin flip.
        parameterClass
          .getMethod("writeToParcel", android.os.Parcel::class.java, Int::class.javaPrimitiveType)
          .invoke(parameter, data, 0)
        data.writeStrongBinder(stub.asBinder())
      }
    }
  }

  /**
   * Always call this. The service keeps an `isScanIng` flag and holds the camera,
   * so a session left open makes every later read come up black.
   */
  fun stop(context: Context) {
    if (!running) return
    running = false
    callback = null
    TopwiseScannerService.cameraManager(context)?.let {
      runCatching { transact(it.asBinder(), TX_STOP_DECODE) {} }
    }
  }

  private fun transact(binder: IBinder, code: Int, write: (android.os.Parcel) -> Unit) {
    val data = android.os.Parcel.obtain()
    val reply = android.os.Parcel.obtain()
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
