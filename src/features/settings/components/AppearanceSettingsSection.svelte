<script lang="ts">
  import * as Field from '$lib/components/ui/field/index.js';
  import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
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
</script>

<Field.Set>
  <Field.Label for="appearance-theme-mode">Appearance</Field.Label>
  <Field.Description>Choose your preferred theme mode.</Field.Description>
  <Field.Group>
    <Field.Field>
      <RadioGroup.Root
        id="appearance-theme-mode"
        value={themeMode}
        onValueChange={(value) => onThemeModeChange((value || 'system') as 'dark' | 'light' | 'system')}
      >
        <Field.Label for="theme-mode-dark">
          <Field.Field orientation="horizontal">
            <Field.Content>
              <Field.Title class="inline-flex items-center gap-2"><Moon class="h-4 w-4" />Dark</Field.Title>
              <Field.Description>Always use the dark theme.</Field.Description>
            </Field.Content>
            <RadioGroup.Item id="theme-mode-dark" value="dark" />
          </Field.Field>
        </Field.Label>
        <Field.Label for="theme-mode-light">
          <Field.Field orientation="horizontal">
            <Field.Content>
              <Field.Title class="inline-flex items-center gap-2"><Sun class="h-4 w-4" />Light</Field.Title>
              <Field.Description>Always use the light theme.</Field.Description>
            </Field.Content>
            <RadioGroup.Item id="theme-mode-light" value="light" />
          </Field.Field>
        </Field.Label>
        <Field.Label for="theme-mode-system">
          <Field.Field orientation="horizontal">
            <Field.Content>
              <Field.Title class="inline-flex items-center gap-2"><Monitor class="h-4 w-4" />System</Field.Title>
              <Field.Description>Match your operating system preference.</Field.Description>
            </Field.Content>
            <RadioGroup.Item id="theme-mode-system" value="system" />
          </Field.Field>
        </Field.Label>
      </RadioGroup.Root>
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
</Field.Set>
