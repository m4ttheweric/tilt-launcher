<script lang="ts">
  import type { Config, Environment, ServiceMapping } from '$lib/types.ts';
  import { BROWSER_PANE_MIN_WIDTH_PX, MAIN_PANE_MIN_WIDTH_PX } from '$lib/constants.ts';
  import SplitterHandle from '$lib/components/SplitterHandle.svelte';
  import TiltfileEnvironmentsPane from '../../tiltfiles/components/TiltfileEnvironmentsPane.svelte';
  import TiltBrowserPane from '../../browser/components/TiltBrowserPane.svelte';
  import OutputPane from '../../output/components/OutputPane.svelte';
  import type { LauncherState } from '../useLauncherState.svelte.ts';

  interface Props {
    config: Config | null;
    selectedEnv: Environment | null;
    selectedEnvStatus: string;
    launcher: LauncherState;
    onStart: (env: Environment) => void | Promise<void>;
    onStop: (env: Environment) => void | Promise<void>;
    onRestart: (env: Environment) => void | Promise<void>;
    onTriggerResource: (envId: string, resourceName: string) => void | Promise<void>;
    onEnableResource: (envId: string, resourceName: string) => void | Promise<void>;
    onDisableResource: (envId: string, resourceName: string) => void | Promise<void>;
    onOpenExternal: (url: string) => void | Promise<void>;
    onSaveMapping: (envId: string, mapping: ServiceMapping) => void;
    onStartVerticalResize: (event: MouseEvent) => void;
    onStartHorizontalResize: (event: MouseEvent) => void;
  }

  let {
    config,
    selectedEnv,
    selectedEnvStatus,
    launcher,
    onStart,
    onStop,
    onRestart,
    onTriggerResource,
    onEnableResource,
    onDisableResource,
    onOpenExternal,
    onSaveMapping,
    onStartVerticalResize,
    onStartHorizontalResize,
  }: Props = $props();

  let outputPaneRef: OutputPane | undefined = $state();
</script>

<div
  class="grid min-h-0 flex-1"
  style={launcher.logsCollapsed
    ? 'grid-template-rows: minmax(260px,1fr) 24px'
    : `grid-template-rows: minmax(260px,1fr) 12px ${launcher.logsHeight}px`}
>
  <div
    class="grid min-h-0"
    style={launcher.rightPaneCollapsed
      ? 'grid-template-columns: 1fr;'
      : `grid-template-columns: minmax(${MAIN_PANE_MIN_WIDTH_PX}px, ${launcher.leftPanePercent}%) 12px minmax(${BROWSER_PANE_MIN_WIDTH_PX}px, ${100 - launcher.leftPanePercent}%);`}
  >
    <TiltfileEnvironmentsPane
      {config}
      rightPaneCollapsed={launcher.rightPaneCollapsed}
      {onStart}
      {onStop}
      {onRestart}
      {onTriggerResource}
      {onEnableResource}
      {onDisableResource}
      {onOpenExternal}
      {onSaveMapping}
      onShowServiceLogs={(envId, serviceName) => outputPaneRef?.showServiceInLogs(envId, serviceName)}
    />

    {#if !launcher.rightPaneCollapsed}
      <SplitterHandle
        orientation="vertical"
        ariaLabel="Resize main and tilt panes"
        onResizeStart={onStartVerticalResize}
      />
    {/if}

    {#if !launcher.rightPaneCollapsed}
      <TiltBrowserPane
        {selectedEnv}
        {selectedEnvStatus}
        selectedTiltUrl={launcher.selectedTiltUrl}
        tiltZoomFactor={launcher.tiltZoomFactor}
        {onStart}
        onRetry={() => {
          if (!selectedEnv) return;
          launcher.selectedTiltUrl = `http://localhost:${selectedEnv.tiltPort}`;
        }}
        onZoomOut={() => launcher.zoomTilt(-0.1)}
        onZoomIn={() => launcher.zoomTilt(0.1)}
        onResetZoom={launcher.resetTiltZoom}
        onClose={() => (launcher.rightPaneCollapsed = true)}
        onWebviewRef={(webview) => (launcher.tiltWebview = webview)}
        onDidFinishLoad={() => launcher.applyTiltZoom(launcher.tiltZoomFactor)}
      />
    {/if}
  </div>

  <OutputPane
    bind:this={outputPaneRef}
    {config}
    activeLogEnvId={launcher.activeLogEnvId}
    logsCollapsed={launcher.logsCollapsed}
    onStartResize={onStartHorizontalResize}
    onRestore={() => (launcher.logsCollapsed = false)}
    onCollapse={() => (launcher.logsCollapsed = true)}
    onSelectEnv={(envId) => (launcher.activeLogEnvId = envId)}
  />
</div>
