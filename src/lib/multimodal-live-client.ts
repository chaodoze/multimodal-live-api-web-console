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

import { Content, GenerativeContentBlob, Part } from "@google/generative-ai";
import { EventEmitter } from "eventemitter3";
import { difference } from "lodash";
import {
  ClientContentMessage,
  isInterrupted,
  isModelTurn,
  isServerContentMessage,
  isSetupCompleteMessage,
  isToolCallCancellationMessage,
  isToolCallMessage,
  isTurnComplete,
  LiveIncomingMessage,
  ModelTurn,
  RealtimeInputMessage,
  ServerContent,
  SetupMessage,
  StreamingLog,
  ToolCall,
  ToolCallCancellation,
  ToolResponseMessage,
  type LiveConfig,
} from "../multimodal-live-types";
import { blobToJSON, base64ToArrayBuffer } from "./utils";

/**
 * the events that this client will emit
 */
interface MultimodalLiveClientEventTypes {
  open: () => void;
  log: (log: StreamingLog) => void;
  close: (event: CloseEvent) => void;
  audio: (data: ArrayBuffer) => void;
  content: (data: ServerContent) => void;
  interrupted: () => void;
  setupcomplete: () => void;
  turncomplete: () => void;
  toolcall: (toolCall: ToolCall) => void;
  toolcallcancellation: (toolcallCancellation: ToolCallCancellation) => void;
}

export type MultimodalLiveAPIClientConnection = {
  url?: string;
  apiKey: string;
};

/**
 * A event-emitting class that manages the connection to the websocket and emits
 * events to the rest of the application.
 * If you dont want to use react you can still use this.
 */
export class MultimodalLiveClient extends EventEmitter<MultimodalLiveClientEventTypes> {
  public ws: WebSocket | null = null;
  protected config: LiveConfig | null = null;
  public url: string = "";
  public getConfig() {
    return { ...this.config };
  }

  constructor({ url, apiKey }: MultimodalLiveAPIClientConnection) {
    super();
    url =
      url ||
      `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent`;
    url += `?key=${apiKey}`;
    this.url = url;
    this.send = this.send.bind(this);
  }

  log(type: string, message: StreamingLog["message"]) {
    const log: StreamingLog = {
      date: new Date(),
      type,
      message,
    };
    this.emit("log", log);
  }

  connect(config: LiveConfig): Promise<boolean> {
    this.config = config;

    const ws = new WebSocket(this.url);

    ws.addEventListener("message", async (evt: MessageEvent) => {
      if (evt.data instanceof Blob) {
        this.receive(evt.data);
      } else {
        console.log("non blob message", evt);
      }
    });
    return new Promise((resolve, reject) => {
      const onError = (ev: Event) => {
        this.disconnect(ws);
        const message = `Could not connect to "${this.url}"`;
        this.log(`server.${ev.type}`, message);
        reject(new Error(message));
      };
      ws.addEventListener("error", onError);
      ws.addEventListener("open", (ev: Event) => {
        if (!this.config) {
          reject("Invalid config sent to `connect(config)`");
          return;
        }
        this.log(`client.${ev.type}`, `connected to socket`);
        this.emit("open");

        this.ws = ws;

        const setupMessage: SetupMessage = {
          setup: this.config,
        };
        this._sendDirect(setupMessage);
        this.log("client.send", "setup");

        ws.removeEventListener("error", onError);
        ws.addEventListener("close", (ev: CloseEvent) => {
          console.log(ev);
          this.disconnect(ws);
          let reason = ev.reason || "";
          if (reason.toLowerCase().includes("error")) {
            const prelude = "ERROR]";
            const preludeIndex = reason.indexOf(prelude);
            if (preludeIndex > 0) {
              reason = reason.slice(
                preludeIndex + prelude.length + 1,
                Infinity,
              );
            }
          }
          this.log(
            `server.${ev.type}`,
            `disconnected ${reason ? `with reason: ${reason}` : ``}`,
          );
          this.emit("close", ev);
        });
        resolve(true);
      });
    });
  }

  disconnect(ws?: WebSocket) {
    // could be that this is an old websocket and theres already a new instance
    // only close it if its still the correct reference
    if ((!ws || this.ws === ws) && this.ws) {
      this.ws.close();
      this.ws = null;
      this.log("client.close", `Disconnected`);
      return true;
    }
    return false;
  }

  protected async fetchPdfText(pdfUri: string): Promise<string> {
    try {
      const apiKey = this.url.split('?key=')[1];
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/files/${pdfUri}/content`,
        {
          headers: {
            'x-goog-api-key': apiKey
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`Failed to fetch PDF content: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.text || '';
    } catch (error) {
      console.error('Error fetching PDF text:', error);
      throw error;
    }
  }

  protected async receive(blob: Blob) {
    const response: LiveIncomingMessage = (await blobToJSON(
      blob,
    )) as LiveIncomingMessage;
    if (isToolCallMessage(response)) {
      this.log("server.toolCall", "Received tool call message");
      this.log("server.debug", `Full response: ${JSON.stringify(response, null, 2)}`);
      
      // Immediately reject any response containing code-like syntax
      const responseStr = JSON.stringify(response);
      if (responseStr.includes('executableCode') || responseStr.includes('print(') || 
          responseStr.includes('PYTHON') || responseStr.includes('code>')) {
        this.sendToolResponse({
          functionResponses: [{
            id: response.toolCall.functionCalls[0]?.id || 'error',
            response: {
              error: 'CODE SYNTAX DETECTED: Must use pure JSON format',
              example: { name: "pdf_lookup", args: { pdfUri: "uri_here" } }
            }
          }]
        });
        return;
      }
      
      // Handle PDF lookup function calls
      const pdfLookupCalls = response.toolCall.functionCalls.filter(fc => {
        this.log("server.debug", `Processing function call: ${JSON.stringify(fc, null, 2)}`);
        
        // Check if this is a PDF lookup call
        if (fc.name !== "pdf_lookup") {
          this.log("server.debug", `Skipping non-pdf_lookup function: ${fc.name}`);
          return false;
        }
        
        // Ensure args is a proper object with pdfUri
        if (typeof fc.args !== 'object' || !fc.args || Array.isArray(fc.args)) {
          this.log("server.error", "Invalid args format for pdf_lookup. Must be an object.");
          return false;
        }
        
        // Strict validation for correct JSON format
        const argsStr = JSON.stringify(fc.args);
        
        // Check for any programming syntax or invalid patterns
        const invalidPatterns = [
          'print(',
          'pdf_lookup(',
          'default_api',
          'queries=',
          'question=',
          'uri=',
          'function(',
          '.lookup(',
          'executableCode',
          'PYTHON',
          'python',
          'console.log',
          'google_search',
          'search(',
          'code>',
          'pre>',
          'h5>',
          'executableCode: PYTHON',
          'code',
          'pre'
        ];
        
        // Add debug logging
        this.log("server.debug", `Validating function call args: ${argsStr}`);
        const hasInvalidPattern = invalidPatterns.some(pattern => argsStr.includes(pattern));
        if (hasInvalidPattern) {
          this.log("server.debug", `Invalid pattern detected in: ${argsStr}`);
          
          // Send error response immediately
          this.sendToolResponse({
            functionResponses: [{
              id: fc.id,
              response: {
                error: 'INVALID FORMAT: Use only this JSON structure:',
                example: {
                  name: "pdf_lookup",
                  args: { pdfUri: "your_uri_here" }
                }
              }
            }]
          });
          
          return false;
        }
        
        if (invalidPatterns.some(pattern => argsStr.includes(pattern))) {
          this.log("server.error", `Invalid function call format detected. Must use exact JSON format: { "name": "pdf_lookup", "args": { "pdfUri": "uri_here" } }`);
          
          // Send error response immediately
          this.sendToolResponse({
            functionResponses: [{
              id: fc.id,
              response: {
                error: 'INVALID FORMAT: Use only this JSON structure:',
                example: {
                  name: "pdf_lookup",
                  args: { pdfUri: "your_uri_here" }
                }
              }
            }]
          });
          
          return false;
        }
        
        // Validate exact structure
        const args = fc.args as { pdfUri?: string };
        if (!args.pdfUri || Object.keys(fc.args).length !== 1) {
          this.log("server.error", "Invalid args structure. Only 'pdfUri' parameter is allowed.");
          
          // Send error response for invalid structure
          this.sendToolResponse({
            functionResponses: [{
              id: fc.id,
              response: {
                error: 'INVALID STRUCTURE: Only pdfUri parameter is allowed',
                example: {
                  name: "pdf_lookup",
                  args: { pdfUri: "your_uri_here" }
                }
              }
            }]
          });
          
          return false;
        }
        
        return true;
      });
      
      if (pdfLookupCalls.length > 0) {
        try {
          const functionResponses = await Promise.all(
            pdfLookupCalls.map(async (fc) => {
              const args = fc.args as { pdfUri: string };
              if (!args.pdfUri) {
                throw new Error('Missing required parameter: pdfUri');
              }
              const fileText = await this.fetchPdfText(args.pdfUri);
              return {
                id: fc.id,
                response: { text: fileText }
              };
            })
          );
          
          this.sendToolResponse({
            functionResponses
          });
        } catch (error) {
          console.error('Error processing PDF lookup:', error);
          // Send error response with more detailed feedback
          this.sendToolResponse({
            functionResponses: pdfLookupCalls.map(fc => ({
              id: fc.id,
              response: { 
                error: 'Failed to fetch PDF content. Remember to use JSON format: { "name": "pdf_lookup", "args": { "pdfUri": "uri_here" } }',
                example: {
                  name: "pdf_lookup",
                  args: { pdfUri: "your_uri_here" }
                }
              }
            }))
          });
        }
      }
      
      this.emit("toolcall", response.toolCall);
      return;
    }
    if (isToolCallCancellationMessage(response)) {
      this.log("receive.toolCallCancellation", response);
      this.emit("toolcallcancellation", response.toolCallCancellation);
      return;
    }

    if (isSetupCompleteMessage(response)) {
      this.log("server.send", "setupComplete");
      this.emit("setupcomplete");
      return;
    }

    // this json also might be `contentUpdate { interrupted: true }`
    // or contentUpdate { end_of_turn: true }
    if (isServerContentMessage(response)) {
      const { serverContent } = response;
      if (isInterrupted(serverContent)) {
        this.log("receive.serverContent", "interrupted");
        this.emit("interrupted");
        return;
      }
      if (isTurnComplete(serverContent)) {
        this.log("server.send", "turnComplete");
        this.emit("turncomplete");
        //plausible theres more to the message, continue
      }

      if (isModelTurn(serverContent)) {
        let parts: Part[] = serverContent.modelTurn.parts;
        
        // Check for code syntax in model response
        const responseStr = JSON.stringify(parts);
        if (responseStr.includes('executableCode') || responseStr.includes('print(') || 
            responseStr.includes('PYTHON') || responseStr.includes('code>')) {
          // Send a message to guide the model to use correct JSON format
          const errorMessage = {
            text: `⚠️ ERROR: Invalid syntax detected. You must use this exact JSON format:
{
  "name": "pdf_lookup",
  "args": {
    "pdfUri": "${this.url.split('files/')[1]?.split('/')[0] || 'your_file_uri'}"
  }
}

❌ DO NOT USE:
- Python code (print, function calls)
- Any programming syntax
- Any other parameters

✅ COPY AND PASTE the exact JSON format above, just change the pdfUri value.`
          };
          
          // Log the error for debugging
          this.log("server.error", "Invalid syntax detected in model response");
          
          // Send the error message
          this.send([errorMessage]);
          
          // Also emit as content to ensure it's displayed
          const errorContent: ModelTurn = {
            modelTurn: {
              parts: [errorMessage]
            }
          };
          this.emit("content", errorContent);
          return;
        }

        // when its audio that is returned for modelTurn
        const audioParts = parts.filter(
          (p) => p.inlineData && p.inlineData.mimeType.startsWith("audio/pcm"),
        );
        const base64s = audioParts.map((p) => p.inlineData?.data);

        // strip the audio parts out of the modelTurn
        const otherParts = difference(parts, audioParts);

        base64s.forEach((b64) => {
          if (b64) {
            const data = base64ToArrayBuffer(b64);
            this.emit("audio", data);
            this.log(`server.audio`, `buffer (${data.byteLength})`);
          }
        });
        if (!otherParts.length) {
          return;
        }

        parts = otherParts;

        const content: ModelTurn = { modelTurn: { parts } };
        this.emit("content", content);
        this.log(`server.content`, response);
      }
    } else {
      console.log("received unmatched message", response);
    }
  }

  /**
   * send realtimeInput, this is base64 chunks of "audio/pcm" and/or "image/jpg"
   */
  sendRealtimeInput(chunks: GenerativeContentBlob[]) {
    let hasAudio = false;
    let hasVideo = false;
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i];
      if (ch.mimeType.includes("audio")) {
        hasAudio = true;
      }
      if (ch.mimeType.includes("image")) {
        hasVideo = true;
      }
      if (hasAudio && hasVideo) {
        break;
      }
    }
    const message =
      hasAudio && hasVideo
        ? "audio + video"
        : hasAudio
          ? "audio"
          : hasVideo
            ? "video"
            : "unknown";

    const data: RealtimeInputMessage = {
      realtimeInput: {
        mediaChunks: chunks,
      },
    };
    this._sendDirect(data);
    this.log(`client.realtimeInput`, message);
  }

  /**
   *  send a response to a function call and provide the id of the functions you are responding to
   */
  sendToolResponse(toolResponse: ToolResponseMessage["toolResponse"]) {
    const message: ToolResponseMessage = {
      toolResponse,
    };

    this._sendDirect(message);
    this.log(`client.toolResponse`, message);
  }

  /**
   * send normal content parts such as { text }
   */
  send(parts: Part | Part[], turnComplete: boolean = true) {
    parts = Array.isArray(parts) ? parts : [parts];
    const content: Content = {
      role: "user",
      parts,
    };

    const clientContentRequest: ClientContentMessage = {
      clientContent: {
        turns: [content],
        turnComplete,
      },
    };

    this._sendDirect(clientContentRequest);
    this.log(`client.send`, clientContentRequest);
  }

  /**
   *  used internally to send all messages
   *  don't use directly unless trying to send an unsupported message type
   */
  _sendDirect(request: object) {
    if (!this.ws) {
      throw new Error("WebSocket is not connected");
    }
    const str = JSON.stringify(request);
    this.ws.send(str);
  }
}
