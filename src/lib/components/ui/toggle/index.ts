import Root from './toggle.svelte';
// @ts-expect-error tsgo does not resolve Svelte module-script exports in .ts index files
export { toggleVariants, type ToggleSize, type ToggleVariant, type ToggleVariants } from './toggle.svelte';

export {
  Root,
  //
  Root as Toggle,
};
