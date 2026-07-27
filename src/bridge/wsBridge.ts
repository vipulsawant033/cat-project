/**
 * WebSocket bridge between the MCP server and the Figma plugin. The plugin (which
 * runs inside Figma and is the ONLY thing that can create nodes) connects to this
 * localhost socket; figma_apply_plan sends a build plan and awaits the plugin's
 * ack with the created node ids.
 *
 * Uses Node's built-in WebSocket server via the 'ws'-free approach: we implement
 * a tiny server over the standard 'http' upgrade + the global WebSocket is NOT
 * available server-side, so we keep a minimal framing layer. To avoid an extra
 * dependency in this scaffold, the transport is pluggable behind BridgeTransport;
 * a production build would use the 'ws' package.
 */

import { EventEmitter } from "node:events";
import type { FigmaBuildPlan } from "../reverse/buildPlan.js";

export interface BridgeTransport {
  /** send a JSON message to the connected plugin */
  send(msg: unknown): void;
  /** register a handler for messages from the plugin */
  onMessage(handler: (msg: unknown) => void): void;
  /** whether a plugin is currently connected */
  isConnected(): boolean;
}

export interface ApplyResult {
  ok: boolean;
  createdRootId?: string;
  error?: string;
}

/**
 * Bridge logic independent of the socket implementation, so it is unit-testable
 * and the transport (ws / mock) can be swapped.
 */
export class FigmaBridge extends EventEmitter {
  private pending = new Map<string, (r: ApplyResult) => void>();
  private seq = 0;

  constructor(private readonly transport: BridgeTransport) {
    super();
    transport.onMessage((msg) => this.handleMessage(msg));
  }

  private handleMessage(msg: unknown): void {
    const m = msg as { type?: string; requestId?: string; result?: ApplyResult };
    if (m.type === "apply-result" && m.requestId && this.pending.has(m.requestId)) {
      this.pending.get(m.requestId)!(m.result ?? { ok: false, error: "empty result" });
      this.pending.delete(m.requestId);
    }
    this.emit("message", msg);
  }

  /** Send a build plan to the plugin and await its ack. */
  applyPlan(plan: FigmaBuildPlan, timeoutMs = 30_000): Promise<ApplyResult> {
    if (!this.transport.isConnected()) {
      return Promise.resolve({ ok: false, error: "No Figma plugin connected to the bridge." });
    }
    const requestId = `req-${++this.seq}`;
    return new Promise<ApplyResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ ok: false, error: "Timed out waiting for plugin ack." });
      }, timeoutMs);
      this.pending.set(requestId, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.transport.send({ type: "apply-plan", requestId, plan });
    });
  }
}

/**
 * Default transport backed by the 'ws' package. Imported lazily so the server
 * can run without the dependency until the A->F write path is used.
 */
export async function createWsTransport(port = 8787): Promise<BridgeTransport> {
  const { WebSocketServer } = await import("ws").catch(() => {
    throw new Error("The 'ws' package is required for the Figma bridge. Run: npm i ws");
  });
  const wss = new WebSocketServer({ port });
  let socket: import("ws").WebSocket | null = null;
  const handlers: Array<(msg: unknown) => void> = [];
  wss.on("connection", (ws: import("ws").WebSocket) => {
    socket = ws;
    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        handlers.forEach((h) => h(msg));
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.on("close", () => {
      if (socket === ws) socket = null;
    });
  });
  return {
    send: (msg) => socket?.send(JSON.stringify(msg)),
    onMessage: (h) => handlers.push(h),
    isConnected: () => socket !== null && socket.readyState === socket.OPEN,
  };
}
