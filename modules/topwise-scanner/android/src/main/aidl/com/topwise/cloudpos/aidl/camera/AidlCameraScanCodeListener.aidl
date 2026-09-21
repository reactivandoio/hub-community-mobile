package com.topwise.cloudpos.aidl.camera;

// Order matches AidlCameraScanCodeListener$Stub: onResult 1, onCancel 2,
// onError 3, onTimeout 4.
interface AidlCameraScanCodeListener {
    void onResult(String result);
    void onCancel();
    void onError(int error);
    void onTimeout();
}
