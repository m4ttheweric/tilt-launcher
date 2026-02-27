// @ts-expect-error tsgo does not resolve Svelte module-script exports in .ts index files
import Root, { type ButtonProps, type ButtonSize, type ButtonVariant, buttonVariants } from './button.svelte';

export {
  Root,
  type ButtonProps as Props,
  //
  Root as Button,
  buttonVariants,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
};
