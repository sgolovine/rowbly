#!/usr/bin/env node
// Grill UI: a persistent local web form for grilling rounds.
//
//   node grill-ui.mjs start [--title "..."]   start/reset the session and open the browser
//   node grill-ui.mjs ask [file|-]           post a round (JSON) and wait for the user's answers
//   node grill-ui.mjs wait                   keep waiting for the latest round's answers
//   node grill-ui.mjs end [--summary "..."]  mark the session complete
//   node grill-ui.mjs status | url | stop
//
// Flags: --json (answers as JSON), --timeout <seconds> (default 540), --no-open.
// Exit codes: 0 answered, 2 still pending (run `wait` again), 1 error.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const UI_FILE = path.join(path.dirname(SCRIPT), "..", "assets", "index.html");
const IDLE_SHUTDOWN_MS = 6 * 60 * 60 * 1000;

const { cmd, positional, flags } = parseArgs(process.argv.slice(2));
const workspace = path.resolve(flags.workspace ?? process.cwd());
const stateDir = path.join(
  os.tmpdir(),
  `grill-ui-${crypto.createHash("sha1").update(workspace).digest("hex").slice(0, 12)}`,
);
const stateFile = path.join(stateDir, "server.json");
const sessionFile = path.join(stateDir, "session.json");

try {
  await main();
} catch (err) {
  console.error(`grill-ui: ${err.message}`);
  process.exit(1);
}

async function main() {
  switch (cmd) {
    case "serve":
      return serve();
    case "start": {
      const server = await ensureServer();
      await api(server, "POST", "/api/session", { title: flags.title ?? path.basename(workspace) });
      await maybeOpen(server, true);
      console.log(`Grill UI ready: ${uiUrl(server)}`);
      return;
    }
    case "ask": {
      const round = validateRound(JSON.parse(await readInput(positional[0])));
      const server = await ensureServer();
      const { id } = await api(server, "POST", "/api/rounds", round);
      await maybeOpen(server, false);
      console.error(`Round ${id} is in the Grill UI: ${uiUrl(server)}`);
      return waitForAnswers(server, id);
    }
    case "wait": {
      const server = await requireServer();
      const { rounds } = await api(server, "GET", "/api/state");
      const last = rounds.at(-1);
      if (!last) throw new Error("no rounds have been asked");
      return waitForAnswers(server, last.id);
    }
    case "end": {
      const server = await requireServer();
      await api(server, "POST", "/api/end", { summary: flags.summary ?? "" });
      console.log("Session marked complete in the Grill UI.");
      return;
    }
    case "status": {
      const server = await findServer();
      if (!server) return console.log("not running");
      const state = await api(server, "GET", "/api/state");
      const last = state.rounds.at(-1);
      console.log(
        `running at ${uiUrl(server)} | rounds: ${state.rounds.length} | latest: ${
          last ? (last.answers ? "answered" : last.cancelled ? "cancelled" : "pending") : "none"
        } | browser tabs: ${state.clients}`,
      );
      return;
    }
    case "url": {
      const server = await ensureServer();
      return console.log(uiUrl(server));
    }
    case "stop": {
      const server = await findServer();
      if (server) await api(server, "POST", "/api/stop").catch(() => {});
      fs.rmSync(stateFile, { force: true });
      return console.log("stopped");
    }
    default:
      console.error(fs.readFileSync(SCRIPT, "utf8").split("\n").slice(1, 11).join("\n").replace(/^\/\/ ?/gm, ""));
      process.exit(cmd ? 1 : 0);
  }
}

// ---------- CLI helpers ----------

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (["json", "no-open"].includes(key) || next === undefined || next.startsWith("--")) flags[key] = true;
      else flags[key] = argv[++i];
    } else positional.push(a);
  }
  return { cmd: positional.shift(), positional, flags };
}

async function readInput(file) {
  if (file && file !== "-") return fs.readFileSync(file, "utf8");
  if (process.stdin.isTTY) throw new Error("pass the round JSON as a file path or on stdin");
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function validateRound(round) {
  if (!round || !Array.isArray(round.questions) || round.questions.length === 0)
    throw new Error('round JSON needs a non-empty "questions" array');
  round.questions = round.questions.map((q, i) => {
    if (!q.title) throw new Error(`question ${i + 1} needs a "title"`);
    const options = (q.options ?? []).map((o, j) => {
      const opt = typeof o === "string" ? { label: o } : { ...o };
      if (!opt.label) throw new Error(`question ${i + 1} option ${j + 1} needs a "label"`);
      opt.id = String(opt.id ?? String.fromCharCode(65 + j));
      return opt;
    });
    let recommended = q.recommended;
    if (recommended !== undefined && recommended !== null && options.length) {
      const recs = (Array.isArray(recommended) ? recommended : [recommended]).map(String);
      const ids = recs.map((r) => options.find((o) => o.id === r || o.label === r)?.id).filter(Boolean);
      recommended = ids.length ? (q.multiple ? ids : ids[0]) : undefined;
    }
    return {
      id: String(q.id ?? `Q${i + 1}`),
      title: String(q.title),
      body: q.body ?? "",
      options,
      multiple: Boolean(q.multiple),
      allowOther: q.allowOther ?? true,
      recommended,
      recommendation: q.recommendation ?? "",
    };
  });
  return round;
}

function uiUrl(server) {
  return `http://127.0.0.1:${server.port}/?t=${server.token}`;
}

function readServerState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

async function findServer() {
  const s = readServerState();
  if (!s) return null;
  try {
    await api(s, "GET", "/api/state");
    return s;
  } catch {
    return null;
  }
}

async function requireServer() {
  const s = await findServer();
  if (!s) throw new Error("the Grill UI server is not running; run `start` or `ask` first");
  return s;
}

async function ensureServer() {
  const existing = await findServer();
  if (existing) return existing;
  fs.mkdirSync(stateDir, { recursive: true });
  fs.rmSync(stateFile, { force: true });
  const child = spawn(process.execPath, [SCRIPT, "serve", "--workspace", workspace], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    const s = await findServer();
    if (s) return s;
  }
  throw new Error(
    "could not start the Grill UI server (if a sandbox blocks localhost networking, rerun with escalated permissions)",
  );
}

async function maybeOpen(server, force) {
  if (flags["no-open"] || process.env.GRILL_UI_NO_OPEN) return;
  if (!force) {
    // Give an existing tab a moment to (re)connect before opening a new one.
    for (let i = 0; i < 6; i++) {
      const { clients } = await api(server, "GET", "/api/state");
      if (clients > 0) return;
      await sleep(500);
    }
  } else {
    const { clients } = await api(server, "GET", "/api/state");
    if (clients > 0) return;
  }
  const url = uiUrl(server);
  const [bin, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(bin, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {
    // The URL is printed either way.
  }
}

async function waitForAnswers(server, id) {
  const deadline = Date.now() + Number(flags.timeout ?? 540) * 1000;
  while (Date.now() < deadline) {
    const round = await api(server, "GET", `/api/rounds/${id}`);
    if (round.cancelled) throw new Error(`round ${id} was superseded by a newer round`);
    if (round.answers) {
      console.log(flags.json ? JSON.stringify(round, null, 2) : formatAnswers(round));
      return;
    }
    await sleep(1000);
  }
  console.log(`Round ${id} is still waiting for the user. Run \`wait\` again to keep waiting.`);
  process.exit(2);
}

function formatAnswers(round) {
  const out = [`Answers for round ${round.id}${round.title ? ` (${round.title})` : ""}:`, ""];
  for (const q of round.questions) {
    const a = round.answers.questions[q.id] ?? {};
    const picked = (a.selected ?? []).map((sid) => {
      const o = q.options.find((x) => x.id === sid);
      const rec = [q.recommended].flat().includes(sid) ? " (recommended)" : "";
      return `${sid}. ${o?.label ?? sid}${rec}`;
    });
    out.push(`${q.id}. ${q.title}`);
    if (picked.length) out.push(`  Answer: ${picked.join("; ")}`);
    if (a.other) out.push(`  ${picked.length ? "Other" : "Answer"}: ${a.other}`);
    if (!picked.length && !a.other) out.push("  Answer: (skipped)");
    if (a.note) out.push(`  Note: ${a.note}`);
    out.push("");
  }
  if (round.answers.comment) out.push(`General comment: ${round.answers.comment}`);
  return out.join("\n").trimEnd();
}

function api(server, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: server.port,
        path: pathname,
        method,
        headers: { "x-grill-token": server.token, "content-type": "application/json" },
        timeout: 5000,
      },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          const json = text ? JSON.parse(text) : {};
          if (res.statusCode >= 400) reject(new Error(json.error ?? `HTTP ${res.statusCode}`));
          else resolve(json);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
    req.end(data);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- Server ----------

function serve() {
  const token = crypto.randomBytes(16).toString("hex");
  let session = loadSession();
  const clients = new Set();
  let idleTimer;

  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => process.exit(0), IDLE_SHUTDOWN_MS);
  };
  const save = () => fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
  const publicState = () => ({ ...session, clients: clients.size });
  const broadcast = () => {
    const msg = `data: ${JSON.stringify(publicState())}\n\n`;
    for (const res of clients) res.write(msg);
  };
  const send = (res, status, obj) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let text = "";
      req.on("data", (c) => (text += c));
      req.on("end", () => {
        try {
          resolve(text ? JSON.parse(text) : {});
        } catch (e) {
          reject(e);
        }
      });
    });

  const server = http.createServer(async (req, res) => {
    touch();
    const url = new URL(req.url, "http://127.0.0.1");
    const authed = (req.headers["x-grill-token"] ?? url.searchParams.get("t")) === token;

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(fs.readFileSync(UI_FILE));
    }
    if (!authed) return send(res, 403, { error: "bad token" });

    try {
      if (req.method === "GET" && url.pathname === "/api/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        clients.add(res);
        res.write(`data: ${JSON.stringify(publicState())}\n\n`);
        const ping = setInterval(() => res.write(": ping\n\n"), 15000);
        req.on("close", () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, publicState());
      if (req.method === "POST" && url.pathname === "/api/session") {
        const { title } = await readBody(req);
        session = newSession(title);
        save();
        broadcast();
        return send(res, 200, publicState());
      }
      if (req.method === "POST" && url.pathname === "/api/rounds") {
        const round = await readBody(req);
        for (const r of session.rounds) if (!r.answers) r.cancelled = true;
        const id = session.rounds.length + 1;
        session.rounds.push({ ...round, id, createdAt: Date.now(), answers: null });
        session.ended = null;
        save();
        broadcast();
        return send(res, 200, { id });
      }
      const m = url.pathname.match(/^\/api\/rounds\/(\d+)(\/answers)?$/);
      if (m) {
        const round = session.rounds.find((r) => r.id === Number(m[1]));
        if (!round) return send(res, 404, { error: "no such round" });
        if (req.method === "GET" && !m[2]) return send(res, 200, round);
        if (req.method === "POST" && m[2]) {
          if (round.answers || round.cancelled) return send(res, 409, { error: "round is closed" });
          round.answers = { ...(await readBody(req)), submittedAt: Date.now() };
          save();
          broadcast();
          return send(res, 200, { ok: true });
        }
      }
      if (req.method === "POST" && url.pathname === "/api/end") {
        const { summary } = await readBody(req);
        for (const r of session.rounds) if (!r.answers) r.cancelled = true;
        session.ended = { summary: summary ?? "", at: Date.now() };
        save();
        broadcast();
        return send(res, 200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/stop") {
        send(res, 200, { ok: true });
        for (const c of clients) c.end();
        return setTimeout(() => process.exit(0), 50);
      }
      send(res, 404, { error: "not found" });
    } catch (err) {
      send(res, 400, { error: err.message });
    }
  });

  server.listen(0, "127.0.0.1", () => {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ port: server.address().port, token, pid: process.pid }));
    touch();
  });

  function newSession(title) {
    return { title: title || path.basename(workspace), workspace, startedAt: Date.now(), rounds: [], ended: null };
  }
  function loadSession() {
    try {
      return JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    } catch {
      return newSession();
    }
  }
}
