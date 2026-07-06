# Glance Responder (Android)

Standalone Capacitor app for field responders. Pairs once via QR from
Glance → Responders → 📱 Provision, then streams GPS to `dispatch-ping`
whenever the operator dispatches this responder.

## Build

```bash
cd apps/responder-android
npm install
npm run build                # produces dist/
npx cap add android          # first time only
npx cap sync android
npx cap open android         # opens Android Studio
```

Then in Android Studio: **Build → Build APK(s)** and sideload the APK
onto the responder's phone (enable "Install unknown apps" for the
transfer method — Drive, USB, etc.).

## Required Android manifest additions

Edit `android/app/src/main/AndroidManifest.xml` after `cap add android`
and add these inside `<manifest>` above `<application>`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-permission android:name="android.permission.CAMERA" />
```

## Pairing QR payload

The Provision dialog on the Glance Responders page must produce a QR
containing JSON of this shape:

```json
{
  "endpoint": "https://your-supabase-host/functions/v1",
  "anon_key": "eyJhbGci...",
  "token": "device-token-uuid",
  "responder_id": "uuid",
  "responder_name": "Alice"
}
```

If the existing `ProvisionDeviceDialog` currently encodes only the token,
update it to encode the full JSON above (endpoint + anon_key + token +
responder metadata) so this app has everything it needs after a single
scan.

## Runtime behavior

- Foreground app polls `dispatch-poll` every 15 s while idle, 10 s while
  a dispatch is active.
- While a dispatch is `pending` or `en_route`, `Geolocation.watchPosition`
  streams fixes to `dispatch-ping`. Server-side geofence promotes the
  dispatch to `on_site` on arrival.
- Manual **Acknowledge / Arrived / Complete** buttons hit `dispatch-state`.
- Background tracking on Android 10+ requires the user to grant
  "Allow all the time" on the location permission prompt.
