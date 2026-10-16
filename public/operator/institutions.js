(() => {
  "use strict";
  window.ManagerPhoneVerification = {
    create({auth, app, onChange}) {
      const $ = id => document.getElementById(id);
      let epoch = 0, active = false, busy = false, confirmation = null, verifier = null, widgetId = null;
      let number = "", verifiedUser = null, verifiedAt = 0, resendAt = 0, cleanup = Promise.resolve();
      function normalize(raw) {
        const n = String(raw || "").replace(/[\s()-]/g, "");
        if (/^010\d{8}$/.test(n)) return "+82" + n.slice(1);
        if (/^\+8210\d{8}$/.test(n)) return n;
        throw new Error("010으로 시작하는 새 담당자 휴대전화 번호를 입력해 주세요.");
      }
      function message(text) { $("managerPhoneMessage").textContent = text; }
      function resetWidget(id) {
        if (id !== null && window.grecaptcha?.reset) { try { window.grecaptcha.reset(id); } catch (_) {} }
      }
      function clearVerifier() {
        resetWidget(widgetId);
        try { verifier?.clear(); } catch (_) {}
        verifier = null; widgetId = null;
      }
      function isVerified(raw) {
        try { return Boolean(active && !busy && verifiedUser && number === normalize(raw) && Date.now() - verifiedAt < 300000); }
        catch (_) { return false; }
      }
      function update() {
        if (!active) return;
        if (verifiedUser && Date.now() - verifiedAt >= 300000) {
          verifiedUser = null; message("인증 후 5분이 지났습니다. 인증번호를 다시 받아 주세요.");
        }
        const remaining = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
        $("sendManagerCode").disabled = busy || remaining > 0;
        $("sendManagerCode").textContent = busy ? "인증 처리 중..." : remaining ? `다시 받기 (${remaining}초)` : confirmation ? "인증번호 다시 받기" : "인증번호 받기";
        $("verifyManagerCode").disabled = busy || !confirmation || !/^[0-9]{6}$/.test($("managerCode").value.trim()) || Boolean(verifiedUser);
        $("verifyManagerCode").textContent = verifiedUser ? "인증 완료" : "인증번호 확인";
        $("newPhone").disabled = busy; $("managerCode").disabled = busy || Boolean(verifiedUser);
        onChange();
      }
      function reset() {
        epoch++; active = false; busy = false; confirmation = null; verifiedUser = null; number = ""; verifiedAt = 0;
        clearVerifier(); $("managerCode").value = ""; $("managerCodeArea").hidden = true;
        $("newPhone").disabled = false; $("managerCode").disabled = false;
        cleanup = cleanup.catch(() => {}).then(() => auth.signOut()).catch(() => {});
        message(""); onChange();
      }
      function errorText(error) {
        const code = error?.code || "";
        if (code === "auth/too-many-requests") return "인증 요청이 제한되었습니다. 잠시 후 다시 시도해 주세요.";
        if (["auth/invalid-verification-code", "auth/code-expired", "auth/session-expired"].includes(code)) return "인증번호가 틀리거나 만료되었습니다. 확인 후 다시 시도해 주세요.";
        return error?.message || "문자 인증을 처리하지 못했습니다. 다시 시도해 주세요.";
      }
      async function send() {
        if (!active || busy || Date.now() < resendAt) return;
        let requested;
        try { requested = normalize($("newPhone").value); } catch (error) { message(error.message); return; }
        const own = ++epoch;
        busy = true; verifiedUser = null; confirmation = null; number = requested; verifiedAt = 0;
        $("managerCode").value = ""; $("managerCodeArea").hidden = true;
        message("인증번호 발송을 요청하고 있습니다. 보안 확인을 완료해 주세요."); update();
        try {
          await cleanup;
          if (own !== epoch || !active) return;
          clearVerifier();
          const currentVerifier = new firebase.auth.RecaptchaVerifier("managerRecaptcha", {size: "normal"}, app);
          verifier = currentVerifier;
          const renderedId = await currentVerifier.render();
          if (own !== epoch || !active) {
            resetWidget(renderedId); try { currentVerifier.clear(); } catch (_) {} return;
          }
          widgetId = renderedId;
          const result = await auth.signInWithPhoneNumber(requested, currentVerifier);
          if (own !== epoch || !active) return;
          confirmation = result; resendAt = Date.now() + 60000;
          $("managerCodeArea").hidden = false; message("새 담당자 휴대전화로 받은 인증번호 6자리를 입력해 주세요.");
        } catch (error) { if (own === epoch && active) message(errorText(error)); }
        finally { if (own === epoch && active) { busy = false; clearVerifier(); update(); if (confirmation) $("managerCode").focus(); } }
      }
      async function confirm() {
        if (!active || busy || !confirmation || !/^[0-9]{6}$/.test($("managerCode").value.trim())) return;
        const own = epoch; busy = true; update();
        try {
          const result = await confirmation.confirm($("managerCode").value.trim());
          if (own !== epoch || !active) { await auth.signOut(); return; }
          if (result.user.phoneNumber !== number || normalize($("newPhone").value) !== number) throw new Error("변경할 전화번호를 다시 인증해 주세요.");
          verifiedUser = result.user; verifiedAt = Date.now(); $("managerCode").value = "";
          message("새 전화번호 인증이 완료되었습니다. 담당자 이름과 변경 사유를 확인한 뒤 변경을 승인해 주세요.");
        } catch (error) { if (own === epoch && active) message(errorText(error)); }
        finally { if (own === epoch && active) { busy = false; update(); } }
      }
      $("sendManagerCode").onclick = send;
      $("verifyManagerCode").onclick = confirm;
      $("managerCode").addEventListener("input", update);
      $("managerCode").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); confirm(); } });
      $("newPhone").addEventListener("input", () => {
        if (!active || busy) return;
        epoch++; verifiedUser = null; confirmation = null; number = ""; verifiedAt = 0;
        $("managerCode").value = ""; $("managerCodeArea").hidden = true;
        cleanup = cleanup.catch(() => {}).then(() => auth.signOut()).catch(() => {});
        message("새 전화번호를 문자 인증해 주세요."); update();
      });
      const timer = setInterval(update, 1000);
      return {reset, isVerified, open() { active = true; update(); },
        async getToken(raw) {
          if (!isVerified(raw)) throw new Error("변경할 새 전화번호의 문자 인증을 먼저 완료해 주세요.");
          const own = epoch, user = verifiedUser;
          const token = await user.getIdToken(true);
          if (own !== epoch || !isVerified(raw) || user !== verifiedUser) throw new Error("새 전화번호를 다시 인증해 주세요.");
          return token;
        },
        destroy() { reset(); clearInterval(timer); },
      };
    },
  };
})();


// Native showModal() puts the dialog above reCAPTCHA's body-mounted challenge iframe.
// Keep page interaction blocked with an ordinary backdrop while allowing Google's challenge above it.
(() => {
  "use strict";
  window.ManagerReviewDialog = {
    create({dialog, background, isBusy, onClose}) {
      const backdrop = document.createElement("div");
      backdrop.setAttribute("aria-hidden", "true");
      backdrop.style.cssText = "position:fixed;inset:0;background:#231c1899;z-index:1000;";
      backdrop.hidden = true; document.body.append(backdrop);
      dialog.setAttribute("aria-modal", "true");
      dialog.style.cssText += ";position:fixed;inset:50% auto auto 50%;transform:translate(-50%,-50%);margin:0;max-height:calc(100dvh - 32px);overflow-y:auto;z-index:1001;box-sizing:border-box;";
      let opened = false, previousFocus = null, previousOverflow = "", previousInert = false;
      function cleanup() {
        if (!opened) return;
        opened = false; onClose(); backdrop.hidden = true;
        background.inert = previousInert; document.body.style.overflow = previousOverflow;
        if (previousFocus?.isConnected) previousFocus.focus();
      }
      function close() {
        if (!opened || isBusy()) return;
        cleanup(); if (dialog.open) dialog.close();
      }
      dialog.addEventListener("close", cleanup);
      backdrop.addEventListener("click", close);
      document.addEventListener("keydown", event => {
        if (opened && event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); close(); }
      });
      return {close, open() {
        if (opened) return;
        previousFocus = document.activeElement; previousOverflow = document.body.style.overflow;
        previousInert = background.inert; opened = true;
        background.inert = true; document.body.style.overflow = "hidden"; backdrop.hidden = false;
        dialog.show();
        const first = Array.from(dialog.querySelectorAll("input,textarea,button"))
          .find(element => !element.disabled && element.getClientRects().length > 0);
        first?.focus();
      }};
    },
  };
})();

(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  let reviewDialog, phoneCheck, auth, api, next = null, loading = false, reviewing = false, selected = null, sequence = 0;
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
  function updateReviewButton() {
    $("confirmReview").disabled = reviewing || (selected?.status === "PHONE_CHANGE" && !phoneCheck?.isVerified($("newPhone").value));
  }
  function render(item) {
    const card = document.createElement("article"); card.className = "institution-card";
    const badge = document.createElement("span"); badge.className = "badge badge-muted"; badge.textContent = item.phoneChangePending ? "새 담당자 인증 대기" : labels[item.status];
    const heading = document.createElement("h2"); heading.textContent = item.institutionName;
    const details = document.createElement("dl");
    const date = item.createdAtMs ? new Intl.DateTimeFormat("ko-KR", {dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul"}).format(item.createdAtMs) : "확인 중";
    for (const [label, value] of [["기관코드", item.institutionCode || "발급 준비 중"], ["담당자", item.managerName], ["기관 이메일", item.email], ["기관 연락처", item.phone], ["인증 휴대전화", item.managerMobileMasked || "2차 인증 등록 필요"], ["기관 주소", item.address || "미등록"], ["가입 신청일", date], ["처리 사유", item.reason || "없음"], ["담당자 변경", item.phoneChangePending ? `${item.phoneChangeManagerName || item.managerName} · ${item.phoneChangeMobileMasked} 새 번호 인증 대기 (승인 후 24시간)${item.phoneChangeSingleApproval ? " · 인증하면 변경 완료" : ""}` : "없음"]]) {
      const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label; dd.textContent = value; details.append(dt, dd);
    }
    const actions = document.createElement("div"); actions.className = "dashboard-actions";
    if (item.institutionCode) {
      const copy = document.createElement("button"); copy.type = "button"; copy.className = "button button-secondary"; copy.textContent = "기관코드 복사";
      copy.onclick = async () => { try { await navigator.clipboard.writeText(item.institutionCode); message("기관코드를 복사했습니다."); } catch (_) { message("기관코드를 선택해 직접 복사해 주세요."); } }; actions.append(copy);
    }
    const options = item.status === "PENDING" ? (item.phoneChangePending ? [["REJECTED", "변경 반려"]] : [["APPROVED", "가입 승인"], ["REJECTED", "반려"]])
      : item.status === "APPROVED" ? [["SUSPENDED", "이용 정지"]] : item.status === "SUSPENDED" ? [["APPROVED", "정지 해제"]] : [];
    if (item.status !== "SUSPENDED") options.push(["PHONE_CHANGE", item.phoneChangePending ? "담당자 변경 다시 확정" : "담당자 변경 확정"]);
    options.forEach(([status, label]) => {
      const button = document.createElement("button"); button.type = "button"; button.className = "button button-secondary"; button.textContent = label;
      button.onclick = () => {
        phoneCheck.reset(); selected = {item, status};
        $("managerPhoneCheck").hidden = status !== "PHONE_CHANGE";
        if (status === "PHONE_CHANGE") phoneCheck.open(); $("reviewTitle").textContent = `${item.institutionName} · ${label}`;
        $("reviewDescription").textContent = status === "APPROVED" ? "처리 후 해당 기관이 기관 업무 메뉴에 접근할 수 있습니다." : "처리 후 해당 기관은 기관 업무 메뉴에 접근할 수 없습니다.";
        $("newManagerNameField").hidden = status !== "PHONE_CHANGE";
        $("newManagerName").required = status === "PHONE_CHANGE";
        $("newManagerName").value = item.phoneChangeManagerName || item.managerName || "";
        $("newPhoneField").hidden = status !== "PHONE_CHANGE"; $("newPhone").required = status === "PHONE_CHANGE"; $("newPhone").value = "";
        if (status === "PHONE_CHANGE") $("reviewDescription").textContent = "기관에 등록된 책임자나 관리자에게 변경 요청을 확인한 뒤, 새 담당자 이름과 번호를 입력하고 문자 인증을 완료해 주세요. 확인한 책임자와 확인 방법은 사유에 기록해 주세요. 변경 확정 즉시 이름·번호가 반영되고 기존 담당자의 기관 접근이 차단됩니다. 승인된 기관은 승인 상태를 유지하며, 최초 가입 승인은 별도로 필요합니다.";
        $("reasonField").hidden = status === "APPROVED"; $("reviewReason").required = status !== "APPROVED";
        $("reviewReason").value = ""; $("reviewMessage").textContent = ""; $("confirmReview").textContent = label; reviewDialog.open(); updateReviewButton();
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
    const phoneApp = firebase.apps.find(app => app.name === "operator-manager-phone") ||
      firebase.initializeApp(firebase.app().options, "operator-manager-phone");
    const phoneAuth = phoneApp.auth();
    await phoneAuth.setPersistence(firebase.auth.Auth.Persistence.NONE);
    phoneAuth.languageCode = "ko";
    phoneCheck = window.ManagerPhoneVerification.create({auth: phoneAuth, app: phoneApp, onChange: updateReviewButton});
    reviewDialog = window.ManagerReviewDialog.create({dialog: $("reviewDialog"),
      background: document.querySelector("main"), isBusy: () => reviewing,
      onClose: () => phoneCheck.reset()});
    $("refreshButton").onclick = () => load(); document.querySelectorAll("#statusTabs [data-status]").forEach(tab => tab.onclick = () => { selectStatus(tab.dataset.status); load(); }); $("loadMoreButton").onclick = () => load(true);
    $("logoutButton").onclick = () => window.AdminSessionTimeout.logoutToHome();
    $("cancelReview").onclick = () => reviewDialog.close();
    $("reviewDialog").addEventListener("cancel", e => { if (reviewing) e.preventDefault(); });
    $("reviewForm").onsubmit = async event => {
      event.preventDefault(); if (reviewing || !selected) return;
      reviewing = true; $("confirmReview").disabled = true; $("cancelReview").disabled = true;
      try {
        const newPhoneIdToken = selected.status === "PHONE_CHANGE" ? await phoneCheck.getToken($("newPhone").value) : null;
        await call(selected.status === "PHONE_CHANGE" ? "adminAllowInstitutionPhoneChange" : "adminReviewInstitutionAccount", {uid: selected.item.uid, version: selected.item.version, status: selected.status, reason: $("reviewReason").value.trim(), newPhone: $("newPhone").value.trim(), newManagerName: $("newManagerName").value.trim(), newPhoneIdToken});
        $("reviewDialog").close(); await load(); message(selected.status === "PHONE_CHANGE" ? "담당자 변경이 완료되었습니다. 기존 담당자의 기관 접근은 종료되며, 새 담당자는 변경된 번호로 로그인할 수 있습니다. 최초 가입 승인 대기 기관은 별도 승인이 필요합니다." : "기관 계정 상태를 변경했습니다.");
      } catch (e) { $("reviewMessage").textContent = failure(e); }
      finally { reviewing = false; updateReviewButton(); $("cancelReview").disabled = false; }
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
