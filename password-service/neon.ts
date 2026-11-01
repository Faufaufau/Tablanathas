import { env } from "node:process";
import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: false,

  functions: {
    password: {
      name: "Tablanathas Password Service",
      source: "./functions/password.ts",
      env: {
        PASSWORD_SERVICE_TOKEN: env.PASSWORD_SERVICE_TOKEN!,
      },
    },
  },

  branch: (branch) => {
    if (branch.isDefault) {
      return {};
    }

    if (!branch.exists) {
      return { ttl: "7d" };
    }

    return {};
  },
});