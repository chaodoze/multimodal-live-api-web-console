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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MultimodalLiveAPIClientConnection,
  MultimodalLiveClient,
} from "../lib/multimodal-live-client";
import { LiveConfig, SchemaType } from "../multimodal-live-types";
import { AudioStreamer } from "../lib/audio-streamer";
import { audioContext } from "../lib/utils";
import VolMeterWorket from "../lib/worklets/vol-meter";

export type UseLiveAPIResults = {
  client: MultimodalLiveClient;
  setConfig: (config: LiveConfig) => void;
  config: LiveConfig;
  connected: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  volume: number;
};

function useLiveAPI({
  url,
  apiKey,
}: MultimodalLiveAPIClientConnection): UseLiveAPIResults {
  const client = useMemo(
    () => new MultimodalLiveClient({ url, apiKey }),
    [url, apiKey],
  );
  const audioStreamerRef = useRef<AudioStreamer | null>(null);

  const [connected, setConnected] = useState(false);
  const [config, setConfig] = useState<LiveConfig>({
    model: "models/gemini-2.0-flash-exp",
    systemInstruction: {
      parts: [
        {
          text: `CRITICAL INSTRUCTION - YOU ARE A PDF ANALYSIS ASSISTANT

Your ONLY available tool is pdf_lookup. You MUST use it before answering ANY question.

EXACT FORMAT REQUIRED (copy and paste this, just change the URI):
{
  "name": "pdf_lookup",
  "args": {
    "pdfUri": "uri_here"
  }
}

❌ DO NOT USE:
- render_altair or any other functions
- Python code or programming syntax
- Any other parameters or formats

✅ CORRECT WORKFLOW:
1. For EVERY question, first send the exact JSON above
2. Wait for PDF content
3. Then answer based on the content

Example interaction:
User: "What's in the PDF?"
Assistant: Let me check the PDF content.
{
  "name": "pdf_lookup",
  "args": {
    "pdfUri": "actual_uri_here"
  }
}
[Wait for content, then respond with analysis]

Remember: You can ONLY access PDF content through this exact JSON format.`
        }
      ]
    },
    generationConfig: {
      responseModalities: "text",
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 2048
    },
    tools: [
      {
        function_declarations: [{
          name: "pdf_lookup",
          description: "Use this function to retrieve PDF content. CRITICAL: Call this function using ONLY this exact JSON format: { \"name\": \"pdf_lookup\", \"args\": { \"pdfUri\": \"uri_here\" } }",
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              pdfUri: { type: SchemaType.STRING, description: "The URI of the PDF file to retrieve content from" }
            },
            required: ["pdfUri"]
          }
        }]
      }
    ]
  });
const [volume, setVolume] = useState(0);

  // register audio for streaming server -> speakers
  useEffect(() => {
    if (!audioStreamerRef.current) {
      audioContext({ id: "audio-out" }).then((audioCtx: AudioContext) => {
        if (audioStreamerRef.current) return;
        const streamer = new AudioStreamer(audioCtx);
        audioStreamerRef.current = streamer;
        streamer
          .addWorklet<any>("vumeter-out", VolMeterWorket, (ev: any) => {
            setVolume(ev.data.volume);
          })
          .then(() => {
            // Successfully added worklet
          });
      });
    }
  }, []);

  useEffect(() => {
    const onClose = () => {
      setConnected(false);
    };

    const stopAudioStreamer = () => audioStreamerRef.current?.stop();

    const onAudio = (data: ArrayBuffer) =>
      audioStreamerRef.current?.addPCM16(new Uint8Array(data));

    client
      .on("close", onClose)
      .on("interrupted", stopAudioStreamer)
      .on("audio", onAudio);

    return () => {
      client
        .off("close", onClose)
        .off("interrupted", stopAudioStreamer)
        .off("audio", onAudio);
    };
  }, [client]);

  const connect = useCallback(async () => {
    console.log('Initializing connection...');
    if (!config) {
      throw new Error("config has not been set");
    }

    // Validate tools configuration
    if (!config.tools || !Array.isArray(config.tools)) {
      console.error('Tools configuration is missing or invalid');
      throw new Error('Tools configuration is required');
    }

    // Find pdf_lookup function declaration
    const pdfLookupTool = config.tools.find(tool => 
      'function_declarations' in tool && 
      tool.function_declarations?.some(fd => fd.name === 'pdf_lookup')
    );

    if (!pdfLookupTool) {
      console.error('PDF lookup tool not found in config');
      throw new Error('PDF lookup tool not properly configured');
    }

    // Log configuration details
    console.log('Configuration validated:');
    console.log('- Model:', config.model);
    console.log('- System instruction:', {
      present: !!config.systemInstruction,
      partsLength: config.systemInstruction?.parts?.length || 0,
      textLength: config.systemInstruction?.parts?.[0]?.text?.length || 0
    });
    console.log('- Tools configuration:', {
      totalTools: config.tools?.length || 0,
      hasPdfLookup: !!pdfLookupTool,
      pdfLookupConfig: pdfLookupTool
    });

    // Validate required configurations
    if (!config.systemInstruction?.parts?.[0]?.text) {
      console.error('System instruction is missing or invalid');
      throw new Error('System instruction must be configured');
    }

    // Ensure clean connection
    client.disconnect();
    
    try {
      await client.connect(config);
      console.log('Successfully connected with tools configured');
      setConnected(true);
    } catch (error) {
      console.error('Connection failed:', error);
      throw error;
    }
  }, [client, setConnected, config]);

  const disconnect = useCallback(async () => {
    client.disconnect();
    setConnected(false);
  }, [setConnected, client]);

  return {
    client,
    config,
    setConfig,
    connected,
    connect,
    disconnect,
    volume,
  };
}

export { useLiveAPI };
