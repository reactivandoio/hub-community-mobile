package com.topwise.cloudpos.aidl;

// Recovered from the device's own /system/app/TOPUSDKService/TOPUSDKService.apk:
// the transaction codes in AidlDeviceService$Stub gave the declaration order,
// which is all that matters — AIDL numbers methods by position, not by name or
// signature. Only getCameraManager (12) is called here, so the eleven before it
// are placeholders that exist purely to occupy codes 1..11.
interface AidlDeviceService {
    IBinder reserved1();
    IBinder reserved2();
    IBinder reserved3();
    IBinder reserved4();
    IBinder reserved5();
    IBinder reserved6();
    IBinder reserved7();
    IBinder reserved8();
    IBinder reserved9();
    IBinder reserved10();
    IBinder reserved11();
    IBinder getCameraManager();
}
