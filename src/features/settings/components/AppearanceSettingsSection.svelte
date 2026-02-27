<script lang="ts">
  interface Props {
    themeMode: 'dark' | 'light' | 'system';
    launchAtLogin: boolean;
    onThemeModeChange: (mode: 'dark' | 'light' | 'system') => void;
    onLaunchAtLoginChange: (enabled: boolean) => void;
  }

  let { themeMode, launchAtLogin, onThemeModeChange, onLaunchAtLoginChange }: Props = $props();
</script>

<section class="rounded-md border border-border bg-card p-3">
  <h4 class="mb-2 text-sm font-medium">Appearance</h4>
  <div class="space-y-1">
    <label for="theme-mode" class="text-xs text-muted-foreground">Theme</label>
    <select
      id="theme-mode"
      class="h-8 w-full border border-input bg-background px-2 text-sm"
      value={themeMode}
      onchange={(e) => onThemeModeChange(e.currentTarget.value as 'dark' | 'light' | 'system')}
    >
      <option value="dark">Dark</option>
      <option value="light">Light</option>
      <option value="system">System</option>
    </select>
  </div>
  <label class="mt-3 flex items-center gap-2 text-sm">
    <input type="checkbox" checked={launchAtLogin} onchange={(e) => onLaunchAtLoginChange(e.currentTarget.checked)} />
    <span>Launch at login</span>
  </label>
</section>
