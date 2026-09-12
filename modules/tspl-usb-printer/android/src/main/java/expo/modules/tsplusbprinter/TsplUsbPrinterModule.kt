package expo.modules.tsplusbprinter

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Base64
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.ByteArrayOutputStream
import kotlin.math.ceil
import kotlin.math.roundToInt

private const val ACTION_USB_PERMISSION = "expo.modules.tsplusbprinter.USB_PERMISSION"
private const val WRITE_TIMEOUT_MS = 5000
private const val CHUNK_SIZE = 16 * 1024

class PrinterError(message: String) : CodedException("ERR_TSPL_PRINTER", message, null)

// Physical label geometry. Defaults match the 4BARCODE 4B-2074A with 4in x 2in labels.
class LabelOptions : Record {
  @Field val widthMm: Double = 101.6
  @Field val heightMm: Double = 50.8
  @Field val gapMm: Double = 3.0
  @Field val dpi: Int = 203
  @Field val density: Int = 8
  @Field val direction: Int = 0
  @Field val threshold: Int = 128
}

class TsplUsbPrinterModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val usbManager: UsbManager
    get() = context.getSystemService(Context.USB_SERVICE) as UsbManager

  private var permissionPromise: Promise? = null
  private var permissionReceiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("TsplUsbPrinter")

    Function("listDevices") {
      usbManager.deviceList.values.map { device ->
        mapOf(
          "deviceName" to device.deviceName,
          "vendorId" to device.vendorId,
          "productId" to device.productId,
          "productName" to device.productName,
          "manufacturerName" to device.manufacturerName,
          "hasPermission" to usbManager.hasPermission(device),
        )
      }
    }

    AsyncFunction("requestPermission") { deviceName: String, promise: Promise ->
      val device = findDevice(deviceName)
      if (usbManager.hasPermission(device)) {
        promise.resolve(true)
        return@AsyncFunction
      }
      permissionPromise?.reject(PrinterError("Permission request superseded"))
      permissionPromise = promise
      registerPermissionReceiver()
      val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
      val intent = Intent(ACTION_USB_PERMISSION).setPackage(context.packageName)
      usbManager.requestPermission(device, PendingIntent.getBroadcast(context, 0, intent, flags))
    }

    // Sends raw TSPL (base64-encoded bytes) to the printer.
    AsyncFunction("printRaw") { deviceName: String, base64: String ->
      write(findDevice(deviceName), Base64.decode(base64, Base64.DEFAULT))
    }

    // Prints a PNG (base64) as a 1-bit TSPL BITMAP filling the whole label.
    AsyncFunction("printBitmap") { deviceName: String, pngBase64: String, options: LabelOptions ->
      val png = Base64.decode(pngBase64, Base64.DEFAULT)
      val bitmap = BitmapFactory.decodeByteArray(png, 0, png.size) ?: throw PrinterError("Invalid PNG")
      write(findDevice(deviceName), buildBitmapJob(bitmap, options))
    }

    OnDestroy {
      unregisterPermissionReceiver()
    }
  }

  private fun findDevice(deviceName: String): UsbDevice =
    usbManager.deviceList[deviceName] ?: throw PrinterError("USB device not found: $deviceName")

  private fun registerPermissionReceiver() {
    if (permissionReceiver != null) return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != ACTION_USB_PERMISSION) return
        val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
        permissionPromise?.resolve(granted)
        permissionPromise = null
      }
    }
    ContextCompat.registerReceiver(
      context, receiver, IntentFilter(ACTION_USB_PERMISSION), ContextCompat.RECEIVER_NOT_EXPORTED,
    )
    permissionReceiver = receiver
  }

  private fun unregisterPermissionReceiver() {
    permissionReceiver?.let { runCatching { context.unregisterReceiver(it) } }
    permissionReceiver = null
  }

  // Bulk-writes `data` to the first OUT endpoint of the printer interface.
  private fun write(device: UsbDevice, data: ByteArray) {
    if (!usbManager.hasPermission(device)) throw PrinterError("No permission for ${device.deviceName}")
    val (intf, endpoint) = findOutEndpoint(device)
    val connection = usbManager.openDevice(device) ?: throw PrinterError("Could not open ${device.deviceName}")
    try {
      if (!connection.claimInterface(intf, true)) throw PrinterError("Could not claim printer interface")
      var offset = 0
      while (offset < data.size) {
        val len = minOf(CHUNK_SIZE, data.size - offset)
        // Offset overload (API 18+): no per-chunk copy of the raster.
        val sent = connection.bulkTransfer(endpoint, data, offset, len, WRITE_TIMEOUT_MS)
        if (sent < 0) throw PrinterError("USB write failed at byte $offset of ${data.size}")
        // 0 bytes accepted within the timeout: the printer stalled (buffer
        // full, paper out, half-unplugged). Looping would spin forever.
        if (sent == 0) throw PrinterError("USB write stalled at byte $offset of ${data.size}")
        offset += sent
      }
    } finally {
      runCatching { connection.releaseInterface(intf) }
      connection.close()
    }
  }

  private fun findOutEndpoint(device: UsbDevice): Pair<UsbInterface, UsbEndpoint> {
    // Prefer the printer-class interface; fall back to any interface with a bulk OUT endpoint.
    val interfaces = (0 until device.interfaceCount).map { device.getInterface(it) }
      .sortedByDescending { it.interfaceClass == UsbConstants.USB_CLASS_PRINTER }
    for (intf in interfaces) {
      for (i in 0 until intf.endpointCount) {
        val ep = intf.getEndpoint(i)
        if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.direction == UsbConstants.USB_DIR_OUT) {
          return intf to ep
        }
      }
    }
    throw PrinterError("No bulk OUT endpoint on ${device.deviceName}")
  }
}

// TSPL job: label setup + the PNG rendered as a 1bpp BITMAP (0 = black) + PRINT.
internal fun buildBitmapJob(source: Bitmap, o: LabelOptions): ByteArray {
  val dotsPerMm = o.dpi / 25.4
  val widthBytes = ceil(o.widthMm * dotsPerMm / 8).toInt()
  val width = widthBytes * 8
  val height = (o.heightMm * dotsPerMm).roundToInt()
  val bitmap = Bitmap.createScaledBitmap(source, width, height, true)

  val pixels = IntArray(width * height)
  bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
  val raster = ByteArray(widthBytes * height) { 0xFF.toByte() }
  for (y in 0 until height) {
    for (x in 0 until width) {
      val p = pixels[y * width + x]
      val alpha = (p ushr 24) and 0xFF
      val r = (p shr 16) and 0xFF
      val g = (p shr 8) and 0xFF
      val b = p and 0xFF
      // Transparent pixels are treated as white paper.
      val luma = if (alpha < 128) 255 else (r * 299 + g * 587 + b * 114) / 1000
      if (luma < o.threshold) {
        val index = y * widthBytes + x / 8
        raster[index] = (raster[index].toInt() and (0x80 ushr (x % 8)).inv()).toByte()
      }
    }
  }

  val out = ByteArrayOutputStream()
  fun cmd(s: String) = out.write("$s\r\n".toByteArray(Charsets.US_ASCII))
  cmd("SIZE ${o.widthMm} mm,${o.heightMm} mm")
  cmd("GAP ${o.gapMm} mm,0 mm")
  cmd("DIRECTION ${o.direction}")
  cmd("DENSITY ${o.density}")
  cmd("CLS")
  out.write("BITMAP 0,0,$widthBytes,$height,0,".toByteArray(Charsets.US_ASCII))
  out.write(raster)
  out.write("\r\n".toByteArray(Charsets.US_ASCII))
  cmd("PRINT 1,1")
  return out.toByteArray()
}
