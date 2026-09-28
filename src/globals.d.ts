/**
 * Ambient declarations for non-code imports.
 *
 * `src/app/global.css` is pulled in for the NativeWind reset and theme tokens.
 * Metro handles it at build time; TypeScript needs to be told that a CSS
 * side-effect import is legal.
 */
declare module "*.css";
