(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  let auth, api, next = null, loading = false, reviewing = false, selected = null, sequence = 0;
  const labels = {PENDING: "승인 대기", APPROVED: "승인 완료", REJECTED: "반려", SUSPENDED: "이용 정지"};
  function message(text, error = false) { $("pageMessage").textContent = text; $("pageMessage").className = `message${error ? " message-error" : ""}`; }
  async function call(name, data) { return (await api.httpsCallable(name)(data)).data; }
  function failure(e) {
    return String(e?.code || "").startsWith("functions/") && !["functions/internal", "functions/unavailable", "functions/not-found"].includes(e.code)
      ? e.message : "처리하지 못했습니다. 서버 연결을 확인한 뒤 다시 시도해 주세요.";
  }
  function updateCounts(counts) {
    document.querySelectorAll("#statusTabs [data-status]").forEach(tab => {
      tab.querySelector("strong").textContent = String(counts?.[tab.dataset.status] || 0);
    });
  }
  function selectStatus(status) {
    $("statusFilter").value = status;
    document.querySelectorAll("#statusTabs [data-status]").forEach(tab => tab.setAttribute("aria-selected", String(tab.dataset.status === status)));
  }
  function render(item) {
    const card = document.createElement("article"); card.className = "institution-card";
    const badge = document.createElement("span"); badge.className = "badge badge-muted"; badge.textContent = labels[item.status];
    const heading = document.createElement("h2"); heading.textContent = item.institutionName;
    const details = document.createElement("dl");
    const date = item.createdAtMs ? new Intl.DateTimeFormat("ko-KR", {dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul"}).format(item.createdAtMs) : "확인 중";
    for (const [label, value] of [["기관코드", item.institutionCode || "발급 준비 중"], ["담당자", item.managerName], ["기관 이메일", item.email], ["기관 연락처", item.phone], ["인증 휴대전화", item.managerMobileMasked || "2차 인증 등록 필요"], ["기관 주소", item.address || "미등록"], ["가입 신청일", date], ["처리 사유", item.reason || "없음"], ["번호 변경", item.phoneChangePending ? `${item.phoneChangeMobileMasked} 새 번호 인증 대기 (허용 후 24시간)` : "없음"]]) {
      const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label; dd.textContent = value; details.append(dt, dd);
    }
    const actions = document.createElement("div"); actions.className = "dashboard-actions";
    if (item.institutionCode) {
      const copy = document.createElement("button"); copy.type = "button"; copy.className = "button button-secondary"; copy.textContent = "기관코드 복사";
      copy.onclick = async () => { try { await navigator.clipboard.writeText(item.institutionCode); message("기관코드를 복사했습니다."); } catch (_) { message("기관코드를 선택해 직접 복사해 주세요."); } }; actions.append(copy);
    }
    const options = item.status === "PENDING" ? [["APPROVED", "가입 승인"], ["REJECTED", "반려"]]
      : item.status === "APPROVED" ? [["SUSPENDED", "이용 정지"]] : item.status === "SUSPENDED" ? [["APPROVED", "정지 해제"]] : [];
    if (item.status !== "SUSPENDED") options.push(["PHONE_CHANGE", item.phoneChangePending ? "번호 변경 다시 허용" : "담당자 번호 변경"]);
    options.forEach(([status, label]) => {
      const button = document.createElement("button"); button.type = "button"; button.className = "button button-secondary"; button.textContent = label;
      button.onclick = () => {
        selected = {item, status}; $("reviewTitle").textContent = `${item.institutionName} · ${label}`;
        $("reviewDescription").textContent = status === "APPROVED" ? "처리 후 해당 기관이 기관 업무 메뉴에 접근할 수 있습니다." : "처리 후 해당 기관은 기관 업무 메뉴에 접근할 수 없습니다.";
        $("newPhoneField").hidden = status !== "PHONE_CHANGE"; $("newPhone").required = status === "PHONE_CHANGE"; $("newPhone").value = "";
        if (status === "PHONE_CHANGE") $("reviewDescription").textContent = "기관 담당자 변경 요청을 별도로 확인한 후 진행해 주세요. 기존 기관 접근이 중단됩니다. 지정한 새 번호로 24시간 내 문자 인증한 뒤 운영자가 재승인해야 합니다.";
        $("reasonField").hidden = status === "APPROVED"; $("reviewReason").required = status !== "APPROVED";
        $("reviewReason").value = ""; $("reviewMessage").textContent = ""; $("confirmReview").textContent = label; $("reviewDialog").showModal();
      }; actions.append(button);
    });
    card.append(badge, heading, details, actions); return card;
  }
  async function load(more = false) {
    if (loading) return;
    loading = true; const ownSequence = ++sequence;
    $("refreshButton").disabled = true; $("statusFilter").disabled = true; $("loadMoreButton").disabled = true;
    if (!more) { next = null; $("institutionList").replaceChildren(); $("emptyState").hidden = true; $("loadMoreButton").hidden = true; }
    message("기관 계정을 불러오는 중입니다.");
    try {
      const result = await call("adminListInstitutionAccounts", {status: $("statusFilter").value, after: more ? next : null});
      if (ownSequence !== sequence || !auth.currentUser) return;
      updateCounts(result.counts);
      result.accounts.forEach(item => $("institutionList").append(render(item)));
      next = result.next; $("loadMoreButton").hidden = !next;
      $("emptyState").hidden = $("institutionList").children.length !== 0;
      message(`기관 계정 ${$("institutionList").children.length}건을 표시합니다.`);
    } catch (e) { message(failure(e), true); }
    finally { loading = false; $("refreshButton").disabled = false; $("statusFilter").disabled = false; $("loadMoreButton").disabled = false; }
  }
  async function initialize() {
    if (!window.firebase?.apps?.length) throw new Error("로그인 서비스를 불러오지 못했습니다. 새로고침해 주세요.");
    auth = firebase.auth(); api = firebase.app().functions("asia-northeast3");
    $("refreshButton").onclick = () => load(); document.querySelectorAll("#statusTabs [data-status]").forEach(tab => tab.onclick = () => { selectStatus(tab.dataset.status); load(); }); $("loadMoreButton").onclick = () => load(true);
    $("logoutButton").onclick = () => window.AdminSessionTimeout.logoutToHome();
    $("cancelReview").onclick = () => $("reviewDialog").close();
    $("reviewDialog").addEventListener("cancel", e => { if (reviewing) e.preventDefault(); });
    $("reviewForm").onsubmit = async event => {
      event.preventDefault(); if (reviewing || !selected) return;
      reviewing = true; $("confirmReview").disabled = true; $("cancelReview").disabled = true;
      try {
        await call(selected.status === "PHONE_CHANGE" ? "adminAllowInstitutionPhoneChange" : "adminReviewInstitutionAccount", {uid: selected.item.uid, version: selected.item.version, status: selected.status, reason: $("reviewReason").value.trim(), newPhone: $("newPhone").value.trim()});
        $("reviewDialog").close(); await load(); message(selected.status === "PHONE_CHANGE" ? "번호 변경을 허용했습니다. 기관에 새 번호 인증 후 재승인이 필요함을 안내해 주세요." : "기관 계정 상태를 변경했습니다.");
      } catch (e) { $("reviewMessage").textContent = failure(e); }
      finally { reviewing = false; $("confirmReview").disabled = false; $("cancelReview").disabled = false; }
    };
    auth.onAuthStateChanged(async user => {
      if (!user) { sequence++; $("institutionsSection").hidden = true; $("institutionList").replaceChildren(); window.location.replace("/operator/"); return; }
      try {
        const token = await user.getIdTokenResult(true), session = window.AdminSessionTimeout;
        if (token.claims.admin !== true || !session?.hasValidSession(user.uid) ||
            !(session.consumeInternalNavigationTicket(user.uid) || session.isReloadNavigation()) || !session.start({auth, uid: user.uid})) {
          session?.clear(); await auth.signOut(); window.location.replace("/operator/"); return;
        }
        $("signedInInfo").textContent = "관리자 인증 완료 · 기관 가입 심사 · 30분 자동 로그아웃";
        $("checkingSection").hidden = true; $("institutionsSection").hidden = false; await load();
      } catch (e) { $("checkingMessage").textContent = "운영자 권한을 확인하지 못했습니다. 운영 현황으로 돌아가 다시 로그인해 주세요."; }
    });
  }
  window.addEventListener("DOMContentLoaded", () => initialize().catch(e => { $("checkingMessage").textContent = e.message; }));
})();
