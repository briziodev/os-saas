require("dotenv").config({ quiet: true });

const { Pool } = require("pg");
const {
  buildDatabasePoolConfig,
} = require("./dbConfig");

const pool =
  new Pool(
    buildDatabasePoolConfig(
      process.env
    )
  );

module.exports = pool;
