export interface ServiceDef {
  id: string;
  label: string;
  port: number;
  path: string;
}

export interface Environment {
  id: string;
  name: string;
  repoDir: string;
  tiltfile: string;
  tiltPort: number;
  description: string;
  services: ServiceDef[];
}

export interface Config {
  port: number;
  dashboardUrl: string;
  environments: Environment[];
}

export interface EnvStatus {
  status: 'stopped' | 'starting' | 'running';
  logs: string[];
  tiltPort: number;
  uptime: number | null;
}

export type HealthStatus = 'up' | 'down' | 'unknown';

export interface StatusResponse {
  envs: Record<string, EnvStatus>;
  health: Record<string, HealthStatus>;
}
