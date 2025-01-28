/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import cn from "classnames";

import { memo, ReactNode, RefObject, useEffect, useRef, useState } from "react";
import { useLiveAPIContext } from "../../contexts/LiveAPIContext";
import { LiveConfig } from "../../multimodal-live-types";
import { UseMediaStreamResult } from "../../hooks/use-media-stream-mux";
import { useScreenCapture } from "../../hooks/use-screen-capture";
import { useWebcam } from "../../hooks/use-webcam";
import { AudioRecorder } from "../../lib/audio-recorder";
import { PDF_CONFIG, getGenerationConfig } from "../../config/pdf-config";
import { getEnvConfig } from "../../config/env-config";
import AudioPulse from "../audio-pulse/AudioPulse";
import "./control-tray.scss";

// PDF upload button props defined below

export type ControlTrayProps = {
  videoRef: RefObject<HTMLVideoElement>;
  children?: ReactNode;
  supportsVideo: boolean;
  onVideoStreamChange?: (stream: MediaStream | null) => void;
};

type MediaStreamButtonProps = {
  isStreaming: boolean;
  onIcon: string;
  offIcon: string;
  start: () => Promise<any>;
  stop: () => any;
};

/**
 * button used for triggering webcam or screen-capture
 */
const MediaStreamButton = memo(
  ({ isStreaming, onIcon, offIcon, start, stop }: MediaStreamButtonProps) =>
    isStreaming ? (
      <button className="action-button" onClick={stop}>
        <span className="material-symbols-outlined">{onIcon}</span>
      </button>
    ) : (
      <button className="action-button" onClick={start}>
        <span className="material-symbols-outlined">{offIcon}</span>
      </button>
    ),
);

interface PDFUploadButtonProps {
  onPDFSelect: (data: string) => void;
  disabled?: boolean;
}

const PDFUploadButton = memo(({ onPDFSelect, disabled }: PDFUploadButtonProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isProcessingPDF, setIsProcessingPDF] = useState(false);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    console.log('🔍 File input change event triggered');
    const file = event.target.files?.[0];
    if (!file) {
      console.warn('❌ No file selected');
      return;
    }
    
    console.log('📄 File selected:', {
      name: file.name,
      type: file.type,
      size: `${(file.size / 1024).toFixed(2)}KB`
    });
    
    // Reset input so the same file can be selected again
    event.target.value = '';
    
    // Validate file size and type
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit
    if (file.size > MAX_FILE_SIZE) {
      console.error('❌ File too large:', `${(file.size / (1024 * 1024)).toFixed(2)}MB`);
      alert("File too large (max 10MB)");
      return;
    }
    
    if (file.type !== 'application/pdf') {
      console.error('❌ Invalid file type:', file.type);
      alert("Invalid file type. Please upload a PDF file.");
      return;
    }

    console.log('🔄 Starting PDF processing...');
    setIsProcessingPDF(true);
    
    try {
      // Create a promise wrapper for FileReader
      const readFileAsBase64 = () => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            console.log('📖 FileReader onload triggered');
            const base64data = reader.result?.toString().split(",")[1];
            if (base64data) {
              console.log('✅ Base64 data extracted successfully:', {
                dataLength: base64data.length,
                preview: base64data.substring(0, 50) + '...'
              });
              resolve(base64data);
            } else {
              reject(new Error('Failed to extract base64 data'));
            }
          } catch (error) {
            reject(error);
          }
        };
        reader.onerror = (error) => {
          console.error('❌ FileReader error:', error);
          reject(reader.error);
        };
        console.log('📚 Starting FileReader.readAsDataURL');
        reader.readAsDataURL(file);
      });

      const base64data = await readFileAsBase64();
      console.log('🎯 Calling onPDFSelect with base64 data');
      onPDFSelect(base64data);
      console.log('✨ PDF processing completed successfully');
    } catch (error) {
      console.error("❌ Error processing PDF:", error);
      alert("Error processing PDF. Please try again.");
    } finally {
      setIsProcessingPDF(false);
    }
  };

  return (
    <>
      <input
        type="file"
        ref={inputRef}
        onChange={handleChange}
        accept="application/pdf"
        style={{ 
          position: 'absolute',
          left: '0',
          top: '0',
          opacity: 0.01,
          cursor: 'pointer',
          width: '100%',
          height: '100%',
          zIndex: 1
        }}
        data-testid="pdf-upload-input"
        aria-label="Upload PDF"
      />
      <button 
        className="action-button" 
        onClick={handleClick}
        disabled={disabled || isProcessingPDF}
      >
        <span className="material-symbols-outlined">description</span>
      </button>
    </>
  );
});

function ControlTray({
  videoRef,
  children,
  onVideoStreamChange = () => {},
  supportsVideo,
}: ControlTrayProps) {
  const videoStreams = [useWebcam(), useScreenCapture()];
  const [activeVideoStream, setActiveVideoStream] =
    useState<MediaStream | null>(null);
  const [webcam, screenCapture] = videoStreams;
  const [inVolume, setInVolume] = useState(0);
  const [audioRecorder] = useState(() => new AudioRecorder());
  const [muted, setMuted] = useState(false);
  const [pdfData, setPdfData] = useState<string | null>(null);
  const renderCanvasRef = useRef<HTMLCanvasElement>(null);
  const connectButtonRef = useRef<HTMLButtonElement>(null);

  const { client, connected, connect, disconnect, volume, setConfig } =
    useLiveAPIContext();

  useEffect(() => {
    if (!connected && connectButtonRef.current) {
      connectButtonRef.current.focus();
    }
  }, [connected]);

  // Configure session with PDF context when PDF is uploaded
  useEffect(() => {
    if (pdfData) {
      console.log('Configuring session with PDF data...');
      try {
        const envConfig = getEnvConfig();
        const generationConfig = getGenerationConfig();
        
        const pdfConfig: LiveConfig = {
          model: envConfig.model,
          systemInstruction: {
            parts: [
              {
                text: "Analyze the provided PDF document and help answer questions about its content."
              },
              {
                inlineData: {
                  mimeType: PDF_CONFIG.ACCEPTED_MIME_TYPE,
                  data: pdfData
                }
              }
            ]
          },
          generationConfig
        };
        setConfig(pdfConfig);
        console.log('PDF content added to system instruction');
      } catch (error) {
        console.error('Failed to configure PDF session:', error);
        return;
      }
    }
  }, [pdfData, setConfig]);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--volume",
      `${Math.max(5, Math.min(inVolume * 200, 8))}px`,
    );
  }, [inVolume]);

  useEffect(() => {
    const onData = (base64: string) => {
      client.sendRealtimeInput([
        {
          mimeType: "audio/pcm;rate=16000",
          data: base64,
        },
      ]);
    };
    if (connected && !muted && audioRecorder) {
      audioRecorder.on("data", onData).on("volume", setInVolume).start();
    } else {
      audioRecorder.stop();
    }
    return () => {
      audioRecorder.off("data", onData).off("volume", setInVolume);
    };
  }, [connected, client, muted, audioRecorder]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = activeVideoStream;
    }

    let timeoutId = -1;

    function sendVideoFrame() {
      const video = videoRef.current;
      const canvas = renderCanvasRef.current;

      if (!video || !canvas) {
        return;
      }

      const ctx = canvas.getContext("2d")!;
      canvas.width = video.videoWidth * 0.25;
      canvas.height = video.videoHeight * 0.25;
      if (canvas.width + canvas.height > 0) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL("image/jpeg", 1.0);
        const data = base64.slice(base64.indexOf(",") + 1, Infinity);
        client.sendRealtimeInput([{ mimeType: "image/jpeg", data }]);
      }
      if (connected) {
        timeoutId = window.setTimeout(sendVideoFrame, 1000 / 0.5);
      }
    }
    if (connected && activeVideoStream !== null) {
      requestAnimationFrame(sendVideoFrame);
    }
    return () => {
      clearTimeout(timeoutId);
    };
  }, [connected, activeVideoStream, client, videoRef]);

  //handler for swapping from one video-stream to the next
  const changeStreams = (next?: UseMediaStreamResult) => async () => {
    if (next) {
      const mediaStream = await next.start();
      setActiveVideoStream(mediaStream);
      onVideoStreamChange(mediaStream);
    } else {
      setActiveVideoStream(null);
      onVideoStreamChange(null);
    }

    videoStreams.filter((msr) => msr !== next).forEach((msr) => msr.stop());
  };

  return (
    <section className="control-tray">
      <canvas style={{ display: "none" }} ref={renderCanvasRef} />
      <nav className={cn("actions-nav", { disabled: !connected })}>
        <button
          className={cn("action-button mic-button")}
          onClick={() => setMuted(!muted)}
        >
          {!muted ? (
            <span className="material-symbols-outlined filled">mic</span>
          ) : (
            <span className="material-symbols-outlined filled">mic_off</span>
          )}
        </button>

        <div className="action-button no-action outlined">
          <AudioPulse volume={volume} active={connected} hover={false} />
        </div>

        {supportsVideo && (
          <>
            <MediaStreamButton
              isStreaming={screenCapture.isStreaming}
              start={changeStreams(screenCapture)}
              stop={changeStreams()}
              onIcon="cancel_presentation"
              offIcon="present_to_all"
            />
            <MediaStreamButton
              isStreaming={webcam.isStreaming}
              start={changeStreams(webcam)}
              stop={changeStreams()}
              onIcon="videocam_off"
              offIcon="videocam"
            />
          </>
        )}
        <PDFUploadButton 
          onPDFSelect={(data) => {
            setPdfData(data);
            console.log('PDF uploaded successfully');
          }}
          disabled={connected} // Disable only after connection is established
        />
        {children}
      </nav>

      <div className={cn("connection-container", { connected })}>
        <div className="connection-button-container">
          <button
            ref={connectButtonRef}
            className={cn("action-button connect-toggle", { connected })}
            onClick={connected ? disconnect : connect}
            disabled={!pdfData}
          >
            <span className="material-symbols-outlined filled">
              {connected ? "pause" : "play_arrow"}
            </span>
          </button>
        </div>
        <span className="text-indicator">Streaming</span>
      </div>
    </section>
  );
}

export default memo(ControlTray);
