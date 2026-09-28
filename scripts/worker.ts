import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
void import("../src/worker");
