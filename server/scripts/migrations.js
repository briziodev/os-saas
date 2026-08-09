#!/usr/bin/env node

const {
  runMigrationCli,
  serializeCliError,
} = require(
  "../database/migrationCli"
);

async function main() {
  try {
    const result =
      await runMigrationCli(
        process.argv.slice(2)
      );

    process.stdout.write(
      JSON.stringify(
        result,
        null,
        2
      ) + "\n"
    );
  } catch (error) {
    process.stderr.write(
      JSON.stringify(
        serializeCliError(
          error
        ),
        null,
        2
      ) + "\n"
    );

    process.exitCode = 1;
  }
}

main();
