<script lang="ts">
  import * as Field from '$lib/components/ui/field/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import Moon from '@lucide/svelte/icons/moon';
  import Sun from '@lucide/svelte/icons/sun';
  import Monitor from '@lucide/svelte/icons/monitor';

  interface Props {
    themeMode: 'dark' | 'light' | 'system';
    launchAtLogin: boolean;
    onThemeModeChange: (mode: 'dark' | 'light' | 'system') => void;
    onLaunchAtLoginChange: (enabled: boolean) => void;
  }

  let { themeMode, launchAtLogin, onThemeModeChange, onLaunchAtLoginChange }: Props = $props();

  const themeOptions = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'System' },
  ] as const;

  let selectedTheme = $derived(themeOptions.find((o) => o.value === themeMode) ?? themeOptions[2]);
</script>

<Field.Group>
  <Field.Field orientation="horizontal">
    <Field.Content>
      <Field.Label for="appearance-theme-mode">Theme</Field.Label>
    </Field.Content>
    <Select.Root
      type="single"
      value={{ value: selectedTheme.value, label: selectedTheme.label }}
      onValueChange={(val) => {
        if (val === 'dark' || val === 'light' || val === 'system') onThemeModeChange(val);
      }}
    >
      <Select.Trigger id="appearance-theme-mode" class="h-8 w-[140px]">
        <span class="inline-flex items-center gap-2">
          {#if themeMode === 'dark'}
            <Moon class="h-3.5 w-3.5" />
          {:else if themeMode === 'light'}
            <Sun class="h-3.5 w-3.5" />
          {:else}
            <Monitor class="h-3.5 w-3.5" />
          {/if}
          {selectedTheme.label}
        </span>
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="dark" label="Dark">
          <span class="inline-flex items-center gap-2"><Moon class="h-3.5 w-3.5" />Dark</span>
        </Select.Item>
        <Select.Item value="light" label="Light">
          <span class="inline-flex items-center gap-2"><Sun class="h-3.5 w-3.5" />Light</span>
        </Select.Item>
        <Select.Item value="system" label="System">
          <span class="inline-flex items-center gap-2"><Monitor class="h-3.5 w-3.5" />System</span>
        </Select.Item>
      </Select.Content>
    </Select.Root>
  </Field.Field>
  <Field.Field orientation="horizontal">
    <Field.Label for="launch-at-login">Launch at login</Field.Label>
    <Field.Switch
      id="launch-at-login"
      checked={launchAtLogin}
      aria-label="Launch at login"
      onclick={() => onLaunchAtLoginChange(!launchAtLogin)}
    />
  </Field.Field>
</Field.Group>
