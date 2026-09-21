package com.topwise.cloudpos.aidl.camera;

// Order matches AidlDecodeCallBack$Stub: onResult 1, onError 2, onPreview 3.
// `onPreview` is what makes an in-screen preview possible at all — the service
// hands over the raw camera frames instead of taking the screen for itself.
interface AidlDecodeCallBack {
    void onResult(String result);
    void onError(int error);
    void onPreview(in byte[] frame, int width, int height);
}
