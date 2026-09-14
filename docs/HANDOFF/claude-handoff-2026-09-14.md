# Handoff note for Claude (or any IDE agent)

**Date:** 14 September 2026  
**From:** Cursor session after VPS deploy + owner priority change  
**Read first:** [agent-current-sprint.md](agent-current-sprint.md) (authoritative), then this note.

---

## Pasteable brief

```text
Zettaz Tours — continue from docs, not from older chat summaries.

START HERE:
1. docs/HANDOFF/agent-current-sprint.md
2. docs/HANDOFF/cross-ide-agent-resume.md
3. docs/AI_CONTEXT/MEMORY.md
4. docs/STRATEGY/ui-waiver-launch-task-list.md

OWNER PRIORITY (14 Sep evening) — supersedes “do Subscription next”:
- Operations menu group (Day Board, Departures, Reservations, Catalog + Day Board child flows: manifest, Plan pickups, Print list, Start trip, weather) is considered FUNCTIONALLY COMPLETE until further testing finds bugs/gaps. Do NOT invent new Ops features, Google routing, GPS, or Plan pickups Phase 2.
- HOLD Subscription messaging polish (row 17 / subscription.tsx banners). Do not start unless owner reopens.
- YOUR JOB NOW: verify and improve NON-Operations menu groups — Workspace (Home), Insights (Reports, Customers), Administration (Finance, Fleet, Staff, Document library, Tenant settings, Integrations/Partners/Audit as present), then Profile. One surface at a time; fix clear gaps; write docs/TESTING evidence; update ui-waiver-launch-task-list.md and agent-current-sprint.md.

GIT / DEPLOY (do not invent stale “push migration 060” plans):
- Production deployed tip a18e083 via ./deploy.sh on VPS (/var/www/zettaz-tours). Migrations through 067, Pending: 0. PM2 tours-api + tours-web online.
- Auth/email-verify already on main. Dirty package-lock on VPS: git checkout -- package-lock.json then ./deploy.sh.
- Check git status on Mac — handoff doc commits may still need commit+push so GitHub matches local sprint board.

RULES:
- No Rock Adventures hard-coding. Launch contract wins on Track A vs B.
- Prefer sprint board over chat history.
- Commit/push docs when you change next-task truth.
```

---

## Context Claude should not re-litigate

- Ops pickups / print / Settings map chapter is closed pending testing.
- Deploy of pickup UI to production succeeded after discarding dirty `package-lock.json` on the server.
- Subscription backend states exist; **copy/messaging UI is intentionally deferred**, not “forgotten.”

## Suggested first Claude session

1. Confirm local `git pull` / push any uncommitted handoff docs if still dirty.  
2. Pick **one** non-Ops surface (recommend: **Reservation detail** is Ops-adjacent — skip; start with **Finance** or **Reports** or **Staff** per owner preference — default **Reports → Customers → Finance**).  
3. Walk phone/tablet/desktop against ui task list; file bounded fixes only.  
4. Update evidence + sprint board before ending.
