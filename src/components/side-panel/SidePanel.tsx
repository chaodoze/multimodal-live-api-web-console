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
import { useEffect, useRef, useState, memo } from "react";
import { RiSidebarFoldLine, RiSidebarUnfoldLine } from "react-icons/ri";
import Select from "react-select";
import { useLiveAPIContext } from "../../contexts/LiveAPIContext";
import { useLoggerStore } from "../../lib/store-logger";
import Logger, { LoggerFilterType } from "../logger/Logger";
import "./side-panel.scss";

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

const filterOptions = [
  { value: "conversations", label: "Conversations" },
  { value: "tools", label: "Tool Use" },
  { value: "none", label: "All" },
];

export default function SidePanel() {
  const { connected, client } = useLiveAPIContext();
  const [open, setOpen] = useState(true);
  const loggerRef = useRef<HTMLDivElement>(null);
  const loggerLastHeightRef = useRef<number>(-1);
  const { log, logs } = useLoggerStore();

  const [textInput, setTextInput] = useState("");
  const [selectedOption, setSelectedOption] = useState<{
    value: string;
    label: string;
  } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  //scroll the log to the bottom when new logs come in
  useEffect(() => {
    if (loggerRef.current) {
      const el = loggerRef.current;
      const scrollHeight = el.scrollHeight;
      if (scrollHeight !== loggerLastHeightRef.current) {
        el.scrollTop = scrollHeight;
        loggerLastHeightRef.current = scrollHeight;
      }
    }
  }, [logs]);

  // listen for log events and store them
  useEffect(() => {
    client.on("log", log);
    return () => {
      client.off("log", log);
    };
  }, [client, log]);

  const handleSubmit = () => {
    client.send([{ text: textInput }]);

    setTextInput("");
    if (inputRef.current) {
      inputRef.current.innerText = "";
    }
  };

  return (
    <div className={`side-panel ${open ? "open" : ""}`}>
      <header className="top">
        <h2>Console</h2>
        {open ? (
          <button className="opener" onClick={() => setOpen(false)}>
            <RiSidebarFoldLine color="#b4b8bb" />
          </button>
        ) : (
          <button className="opener" onClick={() => setOpen(true)}>
            <RiSidebarUnfoldLine color="#b4b8bb" />
          </button>
        )}
      </header>
      <section className="indicators">
        <PDFUploadButton
          onPDFSelect={(data) => {
            client.sendRealtimeInput([
              {
                mimeType: "application/pdf",
                data,
              },
            ]);
            console.log('PDF uploaded successfully');
          }}
          disabled={!connected}
        />
        <Select
          className="react-select"
          classNamePrefix="react-select"
          styles={{
            control: (baseStyles) => ({
              ...baseStyles,
              background: "var(--Neutral-15)",
              color: "var(--Neutral-90)",
              minHeight: "33px",
              maxHeight: "33px",
              border: 0,
            }),
            option: (styles, { isFocused, isSelected }) => ({
              ...styles,
              backgroundColor: isFocused
                ? "var(--Neutral-30)"
                : isSelected
                  ? "var(--Neutral-20)"
                  : undefined,
            }),
          }}
          defaultValue={selectedOption}
          options={filterOptions}
          onChange={(e) => {
            setSelectedOption(e);
          }}
        />
        <div className={cn("streaming-indicator", { connected })}>
          {connected
            ? `🔵${open ? " Streaming" : ""}`
            : `⏸️${open ? " Paused" : ""}`}
        </div>
      </section>
      <div className="side-panel-container" ref={loggerRef}>
        <Logger
          filter={(selectedOption?.value as LoggerFilterType) || "none"}
        />
      </div>
      <div className={cn("input-container", { disabled: !connected })}>
        <div className="input-content">
          <textarea
            className="input-area"
            ref={inputRef}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                handleSubmit();
              }
            }}
            onChange={(e) => setTextInput(e.target.value)}
            value={textInput}
          ></textarea>
          <span
            className={cn("input-content-placeholder", {
              hidden: textInput.length,
            })}
          >
            Type&nbsp;something...
          </span>

          <button
            className="send-button material-symbols-outlined filled"
            onClick={handleSubmit}
          >
            send
          </button>
        </div>
      </div>
    </div>
  );
}
