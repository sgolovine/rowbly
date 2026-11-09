#!/usr/bin/env node
// Local, explicit-resource completion cleanup. Run on the owning machine; see ../references/cleanup.md.
import { spawn } from "node:child_process";
import { lstat, readdir, readFile, readlink, realpath } from "node:fs/promises";
import http from "node:http";
import { homedir, hostname } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const PROTECTED = new Set(["main", "master", "develop"]);
let apply = false;
const resources = [];

try {
  const args = process.argv.slice(2);
  apply = args.includes("--apply");
  if (args.includes("--help")) {
    console.log(
      "Usage: node clean-up-task.mjs --record /absolute/task.json [--apply]\nDry run by default. Local resources only; remote refs and pr-assets are always retained.",
    );
  } else {
    if (
      !["--record", "--apply"].every((flag) => args.filter((a) => a === flag).length <= 1) ||
      args.filter((a) => a !== "--apply").length !== 2 ||
      args.filter((a) => a !== "--apply")[0] !== "--record"
    )
      throw new Error("expected --record /absolute/task.json [--apply]");
    const recordPath = args[args.indexOf("--record") + 1];
    if (!isAbsolute(recordPath)) throw new Error("--record must be an absolute path");
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    await cleanup(record);
    const kept = resources.some((r) => r.decision === "keep");
    console.log(JSON.stringify({ ok: !kept, status: kept ? "kept" : apply ? "cleaned" : "planned", apply, resources }));
    process.exitCode = kept ? 2 : 0;
  }
} catch (error) {
  // Include completed actions if a later check fails; never imply rollback.
  console.log(JSON.stringify({ ok: false, status: "error", apply, reason: error.message, resources }));
  process.exitCode = 1;
}

async function cleanup(record) {
  validate(record);
  const repo = await realpath(record.repo);
  if (repo !== record.repo) throw new Error("record.repo must be the canonical path");
  for (const path of [...record.worktrees, ...record.daemonStates]) {
    if ((await realpath(path)) !== path) throw new Error(`recorded path must exist and be canonical: ${path}`);
  }
  const task = { ...record, repo };
  await git(task, "check-ref-format", "--branch", task.branch);
  await git(task, "check-ref-format", "--branch", task.base);
  await verify(task);
  // Collect retained evidence first so it remains visible even if a later action fails.
  const refs = [`refs/heads/${task.branch}`, `refs/heads/pr-assets/${task.branch}`];
  const remote = await git(task, "ls-remote", "origin", ...refs);
  for (const line of remote.stdout.trim().split("\n").filter(Boolean)) {
    const [sha, ref] = line.split("\t");
    resources.push({
      kind: ref === refs[1] ? "pr-assets" : "remote-branch",
      name: ref,
      sha,
      decision: "retain",
      reason:
        ref === refs[1]
          ? "linked evidence retained indefinitely; ROW-65 owns retention policy"
          : "remote deletion deferred; no atomic non-force compare-and-delete",
    });
  }
  const assets = await revParse(task, `refs/heads/pr-assets/${task.branch}`);
  if (assets)
    resources.push({
      kind: "pr-assets",
      name: `refs/heads/pr-assets/${task.branch}`,
      sha: assets,
      decision: "retain",
      reason: "local evidence branch retained indefinitely",
    });
  const stashes = await git(task, "stash", "list", "--format=%gd");
  if (stashes.stdout.trim()) throw new Error("stashes exist; ownership may be ambiguous, retain all task resources");

  const stopped = [];
  for (const dir of task.daemonStates) {
    await verify(task);
    const result = await daemon(task, dir);
    resources.push(result);
    if (result.decision === "stop" || result.decision === "stopped") stopped.push(result.pid);
  }
  const removable = [];
  for (const path of task.worktrees) {
    const resource = { kind: "worktree", name: path };
    await verify(task);
    let problem = await worktreeProblem(task, path, stopped);
    if (!problem && apply) {
      // Recheck identity/ownership after all slow probes, then check the worktree again.
      await verify(task);
      problem = await worktreeProblem(task, path, []);
      if (!problem) {
        const current = (await worktreeList(task)).find((w) => w.path === path);
        if (
          !current ||
          current.locked ||
          current.head !== task.prHead ||
          current.branch !== `refs/heads/${task.branch}`
        )
          problem = "worktree identity changed immediately before removal";
      }
      if (!problem) {
        const removed = await run(["git", "-C", task.repo, "worktree", "remove", path]);
        problem = removed.code ? removed.stderr.trim() || "git refused removal" : null;
      }
    }
    const decision = problem ? "keep" : apply ? "removed" : "remove";
    resources.push({ ...resource, decision, ...(problem ? { reason: problem } : {}) });
    if (!problem) removable.push(path);
  }
  await verify(task);
  const tip = await revParse(task, `refs/heads/${task.branch}`);
  if (!tip) {
    resources.push({ kind: "branch", name: task.branch, decision: "absent" });
    return;
  }
  let problem = tip !== task.prHead ? "local branch does not equal the verified PR head" : null;
  if (!problem && (await git(task, "stash", "list", "--format=%gd")).stdout.trim())
    problem = "stashes appeared during cleanup";
  // This is deliberately the last asynchronous probe before compare-and-delete. The supervisor's
  // harness lease excludes new assignments/checkouts; Git itself has no cross-command checkout lock.
  if (!problem) {
    const users = (await worktreeList(task)).filter(
      (w) => w.branch === `refs/heads/${task.branch}` && (apply || !removable.includes(w.path)),
    );
    if (users.length) problem = `branch is checked out in ${users.map((w) => w.path).join(", ")}`;
  }
  if (!problem && apply) {
    const deleted = await run(["git", "-C", task.repo, "update-ref", "-d", `refs/heads/${task.branch}`, tip]);
    if (deleted.code) problem = deleted.stderr.trim() || "branch moved during cleanup";
  }
  resources.push({
    kind: "branch",
    name: task.branch,
    sha: tip,
    decision: problem ? "keep" : apply ? "removed" : "remove",
    ...(problem ? { reason: problem } : {}),
  });
}

function validate(r) {
  for (const key of ["story", "machine", "repo", "repository", "branch", "base", "prHead", "lease"])
    if (typeof r[key] !== "string" || !r[key]) throw new Error(`missing record.${key}`);
  if (r.machine !== hostname()) throw new Error("run on the recorded owning machine");
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(r.repository) ||
    !Number.isSafeInteger(r.pr) ||
    r.pr < 1 ||
    !/^[0-9a-f]{40}$/.test(r.prHead)
  )
    throw new Error("record requires an exact repository, PR number and full PR head");
  for (const key of ["worktrees", "daemonStates", "threads", "protectedBranches", "harnessCheck"]) {
    if (
      !Array.isArray(r[key]) ||
      r[key].some((v) => typeof v !== "string" || !v) ||
      new Set(r[key]).size !== r[key].length
    )
      throw new Error(`record.${key} must list distinct strings`);
  }
  if (!r.threads.length || !r.harnessCheck.length || !isAbsolute(r.harnessCheck[0]))
    throw new Error("verified threads and an absolute supervisor harness-check executable are required");
  for (const path of [r.repo, ...r.worktrees, ...r.daemonStates])
    if (!isAbsolute(path) || resolve(path) !== path) throw new Error(`use a canonical absolute path: ${path}`);
  if (r.worktrees.includes(r.repo)) throw new Error("control checkout cannot be a cleanup worktree");
}

// The trusted adapter must query the owning harness afresh and hold an exclusive supervisor lease
// across this invocation, including reservations and descendants; a quiet process list is insufficient.
async function verify(task) {
  const result = await run(task.harnessCheck, JSON.stringify(task));
  let attestation;
  try {
    attestation = JSON.parse(result.stdout);
  } catch {}
  if (
    result.code ||
    attestation?.inactive !== true ||
    attestation?.exclusive !== true ||
    !isDeepStrictEqual(attestation?.record, task)
  )
    throw new Error("harness did not attest exact ownership, inactivity and exclusive lease");
  const origin = (await git(task, "remote", "get-url", "origin")).stdout.trim();
  if (
    ![
      `git@github.com:${task.repository}.git`,
      `https://github.com/${task.repository}.git`,
      `https://github.com/${task.repository}`,
    ].includes(origin)
  )
    throw new Error("origin does not match the recorded GitHub repository");
  const info = JSON.parse((await must(["gh", "repo", "view", task.repository, "--json", "defaultBranchRef"])).stdout);
  if (!info.defaultBranchRef?.name) throw new Error("cannot verify default branch");
  const control = await run(["git", "-C", task.repo, "symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (control.code !== 0) throw new Error("control checkout must have a named branch");
  if (
    PROTECTED.has(task.branch) ||
    task.branch === task.base ||
    task.branch === info.defaultBranchRef.name ||
    task.branch === control.stdout.trim() ||
    task.protectedBranches.includes(task.branch) ||
    task.branch.startsWith("pr-assets/")
  )
    throw new Error("protected, base, default, control or evidence branch; retain");
  const pr = JSON.parse(
    (
      await must([
        "gh",
        "pr",
        "view",
        String(task.pr),
        "--repo",
        task.repository,
        "--json",
        "state,headRefName,headRefOid,baseRefName,mergeCommit,isCrossRepository",
      ])
    ).stdout,
  );
  if (
    pr.state !== "MERGED" ||
    pr.isCrossRepository !== false ||
    pr.headRefName !== task.branch ||
    pr.headRefOid !== task.prHead ||
    pr.baseRefName !== task.base ||
    !pr.mergeCommit?.oid
  )
    throw new Error("PR is not the exact merged, same-repository task PR");
  const base = (await git(task, "ls-remote", "--exit-code", "origin", `refs/heads/${task.base}`)).stdout
    .trim()
    .split("\t")[0];
  if (!/^[0-9a-f]{40}$/.test(base) || !(await ancestor(task, pr.mergeCommit.oid, base)))
    throw new Error("merged commit is not in the current remote base; fetch on the owner and review before retrying");
  const tip = await revParse(task, `refs/heads/${task.branch}`);
  if (tip && tip !== task.prHead) throw new Error("local task branch advanced or does not match the exact PR head");
}

async function worktreeProblem(task, path, stopped) {
  const list = await worktreeList(task);
  const entry = list.find((w) => w.path === path);
  if (!entry || list[0]?.path === path || path === task.repo) return "not an owned linked worktree";
  if (entry.branch !== `refs/heads/${task.branch}` || entry.head !== task.prHead)
    return "worktree branch/head differs from the verified PR";
  if (entry.locked) return "worktree is locked";
  const status = await run([
    "git",
    "-C",
    path,
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--ignored=matching",
    "--ignore-submodules=none",
  ]);
  if (status.code || status.stdout.trim()) return "worktree has changes/untracked files or cannot be read";
  // git worktree remove also refuses submodules, but report them during dry run too.
  const modules = await run(["git", "-C", path, "ls-files", "--stage"]);
  if (modules.code || modules.stdout.split("\n").some((line) => line.startsWith("160000 ")))
    return "worktree has submodules or cannot be inspected";
  const stashes = await git(task, "stash", "list", "--format=%gd");
  if (stashes.stdout.trim()) return "stashes exist";
  const users = await processesIn(path);
  if (users === null) return "cannot establish local process inactivity";
  const others = users.filter((pid) => !stopped.includes(pid));
  return others.length ? `processes have a working directory inside it: ${others.join(", ")}` : null;
}

async function daemon(task, dir) {
  const resource = { kind: "daemon", name: dir };
  const keep = (reason) => ({ ...resource, decision: "keep", reason });
  const shared = resolve(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "agentic-tui");
  if (dir === shared || dir === join(homedir(), ".local/state/agentic-tui"))
    return keep("shared default daemon; never stopped");
  const path = join(dir, "daemon.json");
  let state;
  try {
    if (!(await lstat(path)).isFile()) return keep("daemon state is not a regular file");
    state = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    return error.code === "ENOENT" ? { ...resource, decision: "absent" } : keep("cannot read daemon state");
  }
  if (
    !Number.isSafeInteger(state.pid) ||
    state.pid <= 1 ||
    !Number.isInteger(state.port) ||
    state.port < 1 ||
    state.port > 65535 ||
    typeof state.token !== "string" ||
    !state.token
  )
    return keep("invalid daemon identity");
  const before = await identity(state.pid, dir);
  if (!before) return keep("process does not match the exact recorded task-owned state directory");
  const status = await daemonRequest(state, "/status", "GET");
  if (!status?.ok || status.result?.pid !== state.pid) return keep("scoped daemon API identity differs");
  if (status.result?.sessions?.sessions?.some((s) => s.running)) return keep("daemon still has running sessions");
  if (!Array.isArray(status.result?.sessions?.sessions)) return keep("cannot inspect daemon sessions");
  if (!apply) return { ...resource, pid: state.pid, decision: "stop" };
  await verify(task);
  if (
    !isDeepStrictEqual(before, await identity(state.pid, dir)) ||
    !isDeepStrictEqual(state, JSON.parse(await readFile(path, "utf8")))
  )
    return keep("daemon identity changed");
  // No signals and no CLI auto-start fallback: only this daemon's authenticated scoped API.
  const result = await daemonRequest(state, "/shutdown", "POST");
  if (!result?.ok) return keep("scoped authenticated shutdown failed; no signal sent");
  for (let i = 0; i < 20; i++) {
    if (!isDeepStrictEqual(before, await identity(state.pid, dir)))
      return { ...resource, pid: state.pid, decision: "stopped" };
    await new Promise((done) => setTimeout(done, 100));
  }
  return keep("daemon did not exit; no signal sent");
}

async function identity(pid, dir) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const argv = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0");
    const env = (await readFile(`/proc/${pid}/environ`, "utf8")).split("\0");
    if (
      !argv[1]?.includes("agentic-tui") ||
      argv[2] !== "daemon" ||
      argv[3] !== "run" ||
      !env.includes(`AGENTIC_TUI_STATE_DIR=${dir}`)
    )
      return null;
    return { pid, start: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19], argv };
  } catch {
    return null;
  }
}

function daemonRequest(state, path, method) {
  return new Promise((done) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: state.port,
        path,
        method,
        timeout: 2000,
        headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json" },
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          try {
            done(JSON.parse(data));
          } catch {
            done(null);
          }
        });
      },
    );
    request.on("error", () => done(null));
    request.on("timeout", () => {
      request.destroy();
      done(null);
    });
    request.end(method === "POST" ? "{}" : undefined);
  });
}

async function worktreeList(task) {
  const out = (await git(task, "worktree", "list", "--porcelain", "-z")).stdout;
  return out
    .split("\0\0")
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\0");
      const field = (name) => lines.find((line) => line.startsWith(`${name} `))?.slice(name.length + 1);
      return {
        path: field("worktree"),
        branch: field("branch"),
        head: field("HEAD"),
        locked: lines.some((l) => l === "locked" || l.startsWith("locked ")),
      };
    });
}

async function processesIn(path) {
  try {
    const users = [];
    for (const entry of await readdir("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const cwd = await readlink(`/proc/${entry}/cwd`);
        if (cwd === path || cwd.startsWith(`${path}/`)) users.push(Number(entry));
      } catch (error) {
        // Vanished processes are harmless; inaccessible live processes are not evidence of inactivity.
        if (error.code !== "ENOENT" && error.code !== "ESRCH") return null;
      }
    }
    return users;
  } catch {
    return null;
  }
}

async function revParse(task, ref) {
  const result = await run(["git", "-C", task.repo, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return result.code === 0 ? result.stdout.trim() : null;
}
async function ancestor(task, commit, base) {
  return (await run(["git", "-C", task.repo, "merge-base", "--is-ancestor", commit, base])).code === 0;
}
function git(task, ...args) {
  return must(["git", "-C", task.repo, ...args]);
}
async function must(argv) {
  const result = await run(argv);
  if (result.code) throw new Error(result.stderr.trim() || `command failed: ${argv[0]}`);
  return result;
}
function run(argv, stdin) {
  return new Promise((done) => {
    const child = spawn(argv[0], argv.slice(1), { cwd: "/", timeout: 15000, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.stdin.on("error", () => {});
    child.on("error", () => done({ code: -1, stdout, stderr: `cannot start ${argv[0]}` }));
    child.on("close", (code) => done({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(stdin);
  });
}
