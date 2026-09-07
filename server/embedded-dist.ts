/**
 * Frontend dist assets embedded into the packaged EXE (base64, keyed by
 * dist-relative path with forward slashes). scripts/build-exe.mjs briefly
 * fills this map, rebuilds the server bundle, then restores the empty stub so
 * the repo stays small. Normal dev/build runs keep the empty map and serve the
 * real dist/ folder from disk.
 */
export const embeddedDist: Record<string, string> = {};
