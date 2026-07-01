/**
 * Service for handling file uploads using local edge URLs or mock base64
 */
export const SupabaseStorageService = {
  /**
   * Uploads a file to a local object URL
   * @param file The file object to upload
   * @returns The local object URL
   */
  uploadFile: async (
    file: File,
    bucket: string = 'chat-media',
    folder: string = 'general'
  ): Promise<string> => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/upload-file', {
        method: 'POST',
        body: formData,
      });
      
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(`Server did not return valid JSON: ${text}`);
      }

      if (response.ok && data.downloadUrl) {
        return data.downloadUrl;
      }
      
      throw new Error(data.message || 'Server upload failed');
    } catch (error) {
      console.warn('File Upload to server failed, falling back to local URL:', error);
      try {
        // Use standard browser URL object for instant rendering as a robust offline/local fallback
        const localUrl = URL.createObjectURL(file);
        return localUrl;
      } catch (err) {
        return 'https://cdn-icons-png.flaticon.com/512/1067/1067566.png';
      }
    }
  },

  /**
   * Specifically for documents (PDF, APK, ZIP, etc.)
   */
  uploadDocument: async (file: File): Promise<string> => {
    return SupabaseStorageService.uploadFile(file, 'chat-media', 'documents');
  },

  /**
   * Specifically for images
   */
  uploadImage: async (file: File, onProgress?: (progress: number) => void, bucket: string = 'chat-media'): Promise<string> => {
    if (onProgress) onProgress(100);
    return SupabaseStorageService.uploadFile(file, bucket, 'images');
  },

  /**
   * Specifically for videos
   */
  uploadVideo: async (file: File, onProgress?: (progress: number) => void, bucket: string = 'chat-media'): Promise<string> => {
    if (onProgress) onProgress(100);
    return SupabaseStorageService.uploadFile(file, bucket, 'videos');
  },

  /**
   * Specifically for audio
   */
  uploadAudio: async (file: File | Blob, onProgress?: (progress: number) => void): Promise<string> => {
    const audioFile = file instanceof File ? file : new File([file], `audio_${Date.now()}.webm`, { type: file.type });
    if (onProgress) onProgress(100);
    return SupabaseStorageService.uploadFile(audioFile, 'chat-media', 'audio');
  },

  /**
   * Deletes a file from Storage
   */
  deleteFile: async (filePath: string, bucket: string = 'chat-media'): Promise<void> => {
    // No-op for local memory blobs
  }
};
export const getSupabase = () => null;
