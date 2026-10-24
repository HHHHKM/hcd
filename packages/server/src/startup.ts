export function validateStartupEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production' && env.HCD_SEED_DEMO === '1') {
    throw new Error('HCD_SEED_DEMO=1 is forbidden in production; disable demo seeding before startup.');
  }
  if (env.NODE_ENV === 'production' && (!env.SECRET_KEY || env.SECRET_KEY.length < 32 || env.SECRET_KEY.includes('replace-this'))) throw new Error('Production startup requires SECRET_KEY to be set to a unique value with at least 32 characters.');
  if (env.NODE_ENV === 'production' && !env.APP_URL?.startsWith('https://')) throw new Error('Production startup requires APP_URL to be set to the public HTTPS origin.');
  if (env.NODE_ENV === 'production' && !env.RENDER_URL && !env.RENDER_HOST) throw new Error('Production startup requires an isolated RENDER_URL or RENDER_HOST.');
}
