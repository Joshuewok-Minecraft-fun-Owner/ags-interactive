// Durable Object: one global "room" holding poll state, votes, results and suggestions.
const json = (o, status = 200) => Response.json(o, { status });
const EMPTY = () => ({ episode: "Episode 1", ended: false, poll: null, votes: {}, results: [], suggestions: [], n: 0 });

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get("s")) || EMPTY();
    });
  }

  save() { return this.ctx.storage.put("s", this.s); }

  // What a viewer sees. myVote is per-viewer, everything else is public.
  view(uid) {
    const s = this.s, p = s.poll;
    let poll = null, myVote = null;
    if (p) {
      const v = s.votes[p.id] || {};
      const tally = p.options.map(() => 0);
      Object.values(v).forEach((i) => tally[i]++);
      poll = { id: p.id, q: p.q, options: p.options, dur: p.dur, endsAt: p.endsAt, closed: p.closed, tally, total: tally.reduce((a, b) => a + b, 0) };
      if (uid && v[uid] !== undefined) myVote = v[uid];
    }
    return { type: "state", now: Date.now(), episode: s.episode, ended: s.ended, poll, myVote };
  }

  send(ws) {
    try { ws.send(JSON.stringify(this.view(ws.deserializeAttachment()?.uid || ""))); } catch {}
  }
  broadcast() { this.ctx.getWebSockets().forEach((w) => this.send(w)); }

  async closePoll() {
    const s = this.s, p = s.poll;
    if (!p || p.closed) return;
    p.closed = true;
    const v = s.votes[p.id] || {};
    const tally = p.options.map(() => 0);
    Object.values(v).forEach((i) => tally[i]++);
    const max = Math.max(...tally);
    const tops = tally.map((n, i) => (n === max ? i : -1)).filter((i) => i >= 0);
    const total = tally.reduce((a, b) => a + b, 0);
    const win = total ? tops[Math.floor(Math.random() * tops.length)] : -1;
    s.results.push({
      pollId: p.id, key: p.key, question: p.q, options: p.options,
      winner: win >= 0 ? p.options[win] : null, winnerIndex: win,
      tally: Object.fromEntries(p.options.map((o, i) => [o, tally[i]])),
      total, tie: tops.length > 1 && total > 0, noVotes: total === 0,
      closedAt: new Date().toISOString(),
    });
    await this.ctx.storage.deleteAlarm();
    await this.save();
    this.broadcast();
  }

  async alarm() { await this.closePoll(); }

  async fetch(req) {
    const s = this.s, url = new URL(req.url), path = url.pathname, m = req.method;
    const role = req.headers.get("X-Role") || "";
    const uid = req.headers.get("X-Uid") || "";
    const name = decodeURIComponent(req.headers.get("X-Name") || "");
    const host = role === "host";

    if (s.poll && !s.poll.closed && Date.now() >= s.poll.endsAt) await this.closePoll();

    if (path === "/api/ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ uid, name });
      this.send(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    const body = ["POST", "PUT"].includes(m) ? await req.json().catch(() => ({})) : {};

    // ----- viewers -----
    if (path === "/api/vote" && m === "POST") {
      if (!uid) return json({ error: "Log in to vote." }, 401);
      const p = s.poll;
      if (!p || p.closed) return json({ error: "No open poll." }, 409);
      const i = body.choice;
      if (!Number.isInteger(i) || i < 0 || i >= p.options.length) return json({ error: "Invalid choice." }, 400);
      s.votes[p.id] ??= {};
      if (s.votes[p.id][uid] !== undefined) return json({ error: "You already voted." }, 409);
      s.votes[p.id][uid] = i;
      await this.save();
      this.broadcast();
      return json({ ok: true });
    }

    if (path === "/api/suggest" && m === "POST") {
      if (!uid) return json({ error: "Log in to submit." }, 401);
      const text = String(body.text || "").trim().slice(0, 400);
      if (!text) return json({ error: "Write something first." }, 400);
      if (s.suggestions.filter((x) => x.uid === uid).length >= 5) return json({ error: "Limit of 5 suggestions reached." }, 429);
      s.suggestions.push({ id: crypto.randomUUID().slice(0, 8), uid, by: name, text, at: Date.now(), used: false });
      await this.save();
      return json({ ok: true });
    }

    // ----- Godot (or host) -----
    if (path === "/api/results" && m === "GET") {
      if (role !== "godot" && !host) return json({ error: "Unauthorized" }, 401);
      const after = url.searchParams.get("after");
      let list = s.results;
      if (after) {
        const idx = list.findIndex((r) => r.pollId === after);
        if (idx >= 0) list = list.slice(idx + 1);
      }
      return json({ results: list });
    }

    // ----- host only -----
    if (path.startsWith("/api/host/")) {
      // Godot may open/close polls; everything else stays host-only.
      const godotOk = role === "godot" && (path === "/api/host/poll" || path === "/api/host/close");
      if (!host && !godotOk) return json({ error: "Unauthorized" }, 401);

      if (path === "/api/host/state") {
        return json({ ...this.view(""), results: s.results.slice(-10).reverse(), suggestions: s.suggestions.map(({ uid, ...x }) => x) });
      }
      if (path === "/api/host/poll" && m === "POST") {
        const options = (body.options || []).map((o) => String(o).trim().slice(0, 60)).filter(Boolean);
        const q = String(body.q || "").trim().slice(0, 200);
        const dur = Math.min(600, Math.max(10, parseInt(body.dur) || 45));
        if (!q || options.length < 2 || options.length > 8 || new Set(options).size !== options.length)
          return json({ error: "Need a question and 2-8 different options." }, 400);
        await this.closePoll();
        s.n++;
        s.ended = false;
        s.poll = { id: "p" + s.n, key: String(body.key || "").trim().slice(0, 40) || "poll_" + s.n, q, options, dur, endsAt: Date.now() + dur * 1000, closed: false };
        await this.save();
        await this.ctx.storage.setAlarm(s.poll.endsAt);
        this.broadcast();
        return json({ ok: true, pollId: s.poll.id });
      }
      if (path === "/api/host/close" && m === "POST") { await this.closePoll(); return json({ ok: true }); }
      if (path === "/api/host/episode" && m === "POST") {
        if (typeof body.name === "string" && body.name.trim()) s.episode = body.name.trim().slice(0, 80);
        if (typeof body.ended === "boolean") s.ended = body.ended;
        await this.save();
        this.broadcast();
        return json({ ok: true });
      }
      if (path === "/api/host/suggestion" && m === "POST") {
        const x = s.suggestions.find((z) => z.id === body.id);
        if (!x) return json({ error: "Not found" }, 404);
        x.used = !!body.used;
        await this.save();
        return json({ ok: true });
      }
    }
    return json({ error: "Not found" }, 404);
  }

  webSocketMessage() {}
  webSocketClose(ws) { try { ws.close(); } catch {} }
}
