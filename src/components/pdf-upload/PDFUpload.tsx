import React, { useCallback } from "react";
import { useLiveAPIContext } from "../../contexts/LiveAPIContext";
import "./pdf-upload.scss";

interface PDFUploadProps {
  onUploadComplete?: (fileUri: string) => void;
  onError?: (error: { message: string }) => void;
}

interface FileUploadResponse {
  file: {
    name: string;
    uri: string;
    mimeType: string;
  };
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
      // Use client's existing authentication
      const apiKey = client.url.split('?key=')[1];
      if (!apiKey) {
        throw new Error("Client not properly authenticated");
      }

      // Convert File to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(file);
      
      const base64Data = await base64Promise;
      
      // Upload file using Files API
      const uploadResponse = await fetch(
        'https://generativelanguage.googleapis.com/upload/v1beta/files',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            data: base64Data,
            mimeType: "application/pdf",
            name: file.name
          }),
        }
      );

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.statusText}`);
      }

      const responseData: FileUploadResponse = await uploadResponse.json();
      
      // First notify about successful upload
      onUploadComplete?.(responseData.file.uri);
      
      // Then send a text message about the uploaded file
      client.send([
        { text: `I've uploaded a PDF file named "${file.name}". The file has been processed and is available at: ${responseData.file.uri}` }
      ]);
    } catch (error) {
      console.error("PDF upload failed:", error);
      onError?.(error as Error);
    }
  }, [onUploadComplete, onError, client]);

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
