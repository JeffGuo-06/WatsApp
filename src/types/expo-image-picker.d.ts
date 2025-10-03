declare module 'expo-image-picker' {
  export enum MediaTypeOptions {
    All = 'All',
    Images = 'Images',
    Videos = 'Videos',
    AllWithoutAudio = 'AllWithoutAudio',
  }

  export interface PermissionResponse {
    granted: boolean;
    canAskAgain: boolean;
    expires: string;
    status: 'undetermined' | 'granted' | 'denied';
  }

  export interface ImagePickerAsset {
    uri: string;
    width: number;
    height: number;
    fileName?: string | null;
    fileSize?: number | null;
    type?: string;
    mimeType?: string | null;
    base64?: string | null;
  }

  export interface ImagePickerResult {
    canceled: boolean;
    assets?: ImagePickerAsset[];
  }

  export interface ImagePickerOptions {
    mediaTypes?: MediaTypeOptions;
    allowsEditing?: boolean;
    aspect?: [number, number];
    quality?: number;
  }

  export function requestMediaLibraryPermissionsAsync(): Promise<PermissionResponse>;
  export function launchImageLibraryAsync(
    options?: ImagePickerOptions
  ): Promise<ImagePickerResult>;
}
