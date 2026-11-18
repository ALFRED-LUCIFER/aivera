import { env } from './env';

/** Exits with code 1, logging only the names of missing or invalid variables, when the configuration is wrong. */
export function checkEnvOnStart(): void {
  try {
    env();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
