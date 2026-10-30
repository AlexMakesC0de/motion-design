// Reserve once against the store in KIE_RUNS_DIR with a $1 cap, and print the
// outcome. Two of these run at once to prove the lock works across processes.
const { openJobs } = await import("../../cli/core/jobs.mjs");
const { reserve } = await import("../../cli/core/spend.mjs");

try {
  const job = await reserve(openJobs(), { estimateUsd: Number(process.argv[2]) }, {
    limits: { dailyUsd: 1, allowRoots: [] },
  });
  console.log(`ok ${job.id}`);
} catch (e) {
  console.log(`refused ${e.code}`);
}
