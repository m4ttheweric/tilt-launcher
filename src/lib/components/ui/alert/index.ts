import Root from './alert.svelte';
import Description from './alert-description.svelte';
import Title from './alert-title.svelte';
// @ts-expect-error tsgo does not resolve Svelte module-script exports in .ts index files
export { alertVariants, type AlertVariant } from './alert.svelte';

export {
  Root,
  Description,
  Title,
  //
  Root as Alert,
  Description as AlertDescription,
  Title as AlertTitle,
};
