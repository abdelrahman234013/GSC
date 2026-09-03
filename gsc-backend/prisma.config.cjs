require("dotenv").config();
const { defineConfig } = require("prisma/config");

module.exports = defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Read directly instead of prisma/config's env() helper, which THROWS when
    // the variable is absent — and it is absent during `docker build`, because
    // a connection string is a runtime secret and has no business in an image
    // layer. `prisma generate` only reads the schema, so it does not need a
    // database at all; requiring one broke the production build.
    //
    // Commands that genuinely need a database (migrate deploy, studio) still
    // get it from the environment at runtime, and fail clearly if it is unset —
    // see the guard in docker-entrypoint.sh.
    url: process.env.DATABASE_URL,
  },
});
