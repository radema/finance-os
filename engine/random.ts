const TWO_PI = 2 * Math.PI;
const UINT32 = 2 ** 32;

/** MurmurHash3 finaliser: spreads every input bit over the 32-bit output. */
function mix(x: number): number {
  let h = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * A uniform generator on [0, 1) for one simulation path.
 *
 * The stream is the mulberry32 PRNG (32-bit state), seeded from `seed` and `path` through a hash.
 * Each path has its own stream, so a path's numbers do not depend on how many paths or goals run.
 *
 * @param seed An integer; its low and high 32 bits both count.
 * @param path Index of the path, 0-based.
 */
export function pathRandom(seed: number, path: number): () => number {
  const low = seed >>> 0;
  const high = Math.floor(seed / UINT32) >>> 0;
  let state = mix(low ^ mix(high + 1)) ^ mix(path + 0x9e3779b9);
  state = mix(state);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
}

/**
 * Fill `out` with independent standard normals by the Box-Muller transform: two uniforms give two
 * normals. `out.length` may be odd; the last pair then wastes one value.
 */
export function fillNormals(random: () => number, out: Float64Array): void {
  for (let i = 0; i < out.length; i += 2) {
    const radius = Math.sqrt(-2 * Math.log(1 - random()));
    const angle = TWO_PI * random();
    out[i] = radius * Math.cos(angle);
    if (i + 1 < out.length) out[i + 1] = radius * Math.sin(angle);
  }
}
