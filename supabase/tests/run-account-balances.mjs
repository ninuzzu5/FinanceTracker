// Disposable embedded PostgreSQL only. Never reads credentials or opens a remote connection.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const runtimePath = process.argv[2];
if (!runtimePath) {
  throw new Error("Supply the path to a temporary PGlite runtime; see supabase/README.md. No project dependency is required.");
}
const { PGlite } = await import(pathToFileURL(resolve(runtimePath)).href);
const db = new PGlite(); // In-memory; no filesystem database and no network.
const read = path => readFile(new URL(path, import.meta.url), "utf8");
try {
  // Minimal Supabase Auth contract for testing; this is not a replacement for hosted Auth.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    set financetracker.test_database = 'isolated';
  `);
  await db.exec(await read("../migrations/001_initial_schema.sql"));
  await db.exec(await read("../migrations/002_rls_policies.sql"));
  // Verify additive migration behavior on a pre-existing row, including legacy precision.
  await db.exec(`
    insert into auth.users values ('00000000-0000-4000-8000-000000000099');
    insert into public.accounts (id, user_id, name, type)
      values ('10000000-0000-4000-8000-000000000099', '00000000-0000-4000-8000-000000000099', 'Existing', 'bank');
    insert into public.transactions (user_id, type, amount, transaction_date, category, to_account_id)
      values ('00000000-0000-4000-8000-000000000099', 'income', 0.001, '2026-09-01', 'salary', '10000000-0000-4000-8000-000000000099');
  `);
  const before = (await db.query("select * from public.transactions")).rows;
  await db.exec(await read("../migrations/004_account_openings_and_balances.sql"));
  assert.deepEqual((await db.query("select * from public.transactions")).rows, before);
  const opening = (await db.query("select opening_balance, opening_date from public.accounts")).rows[0];
  assert.deepEqual(opening, { opening_balance: null, opening_date: null });
  const fixture = await read("account_balances.sql");
  await db.exec(fixture);
  assert.equal((await db.query("select count(*)::int as n from public.accounts")).rows[0].n, 1);
  const checks = (fixture.match(/select pg_temp\.(assert_balance|expect_error)/g) ?? []).length;
  console.log(`SQL integration passed: ${checks} balance/error assertions, RLS and migration preservation checks. Fixtures rolled back.`);
} finally {
  await db.close();
}
