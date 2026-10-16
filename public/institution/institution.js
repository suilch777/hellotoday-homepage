(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const views = ["checkingView", "loginView", "verifyView", "smsView", "policyView", "applicationView", "statusView", "portalView"];
  const displayedPolicy = {termsVersion: "2026-09-30", privacyVersion: "2026-09-30"};
  let currentPolicy = {...displayedPolicy}, pendingPolicyConsent = null;
  function showPolicy() {
    $("policyForm").reset();
    $("policyVersion").textContent = `이용약관 ${currentPolicy.termsVersion} · 개인정보처리방침 ${currentPolicy.privacyVersion}`;
    show("policyView");
  }
  const menuNames = {overview: "대상자 현황", checkins: "안부 지연 확인", help: "도움 요청", records: "전체 기록 열람", statistics: "통계 보기", staff: "돌봄담당자 관리", settings: "기관 설정"};
  let emailAuth, phoneAuth, api, phone, session, account, busy = false, checking = false, ending = false, epoch = 0, activeMenu = "overview";
  function show(id) {
    document.body.classList.toggle("institution-logged-in", id === "portalView");
    views.forEach(name => { $(name).hidden = name !== id; });
    const messageBox = $("accountMessage");
    if ($(id).classList.contains("account-card")) $(id).prepend(messageBox);
    else document.querySelector(".account-wrap").append(messageBox);
    $("signupIntroduction").hidden = id === "portalView";
    const code = account?.institutionCode || "";
    $("institutionCodePanel").hidden = !code || !["portalView", "statusView", "applicationView"].includes(id);
    $("institutionCodeValue").textContent = code;
    document.querySelector(".account-wrap").classList.toggle("portal-message", id === "portalView");
  }
  function message(text = "", error = false) {
    const box = $("accountMessage");
    const card = views.map(id => $(id)).find(view => !view.hidden && view.classList.contains("account-card"));
    if (card) card.prepend(box);
    else document.querySelector(".account-wrap").append(box);
    box.textContent = text; box.classList.toggle("error", error);
    if (text) { box.scrollIntoView({block: "center", behavior: "instant"}); box.focus({preventScroll: true}); }
  }
  function errorText(error) {
    const code = /INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(String(error?.message || "")) ? "auth/invalid-credential" : String(error?.code || "");
    const messages = {
      "auth/email-already-in-use": "이미 가입된 이메일입니다. 로그인하거나 비밀번호를 재설정해 주세요.",
      "auth/invalid-email": "이메일 주소를 확인해 주세요.", "auth/weak-password": "비밀번호는 8자 이상으로 입력해 주세요.",
      "auth/invalid-login-credentials": "이메일 또는 비밀번호가 올바르지 않습니다. 다시 입력하거나 아래의 이메일 찾기·비밀번호 재설정을 이용해 주세요.", "auth/invalid-credential": "이메일 또는 비밀번호가 올바르지 않습니다. 다시 입력하거나 아래의 이메일 찾기·비밀번호 재설정을 이용해 주세요.",
      "auth/wrong-password": "이메일 또는 비밀번호가 올바르지 않습니다. 다시 입력하거나 아래의 이메일 찾기·비밀번호 재설정을 이용해 주세요.", "auth/user-not-found": "이메일 또는 비밀번호가 올바르지 않습니다. 다시 입력하거나 아래의 이메일 찾기·비밀번호 재설정을 이용해 주세요.",
      "auth/too-many-requests": "요청이 많습니다. 잠시 후 다시 시도해 주세요.", "auth/user-disabled": "이용이 정지된 계정입니다.",
      "auth/operation-not-allowed": "로그인 서비스를 사용할 수 없습니다. 운영자에게 문의해 주세요.",
      "auth/network-request-failed": "네트워크 연결을 확인해 주세요.", "auth/invalid-phone-number": "010으로 시작하는 담당자 휴대전화 번호를 확인해 주세요.",
      "auth/invalid-verification-code": "인증번호가 일치하지 않습니다. 문자에 있는 6자리를 확인해 주세요.",
      "auth/code-expired": "인증번호가 만료되었습니다. 다시 받아 주세요.", "auth/session-expired": "인증 시간이 만료되었습니다. 다시 로그인해 주세요.",
      "auth/quota-exceeded": "문자 발송 한도를 초과했습니다. 잠시 후 시도하거나 운영자에게 문의해 주세요.",
      "auth/captcha-check-failed": "자동입력 방지 확인을 다시 진행해 주세요.", "auth/unauthorized-domain": "이 주소에서는 문자 인증을 사용할 수 없습니다. 운영자에게 문의해 주세요.",
      "auth/multi-factor-auth-required": "이 계정에는 이전 다중 인증이 등록되어 있습니다. 운영자에게 인증 방식 전환을 요청해 주세요.",
      "functions/not-found": "기관 로그인 서비스가 아직 준비되지 않았습니다. 운영자에게 문의해 주세요.",
    };
    return messages[code] || (code.startsWith("functions/") && !["functions/internal", "functions/unavailable"].includes(code) ? error.message : "처리하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.");
  }
  async function run(fn) {
    if (busy || ending) return;
    busy = true; const buttons = [...document.querySelectorAll(".account-wrap button")];
    buttons.forEach(b => { b.disabled = true; }); message();
    try { await fn(); } catch (error) { if (!ending) message(errorText(error), true); }
    finally { busy = false; buttons.forEach(b => { b.disabled = false; }); phone?.update(); }
  }
  async function rawCall(name, data = {}) {
    if (!emailAuth.currentUser || !phoneAuth.currentUser) throw {code: "auth/session-expired"};
    const ownEpoch = epoch;
    const emailIdToken = await emailAuth.currentUser.getIdToken();
    const result = (await api.httpsCallable(name)({...data, emailIdToken})).data;
    if (ownEpoch !== epoch) throw {code: "auth/session-expired"};
    return result;
  }
  async function call(name, data = {}) {
    const record = session.read();
    if (!record || !session.valid(emailAuth.currentUser?.uid, phoneAuth.currentUser?.uid)) {
      await logout("/institution/?timeout=1"); throw {code: "auth/session-expired"};
    }
    try {
      const result = await rawCall(name, {...data, sessionId: record.id});
      if (result.session) session.sync(result.session);
      return result;
    } catch (error) {
      if (error.code === "functions/unauthenticated") await logout("/institution/?timeout=1");
      throw error;
    }
  }
  async function signOutBoth() { await Promise.allSettled([emailAuth.signOut(), phoneAuth.signOut()]); }
  async function cancelAuthentication() {
    stopHelpWatches(); recordsView.clear(); statisticsView.clear(); epoch++; account = null; phone.reset(); session.clear(); await signOutBoth();
    pendingPolicyConsent = null; currentPolicy = {...displayedPolicy}; show("loginView");
    $("authForm").reset(); $("applicationForm").reset(); $("institutionDetails").replaceChildren();
  }
  async function logout(destination = "/") {
    if (ending) return;
    ending = true; stopHelpWatches(); recordsView.clear(); statisticsView.clear();
    const record = session.read(); show("checkingView");
    // Hide protected information immediately. Bound network cleanup must not keep
    // the UI open when the connection is unavailable.
    account = null; $("institutionDetails").replaceChildren(); $("institutionIdentity").textContent = "";
    const end = record && emailAuth.currentUser && phoneAuth.currentUser
      ? rawCall("institutionEndSession", {sessionId: record.id}).catch(() => {}) : Promise.resolve();
    epoch++; session.clear(); phone.reset();
    await Promise.race([end, new Promise(resolve => setTimeout(resolve, 1500))]);
    await Promise.race([signOutBoth(), new Promise(resolve => setTimeout(resolve, 1500))]);
    window.location.replace(destination);
  }
  function editApplication() {
    for (const id of ["institutionName", "managerName", "phone", "address"]) $(id).value = account?.[id] || "";
    $("applicationEmail").textContent = emailAuth.currentUser.email; show("applicationView");
  }
  function renderMenu(name) {
    pendingRecordFilters = null;
    stopHelpWatches(); recordsView.clear(); statisticsView.clear();
    $("recordPanel").hidden = name !== "records";
    $("statisticsPanel").hidden = name !== "statistics";
    const seniorMenu = ["overview", "checkins", "help", "workerView"].includes(name);
    $("seniorRefresh").hidden = !seniorMenu;
    $("workerRefresh").hidden = name !== "staff";
    $("seniorPanel").hidden = !seniorMenu;
    $("careWorkerPanel").hidden = name !== "staff";
    if (name === "staff") loadWorkers();
    $("phoneChangeHelp").hidden = name !== "settings";
    activeMenu = name; $("portalTitle").textContent = name === "workerView" ? selectedWorker.name + " · 대상자 현황" : menuNames[name];
    if (seniorMenu) loadDashboard();
    if (name === "records") loadDashboard().then(ok => { if (ok && activeMenu === "records" && !ending) { recordsView.open(pendingRecordFilters?.epoch === epoch ? pendingRecordFilters : undefined); pendingRecordFilters = null; } });
    if (name === "statistics") { $("statsMessage").textContent = "기관의 업무 대상자를 확인하고 있습니다."; loadDashboard().then(ok => { if (activeMenu === "statistics" && !ending) { if(ok) statisticsView.open(); else $("statsMessage").textContent = "대상자를 확인하지 못했습니다. 통계 보기 메뉴를 다시 눌러 주세요."; } }); }
    document.querySelectorAll("[data-institution-menu]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.institutionMenu === (name === "workerView" ? "staff" : name))));
    $("institutionDetails").hidden = name !== "settings"; $("portalEmpty").hidden = true;
    const dl = $("institutionDetails"); dl.replaceChildren();
    for (const [label, value] of [["기관코드", account.institutionCode || "발급 준비 중"], ["기관명", account.institutionName], ["담당자", account.managerName], ["기관 이메일", account.email], ["기관 연락처", account.phone], ["인증 휴대전화", account.managerMobileMasked], ["주소", account.address || "미등록"]]) {
      const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label; dd.textContent = value; dl.append(dt, dd);
    }
  }
  let seniorSequence = 0, seniorRows = [], seniorAsOf = 0, selectedWorker = null, seniorFilter = "ALL";

  const recordsView = window.InstitutionRecordsView.create({call, getTargets: () => seniorRows,
    isActive: () => activeMenu === "records" && !ending, errorText});

  const statisticsView = window.InstitutionStatisticsView.create({call, getTargets: () => seniorRows,
    getName: () => account?.institutionName || "기관", isActive: () => activeMenu === "statistics" && !ending, errorText,
    openRecords: filters => { renderMenu("records"); const ownEpoch = epoch;
      // renderMenu starts a fresh authorized target scan; apply filters only when that scan finishes.
      pendingRecordFilters = {...filters, epoch: ownEpoch};
    }});
  let pendingRecordFilters = null;

  let helpGeneration = 0, helpScopes = [], helpRetryTimers = new Set();
  function stopHelpWatches() {
    helpGeneration++;
    for (const timer of helpRetryTimers) clearTimeout(timer);
    helpRetryTimers.clear();
  }
  function startHelpWatches() {
    stopHelpWatches();
    if (document.hidden || ending || !["overview", "checkins", "help", "workerView"].includes(activeMenu)) return;
    const generation = helpGeneration;
    $("helpLiveMessage").textContent = "도움요청 변경을 실시간으로 확인합니다.";
    for (const scope of helpScopes) if (scope.rows.length && scope.version) watch(scope);
    async function watch(scope) {
      if (generation !== helpGeneration || ending || document.hidden) return;
      try {
        const result = await call("institutionWaitForHelp", {...scope.query, helpVersion: scope.version});
        if (generation !== helpGeneration || ending) return;
        const changed = result.helpVersion !== scope.version;
        scope.version = result.helpVersion;
        scope.rows = result.seniors.map(row => ({...row, workers: [scope.name], workerUids: [scope.query.workerUid]}));
        if (changed) {
          seniorRows = window.InstitutionSeniorSummary.merge(helpScopes.flatMap(s => s.rows));
          seniorAsOf = Date.now(); renderSeniors();
        }
        $("helpLiveMessage").textContent = "도움요청 변경을 실시간으로 확인합니다.";
        // Empty/revoked pages must not create an immediate request loop.
        if (scope.rows.length) watch(scope);
      } catch (error) {
        if (generation !== helpGeneration || ending) return;
        if (["functions/permission-denied", "functions/unauthenticated"].includes(error.code)) {
          stopHelpWatches(); clearSeniorRows();
          $("helpLiveMessage").textContent = "조회 권한이 변경되었습니다. 새로고침해 주세요."; return;
        }
        $("helpLiveMessage").textContent = "도움요청 실시간 연결을 다시 시도하고 있습니다.";
        const timer = setTimeout(() => { helpRetryTimers.delete(timer); watch(scope); }, 5000);
        helpRetryTimers.add(timer);
      }
    }
  }
  function clearSeniorRows() {
    seniorRows = []; $("seniorList").replaceChildren();
    recordsView.clear(); statisticsView.clear();
    document.querySelectorAll("#seniorSummary button").forEach(b => { b.disabled = true; b.querySelector("strong").textContent = "—"; });
  }
  async function loadDashboard() {
    stopHelpWatches(); helpScopes = [];
    const seq = ++seniorSequence, ownEpoch = epoch, menu = activeMenu;
    const current = () => seq === seniorSequence && ownEpoch === epoch && !ending && activeMenu === menu;
    clearSeniorRows();
    $("seniorBack").hidden = menu !== "workerView";
    $("seniorSummary").hidden = !["overview", "workerView"].includes(menu);
    $("seniorMessage").textContent = "기관의 업무용 대상자 전체를 확인하고 있습니다.";
    try {
      let workers = [], after = null;
      if (menu === "workerView") workers = [{uid: selectedWorker.uid, displayName: selectedWorker.name}];
      else do {
        const result = await call("institutionListCareWorkers", {status: "APPROVED", after, includeCounts: false});
        if (!current()) return;
        // Approved affiliation, not the currently selected app mode, determines visibility.
        workers.push(...result.workers.filter(w => w.accountStatus === "ACTIVE"));
        after = result.next;
      } while (after);
      const collected = [], scopes = [];
      async function loadWorker(worker) {
        let workerAfter = null;
        do {
          if (!current()) return;
          const query = {workerUid: worker.uid, after: workerAfter};
          const result = await call("institutionListSeniors", query);
          if (!current()) return;
          const name = worker.displayName || worker.memberId || "담당자 " + worker.uid.slice(0, 8);
          const rows = result.seniors.map(row => ({...row, workers: [name], workerUids: [worker.uid]}));
          collected.push(...rows); scopes.push({query, name, rows, version: result.helpVersion});
          workerAfter = result.next;
        } while (workerAfter);
      }
      // Avoid a request per worker in series without creating an unbounded burst.
      for (let offset = 0; offset < workers.length; offset += 3) {
        if (!current()) return;
        await Promise.all(workers.slice(offset, offset + 3).map(loadWorker));
      }
      if (!current()) return;
      seniorRows = window.InstitutionSeniorSummary.merge(collected); seniorAsOf = Date.now();
      helpScopes = scopes; renderSeniors(); startHelpWatches(); return true;
    } catch (error) {
      if (current()) { seniorSequence++; clearSeniorRows(); $("seniorMessage").textContent = "전체 현황을 확인하지 못했습니다. 새로고침해 주세요. " + errorText(error); }
    }
  }
  function renderSeniors() {
    const counts = window.InstitutionSeniorSummary.counts(seniorRows);
    document.querySelectorAll("#seniorSummary button").forEach(b => {
      b.disabled = false; b.querySelector("strong").textContent = counts[b.dataset.filter] + "명";
      b.setAttribute("aria-pressed", String(b.dataset.filter === seniorFilter));
    });
    const rows = window.InstitutionSeniorSummary.filter(seniorRows, activeMenu, seniorFilter);
    $("seniorListTitle").textContent = activeMenu === "checkins" ? "안부 지연 대상자" : activeMenu === "help" ? "진행 중 도움요청" : ({ALL:"전체 대상자", COMPLETED:"완료 대상자", INCOMPLETE:"미완료 대상자", HELP_REQUEST:"도움요청 대상자"})[seniorFilter];
    const list = $("seniorList"); list.replaceChildren();
    const labels = {COMPLETED: "최근 안부 완료", INCOMPLETE: "안부 미완료", HELP_REQUEST: "도움요청", NO_RECORD: "안부 기록 없음"};
    const methods = {button: "버튼", AccelerometerMotionManager: "전화기 움직임", accelerometer_motion: "전화기 움직임", StepCounterManager: "걸음수", step_counter: "걸음수", phone_call: "통화", power_connected: "충전기 연결", power_disconnected: "충전기 분리"};
    const date = value => value ? new Date(value).toLocaleString("ko-KR", {timeZone: "Asia/Seoul"}) : "기록 없음";
    for (const row of rows) {
      const card = document.createElement("article"); card.className = "worker-card senior-card";
      const heading = document.createElement("h3"); heading.textContent = row.relations?.join(" / ") || row.relation || "관계호칭 미등록";
      const badge = document.createElement("span"); badge.className = "senior-status " + row.status.toLowerCase(); badge.textContent = labels[row.status];
      const identity = document.createElement("div"); identity.className = "senior-identity"; identity.append(heading, badge);
      const facts = document.createElement("dl"); facts.className = "senior-facts";
      const values = [["돌봄담당자", row.workers.join(", ")], ["최근 안부", date(row.lastCheckInAtMs)],
        ["확인 방법", methods[row.source] || "미기록"], ["배터리", row.batteryPercent === null ? "미기록" : row.batteryPercent + "%" + (row.charging ? " · 충전 중" : "")]];
      for (const [label, value] of values) {
        const group = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd");
        dt.textContent = label; dd.textContent = value; group.append(dt, dd); facts.append(group);
      }
      card.append(identity, facts);
      if (row.pending.length || row.helpCount) {
        const alerts = document.createElement("div"); alerts.className = "senior-alerts";
        for (const pending of row.pending) {
          const p = document.createElement("p"); p.textContent = (pending.checkType === "morning" ? "아침" : "저녁") + " 안부지연 · " + date(pending.createdAtMs) + (pending.requestStatus === "REQUESTED" ? " · 재요청 " + date(pending.requestedAtMs) : ""); alerts.append(p);
        }
        if (row.helpCount) { const p = document.createElement("p"); p.textContent = "진행 중 도움요청 " + row.helpCount + "건 · " + date(row.helpRequestedAtMs); alerts.append(p); }
        card.append(alerts);
      }
      list.append(card);
    }
    $("seniorMessage").textContent = (rows.length ? "현재 " + rows.length + "명을 표시합니다." : "해당 대상자가 없습니다.") + " 확인: " + date(seniorAsOf) + " · 새로고침 버튼으로 최신 상태 확인";
  }
  let workerSequence = 0, workerNext = null, workerLoading = false, workerReviewing = false;
  function updateWorkerCounts(counts) { document.querySelectorAll("#workerStatusTabs [data-status]").forEach(tab => { tab.querySelector("strong").textContent = String(counts?.[tab.dataset.status] || 0); }); }
  function selectWorkerStatus(status) { $("workerStatus").value = status; document.querySelectorAll("#workerStatusTabs [data-status]").forEach(tab => tab.setAttribute("aria-selected", String(tab.dataset.status === status))); }
  async function manageWorkerAffiliation(worker, action, label, workerName, card) {
    if (workerReviewing || workerLoading) return;
    const needsReason = action !== "RESTORE";
    const promptLabel = action === "END" ? "해지 사유" : "정지 사유";
    const reason = needsReason ? window.prompt(promptLabel + "를 입력해 주세요. (500자 이내)") : "";
    if (reason === null || (needsReason && !reason.trim())) return;
    const warning = action === "END"
      ? "소속을 해지하면 기관의 대상자 조회 권한이 즉시 중단되며, 담당자는 다른 기관에 다시 소속을 요청할 수 있습니다."
      : action === "SUSPEND"
        ? "소속을 정지하면 기관의 대상자 조회 권한이 즉시 중단됩니다. 나중에 복구할 수 있습니다."
        : "소속을 복구하면 기관의 대상자 조회 권한이 다시 활성화됩니다.";
    if (!window.confirm(workerName + " 님의 " + label + " 처리를 하시겠습니까?\n\n" + warning)) return;
    workerReviewing = true;
    card.querySelectorAll("button").forEach(button => { button.disabled = true; });
    try {
      await call("institutionManageCareWorkerAffiliation", {uid: worker.uid, version: worker.version, action, reason});
      await loadWorkers();
    } catch (error) {
      $("workerMessage").textContent = errorText(error);
    } finally {
      workerReviewing = false;
      card.querySelectorAll("button").forEach(button => { button.disabled = false; });
    }
  }
  async function loadWorkers(more = false) {
    const sequence = ++workerSequence, ownEpoch = epoch;
    workerLoading = true;
    $("workerRefresh").disabled = true; $("workerMore").disabled = true;
    if (!more) { workerNext = null; $("workerList").replaceChildren(); $("workerMore").hidden = true; }
    $("workerMessage").textContent = "돌봄담당자를 불러오는 중입니다.";
    try {
      const result = await call("institutionListCareWorkers", {status: $("workerStatus").value, after: more ? workerNext : null});
      if (sequence !== workerSequence || ownEpoch !== epoch || ending) return;
      updateWorkerCounts(result.counts);
      for (const worker of result.workers) {
        const card = document.createElement("article"); card.className = "worker-card";
        const heading = document.createElement("h3"); heading.textContent = worker.displayName || worker.memberId || "돌봄담당자";
        const detail = document.createElement("p"); detail.textContent = "회원: " + (worker.memberId || worker.uid) + " · " + ({PENDING:"승인 대기", APPROVED:"승인 완료", REJECTED:"반려", SUSPENDED:"소속 정지"})[worker.institutionStatus];
        const date = document.createElement("p"); date.textContent = "요청일: " + (worker.requestedAtMs ? new Date(worker.requestedAtMs).toLocaleString("ko-KR") : "미기록");
        card.append(heading, detail, date);
        if (worker.institutionStatus === "APPROVED" && worker.accountStatus === "ACTIVE") {
          const open = document.createElement("button"); open.type = "button"; open.className = "worker-open";
          const workerName = heading.textContent; open.textContent = workerName + " · 대상자 현황 보기";
          open.onclick = () => { selectedWorker = {uid: worker.uid, name: workerName}; seniorFilter = "ALL"; renderMenu("workerView"); };
          heading.replaceChildren(open);
        }
        if (worker.reason) { const p = document.createElement("p"); p.textContent = "반려 사유: " + worker.reason; card.append(p); }
        if (worker.accountStatus !== "ACTIVE") { const p = document.createElement("p"); p.textContent = "이용이 제한된 계정입니다."; card.append(p); }
        else if (!worker.isCareWorker && worker.institutionStatus === "PENDING") { const p = document.createElement("p"); p.textContent = "신규 소속 승인 전에는 앱을 돌봄담당자 모드로 설정해 주세요."; card.append(p); }
        if (worker.institutionStatus === "PENDING") for (const [status, label] of [["APPROVED", "승인"], ["REJECTED", "반려"]]) {
          const button = document.createElement("button"); button.type = "button"; button.textContent = label;
          button.onclick = async () => {
            if (workerReviewing || workerLoading) return;
            const reason = status === "REJECTED" ? window.prompt("반려 사유를 입력해 주세요. (500자 이내)") : "";
            if (reason === null || (status === "REJECTED" && !reason.trim())) return;
            if (!window.confirm(heading.textContent + " 님의 기관 소속 요청을 " + label + "하시겠습니까?")) return;
            workerReviewing = true; card.querySelectorAll("button").forEach(b => b.disabled = true);
            try { await call("institutionReviewCareWorker", {uid: worker.uid, version: worker.version, status, reason}); await loadWorkers(); }
            catch (error) { $("workerMessage").textContent = errorText(error); }
            finally { workerReviewing = false; card.querySelectorAll("button").forEach(b => b.disabled = false); }
          }; card.append(button);
        }
        if (worker.institutionStatus === "APPROVED") {
          for (const [action, label, className] of [["SUSPEND", "소속 정지", "worker-suspend"], ["END", "소속 해지", "worker-end"]]) {
            const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.className = className;
            button.onclick = () => manageWorkerAffiliation(worker, action, label, heading.textContent, card);
            card.append(button);
          }
        } else if (worker.institutionStatus === "SUSPENDED") {
          for (const [action, label, className] of [["RESTORE", "소속 복구", "worker-restore"], ["END", "소속 해지", "worker-end"]]) {
            const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.className = className;
            button.onclick = () => manageWorkerAffiliation(worker, action, label, heading.textContent, card);
            card.append(button);
          }
        }
        $("workerList").append(card);
      }
      workerNext = result.next; $("workerMore").hidden = !workerNext;
      $("workerMessage").textContent = $("workerList").children.length ? "현재 " + $("workerList").children.length + "명을 표시합니다." : "해당 상태의 돌봄담당자가 없습니다.";
    } catch (error) { if (sequence === workerSequence && !ending) $("workerMessage").textContent = errorText(error); }
    finally { if (sequence === workerSequence) { workerLoading = false; $("workerRefresh").disabled = false; $("workerMore").disabled = false; } }
  }
  async function refresh(silent = false) {
    if (checking || ending) return;
    checking = true; if (!silent) show("checkingView");
    try {
      const result = await call("institutionGetAccount"); if (ending) return;
      account = result.account; $("applicationMobile").textContent = result.managerMobileMasked;
      // Fail closed if the server has not yet been deployed with the policy contract.
      if (!result.policy?.termsVersion || !result.policy?.privacyVersion) {
        throw {code: "functions/failed-precondition", message: "기관 로그인 동의 서비스 업데이트가 필요합니다. 운영자에게 문의해 주세요."};
      }
      currentPolicy = result.policy;
      if (currentPolicy.required && pendingPolicyConsent?.termsVersion === currentPolicy.termsVersion &&
          pendingPolicyConsent?.privacyVersion === currentPolicy.privacyVersion) {
        await call("institutionAcceptPolicies", pendingPolicyConsent);
        currentPolicy.required = false; pendingPolicyConsent = null;
      }
      if (currentPolicy.required) {
        stopHelpWatches(); seniorSequence++; workerSequence++;
        clearSeniorRows(); $("workerList").replaceChildren(); $("institutionDetails").replaceChildren();
        showPolicy(); return;
      }
      if (!account || (result.requiresResubmission && account.status !== "SUSPENDED")) {
        editApplication(); if (account) message("담당자 휴대전화 인증 정보를 확인하고 다시 승인을 신청해 주세요.");
      } else if (account.status === "APPROVED") {
        const portal = await call("institutionGetPortal"); if (ending) return;
        account = portal.account; $("institutionIdentity").textContent = `${account.institutionName} · ${account.managerName}`;
        renderMenu(activeMenu); show("portalView");
      } else {
        $("statusTitle").textContent = ({PENDING: "가입 승인 대기", REJECTED: "가입 신청 반려", SUSPENDED: "기관 이용 정지"})[account.status] || "이용 상태 확인 필요";
        $("statusName").textContent = account.institutionName;
        $("statusDescription").textContent = account.status === "PENDING" ? account.reason || "가입 신청이 접수되었습니다. 운영자 승인 후 기관 업무 메뉴를 이용할 수 있습니다." : account.reason || "운영자에게 문의해 주세요.";
        $("reapplyButton").hidden = account.status !== "REJECTED"; show("statusView");
      }
    } catch (error) {
      if (!ending) {
        $("statusTitle").textContent = "계정 확인 필요"; $("statusName").textContent = "";
        $("statusDescription").textContent = "이용 권한을 확인하지 못했습니다. 다시 확인해 주세요.";
        $("reapplyButton").hidden = true; show("statusView"); message(errorText(error), true);
      }
    } finally { checking = false; }
  }
  async function emailStep() {
    const user = emailAuth.currentUser;
    await user.reload(); await user.getIdToken(true);
    if (!user.emailVerified) { $("verifyEmail").textContent = user.email; show("verifyView"); return; }
    await phoneAuth.signOut(); phone.open();
  }
  function initialUser(auth) {
    return new Promise(resolve => { let stop; stop = auth.onAuthStateChanged(user => { queueMicrotask(() => stop()); resolve(user); }); });
  }
  async function initialize() {
    $("seniorRefresh").onclick = () => loadDashboard();
    $("seniorBack").onclick = () => { selectWorkerStatus("APPROVED"); renderMenu("staff"); };
    document.querySelectorAll("#seniorSummary button").forEach(b => b.onclick = () => { seniorFilter = b.dataset.filter; renderSeniors(); });
    if (!window.firebase?.apps?.length) { message("로그인 서비스를 불러오지 못했습니다. 새로고침해 주세요.", true); return; }
    const namedApp = name => firebase.apps.find(a => a.name === name) || firebase.initializeApp(firebase.app().options, name);
    emailAuth = namedApp("institution").auth();
    const phoneApp = namedApp("institution-phone"); phoneAuth = phoneApp.auth(); api = phoneApp.functions("asia-northeast3");
    await Promise.all([emailAuth.setPersistence(firebase.auth.Auth.Persistence.SESSION), phoneAuth.setPersistence(firebase.auth.Auth.Persistence.SESSION)]);
    emailAuth.languageCode = phoneAuth.languageCode = "ko";
    session = window.InstitutionSessionTimeout.create({onExpire: () => logout("/institution/?timeout=1"), onExtend: () => call("institutionExtendSession")});
    phone = window.InstitutionPhoneAuth.create({auth: phoneAuth, app: phoneApp, show, message, run, cancel: cancelAuthentication,
      complete: async () => { const result = await rawCall("institutionStartSession"); session.begin(result.session); await refresh(); }});
    $("copyInstitutionCode").onclick = async () => {
      try { await navigator.clipboard.writeText(account.institutionCode); $("institutionCodeMessage").textContent = "기관코드를 복사했습니다."; }
      catch (_) { $("institutionCodeMessage").textContent = "기관코드를 선택해 직접 복사해 주세요."; }
    };
    document.querySelectorAll("#workerStatusTabs [data-status]").forEach(tab => tab.onclick = () => { selectWorkerStatus(tab.dataset.status); loadWorkers(); });
    $("workerRefresh").onclick = () => loadWorkers();
    $("workerMore").onclick = () => loadWorkers(true);
    $("policyForm").onsubmit = event => {
      event.preventDefault(); run(async () => {
        if (!currentPolicy || !$("termsAccepted").checked || !$("privacyAcknowledged").checked) {
          message("이용약관 동의와 개인정보처리방침 확인을 모두 선택해 주세요.", true); return;
        }
        const consent = {termsVersion: currentPolicy.termsVersion,
          privacyVersion: currentPolicy.privacyVersion, termsAccepted: true, privacyAcknowledged: true};
        if (session.read()) {
          await call("institutionAcceptPolicies", consent); await refresh();
        } else {
          pendingPolicyConsent = consent; switchMode(true); message(); show("loginView");
        }
      });
    };
    let signup = false;
    function switchMode(next) {
      signup = next; $("loginTab").setAttribute("aria-pressed", String(!next)); $("signupTab").setAttribute("aria-pressed", String(next));
      $("passwordConfirmField").hidden = !next; $("passwordConfirm").required = next; $("password").minLength = next ? 8 : 1;
      $("password").autocomplete = next ? "new-password" : "current-password"; $("authSubmit").textContent = next ? "이메일 계정 만들기" : "다음: 담당자 휴대전화 인증";
      $("accountRecoveryActions").hidden = next; closeRecovery(); message();
      if (next && !pendingPolicyConsent) showPolicy();
    }
    $("loginTab").onclick = () => switchMode(false); $("signupTab").onclick = () => switchMode(true);
    $("authForm").onsubmit = event => {
      event.preventDefault(); run(async () => {
        if (signup && !pendingPolicyConsent) { showPolicy(); message("먼저 이용약관 동의와 개인정보처리방침 확인을 완료해 주세요.", true); return; }
        const email = $("email").value.trim(), password = $("password").value;
        if (signup && password !== $("passwordConfirm").value) { message("비밀번호가 일치하지 않습니다.", true); return; }
        try {
          if (signup) { const credential = await emailAuth.createUserWithEmailAndPassword(email, password); await emailStep(); await credential.user.sendEmailVerification(); message("인증 메일을 보냈습니다. 링크를 누른 뒤 ‘인증 완료 확인’을 선택해 주세요."); }
          else { await emailAuth.signInWithEmailAndPassword(email, password); await emailStep(); }
        } finally { $("password").value = ""; $("passwordConfirm").value = ""; }
      });
    };
    function closeRecovery() {
      $("emailHelp").hidden = true; $("passwordHelp").hidden = true;
      $("findEmail").setAttribute("aria-expanded", "false"); $("resetPassword").setAttribute("aria-expanded", "false");
    }
    $("findEmail").onclick = () => {
      closeRecovery(); message(); $("emailHelp").hidden = false; $("findEmail").setAttribute("aria-expanded", "true");
      $("emailHelp").scrollIntoView({block: "center"});
    };
    $("resetPassword").onclick = () => {
      closeRecovery(); message(); $("passwordHelp").hidden = false; $("resetPassword").setAttribute("aria-expanded", "true");
      $("resetEmail").value = $("email").value.trim(); $("resetEmail").focus();
    };
    document.querySelectorAll("[data-close-recovery]").forEach(button => { button.onclick = closeRecovery; });
    $("passwordResetForm").onsubmit = event => {
      event.preventDefault(); run(async () => {
        const email = $("resetEmail").value.trim();
        try { await emailAuth.sendPasswordResetEmail(email); }
        catch (error) { if (error.code !== "auth/user-not-found") throw error; }
        message("등록된 이메일이라면 비밀번호 재설정 메일이 발송됩니다. 메일의 링크에서 새 비밀번호를 설정한 뒤 로그인해 주세요. 메일이 보이지 않으면 스팸함과 입력한 이메일 주소를 확인해 주세요.");
      });
    };
    for (const form of [$("authForm"), $("passwordResetForm")]) form.addEventListener("invalid", event => {
      event.preventDefault();
      const field = event.target;
      if (field !== form.querySelector(":invalid")) return;
      const text = field.type === "email" ? "올바른 이메일 주소를 입력해 주세요." : field.id === "passwordConfirm" ? "비밀번호 확인란에 8자 이상 입력해 주세요." : "비밀번호를 입력해 주세요. 가입할 때는 8자 이상이어야 합니다.";
      message(text, true);
    }, true);
    $("resendVerification").onclick = () => run(async () => { await emailAuth.currentUser.sendEmailVerification(); message("인증 메일을 다시 보냈습니다."); });
    document.querySelector("#verifyView [data-refresh-account]").onclick = () => run(emailStep);
    document.querySelector("#statusView [data-refresh-account]").onclick = () => run(refresh);
    document.querySelectorAll("[data-institution-logout]").forEach(b => { b.onclick = () =>
      session.read() || b.closest("#policyView") ? logout() : run(cancelAuthentication); });
    $("reapplyButton").onclick = () => { message(); editApplication(); };
    $("applicationForm").onsubmit = event => { event.preventDefault(); run(async () => {
      const data = Object.fromEntries(["institutionName", "managerName", "phone", "address"].map(id => [id, $(id).value.trim()]));
      await call("institutionSubmitApplication", data); $("applicationForm").reset(); await refresh(); message("가입 신청이 접수되었습니다.");
    }); };
    document.querySelectorAll("[data-institution-menu]").forEach(b => { b.onclick = () => {
      if (ending || $("portalView").hidden || account?.status !== "APPROVED") return;
      if (!session.valid(emailAuth.currentUser?.uid, phoneAuth.currentUser?.uid)) { logout("/institution/?timeout=1"); return; }
      seniorFilter = "ALL"; renderMenu(b.dataset.institutionMenu);
    }; });
    document.addEventListener("click", event => {
      const anchor = event.target.closest("a[href]"); if (!anchor) return;
      if (anchor.hasAttribute("data-policy-document")) {
        event.preventDefault();
        $("policyDocumentTitle").textContent = anchor.textContent;
        $("policyDocumentFrame").src = anchor.getAttribute("href");
        $("policyDocumentDialog").showModal(); return;
      }
      if (anchor.hasAttribute("download")) return;
      if (anchor.target === "_blank" || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const url = new URL(anchor.href, location.href);
      if (["http:", "https:"].includes(url.protocol) && url.origin === location.origin && !url.pathname.startsWith("/institution/") && session.read()) { event.preventDefault(); logout(url.href); }
    });
    $("policyDocumentClose").onclick = () => {
      $("policyDocumentDialog").close(); $("policyDocumentFrame").src = "about:blank";
    };
    const [emailUser, phoneUser] = await Promise.all([initialUser(emailAuth), initialUser(phoneAuth)]);
    const reload = performance.getEntriesByType("navigation")[0]?.type === "reload";
    if (reload && session.valid(emailUser?.uid, phoneUser?.uid)) { session.start(); await refresh(); }
    else { await cancelAuthentication(); switchMode(false); if (new URLSearchParams(location.search).get("timeout") === "1") message("30분 로그인 시간이 만료되어 로그아웃되었습니다. 다시 문자 인증해 주세요."); }
    for (const auth of [emailAuth, phoneAuth]) auth.onAuthStateChanged(user => { if (!user && session.read() && !ending) logout("/institution/?timeout=1"); });
  }
  window.addEventListener("DOMContentLoaded", () => initialize().catch(() => message("로그인을 준비하지 못했습니다. 새로고침해 주세요.", true)));
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopHelpWatches(); else if (!$("portalView").hidden) startHelpWatches(); });
  window.addEventListener("pagehide", () => { stopHelpWatches(); session?.stop(); phone?.destroy(); });
  window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
})();


