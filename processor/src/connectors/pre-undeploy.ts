async function preUndeploy() {
  process.stdout.write("[pre-undeploy] Starting pre-undeploy scripts\n");
  process.stdout.write("[pre-undeploy] Pre-undeploy completed successfully\n");
}

async function run() {
  try {
    await preUndeploy();
  } catch (error) {
    if (error instanceof Error) {
      process.stderr.write(
        `[pre-undeploy] Pre-undeploy failed: ${error.message}\n`,
      );
    }
    process.exitCode = 1;
  }
}
run();
