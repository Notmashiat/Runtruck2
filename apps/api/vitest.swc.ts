import { fileURLToPath } from 'node:url';

// SWC emits the decorator metadata Nest's DI needs (esbuild/oxc do not).
// Its native addon validates the permissions of its binding cache directory and
// refuses a user-profile cache whose ACL it does not trust, so keep the cache
// inside the repo. Set before @swc/core is first loaded (hence the dynamic import).
export async function swcPlugin() {
  process.env.SWC_NATIVE_BINDING_CACHE ??= fileURLToPath(new URL('../../node_modules/.cache/swc', import.meta.url));
  const { default: swc } = await import('unplugin-swc');
  return swc.vite({ module: { type: 'es6' } });
}
