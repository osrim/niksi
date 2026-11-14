const elapsed = (run: () => unknown): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

// How many times longer `hostile` takes than `baseline`, an input of the same size that takes the
// linear path. The two alternate and the fastest run of each counts, so a slow or busy machine
// slows both alike and a fixed number of milliseconds never decides the result.
export const slowdown = (hostile: () => unknown, baseline: () => unknown, rounds = 3): number => {
  let fastestHostile = Number.POSITIVE_INFINITY;
  let fastestBaseline = Number.POSITIVE_INFINITY;
  for (let round = 0; round < rounds; round++) {
    fastestBaseline = Math.min(fastestBaseline, elapsed(baseline));
    fastestHostile = Math.min(fastestHostile, elapsed(hostile));
  }
  return fastestHostile / fastestBaseline;
};
