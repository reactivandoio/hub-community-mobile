package com.topwise.cloudpos.aidl.camera;

import com.topwise.cloudpos.aidl.camera.AidlCameraScanCodeListener;

// Order matches AidlCameraScanCode$Stub: scanCode 1, stopScan 2. The rest of
// the interface (startDecode, flash and exposure setters…) is not used.
interface AidlCameraScanCode {
    void scanCode(in Bundle params, AidlCameraScanCodeListener listener);
    void stopScan();
}
