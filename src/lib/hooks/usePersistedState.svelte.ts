/**
 * Svelte 5 rune-based persisted state.
 *
 * Usage:
 *   const theme = usePersistedState({ key: 'app:theme', defaultValue: 'dark' });
 *   theme.value          // read (reactive)
 *   theme.value = 'light' // write (triggers localStorage sync automatically)
 *
 * Type is inferred from `defaultValue`. Works with any JSON-serialisable value.
 */
export function usePersistedState<T>({ key, defaultValue }: { key: string; defaultValue: T }) {
  function load(): T {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  let value = $state<T>(load());

  $effect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  });

  return {
    get value(): T {
      return value;
    },
    set value(next: T) {
      value = next;
    },
  };
}
