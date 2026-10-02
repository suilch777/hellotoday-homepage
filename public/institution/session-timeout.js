(() => {
  "use strict";
  const KEY = "hellotoday_institution_session_v1";
  window.InstitutionSessionTimeout = {
    create({onExpire, onExtend}) {
      const $ = id => document.getElementById(id);
      let timer = null, ending = false, extending = false;
      function read() {
        try {
          const data = JSON.parse(sessionStorage.getItem(KEY));
          if (!data || !/^[a-f0-9]{64}$/.test(data.id) || !data.emailUid || !data.phoneUid ||
              !Number.isFinite(data.expiresAt) || !Number.isFinite(data.serverOffset)) return null;
          return data;
        } catch (_) { return null; }
      }
      function remaining(data = read()) { return data ? data.expiresAt - (Date.now() + data.serverOffset) : 0; }
      function stop() { clearInterval(timer); timer = null; }
      function clear() {
        stop(); sessionStorage.removeItem(KEY);
        if ($("sessionDialog").open) $("sessionDialog").close();
      }
      async function expire() {
        if (ending) return;
        ending = true; stop();
        if ($("sessionDialog").open) $("sessionDialog").close();
        await onExpire();
      }
      function check() {
        const data = read(), ms = remaining(data);
        if (!data || ms <= 0) { expire(); return; }
        const total = Math.ceil(ms / 1000), text = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

        $("sessionWarningTime").textContent = text;
        if (ms <= 5 * 60 * 1000 && !$("sessionDialog").open) $("sessionDialog").showModal();
        if (ms > 5 * 60 * 1000 && $("sessionDialog").open) $("sessionDialog").close();
      }
      function write(payload) {
        if (!payload || !Number.isFinite(payload.serverNow) || !Number.isFinite(payload.expiresAt)) throw Error("로그인 시간을 확인하지 못했습니다.");
        sessionStorage.setItem(KEY, JSON.stringify({...payload, serverOffset: payload.serverNow - Date.now()}));
      }
      function start() { ending = false; stop(); check(); if (!ending) timer = setInterval(check, 1000); }
      $("sessionExtend").onclick = async () => {
        if (extending || ending) return;
        extending = true; $("sessionExtend").disabled = true; $("sessionError").textContent = "";
        try { await onExtend(); }
        catch (_) { $("sessionError").textContent = "로그인 시간을 연장하지 못했습니다. 다시 시도해 주세요."; }
        finally { extending = false; $("sessionExtend").disabled = false; }
      };
      $("sessionLogout").onclick = expire;
      $("sessionDialog").addEventListener("cancel", e => e.preventDefault());
      document.addEventListener("visibilitychange", () => { if (!document.hidden && timer) check(); });
      window.addEventListener("focus", () => { if (timer) check(); });
      return {
        read, remaining, clear, stop, start,
        begin(payload) { write(payload); start(); },
        sync(payload) { if (!ending && read()?.id === payload.id) { write(payload); check(); } },
        valid(emailUid, phoneUid) { const data = read(); return Boolean(data && data.emailUid === emailUid && data.phoneUid === phoneUid && remaining(data) > 0); },
      };
    },
  };
})();
