package expo.modules.topwisescanner

import android.content.Context
import android.os.Bundle
import com.topwise.cloudpos.aidl.camera.AidlCameraScanCodeListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.Serializable
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The totem's own scanner, reached through the vendor service instead of CameraX.
 *
 * On the Gertec SK-210 `expo-camera` opens either lens, reports no error and
 * renders nothing, while the device's stock camera app works — the gap is
 * CameraX, not the hardware. The vendor service (`com.android.topwise.topusdkservice`,
 * a rebadged Topwise CloudPOS build) drives the camera itself.
 *
 * Two ways in: `scan()` hands the screen to the vendor's own full-screen reader,
 * while `TopwiseScannerView` keeps the preview inside our layout. The AIDL under
 * `src/main/aidl` was recovered from the service APK pulled off the device — the
 * transaction codes in each `$Stub` gave the declaration order, which is what
 * AIDL numbers by.
 */
// `CameraBinder.scanCode` reads `getSerializable("scanCode")`, cast to
// com.topwise.cloudpos.data.AidlScanParam; an empty Bundle earns
// ERROR_INPUT_PARAMS (109007). That class declares no serialVersionUID, so a
// hand-written copy would fail to deserialize — it comes from the service's APK.
private const val KEY_SCAN_PARAM = "scanCode"
private const val PARAM_CLASS = "com.topwise.cloudpos.data.AidlScanParam"

class TopwiseScannerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No react context")

  override fun definition() = ModuleDefinition {
    Name("TopwiseScanner")

    // False on the operators' phones, which have no such service and must keep
    // working anyway.
    Function("isAvailable") { TopwiseScannerService.isAvailable(context) }

    AsyncFunction("scan") { cameraId: Int, timeoutSeconds: Int, title: String, reminder: String, promise: Promise ->
      val settled = AtomicBoolean(false)
      // The service keeps an `isScanIng` flag and holds the camera session until
      // told otherwise: without stopping it the first read works and every one
      // after it comes up black.
      fun finish(block: () -> Unit) {
        if (!settled.compareAndSet(false, true)) return
        runCatching { TopwiseScannerService.cameraManager(context)?.stopScan() }
        block()
      }

      val listener = object : AidlCameraScanCodeListener.Stub() {
        override fun onResult(result: String?) = finish { promise.resolve(result) }
        override fun onCancel() = finish { promise.resolve(null) }
        override fun onTimeout() = finish { promise.resolve(null) }
        override fun onError(error: Int) =
          finish { promise.reject("SCAN_ERROR", "Scanner returned error $error", null) }
      }

      try {
        val params = Bundle().apply {
          putSerializable(KEY_SCAN_PARAM, scanParam(cameraId, timeoutSeconds, title, reminder))
        }
        TopwiseScannerService.withCamera(context) { camera -> camera.scanCode(params, listener) }
      } catch (err: Throwable) {
        finish { promise.reject("SCAN_FAILED", err.message ?: "Could not start the scanner", err) }
      }
    }

    View(TopwiseScannerView::class) {
      Events("onScanned", "onScanError")

      // Held while the check-in overlay is up, so the next person in the queue
      // cannot scan over someone else's badge.
      Prop("paused") { view: TopwiseScannerView, paused: Boolean ->
        view.paused = paused
      }
    }
  }

  /**
   * The vendor's own `AidlScanParam`. Constructors seen in the APK:
   * `(int cameraId, int timeOut)` and `(int, int, String title, String reminder, String amount)`.
   */
  private fun scanParam(cameraId: Int, timeoutSeconds: Int, title: String, reminder: String): Serializable {
    val klass = TopwiseScannerService.vendorClassLoader(context).loadClass(PARAM_CLASS)
    val instance = runCatching {
      klass.getConstructor(
        Int::class.javaPrimitiveType,
        Int::class.javaPrimitiveType,
        String::class.java,
        String::class.java,
        String::class.java,
      ).newInstance(cameraId, timeoutSeconds, title, reminder, "")
    }.getOrElse {
      klass.getConstructor(Int::class.javaPrimitiveType, Int::class.javaPrimitiveType)
        .newInstance(cameraId, timeoutSeconds)
    }
    return instance as Serializable
  }
}
