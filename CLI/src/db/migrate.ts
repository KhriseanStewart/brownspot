#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "./client.ts";

const schemaPath = path.join(import.meta.dir, "schema.sql");
const sqlText = readFileSync(schemaPath, "utf8");
const db = getDb();
await db.unsafe(sqlText);
console.log("Migrations applied:", schemaPath);
await closeDb();
