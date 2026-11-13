import { production } from '../../environments/environment';

/** `console.log` in development only (see `src/environments/`); nothing is written in production builds. */
export const devLog = (...args: unknown[]): void => {
  if (!production) console.log(...args);
};
