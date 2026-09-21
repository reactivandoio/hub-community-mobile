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
