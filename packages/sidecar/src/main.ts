#!/usr/bin/env bun
/**
 * Tilt Launcher Sidecar — JSON-RPC server over stdin/stdout.
 *
 * Wraps TiltManagerSDK and exposes every SDK feature as a JSON-RPC method.
 * Push notifications (statusUpdate, logDelta, configUpdated) are emitted
 * as JSON-RPC notifications on stdout.
 *
 * Protocol: newline-delimited JSON-RPC 2.0.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { lstatSync, readdirSync, realpathSync, statSync, readlinkSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { homedir } from 'node:os';
import { TiltManagerSDK } from '@tilt-launcher/sdk';
import type { Config, StatusUpdate, LogDelta, PickedTiltfile, DirEntry } from '@tilt-launcher/sdk';
import {
  parseRequest,
  successResponse,
  errorResponse,
  notification,
  RPC_METHOD_NOT_FOUND,
  RPC_INTERNAL_ERROR,
} from './rpc.ts';

// ── Path helpers ──────────────────────────────────────────────────────────

/** Expand leading ~ to the user's home directory */
function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

// ── Config persistence ────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), '.config', 'tilt-launcher');
const CONFIG_PATH = process.env.TILT_LAUNCHER_CONFIG || join(CONFIG_DIR, 'config.json');

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeConfig(raw: Config): Config {
  const used = new Set<string>();
  const environments = (raw.environments ?? []).map((env, idx) => {
    const id = env.id && env.id.length > 0 ? env.id : slugify(env.name || `env-${idx + 1}`) || `env-${idx + 1}`;
    let unique = id;
    let suffix = 2;
    while (used.has(unique)) {
      unique = `${id}-${suffix++}`;
    }
    used.add(unique);
    return {
      ...env,
      id: unique,
      external: env.external ?? false,
      description: env.description ?? '',
      selectedResources: env.selectedResources ?? [],
      cachedResources: env.cachedResources ?? [],
      serviceMapping: env.serviceMapping,
    };
  });
  return { themeMode: raw.themeMode ?? 'system', environments };
}

/** Validate that no two environments share the same tiltPort. */
function ensureUniquePorts(cfg: Config): string | null {
  const seen = new Map<number, string>();
  for (const env of cfg.environments) {
    const owner = seen.get(env.tiltPort);
    if (owner) return `Port ${env.tiltPort} is used by both ${owner} and ${env.name}.`;
    seen.set(env.tiltPort, env.name);
  }
  return null;
}

function loadConfig(): Config {
  mkdirSync(CONFIG_DIR, { recursive: true });
  if (!existsSync(CONFIG_PATH)) {
    const fallback: Config = { environments: [] };
    const normalized = normalizeConfig(fallback);
    writeConfig(normalized);
    return normalized;
  }
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Config;
    return normalizeConfig(parsed);
  } catch (e) {
    const backupPath = `${CONFIG_PATH}.bak`;
    console.error(`Failed to parse config, backing up to ${backupPath}:`, e);
    try {
      renameSync(CONFIG_PATH, backupPath);
    } catch {
      /* backup failed */
    }
    const fallback: Config = { environments: [] };
    const normalized = normalizeConfig(fallback);
    writeConfig(normalized);
    return normalized;
  }
}

function writeConfig(config: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

// ── SDK instance ──────────────────────────────────────────────────────────

let config: Config = loadConfig();
let configSaveTimer: ReturnType<typeof setTimeout> | null = null;

const sdk = new TiltManagerSDK(config, {
  onStatusUpdate: (update: StatusUpdate) => {
    emit('statusUpdate', update);
  },
  onLogDelta: (delta: LogDelta) => {
    emit('logDelta', delta);
  },
  onConfigMutated: (mutated: Config) => {
    config = mutated;
    if (configSaveTimer) clearTimeout(configSaveTimer);
    configSaveTimer = setTimeout(() => {
      writeConfig(config);
      emit('configUpdated', config);
    }, 5000);
  },
});

sdk.startPolling(5000);

// ── Output ────────────────────────────────────────────────────────────────

function emit(method: string, params: unknown): void {
  const line = notification(method, params);
  process.stdout.write(line + '\n');
}

function respond(line: string): void {
  process.stdout.write(line + '\n');
}

// ── Filesystem helpers ────────────────────────────────────────────────────

/**
 * macOS NSOpenPanel resolves POSIX symlinks before returning paths, so
 * the file path is often the real file rather than the symlink the user
 * navigated to. Given the real path, scan common workspace roots for a
 * symlink whose realpath matches, then remap the path through it.
 *
 * Ported from Electron shell's findSymlinkFor().
 */
function findSymlinkFor(realFilePath: string): string | null {
  const realDir = dirname(realFilePath);
  const filename = basename(realFilePath);

  const scanRoots = [
    dirname(realDir), // siblings of the real directory
    join(homedir(), 'Documents', 'GitHub'),
    join(homedir(), 'Documents', 'Projects'),
    join(homedir(), 'repos'),
    join(homedir(), 'projects'),
    join(homedir(), 'src'),
    join(homedir(), 'dev'),
    join(homedir(), 'code'),
    join(homedir(), 'workspace'),
  ];

  for (const scanRoot of scanRoots) {
    if (!existsSync(scanRoot)) continue;
    try {
      for (const entry of readdirSync(scanRoot)) {
        const entryPath = join(scanRoot, entry);
        try {
          const entryStat = lstatSync(entryPath);
          if (!entryStat.isSymbolicLink()) continue;
          const entryReal = realpathSync(entryPath);
          // Directory symlink whose target is realDir → remap file path through it
          if (entryReal === realDir) return join(entryPath, filename);
          // File symlink pointing directly to our file
          if (entryReal === realFilePath) return entryPath;
          // Symlink whose target is an ancestor of realDir → remap deeper path
          const rel = relative(entryReal, realFilePath);
          if (!rel.startsWith('..')) return join(entryPath, rel);
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Classify a Tiltfile path — detect symlinks with reverse-mapping support.
 * Matches Electron shell's classifyTiltfilePath() behavior.
 */
function classifyTiltfilePath(filePath: string): PickedTiltfile {
  const resolved = expandHome(filePath);

  // Case 1: path is itself a symlink
  try {
    if (lstatSync(resolved).isSymbolicLink()) {
      return { path: resolved, isSymlink: true, realPath: realpathSync(resolved) };
    }
  } catch {
    /* ignore */
  }

  // Case 2: macOS resolved the symlink — try to reverse-map back to the symlink
  const symlinkPath = findSymlinkFor(resolved);
  if (symlinkPath) {
    return { path: symlinkPath, isSymlink: true, realPath: resolved };
  }

  return { path: resolved, isSymlink: false };
}

/**
 * Read directory contents. Matches Electron shell behavior:
 * - Filters out dotfiles (entries starting with '.')
 * - Sorts directories before files, then alphabetical
 * - Resolves symlink targets
 */
function readDir(dirPath: string): { ok: boolean; path: string; entries: DirEntry[]; error?: string } {
  try {
    const resolved = expandHome(dirPath);
    const rawNames = readdirSync(resolved);
    const entries: DirEntry[] = [];

    for (const name of rawNames) {
      if (name.startsWith('.')) continue; // Filter dotfiles

      const fullPath = join(resolved, name);
      try {
        const lstats = lstatSync(fullPath);
        const isSymlink = lstats.isSymbolicLink();
        let isDirectory = lstats.isDirectory();
        let isFile = lstats.isFile();
        let symlinkTarget: string | undefined;
        let realPath: string | undefined;

        if (isSymlink) {
          try {
            symlinkTarget = readlinkSync(fullPath);
          } catch {
            /* ignore */
          }
          try {
            realPath = realpathSync(fullPath);
            const resolvedStat = statSync(fullPath); // follows the symlink
            isDirectory = resolvedStat.isDirectory();
            isFile = resolvedStat.isFile();
          } catch {
            isFile = true; /* broken symlink */
          }
        }

        entries.push({ name, isDirectory, isFile, isSymlink, symlinkTarget, realPath });
      } catch {
        continue;
      }
    }

    // Sort: directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { ok: true, path: resolved, entries };
  } catch (e) {
    return { ok: false, path: dirPath, entries: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Method dispatch ───────────────────────────────────────────────────────

type Handler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

const methods: Record<string, Handler> = {
  // Config
  getConfig: () => config,

  saveConfig: (params) => {
    const next = params.config as Config;
    const normalized = normalizeConfig(next);

    // Validate unique ports (matches Electron behavior)
    const conflict = ensureUniquePorts(normalized);
    if (conflict) return { ok: false, error: conflict };

    config = normalized;
    sdk.setConfig(config);
    writeConfig(config);
    emit('configUpdated', config);
    return { ok: true };
  },

  // Status & Logs
  getStatus: () => sdk.currentStatusUpdate(),

  getLogs: (params) => {
    const envId = params.envId as string;
    return sdk.getEnvLogs(envId);
  },

  // Lifecycle
  startEnv: (params) => {
    const envId = params.envId as string;
    return sdk.startEnv(envId);
  },

  stopEnv: (params) => {
    const envId = params.envId as string;
    return sdk.stopEnv(envId);
  },

  restartEnv: (params) => {
    const envId = params.envId as string;
    return sdk.restartEnv(envId);
  },

  // Resource control
  triggerResource: async (params) => {
    const envId = params.envId as string;
    const resourceName = params.resourceName as string;
    return sdk.triggerResource(envId, resourceName);
  },

  enableResource: async (params) => {
    const envId = params.envId as string;
    const resourceName = params.resourceName as string;
    return sdk.enableResource(envId, resourceName);
  },

  disableResource: async (params) => {
    const envId = params.envId as string;
    const resourceName = params.resourceName as string;
    return sdk.disableResource(envId, resourceName);
  },

  // Discovery
  discoverResources: async (params) => {
    const input: { tiltfilePath: string; tiltPort: number; timeoutMs?: number } = {
      tiltfilePath: params.tiltfilePath as string,
      tiltPort: params.tiltPort as number,
    };
    if (params.timeoutMs != null) input.timeoutMs = params.timeoutMs as number;
    return sdk.discoverResources(input);
  },

  // Filesystem
  classifyTiltfilePath: (params) => {
    return classifyTiltfilePath(params.filePath as string);
  },

  getHomeDir: () => homedir(),

  readDir: (params) => {
    return readDir(params.dirPath as string);
  },

  // Login item (stub — platform-specific, handled by shells directly)
  getLoginItem: () => ({ openAtLogin: false }),
  setLoginItem: () => ({ ok: true }),
};

// ── Request handler ───────────────────────────────────────────────────────

async function handleLine(line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  const parsed = parseRequest(trimmed);

  // If parseRequest returned an error response, send it
  if ('error' in parsed && parsed.error) {
    respond(JSON.stringify(parsed));
    return;
  }

  const request = parsed as { id: number | string; method: string; params: Record<string, unknown> };
  const handler = methods[request.method];

  if (!handler) {
    respond(errorResponse(request.id, RPC_METHOD_NOT_FOUND, `Method not found: ${request.method}`));
    return;
  }

  try {
    const result = await handler(request.params ?? {});
    respond(successResponse(request.id, result));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    respond(errorResponse(request.id, RPC_INTERNAL_ERROR, message));
  }
}

// ── stdin reader ──────────────────────────────────────────────────────────

let buffer = '';

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    void handleLine(line);
  }
});

process.stdin.on('end', () => {
  // stdin closed — clean shutdown.
  // Match Electron behavior: do NOT stop running Tilt environments.
  // Quitting the launcher should leave Tilt processes running.
  sdk.stopPolling();
  process.exit(0);
});

// Handle signals gracefully — same policy: don't kill Tilt processes.
process.on('SIGTERM', () => {
  sdk.stopPolling();
  process.exit(0);
});

process.on('SIGINT', () => {
  sdk.stopPolling();
  process.exit(0);
});

// Signal that sidecar is ready
emit('ready', { version: '1.2.0' });
