import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import Constants from "expo-constants";

// Optional: Install expo-device for more detailed device info
// npm install expo-device
let Device: any = null;
try {
  Device = require("expo-device");
} catch (e) {
  // expo-device not installed, will use fallbacks
}

const DEVICE_ID_KEY = "watsapp_device_id";

export interface DeviceInfo {
  deviceName?: string;
  deviceType: "web" | "ios" | "android";
  osName?: string;
  osVersion?: string;
  modelName?: string;
  brand?: string;
  appVersion?: string;
}

export interface UserSession {
  session_id: string;
  device_id: string;
  device_name: string | null;
  device_type: string;
  device_info: DeviceInfo | null;
  created_at: string;
  last_active_at: string;
  is_current: boolean;
}

/**
 * SessionManager handles device identification and session tracking
 * for multi-device authentication persistence.
 */
export class SessionManager {
  private static deviceId: string | null = null;

  /**
   * Generate a UUID v4
   */
  private static generateUUID(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Get or create a unique device ID for this installation.
   * Persists across app restarts and updates.
   */
  static async getDeviceId(): Promise<string> {
    // Return cached value if available
    if (this.deviceId) {
      return this.deviceId;
    }

    try {
      // Try to retrieve existing device ID
      if (Platform.OS === "web") {
        // For web, use localStorage
        if (typeof window !== "undefined") {
          let deviceId = window.localStorage.getItem(DEVICE_ID_KEY);
          if (!deviceId) {
            deviceId = this.generateUUID();
            window.localStorage.setItem(DEVICE_ID_KEY, deviceId);
          }
          this.deviceId = deviceId;
          return deviceId;
        }
      } else {
        // For mobile, use SecureStore
        let deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
        if (!deviceId) {
          deviceId = this.generateUUID();
          await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId);
        }
        this.deviceId = deviceId;
        return deviceId;
      }
    } catch (error) {
      console.error("Error getting device ID:", error);
    }

    // Fallback: generate new UUID (won't persist)
    const fallbackId = this.generateUUID();
    this.deviceId = fallbackId;
    return fallbackId;
  }

  /**
   * Get device information for session tracking
   */
  static async getDeviceInfo(): Promise<DeviceInfo> {
    const deviceType = Platform.OS === "web" ? "web" : Platform.OS;

    if (Platform.OS === "web") {
      return {
        deviceType: "web",
        deviceName: typeof navigator !== "undefined" ? navigator.userAgent : "Web Browser",
        osName: "Web",
        appVersion: Constants.expoConfig?.version || "unknown",
      };
    }

    // For mobile platforms
    if (Device) {
      return {
        deviceType: deviceType as "ios" | "android",
        deviceName: Device.deviceName || `${Device.brand} ${Device.modelName}`,
        osName: Device.osName || Platform.OS,
        osVersion: Device.osVersion || "unknown",
        modelName: Device.modelName || "unknown",
        brand: Device.brand || "unknown",
        appVersion: Constants.expoConfig?.version || "unknown",
      };
    }

    // Fallback when expo-device is not installed
    return {
      deviceType: deviceType as "ios" | "android",
      deviceName: Platform.OS === "ios" ? "iPhone" : "Android Device",
      osName: Platform.OS,
      appVersion: Constants.expoConfig?.version || "unknown",
    };
  }

  /**
   * Get a human-readable device name
   */
  static async getDeviceName(): Promise<string> {
    if (Platform.OS === "web") {
      return "Web Browser";
    }

    if (Device) {
      const deviceName = Device.deviceName;
      const modelName = Device.modelName;
      const brand = Device.brand;

      if (deviceName) {
        return deviceName;
      }

      if (brand && modelName) {
        return `${brand} ${modelName}`;
      }
    }

    return Platform.OS === "ios" ? "iPhone" : "Android Device";
  }

  /**
   * Get user agent string (for web)
   */
  static getUserAgent(): string | null {
    if (Platform.OS === "web" && typeof navigator !== "undefined") {
      return navigator.userAgent;
    }
    return null;
  }

  /**
   * Clear the stored device ID (useful for testing or logout)
   */
  static async clearDeviceId(): Promise<void> {
    this.deviceId = null;

    try {
      if (Platform.OS === "web") {
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(DEVICE_ID_KEY);
        }
      } else {
        await SecureStore.deleteItemAsync(DEVICE_ID_KEY);
      }
    } catch (error) {
      console.error("Error clearing device ID:", error);
    }
  }

  /**
   * Format a session for display
   */
  static formatSessionInfo(session: UserSession): {
    title: string;
    subtitle: string;
    platform: "web" | "ios" | "android";
  } {
    const deviceInfo = session.device_info;
    const deviceType = session.device_type as "web" | "ios" | "android";

    let title = session.device_name || "Unknown Device";
    let subtitle = `Last active: ${this.formatRelativeTime(session.last_active_at)}`;

    if (deviceInfo) {
      if (deviceInfo.modelName && deviceInfo.brand) {
        title = `${deviceInfo.brand} ${deviceInfo.modelName}`;
      }
      if (deviceInfo.osVersion) {
        subtitle = `${deviceInfo.osName} ${deviceInfo.osVersion} • ${subtitle}`;
      }
    }

    return { title, subtitle, platform: deviceType };
  }

  /**
   * Format a timestamp as relative time
   */
  private static formatRelativeTime(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return "Just now";
    } else if (diffMins < 60) {
      return `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
    } else {
      return date.toLocaleDateString();
    }
  }
}

export default SessionManager;
