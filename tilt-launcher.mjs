#!/usr/bin/env node

/**
 * Tilt Launcher — a local web UI to start/stop Tilt environments.
 *
 * Usage:   node tilt-launcher.mjs
 * Config:  ~/.config/tilt-launcher/config.json (or TILT_LAUNCHER_CONFIG env var)
 *
 * Serves over plain HTTP.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load config ─────────────────────────────────────────────────────
const CONFIG_PATH =
  process.env.TILT_LAUNCHER_CONFIG || join(homedir(), '.config', 'tilt-launcher', 'config.json');

let config;
try {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
} catch {
  // Fall back to local config.json or example
  const localConfig = join(__dirname, 'config.json');
  const exampleConfig = join(__dirname, 'config.example.json');
  const fallback = existsSync(localConfig) ? localConfig : exampleConfig;
  config = JSON.parse(readFileSync(fallback, 'utf-8'));
  console.warn(`  ⚠️  Config not found at ${CONFIG_PATH}, using ${fallback}`);
}

const PORT = config.port || 10400;
const DIST_DIR = join(__dirname, 'dist');

// Build ENVS lookup
const ENVS = {};
for (const env of config.environments) {
  ENVS[env.id] = env;
}

// Collect all services across all environments for health checking.
// Each service is keyed as "envId:serviceId" to avoid collisions
// (e.g. both envs may have a "backend" service on different ports).
// Tilt dashboard health is auto-added per environment.
const ALL_SERVICES = [];
for (const env of config.environments) {
  for (const svc of env.services || []) {
    ALL_SERVICES.push({ ...svc, healthKey: `${env.id}:${svc.id}` });
  }
  ALL_SERVICES.push({
    id: 'tilt',
    label: `Tilt ${env.name}`,
    port: env.tiltPort,
    path: '/',
    healthKey: `${env.id}:tilt`,
  });
}

// ── Service health checks ───────────────────────────────────────────
const serviceHealth = {};
ALL_SERVICES.forEach((s) => (serviceHealth[s.healthKey] = 'unknown'));

function tryConnect(hostname, port, path, timeout) {
  return new Promise((resolve) => {
    const request = http.request({ hostname, port, path, timeout, method: 'GET' }, (res) => {
      res.resume();
      resolve(true);
    });
    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.end();
  });
}

async function checkServiceHealth(service) {
  const up =
    (await tryConnect('127.0.0.1', service.port, service.path, 1500)) ||
    (await tryConnect('::1', service.port, service.path, 1500));
  serviceHealth[service.healthKey] = up ? 'up' : 'down';
}

async function pollAllHealth() {
  await Promise.all(ALL_SERVICES.map((s) => checkServiceHealth(s)));
}

setInterval(pollAllHealth, 5000);
pollAllHealth();

// ── Process tracking ─────────────────────────────────────────────────
const processes = {};
const logs = {};
const startTimes = {};
const MAX_LOG_LINES = 500;

function appendLog(env, line) {
  if (!logs[env]) logs[env] = [];
  logs[env].push(line);
  if (logs[env].length > MAX_LOG_LINES) {
    logs[env] = logs[env].slice(-MAX_LOG_LINES);
  }
}

function getStatus(env) {
  const envConfig = ENVS[env];
  if (!envConfig) return 'stopped';
  const tiltHealthKey = `${env}:tilt`;
  if (serviceHealth[tiltHealthKey] === 'up') return 'running';
  const proc = processes[env];
  if (proc && proc.exitCode === null && !proc.killed) return 'starting';
  return 'stopped';
}

function startEnv(env) {
  const status = getStatus(env);
  if (status === 'running' || status === 'starting') {
    return { ok: false, error: 'Already running' };
  }

  const envConfig = ENVS[env];
  if (!envConfig) return { ok: false, error: 'Unknown environment' };

  logs[env] = [];
  appendLog(env, `[launcher] Starting ${envConfig.name}...`);
  appendLog(env, `[launcher] cwd: ${envConfig.repoDir}`);
  appendLog(env, `[launcher] tilt up -f ${envConfig.tiltfile} --port ${envConfig.tiltPort}`);

  const child = spawn(
    'tilt',
    ['up', '-f', envConfig.tiltfile, '--port', String(envConfig.tiltPort)],
    {
      cwd: envConfig.repoDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env },
    },
  );

  child.unref();

  child.stdout.on('data', (data) => {
    data
      .toString()
      .split('\n')
      .filter(Boolean)
      .forEach((l) => appendLog(env, l));
  });
  child.stderr.on('data', (data) => {
    data
      .toString()
      .split('\n')
      .filter(Boolean)
      .forEach((l) => appendLog(env, l));
  });
  child.on('close', (code) => {
    appendLog(env, `[launcher] Process exited with code ${code}`);
    delete processes[env];
  });
  child.on('error', (err) => {
    appendLog(env, `[launcher] Error: ${err.message}`);
    delete processes[env];
  });

  processes[env] = child;
  startTimes[env] = Date.now();
  return { ok: true };
}

function stopEnv(env) {
  const envConfig = ENVS[env];
  if (!envConfig) return { ok: false, error: 'Unknown environment' };

  const status = getStatus(env);
  if (status === 'stopped') return { ok: false, error: 'Not running' };

  appendLog(env, `[launcher] Stopping ${envConfig.name}...`);

  const proc = processes[env];
  if (proc && !proc.killed && proc.exitCode === null) {
    proc.kill('SIGTERM');
    delete processes[env];
  }

  const down = spawn('tilt', ['down', '-f', envConfig.tiltfile], {
    cwd: envConfig.repoDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  down.stdout.on('data', (data) => {
    data
      .toString()
      .split('\n')
      .filter(Boolean)
      .forEach((l) => appendLog(env, `[down] ${l}`));
  });
  down.stderr.on('data', (data) => {
    data
      .toString()
      .split('\n')
      .filter(Boolean)
      .forEach((l) => appendLog(env, `[down] ${l}`));
  });

  delete startTimes[env];
  return { ok: true };
}

// ── HTTP server ──────────────────────────────────────────────────────
function sendJSON(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const handler = (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API: config
  if (req.method === 'GET' && url.pathname === '/api/config') {
    const dashboardUrl = config.dashboardUrl || `http://localhost:${PORT}`;
    return sendJSON(res, { ...config, dashboardUrl });
  }

  // API: status
  if (req.method === 'GET' && url.pathname === '/api/status') {
    const status = {};
    for (const env of Object.keys(ENVS)) {
      status[env] = {
        status: getStatus(env),
        logs: logs[env] || [],
        tiltPort: ENVS[env].tiltPort,
        uptime: startTimes[env] ? Date.now() - startTimes[env] : null,
      };
    }
    return sendJSON(res, { envs: status, health: serviceHealth });
  }

  // API: start
  if (req.method === 'POST' && url.pathname.startsWith('/api/start/')) {
    const env = url.pathname.split('/').pop();
    return sendJSON(res, startEnv(env));
  }

  // API: stop
  if (req.method === 'POST' && url.pathname.startsWith('/api/stop/')) {
    const env = url.pathname.split('/').pop();
    return sendJSON(res, stopEnv(env));
  }

  // Serve static files from dist/ (Vite build output)
  if (req.method === 'GET') {
    const MIME = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.json': 'application/json',
    };
    const filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    const ext = filePath.substring(filePath.lastIndexOf('.'));
    const contentType = MIME[ext] || 'application/octet-stream';
    try {
      const content = readFileSync(join(DIST_DIR, filePath));
      res.writeHead(200, { 'Content-Type': contentType });
      return res.end(content);
    } catch {
      // SPA fallback — serve index.html for unmatched routes
      try {
        const content = readFileSync(join(DIST_DIR, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(content);
      } catch {
        res.writeHead(404);
        return res.end('Not found — run `bun run build` first');
      }
    }
  }

  res.writeHead(404);
  res.end('Not found');
};

const server = createServer(handler);

server.listen(PORT, '0.0.0.0', () => {
  const dashUrl = config.dashboardUrl || `http://localhost:${PORT}`;
  console.log(`\n  🚀 Tilt Launcher running at ${dashUrl} (port ${PORT})`);
  console.log(`  📋 Config: ${CONFIG_PATH}`);
  for (const env of config.environments) {
    const svcList = (env.services || []).map((s) => `${s.label}:${s.port}`).join(', ');
    console.log(
      `  🔧 ${env.name}: ${env.repoDir} → ${env.tiltfile} (:${env.tiltPort}) [${svcList}]`,
    );
  }
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n[launcher] Dashboard shutting down (tilt processes are unaffected)');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('[launcher] Dashboard shutting down (tilt processes are unaffected)');
  process.exit(0);
});
