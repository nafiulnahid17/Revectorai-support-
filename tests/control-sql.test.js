import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const A = "00000000-0000-4000-8000-000000000001",
  U = "00000000-0000-4000-8000-000000000002",
  V = "00000000-0000-4000-8000-000000000003",
  S = "00000000-0000-4000-8000-000000000004";
test("actual PostgreSQL migration: RLS, separate roles, atomic ledger, reservations and support privacy", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;grant usage on schema public to service_role,authenticated;`,
    );
    await db.exec(
      await readFile(
        new URL(
          "../schema/20261004190643_revector_control_v1.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      `insert into auth.users values('${A}'),('${U}'),('${V}'),('${S}');insert into revector_profiles(id,auth_user_id,email,role) values('${A}','${A}','admin@example.test','ADMIN'),('${U}','${U}','one@example.test','USER'),('${V}','${V}','two@example.test','USER'),('${S}','${S}','support@example.test','SUPPORT');`,
    );
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${U}';`);
    assert.equal(
      (await db.query("select * from revector_profiles")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from revector_wallets")).rows.length,
      1,
    );
    await assert.rejects(
      db.query(`update revector_profiles set role='ADMIN' where id='${U}'`),
      /permission denied/,
    );
    await assert.rejects(
      db.query(`select rv_adjust_wallet('${A}','${U}',10,'bad','bad')`),
      /permission denied/,
    );
    await db.exec("reset role;set role service_role;");
    await assert.rejects(
      db.query(`select rv_adjust_wallet('${U}','${U}',10,'bad','bad')`),
      /ADMIN_REQUIRED/,
    );
    await assert.rejects(
      db.query(`select rv_adjust_wallet('${S}','${U}',10,'bad','bad')`),
      /ADMIN_REQUIRED/,
    );
    await db.query(
      `select rv_adjust_wallet('${A}','${U}',10,'test funding','fund')`,
    );
    await db.query(
      `select rv_adjust_wallet('${A}','${U}',10,'test funding','fund')`,
    );
    assert.equal(
      (await db.query("select * from revector_wallet_transactions")).rows
        .length,
      1,
    );
    assert.equal(
      (await db.query("select * from revector_admin_audit_log")).rows.length,
      1,
    );
    await assert.rejects(
      db.query(`select rv_adjust_wallet('${A}','${U}',11,'conflict','fund')`),
      /IDEMPOTENCY_CONFLICT/,
    );
    await assert.rejects(
      db.query(
        `select rv_adjust_wallet('${A}','${U}',-11,'too much','deduct')`,
      ),
      /INSUFFICIENT_CREDITS/,
    );
    await assert.rejects(
      db.query(`delete from revector_wallet_transactions`),
      /append-only|permission denied/,
    );
    await db.query(
      `update revector_model_catalog set operation_prices='{"ANALYZE":0.05}',pricing_version='test-v1' where capability='ANALYZER'`,
    );
    const reservation = (
      await db.query(
        `select rv_reserve_operation('${U}','op','ANALYZE',null,100) as r`,
      )
    ).rows[0].r;
    assert.equal(reservation.reserved_credits, 5);
    // Catalog/rate changes during a queued job cannot change its reserved price.
    await db.query(
      `update revector_model_catalog set operation_prices='{"ANALYZE":0.09}',pricing_version='test-v2' where capability='ANALYZER'`,
    );
    await assert.rejects(
      db.query(
        `select rv_adjust_wallet('${A}','${U}',-6,'reserved funds','held')`,
      ),
      /INSUFFICIENT_CREDITS/,
    );
    await db.query(
      `select rv_record_usage('${U}','event',null,'ANALYZE','cloudflare','@cf/meta/llama-4-scout-17b-16e-instruct','FALLBACK_AI','SUCCEEDED','{}',null,'${reservation.id}',100)`,
    );
    await db.query(
      `select rv_record_usage('${U}','event',null,'ANALYZE','cloudflare','@cf/meta/llama-4-scout-17b-16e-instruct','FALLBACK_AI','SUCCEEDED','{}',null,'${reservation.id}',100)`,
    );
    await db.query(
      `select rv_finish_reservation('${U}','${reservation.id}','SUCCEEDED')`,
    );
    assert.equal(
      Number(
        (
          await db.query(
            `select current_credit_balance from revector_wallets where user_id='${U}'`,
          )
        ).rows[0].current_credit_balance,
      ),
      5,
    );
    await db.query(
      `select rv_record_usage('${U}','fail',null,'ANALYZE','cloudflare','@cf/meta/llama-4-scout-17b-16e-instruct','FALLBACK_AI','FAILED','{}',0.04,null,100)`,
    );
    assert.equal(
      Number(
        (
          await db.query(
            `select credits_charged from revector_usage_events where event_key='fail'`,
          )
        ).rows[0].credits_charged,
      ),
      0,
    );
    await db.query(
      `select rv_record_usage('${U}','unknown',null,'ENHANCE','cloudflare',null,'FALLBACK_AI','SUCCEEDED','{}',null,null,100)`,
    );
    assert.equal(
      (
        await db.query(
          `select estimated_usd_cost from revector_usage_events where event_key='unknown'`,
        )
      ).rows[0].estimated_usd_cost,
      null,
    );
    const ticket = (
      await db.query(
        `insert into revector_requests(user_id,type,status,subject,payload) values('${U}','SUPPORT','OPEN','Help','{"message":"My SVG"}') returning id`,
      )
    ).rows[0].id;
    await db.query(
      `select rv_reply_support('${S}','${ticket}','Please review the boundary','IN_PROGRESS')`,
    );
    await db.exec(
      `reset role;set role authenticated;set request.jwt.claim.sub='${V}';`,
    );
    assert.equal(
      (await db.query("select * from revector_requests")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from revector_support_messages")).rows.length,
      0,
    );
    await db.exec(`set request.jwt.claim.sub='${U}';`);
    assert.equal(
      (await db.query("select * from revector_support_messages")).rows.length,
      1,
    );
    await db.exec("reset role;set role service_role;");
    const topup = (
      await db.query(
        `insert into revector_requests(user_id,type,status,payload) values('${U}','TOPUP','PENDING','{"requested_credits":20}') returning id`,
      )
    ).rows[0].id;
    await db.query(
      `select rv_decide_request('${A}','${topup}','APPROVED','Verified','approve')`,
    );
    await db.query(
      `select rv_decide_request('${A}','${topup}','APPROVED','Verified','approve')`,
    );
    assert.equal(
      Number(
        (
          await db.query(
            `select current_credit_balance from revector_wallets where user_id='${U}'`,
          )
        ).rows[0].current_credit_balance,
      ),
      25,
    );
    await assert.rejects(
      db.query(
        `select rv_decide_request('${A}','${topup}','REJECTED','changed','other')`,
      ),
      /REQUEST_ALREADY_DECIDED/,
    );
    const catalog = (await db.query("select * from revector_model_catalog"))
      .rows;
    const analyzer = catalog.find((m) => m.capability === "ANALYZER"),
      image = catalog.find((m) => m.capability === "IMAGE");
    await db.query(
      `select rv_set_preferences('${U}','${analyzer.id}','${image.id}')`,
    );
    await db.query(
      `update revector_model_catalog set enabled=false where id='${image.id}'`,
    );
    await assert.rejects(
      db.query(`select rv_set_preferences('${U}',null,'${image.id}')`),
      /MODEL_UNAVAILABLE/,
    );
    const modelRequest = (
      await db.query(
        `insert into revector_requests(user_id,type,status,payload) values('${U}','MODEL_CHANGE','PENDING','{"desired_model":"catalog analyzer","capability":"ANALYZER"}') returning id`,
      )
    ).rows[0].id;
    await db.query(
      `select rv_decide_request('${A}','${modelRequest}','APPROVED','Catalog model approved','model-approval','${analyzer.id}')`,
    );
    assert.equal(
      (
        await db.query(
          `select analyzer_model_id from revector_user_model_preferences where user_id='${U}'`,
        )
      ).rows[0].analyzer_model_id,
      analyzer.id,
    );
    const rejected = (
      await db.query(
        `insert into revector_requests(user_id,type,status,payload) values('${U}','TOPUP','PENDING','{"requested_credits":100}') returning id`,
      )
    ).rows[0].id;
    await db.query(
      `select rv_decide_request('${A}','${rejected}','REJECTED','Unverified payment','rejected')`,
    );
    assert.equal(
      Number(
        (
          await db.query(
            `select current_credit_balance from revector_wallets where user_id='${U}'`,
          )
        ).rows[0].current_credit_balance,
      ),
      25,
    );
    await db.query(
      `select rv_user_support_message('${U}','${ticket}','Thank you')`,
    );
    await assert.rejects(
      db.query(
        `select rv_user_support_message('${V}','${ticket}','Other user')`,
      ),
      /REQUEST_NOT_FOUND/,
    );
    await assert.rejects(
      db.query(`update revector_admin_audit_log set reason='tampered'`),
      /append-only|permission denied/,
    );
    await db.query(
      `select rv_update_catalog('${A}','${analyzer.id}',true,'{"ANALYZE":0.001,"ENHANCE":0.001,"MASTER_MOCKUP":0.001,"IDENTIFY_PARTS":0.001}','rounding-v1','Test per-operation rounding')`,
    );
    const rounded = (
      await db.query(
        `select rv_reserve_operation('${U}','rounding','PREPARE',null,100) as r`,
      )
    ).rows[0].r;
    assert.equal(rounded.reserved_credits, 4);
    await db.query(
      `select rv_finish_reservation('${U}','${rounded.id}','CANCELLED')`,
    );
  } finally {
    await db.close();
  }
});
