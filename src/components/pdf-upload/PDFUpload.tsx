import React, { useCallback } from "react";
import { useLiveAPIContext } from "../../contexts/LiveAPIContext";
import "./pdf-upload.scss";

interface PDFUploadProps {
  onUploadComplete?: (fileUri: string) => void;
  onError?: (error: { message: string }) => void;
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
      // Get API key from client URL
      const apiKey = client.url.split('?key=')[1];
      if (!apiKey) {
        throw new Error("API key not available");
      }

      // Read file as text instead of base64
      const textReader = new FileReader();
      const textPromise = new Promise<string>((resolve) => {
        textReader.onload = () => {
          resolve(textReader.result as string);
        };
      });
      textReader.readAsText(file);
      
      const textContent = await textPromise;
      
      // Send the PDF content as text in the conversation
      client.send([{
        text: `PDF Content from ${file.name}:\n\n${textContent}`
      }]);
      
      // Generate a temporary URI for reference
      const tempUri = `pdf-${Date.now()}-${file.name}`;
      onUploadComplete?.(tempUri);
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
