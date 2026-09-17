import type { ExpoConfig } from "expo/config";

const apiBaseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ||
  "https://tours.zettaz.com/api/mobile";
const webOrigin =
  process.env.EXPO_PUBLIC_WEB_ORIGIN?.replace(/\/$/, "") ||
  "https://tours.zettaz.com";

const config: ExpoConfig = {
  name: "Zettaz Crew",
  slug: "zettaz-crew",
  scheme: "zettaz-crew",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "light",
  icon: "./assets/icon.png",
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.zettaz.crew",
    buildNumber: "1",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription:
        "Zettaz Crew uses the camera to scan passenger check-in codes. No photo is saved.",
      NSFaceIDUsageDescription:
        "Zettaz Crew uses Face ID to unlock the offline field cache on this device.",
    },
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
          NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
        },
      ],
    },
  },
  android: {
    package: "com.zettaz.crew",
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#11343B",
    },
    permissions: ["CAMERA", "INTERNET", "USE_BIOMETRIC", "USE_FINGERPRINT"],
  },
  plugins: [
    "expo-sqlite",
    [
      "expo-local-authentication",
      {
        faceIDPermission:
          "Allow Zettaz Crew to unlock the offline field cache with Face ID.",
      },
    ],
    [
      "expo-secure-store",
      {
        configureAndroidBackup: true,
        faceIDPermission:
          "Allow Zettaz Crew to protect your signed-in session.",
      },
    ],
    "expo-status-bar",
    [
      "expo-camera",
      {
        cameraPermission:
          "Allow Zettaz Crew to scan passenger check-in codes. No photo is saved.",
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
    [
      "expo-splash-screen",
      {
        backgroundColor: "#11343B",
        image: "./assets/splash-icon.png",
        imageWidth: 220,
      },
    ],
  ],
  extra: {
    apiBaseUrl,
    webOrigin,
    eas: {
      projectId: "06c5ee72-752e-4e24-8519-a148f57b84d3",
    },
  },
};

export default config;
