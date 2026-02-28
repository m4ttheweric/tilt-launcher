/**
 * JSON-RPC 2.0 protocol handler for the sidecar.
 *
 * Handles: parsing requests from stdin, serializing responses to stdout,
 * and emitting push notifications.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

// Standard JSON-RPC error codes
export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INTERNAL_ERROR = -32603;

// ── Parsing ───────────────────────────────────────────────────────────────

export function parseRequest(line: string): JsonRpcRequest | JsonRpcResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return {
      jsonrpc: '2.0',
      id: 0,
      error: { code: RPC_PARSE_ERROR, message: 'Parse error: invalid JSON' },
    };
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.jsonrpc !== '2.0' || typeof obj.method !== 'string' || obj.id == null) {
    return {
      jsonrpc: '2.0',
      id: (obj.id as number | string) ?? 0,
      error: { code: RPC_INVALID_REQUEST, message: 'Invalid Request: missing jsonrpc, method, or id' },
    };
  }

  return {
    jsonrpc: '2.0',
    id: obj.id as number | string,
    method: obj.method as string,
    params: (obj.params as Record<string, unknown>) ?? {},
  };
}

// ── Serialization ─────────────────────────────────────────────────────────

export function successResponse(id: number | string, result: unknown): string {
  const resp: JsonRpcResponse = { jsonrpc: '2.0', id, result };
  return JSON.stringify(resp);
}

export function errorResponse(
  id: number | string,
  code: number,
  message: string,
  data?: unknown,
): string {
  const resp: JsonRpcResponse = { jsonrpc: '2.0', id, error: { code, message, data } };
  return JSON.stringify(resp);
}

export function notification(method: string, params: unknown): string {
  const notif: JsonRpcNotification = { jsonrpc: '2.0', method, params };
  return JSON.stringify(notif);
}
