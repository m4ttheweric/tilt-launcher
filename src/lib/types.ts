export interface CachedResource {
  name: string;
  label: string;
  category?: string | undefined;
  type?: string | undefined;
  endpoint?: string | undefined;
  port?: number | undefined;
  path?: string | undefined;
  runtimeStatus?: string | undefined;
  isDisabled?: boolean | undefined;
}

export interface Environment {
  id: string;
  name: string;
  repoDir: string;
  tiltfile: string;
  tiltPort: number;
  description?: string | undefined;
  isSymlink?: boolean | undefined;
  selectedResources?: string[] | undefined;
  cachedResources?: CachedResource[] | undefined;
}

export interface PickedTiltfile {
  path: string;
  isSymlink: boolean;
  /** Resolved real path (absolute) when isSymlink is true */
  realPath?: string | undefined;
}

export interface Config {
  port: number;
  dashboardUrl?: string | undefined;
  themeMode?: 'dark' | 'light' | 'system' | undefined;
  environments: Environment[];
}

export interface EnvStatus {
  status: 'stopped' | 'starting' | 'running';
  logs: string[];
  tiltPort: number;
  uptime: number | null;
  newResources?: number | undefined;
  resources?: ResourceRow[] | undefined;
}

export type HealthStatus = 'up' | 'down' | 'unknown' | 'missing';

export interface ResourceRow {
  key: string;
  name: string;
  label: string;
  category: string;
  endpoint?: string | undefined;
  port?: number | undefined;
  path?: string | undefined;
  runtimeStatus: string;
  isDisabled: boolean;
  health: HealthStatus;
  exists: boolean;
  error?: string | undefined;
}

export interface StatusResponse {
  envs: Record<string, EnvStatus>;
  health?: Record<string, HealthStatus>;
}

export interface DiscoverResult {
  ok: boolean;
  resources: CachedResource[];
  logs: string[];
  error?: string;
}

export interface LoginItemSettings {
  openAtLogin: boolean;
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  /** Raw link target as returned by readlink (may be relative) */
  symlinkTarget?: string | undefined;
  /** Absolute resolved path when isSymlink is true */
  realPath?: string | undefined;
}

export interface ReadDirResult {
  ok: boolean;
  path: string;
  entries: DirEntry[];
  error?: string | undefined;
}
