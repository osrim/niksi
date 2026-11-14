const ROUNDS = 3;

const elapsed = (run: () => unknown): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

const milliseconds = (times: number[]): string => times.map((time) => time.toFixed(1)).join(", ");

// How many times longer `hostile` takes than `baseline`, an input of the same size that takes the
// linear path. The two alternate, the one that runs first swaps each round, and the fastest run of
// each counts, so a slow or busy machine slows both alike and a fixed number of milliseconds never
// decides the result. `rounds` lists every run's time, for the assertion's failure message.
export const slowdown = (
  hostile: () => unknown,
  baseline: () => unknown,
): { ratio: number; rounds: string } => {
  const hostileTimes: number[] = [];
  const baselineTimes: number[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    if (round % 2 === 0) {
      baselineTimes.push(elapsed(baseline));
      hostileTimes.push(elapsed(hostile));
    } else {
      hostileTimes.push(elapsed(hostile));
      baselineTimes.push(elapsed(baseline));
    }
  }
  return {
    ratio: Math.min(...hostileTimes) / Math.min(...baselineTimes),
    rounds: `hostile ms by round: ${milliseconds(hostileTimes)}; baseline ms by round: ${milliseconds(baselineTimes)}; baseline runs first in odd rounds`,
  };
};
