(function(root) {
  "use strict";
  const typeLabels = {CHECK_IN: "안부기록", HELP_REQUEST: "도움요청기록", DELAYED_CHECK_IN: "안부지연기록"};
  const statusLabels = {COMPLETED: "완료", INCOMPLETE: "미완료", PENDING: "확인 대기", RESPONDING: "대응 중", EXPIRED_24H: "24시간 미처리 자동 종료", HANDLED: "담당자 확인 완료", DELAYED: "안부지연"};
  function merge(records) {
    const unique = new Map();
    for (const row of records) {
      const key = row.seniorUid + ":" + row.id, previous = unique.get(key);
      const rank = r => ["COMPLETED", "EXPIRED_24H"].includes(r.status) ? 3 : r.status === "HANDLED" ? 2 : r.status === "RESPONDING" ? 1 : 0;
      if (!previous || rank(row) > rank(previous) || (rank(row) === rank(previous) &&
          ((row.completedAtMs || row.expiredAtMs || 0) > (previous.completedAtMs || previous.expiredAtMs || 0) || (row.memo && !previous.memo)))) unique.set(key, row);
    }
    return [...unique.values()].sort((a, b) => b.occurredAtMs - a.occurredAtMs || a.id.localeCompare(b.id));
  }
  function create({call, getTargets, isActive, errorText}) {
    const $ = id => document.getElementById(id);
    let generation = 0, entries = [], scopes = [], targets = [], loading = false, displayLimit = 50;
    const date = value => value ? new Date(value).toLocaleString("ko-KR", {timeZone: "Asia/Seoul"}) : "—";
    function clear() {
      generation++; loading = false; entries = []; scopes = []; targets = [];
      $("recordRows").replaceChildren(); $("recordMore").hidden = true;
      $("recordTarget").replaceChildren(); $("recordMessage").textContent = "";
      $("recordForm").querySelectorAll("input,select,button").forEach(el => { el.disabled = false; });
    }
    function open(filters) {
      clear(); targets = getTargets();
      const select = $("recordTarget"), all = document.createElement("option");
      all.value = ""; all.textContent = "전체 대상자"; select.append(all);
      for (const target of targets) {
        const option = document.createElement("option"); option.value = target.uid;
        option.textContent = target.relations?.join(" / ") || target.relation || target.memberId || "대상자";
        select.append(option);
      }
      const now = Date.now() + 9 * 3600000;
      if (!$("recordEnd").value) $("recordEnd").value = new Date(now).toISOString().slice(0, 10);
      if (!$("recordStart").value) $("recordStart").value = new Date(now - 6 * 86400000).toISOString().slice(0, 10);
      if (filters) { $("recordStart").value = filters.startDate; $("recordEnd").value = filters.endDate; $("recordType").value = filters.recordType; $("recordStatus").value = filters.status || "ALL"; }
      $("recordMessage").textContent = targets.length ? "대상자·기간·기록 종류를 선택하고 조회해 주세요." : "현재 조회 가능한 대상자가 없습니다.";
      if (filters) load();
    }
    function render() {
      entries = merge(entries);
      const body = $("recordRows"); body.replaceChildren();
      const names = new Map(targets.map(t => [t.uid, t.relations?.join(" / ") || t.relation || t.memberId || "대상자"]));
      const visible = entries.filter(row => $("recordStatus").value !== "OPEN" || (row.type === "HELP_REQUEST" ? ["PENDING", "RESPONDING"].includes(row.status) : row.type === "DELAYED_CHECK_IN" ? !["COMPLETED", "HANDLED"].includes(row.status) : row.status !== "COMPLETED"));
      for (const row of visible.slice(0, displayLimit)) {
        const tr = document.createElement("tr");
        const handling = row.expiredAtMs ? date(row.expiredAtMs) + " (자동 종료)" : date(row.completedAtMs);
        const note = row.memo || (row.type === "DELAYED_CHECK_IN" && row.requestedAtMs ? "안부 재요청: " + date(row.requestedAtMs) : "—");
        for (const value of [names.get(row.seniorUid) || "대상자", typeLabels[row.type], date(row.occurredAtMs),
          statusLabels[row.status] || row.status, handling, note]) {
          const td = document.createElement("td"); td.textContent = value; tr.append(td);
        }
        body.append(tr);
      }
      const pending = scopes.some(s => s.next !== null);
      $("recordMore").hidden = !pending && displayLimit >= visible.length;
      $("recordMessage").textContent = "조회된 기록 " + entries.length + "건 · 표시 " + Math.min(displayLimit, visible.length) + "건" +
        (pending ? " · 아직 조회하지 않은 기록이 있습니다. 더 보기를 눌러 계속 조회하세요." : entries.length ? " · 조회 완료" : " · 조건에 맞는 기록이 없습니다.");
    }
    async function load(more = false) {
      if (loading || !isActive()) return;
      if (more && displayLimit < entries.filter(row => $("recordStatus").value !== "OPEN" || (row.type === "HELP_REQUEST" ? ["PENDING", "RESPONDING"].includes(row.status) : row.type === "DELAYED_CHECK_IN" ? !["COMPLETED", "HANDLED"].includes(row.status) : row.status !== "COMPLETED")).length) { displayLimit += 50; render(); return; }
      const selected = $("recordTarget").value, recordType = $("recordType").value;
      const startDate = $("recordStart").value, endDate = $("recordEnd").value;
      if (!startDate || !endDate || startDate > endDate) { $("recordMessage").textContent = "조회 시작일과 종료일을 확인해 주세요."; return; }
      if (!more) {
        entries = []; displayLimit = 50;
        scopes = targets.filter(t => !selected || t.uid === selected).map(t => ({uid: t.uid, workerUid: t.workerUids[0], next: undefined}));
      } else displayLimit += 50;
      const own = ++generation; loading = true;
      $("recordRows").replaceChildren(); $("recordMore").disabled = true;
      $("recordForm").querySelectorAll("input,select,button").forEach(el => { el.disabled = true; });
      $("recordMessage").textContent = "권한과 동의를 확인하며 기록을 조회하고 있습니다.";
      try {
        const pending = scopes.filter(s => s.next !== null);
        for (let offset = 0; offset < pending.length; offset += 3) {
          if (own !== generation || !isActive()) return;
          await Promise.all(pending.slice(offset, offset + 3).map(async scope => {
            const result = await call("institutionListRecords", {workerUid: scope.workerUid, seniorUid: scope.uid,
              recordType, startDate, endDate, recordAfter: scope.next || {}});
            if (own !== generation || !isActive()) return;
            entries.push(...result.records); scope.next = result.next;
          }));
        }
        if (own === generation && isActive()) render();
      } catch (error) {
        if (own !== generation) return;
        entries = []; scopes = []; $("recordRows").replaceChildren(); $("recordMore").hidden = true;
        $("recordMessage").textContent = "기록을 조회하지 못했습니다. " + errorText(error);
      } finally {
        if (own === generation) {
          loading = false; $("recordMore").disabled = false;
          $("recordForm").querySelectorAll("input,select,button").forEach(el => { el.disabled = false; });
        }
      }
    }
    $("recordForm").addEventListener("submit", event => { event.preventDefault(); load(); });
    $("recordForm").querySelectorAll("input,select").forEach(el => el.addEventListener("change", () => {
      generation++; entries = []; scopes = []; loading = false;
      $("recordRows").replaceChildren(); $("recordMore").hidden = true;
      $("recordMessage").textContent = "조회 조건이 변경되었습니다. 기록 조회를 눌러 주세요.";
    }));
    $("recordMore").addEventListener("click", () => load(true));
    return {open, clear};
  }
  const api = {create, merge};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.InstitutionRecordsView = api;
})(typeof window !== "undefined" ? window : globalThis);
