import * as dotenv from "dotenv";
import { initCustomTypes } from "../utils/custom-fields";
dotenv.config();

async function runPostDeployScripts() {
  process.stdout.write("[post-deploy] Starting post-deploy scripts\n");
  try {
    const properties = new Map(Object.entries(process.env));
    process.stdout.write(
      `[post-deploy] Loaded ${properties.size} environment variables\n`,
    );
    await initCustomTypes();
    process.stdout.write("[post-deploy] Post-deploy completed successfully\n");
  } catch (error) {
    if (error instanceof Error) {
      process.stderr.write(
        `[post-deploy] Post-deploy failed: ${error.message}\n`,
      );
    }
    process.exitCode = 1;
  }
}

(async () => {
  await runPostDeployScripts();
})();
