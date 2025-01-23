import React, { useCallback } from "react";
import { useLiveAPIContext } from "../../contexts/LiveAPIContext";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import "./pdf-upload.scss";

// Add type for file upload response
interface FileUploadResponse {
  file: {
    uri: string;
    mimeType: string;
  };
}

interface PDFUploadProps {
  onUploadComplete?: (fileUri: string) => void;
  onError?: (error: { message: string }) => void;
}

interface FileUploadError extends Error {
  message: string;
}

export default function PDFUpload({ onUploadComplete, onError }: PDFUploadProps) {
  const { client } = useLiveAPIContext();

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      // Ensure client is connected and authenticated
      if (!client) {
        throw new Error("Client not available");
      }
      
      // Convert File to base64 for upload
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(file);
      
      const base64Data = await base64Promise;
      // Use environment variable for authentication
      if (!process.env.REACT_APP_GEMINI_API_KEY) {
        throw new Error("API key not configured in environment");
      }
      const fileManager = new GoogleAIFileManager(process.env.REACT_APP_GEMINI_API_KEY);
      
      const uploadResult = await fileManager.uploadFile(base64Data, {
        mimeType: "application/pdf",
        displayName: file.name,
      }) as FileUploadResponse;

      if (uploadResult.file?.uri) {
        onUploadComplete?.(uploadResult.file.uri);
      }
    } catch (error) {
      console.error("PDF upload failed:", error);
      onError?.(error as Error);
    }
  }, [onUploadComplete, onError]);

  return (
    <div className="pdf-upload-container">
      <input
        type="file"
        accept="application/pdf"
        onChange={handleFileUpload}
        className="pdf-upload-input"
      />
    </div>
  );
}
