/**
 * The plugin must load on iOS, where Node imports are unavailable.
 *
 * A single `node`, `fs`, `path`, `child_process` or `electron` import makes the plugin fail to
 * load on iOS, and it fails silently. Check this at build time rather than rely on
 * discipline, so this is an esbuild plugin that turns such an import into a build error.
 *
 * It is exported as data too, so a unit test can apply the same list to the source tree without
 * running a build.
 */
export const FORBIDDEN = [
  'fs', 'path', 'os', 'child_process', 'crypto', 'http', 'https', 'net', 'stream', 'util',
  'events', 'url', 'zlib', 'worker_threads', 'electron', 'original-fs',
]

/** True when an import specifier names something iOS cannot provide. */
export function isForbidden(specifier) {
  if (specifier.startsWith('node:')) return true
  return FORBIDDEN.includes(specifier)
}

export function forbiddenImports() {
  return {
    name: 'forbidden-imports',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (!isForbidden(args.path)) return null
        return {
          errors: [{
            text: `"${args.path}" cannot be imported: the plugin must load on iOS.`,
            notes: [{ text: `Imported by ${args.importer}` }],
          }],
        }
      })
    },
  }
}
