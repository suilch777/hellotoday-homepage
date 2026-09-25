(() => {
  "use strict";

  const RECENT_USER_LIMIT = 100;
  const REGION = "asia-northeast3";

  const checkingSection = document.getElementById("checkingSection");
  const usersSection = document.getElementById("usersSection");
  const signedInInfo = document.getElementById("signedInInfo");

  const phoneSearchInput = document.getElementById("phoneSearchInput");
  const searchButton = document.getElementById("searchButton");
  const refreshButton = document.getElementById("refreshButton");
  const logoutButton = document.getElementById("logoutButton");

  const pageMessage = document.getElementById("pageMessage");
  const listTitle = document.getElementById("listTitle");
  const listCountBadge = document.getElementById("listCountBadge");
  const userTableBody = document.getElementById("userTableBody");
  const userCardList = document.getElementById("userCardList");
  const emptyState = document.getElementById("emptyState");
  const actionHeader = document.getElementById("actionHeader");
  const activitySection = document.getElementById("activitySection");
  const refreshActivityButton = document.getElementById("refreshActivityButton");
  const activityCheckIn = document.getElementById("activityCheckIn");
  const activityPending = document.getElementById("activityPending");
  const activityReRequest = document.getElementById("activityReRequest");
  const activityHelp = document.getElementById("activityHelp");
  const activityConnections = document.getElementById("activityConnections");
  const activityMessage = document.getElementById("activityMessage");

  let auth;
  let db;
  let functions;
  let currentSingleUser = null;
  let showingSingleUser = false;
  let activityLoadSequence = 0;

  function setMessage(text, type = "") {
    pageMessage.textContent = text || "";
    pageMessage.className = "message";

    if (type) {
      pageMessage.classList.add(`message-${type}`);
    }
  }

  function maskAdminPhone(phone) {
    const digits = String(phone || "").replace(/\D/g, "");

    if (digits.length < 4) {
      return "인증된 관리자";
    }

    return `***-****-${digits.slice(-4)}`;
  }

  function normalizePhoneForSearch(raw) {
    const text = String(raw || "").trim();
    const digits = text.replace(/\D/g, "");

    if (!digits) {
      throw new Error("전화번호를 입력해 주세요.");
    }

    if (digits.length < 10 || digits.length > 11) {
      throw new Error("전화번호를 정확히 입력해 주세요.");
    }

    return digits;
  }

  function hasMode(data, mode) {
    const currentMode = String(data.mode || "").toUpperCase();

    const modes = Array.isArray(data.modes)
      ? data.modes.map(value => String(value || "").toUpperCase())
      : [];

    return currentMode === mode || modes.includes(mode);
  }

  function roleText(data) {
    const roles = [];

    if (hasMode(data, "SENIOR")) {
      roles.push("대상자");
    }

    if (hasMode(data, "GUARDIAN")) {
      roles.push("가족보호자");
    }

    if (hasMode(data, "CARE_WORKER")) {
      roles.push("돌봄담당자");
    }

    return roles.length > 0 ? roles.join(" · ") : "미지정";
  }

  function isDisabled(data) {
    return data.disabled === true ||
      String(data.status || "").toUpperCase() === "SUSPENDED";
  }

  function numberValue(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (value && typeof value.toNumber === "function") {
      return value.toNumber();
    }

    return 0;
  }

  function toMillis(value) {
    if (!value) {
      return 0;
    }

    if (typeof value.toMillis === "function") {
      return value.toMillis();
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    if (typeof value === "number") {
      return value;
    }

    return 0;
  }

  function formatDate(value) {
    const ms = toMillis(value);

    if (!ms) {
      return "기록 없음";
    }

    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(ms));
  }

  function makeUserItem(uid, data, maskedPhone = "") {
    return {
      uid: uid || "",
      memberNo: numberValue(data.memberNo),
      memberId: String(data.memberId || "").trim(),
      role: roleText(data),
      disabled: isDisabled(data),
      createdAt: data.createdAt || data.createdAtMs || 0,
      maskedPhone: String(maskedPhone || "").trim()
    };
  }

  function escapeText(value) {
    return String(value == null ? "" : value);
  }

  function clearResults() {
    userTableBody.replaceChildren();
    userCardList.replaceChildren();
  }

  function createCell(text, className = "") {
    const td = document.createElement("td");
    td.textContent = text;

    if (className) {
      td.className = className;
    }

    return td;
  }

  function createStatusActionButton(item) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = item.disabled
      ? "user-action-button user-action-restore"
      : "user-action-button user-action-suspend";

    button.textContent = item.disabled ? "정지 해제" : "이용자 정지";

    button.addEventListener("click", async () => {
      await setUserDisabled(item, !item.disabled, button);
    });

    return button;
  }

  function renderUsers(items, title, options = {}) {
    clearResults();

    const showActions = options.showActions === true;
    showingSingleUser = showActions && items.length === 1;
    currentSingleUser = showingSingleUser ? items[0] : null;

    listTitle.textContent = title;
    listCountBadge.textContent = `${items.length}명`;
    emptyState.hidden = items.length !== 0;

    if (actionHeader) {
      actionHeader.hidden = !showActions;
    }

    refreshButton.textContent = showingSingleUser
      ? "최근 이용자 목록으로"
      : "최근 이용자 다시 보기";

    for (const item of items) {
      const statusText = item.disabled ? "이용 정지" : "정상";
      const memberNoText = item.memberNo > 0 ? String(item.memberNo) : "없음";
      const memberIdText = item.memberId || "없음";
      const dateText = formatDate(item.createdAt);
      const phoneText = item.maskedPhone || "-";

      const tr = document.createElement("tr");
      tr.appendChild(createCell(memberNoText, "cell-member-no"));
      tr.appendChild(createCell(memberIdText));
      tr.appendChild(createCell(item.role));
      tr.appendChild(
        createCell(
          statusText,
          item.disabled ? "status-suspended" : "status-active"
        )
      );
      tr.appendChild(createCell(dateText));
      tr.appendChild(createCell(phoneText));

      if (showActions) {
        const actionCell = document.createElement("td");
        actionCell.className = "cell-actions";
        actionCell.appendChild(createStatusActionButton(item));
        tr.appendChild(actionCell);
      }

      userTableBody.appendChild(tr);

      const card = document.createElement("article");
      card.className = "user-row-card";

      const top = document.createElement("div");
      top.className = "user-card-top";

      const titleEl = document.createElement("strong");
      titleEl.textContent = `회원번호 ${memberNoText}`;

      const statusEl = document.createElement("span");
      statusEl.className = item.disabled
        ? "user-status user-status-suspended"
        : "user-status user-status-active";
      statusEl.textContent = statusText;

      top.append(titleEl, statusEl);

      const lines = document.createElement("div");
      lines.className = "user-card-lines";

      const details = [
        `회원 ID: ${memberIdText}`,
        `역할: ${escapeText(item.role)}`,
        `가입일: ${dateText}`,
        `전화번호: ${phoneText}`
      ];

      for (const detail of details) {
        const p = document.createElement("p");
        p.textContent = detail;
        lines.appendChild(p);
      }

      card.append(top, lines);

      if (showActions) {
        const actions = document.createElement("div");
        actions.className = "user-card-actions";
        actions.appendChild(createStatusActionButton(item));
        card.appendChild(actions);
      }

      userCardList.appendChild(card);
    }
  }

  async function setUserDisabled(item, makeDisabled, sourceButton) {
    if (!item || !item.uid) {
      setMessage("이용자 UID를 확인할 수 없습니다.", "error");
      return;
    }

    const actionText = makeDisabled ? "정지" : "정지 해제";
    const confirmMessage = makeDisabled
      ? "이 이용자의 서비스 이용을 정지하시겠습니까?"
      : "이 이용자의 서비스 이용 정지를 해제하시겠습니까?";

    if (!window.confirm(confirmMessage)) {
      return;
    }

    sourceButton.disabled = true;
    setMessage(`이용자 ${actionText} 처리 중입니다.`);

    try {
      const callable = functions.httpsCallable("adminSetUserDisabled");
      await callable({
        uid: item.uid,
        disabled: makeDisabled
      });

      item.disabled = makeDisabled;

      if (currentSingleUser && currentSingleUser.uid === item.uid) {
        currentSingleUser.disabled = makeDisabled;
      }

      renderUsers(
        [item],
        "전화번호 조회 결과",
        { showActions: true }
      );

      setMessage(
        makeDisabled
          ? "이용자 이용을 정지했습니다."
          : "이용자 이용 정지를 해제했습니다.",
        "success"
      );
    } catch (error) {
      console.error("이용자 상태 변경 실패", error);

      let message = `이용자 ${actionText} 처리에 실패했습니다.`;
      const code = String(error && error.code ? error.code : "");

      if (code.includes("permission-denied")) {
        message = "관리자 권한이 없어 이용자 상태를 변경할 수 없습니다.";
      } else if (code.includes("failed-precondition")) {
        message =
          error && error.message
            ? error.message
            : "현재 상태에서는 이 작업을 수행할 수 없습니다.";
      } else if (code.includes("not-found")) {
        message = "해당 이용자를 찾을 수 없습니다.";
      } else if (error && error.message) {
        message = `이용자 ${actionText} 실패: ${error.message}`;
      }

      setMessage(message, "error");
      sourceButton.disabled = false;
    }
  }

  function setActivityMessage(text, type = "") {
    activityMessage.textContent = text || "";
    activityMessage.className = "message";

    if (type) {
      activityMessage.classList.add(`message-${type}`);
    }
  }

  function resetActivityUi() {
    activityCheckIn.textContent = "불러오는 중…";
    activityPending.textContent = "불러오는 중…";
    activityReRequest.textContent = "불러오는 중…";
    activityHelp.textContent = "불러오는 중…";
    activityConnections.textContent = "불러오는 중…";
    setActivityMessage("");
  }

  function formatDateTime(value) {
    const ms = toMillis(value);

    if (!ms) {
      return "시간 확인 불가";
    }

    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Seoul"
    }).format(new Date(ms));
  }

  function checkTypeText(type) {
    return type === "evening" ? "저녁" : "아침";
  }

  function checkInSourceText(source) {
    const key = String(source || "").toLowerCase();
    const names = {
      button: "버튼", accelerometermotionmanager: "전화기 움직임",
      accelerometer_motion: "전화기 움직임", stepcountermanager: "걸음 수",
      step_counter: "걸음 수", phone_call: "통화",
      power_connected: "충전기 연결", power_connect: "충전기 연결",
      power_disconnected: "충전기 분리", power_disconnect: "충전기 분리"
    };
    return names[key] || key || "방법 확인 불가";
  }

  function appendHistory(element, rows, emptyMessage, formatRow) {
    element.replaceChildren();
    if (!Array.isArray(rows) || rows.length === 0) {
      element.textContent = emptyMessage;
      return;
    }
    const visible = document.createElement("div");
    visible.textContent = rows.slice(0, 5).map(formatRow).join("\n");
    element.appendChild(visible);
    if (rows.length > 5) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "activity-more-button";
      more.textContent = "전체보기";
      more.addEventListener("click", () => {
        const expanded = more.getAttribute("aria-expanded") === "true";
        visible.textContent = (expanded ? rows.slice(0, 5) : rows)
          .map(formatRow).join("\n");
        more.setAttribute("aria-expanded", expanded ? "false" : "true");
        more.textContent = expanded ? "전체보기" : "접기";
      });
      element.appendChild(more);
    }
  }

  function requestStatusText(status) {
    const values = {
      COMPLETED: "안부확인 완료", DELIVERED: "대상자에게 전달됨",
      REQUESTED: "요청됨", EXPIRED: "만료됨"
    };
    return values[String(status || "").toUpperCase()] || String(status || "상태 확인 중");
  }

  function helpStatusText(status) {
    const key = String(status || "").toLowerCase();
    if (["pending", "new", "open"].includes(key)) return "도움요청 진행 중";
    if (key === "responding") return "보호자 대응 중";
    if (["handled", "completed", "resolved"].includes(key)) return "처리 완료";
    return key || "상태 확인 중";
  }

  function renderManagedDetail(data) {
    appendHistory(activityCheckIn, data.checkInHistory, "안부기록이 없습니다.", row => {
      const battery = Number.isFinite(row.batteryLevel)
        ? ` · 배터리 ${row.batteryLevel}%` : "";
      return `${formatDateTime(row.completedAtMs)} · ${checkTypeText(row.checkType)} 안부 · ${checkInSourceText(row.source)}${battery}`;
    });

    const pending = data.pendingCheckIn;
    activityPending.textContent = pending
      ? `${checkTypeText(pending.checkType)} 안부 · ${pending.requestStatus === "REQUESTED" ? "재요청됨" : "미완료"}\n미완료 알림: ${formatDateTime(pending.createdAtMs)}${pending.requestedAtMs ? `\n재요청: ${formatDateTime(pending.requestedAtMs)}` : ""}`
      : "현재 미완료 안부가 없습니다.";

    appendHistory(activityReRequest, data.requestHistory,
      "안부 재요청 기록이 없습니다.", row => {
        const actor = row.requestedByType === "CARE_WORKER"
          ? "돌봄담당자" : row.requestedByType === "ORG_ADMIN"
            ? "기관 관리자" : `가족보호자${row.guardianRelation ? `(${row.guardianRelation})` : ""}`;
        return `${formatDateTime(row.requestedAtMs)} · ${checkTypeText(row.checkType)} 안부 · ${actor}${row.organizationName ? ` · ${row.organizationName}` : ""} · ${requestStatusText(row.status)}`;
      });

    const help = data.latestHelp;
    activityHelp.textContent = help
      ? `최근 기록: ${formatDateTime(help.createdAtMs)}\n상태: ${helpStatusText(help.status)}`
      : "현재 Firestore에 남아 있는 도움요청 기록이 없습니다.";

    const guardians = data.connections && data.connections.guardians || {};
    const seniors = data.connections && data.connections.seniors || {};
    const count = group => Number(group.family || 0) +
      Number(group.careWorkers || 0) + Number(group.other || 0);
    activityConnections.textContent = [
      `연결된 보호자/담당자: ${count(guardians)}명 (가족 ${guardians.family || 0}명 · 돌봄 ${guardians.careWorkers || 0}명)`,
      `연결된 대상자: ${count(seniors)}명 (가족 ${seniors.family || 0}명 · 돌봄 ${seniors.careWorkers || 0}명)`
    ].join("\n");
  }

  async function loadUserActivity(uid) {
    const sequence = ++activityLoadSequence;
    if (!uid) {
      activitySection.hidden = true;
      return;
    }
    activitySection.hidden = false;
    resetActivityUi();
    refreshActivityButton.disabled = true;
    try {
      // 기관 화면에서 이 파일을 재사용하면 소속 기관 ID를 전달합니다.
      // 실제 조회 범위는 서버가 기관 회원/대상자/담당자 문서를 대조합니다.
      const organizationId = new URLSearchParams(location.search).get("organizationId") || "";
      const callable = functions.httpsCallable("getManagedUserDetail");
      const result = await callable({seniorUid: uid, organizationId});
      if (sequence !== activityLoadSequence) return;
      renderManagedDetail(result.data || {});
      setActivityMessage("활동정보를 불러왔습니다.", "success");
    } catch (error) {
      if (sequence !== activityLoadSequence) return;
      console.error("이용자 상세 조회 실패", error);
      const denied = String(error && error.code || "").includes("permission-denied");
      const message = denied ? "이 이용자의 조회 권한이 없습니다." :
        "활동정보를 불러오지 못했습니다. 서버 기능 배포 상태를 확인해 주세요.";
      [activityCheckIn, activityPending, activityReRequest,
        activityHelp, activityConnections].forEach(element => {
          element.textContent = message;
        });
      setActivityMessage(message, "error");
    } finally {
      if (sequence === activityLoadSequence) refreshActivityButton.disabled = false;
    }
  }

  async function loadRecentUsers() {
    activityLoadSequence++;
    activitySection.hidden = true;
    currentSingleUser = null;
    showingSingleUser = false;
    refreshButton.textContent = "최근 이용자 다시 보기";
    refreshButton.disabled = true;
    searchButton.disabled = true;
    phoneSearchInput.value = "";

    setMessage("최근 이용자를 불러오는 중입니다.");
    listTitle.textContent = "최근 이용자";

    try {
      const snapshot = await db
        .collection("users")
        .orderBy("memberNo", "desc")
        .limit(RECENT_USER_LIMIT)
        .get();

      const items = snapshot.docs.map(document =>
        makeUserItem(document.id, document.data() || {})
      );

      renderUsers(items, "최근 이용자", { showActions: false });

      setMessage(
        items.length >= RECENT_USER_LIMIT
          ? `최근 이용자 ${items.length}명 · 최대 ${RECENT_USER_LIMIT}명 표시`
          : `최근 이용자 ${items.length}명을 불러왔습니다.`,
        "success"
      );
    } catch (error) {
      console.error("최근 이용자 조회 실패", error);
      renderUsers([], "최근 이용자", { showActions: false });

      let message = "최근 이용자 목록을 불러오지 못했습니다.";

      if (error && error.code === "permission-denied") {
        message =
          "이용자 목록 조회 권한이 없습니다. 관리자 권한과 Firestore Rules를 확인해 주세요.";
      }

      setMessage(message, "error");
    } finally {
      refreshButton.disabled = false;
      searchButton.disabled = false;
    }
  }

  async function findUserByPhone() {
    let phone;

    try {
      phone = normalizePhoneForSearch(phoneSearchInput.value);
    } catch (error) {
      setMessage(error.message, "error");
      phoneSearchInput.focus();
      return;
    }

    searchButton.disabled = true;
    refreshButton.disabled = true;
    setMessage("전화번호로 이용자를 조회하는 중입니다.");
    listTitle.textContent = "전화번호 조회 결과";

    try {
      const callable = functions.httpsCallable("adminFindUserByPhone");
      const result = await callable({ phone });

      const data = result && result.data ? result.data : {};
      const uid = String(data.uid || "").trim();
      const maskedPhone = String(data.maskedPhone || "").trim();

      if (!uid) {
        throw new Error("조회 결과에서 이용자 UID를 확인할 수 없습니다.");
      }

      let item;

      try {
        const userDocument = await db.collection("users").doc(uid).get();

        if (userDocument.exists) {
          item = makeUserItem(
            uid,
            userDocument.data() || {},
            maskedPhone
          );
        }
      } catch (documentError) {
        console.warn("이용자 기본정보 추가 조회 실패", documentError);
      }

      if (!item) {
        item = makeUserItem(
          uid,
          {
            memberNo: data.memberNo,
            memberId: data.memberId,
            mode: data.mode,
            modes: data.modes,
            disabled: data.disabled,
            status: data.status,
            createdAtMs: data.createdAtMs
          },
          maskedPhone
        );
      }

      renderUsers([item], "전화번호 조회 결과", { showActions: true });
      setMessage("전화번호 조회 결과 1명", "success");
      await loadUserActivity(item.uid);
    } catch (error) {
      console.error("전화번호 이용자 조회 실패", error);
      renderUsers([], "전화번호 조회 결과", { showActions: false });
      activitySection.hidden = true;

      let message = "일치하는 이용자를 찾지 못했습니다.";

      const code = String(error && error.code ? error.code : "");

      if (code.includes("permission-denied")) {
        message = "관리자 권한이 없어 전화번호를 조회할 수 없습니다.";
      } else if (code.includes("not-found")) {
        message = "일치하는 이용자를 찾지 못했습니다.";
      } else if (error && error.message) {
        message = `전화번호 조회 실패: ${error.message}`;
      }

      setMessage(message, "error");
    } finally {
      searchButton.disabled = false;
      refreshButton.disabled = false;
    }
  }

  async function verifyAdmin(user) {
    try {
      // 운영자 관리 내부 메뉴 이동입니다.
      // 이미 로그인 시 검증된 ID 토큰을 재사용하고 매번 강제 재발급하지 않습니다.
      const tokenResult = await user.getIdTokenResult();
      const isAdmin =
        tokenResult &&
        tokenResult.claims &&
        tokenResult.claims.admin === true;

      if (!isAdmin) {
        if (window.AdminSessionTimeout) {
          window.AdminSessionTimeout.clear();
        }
        await auth.signOut();
        window.location.replace("/operator/?auth=denied");
        return;
      }

      const hasAppSession =
        window.AdminSessionTimeout &&
        window.AdminSessionTimeout.hasValidSession &&
        window.AdminSessionTimeout.hasValidSession(user.uid);

      const cameFromInternalMenu =
        hasAppSession &&
        window.AdminSessionTimeout &&
        window.AdminSessionTimeout.consumeInternalNavigationTicket &&
        window.AdminSessionTimeout.consumeInternalNavigationTicket(user.uid);

      const isAllowedReload =
        hasAppSession &&
        window.AdminSessionTimeout &&
        window.AdminSessionTimeout.isReloadNavigation &&
        window.AdminSessionTimeout.isReloadNavigation();

      if (!cameFromInternalMenu && !isAllowedReload) {
        if (window.AdminSessionTimeout) {
          window.AdminSessionTimeout.clear();
        }
        await auth.signOut().catch(() => {});
        window.location.replace("/");
        return;
      }

      const sessionStarted = window.AdminSessionTimeout.start({
        auth,
        uid: user.uid
      });

      if (!sessionStarted) {
        await auth.signOut().catch(() => {});
        window.location.replace("/");
        return;
      }

      signedInInfo.textContent =
        `${maskAdminPhone(user.phoneNumber)} · 관리자 인증 완료 · 30분 자동 로그아웃`;

      checkingSection.hidden = true;
      usersSection.hidden = false;

      await loadRecentUsers();
    } catch (error) {
      console.error("관리자 권한 확인 실패", error);

      // 내부 페이지 이동 중 네트워크/토큰 조회가 일시적으로 실패했다고 해서
      // 기존 Firebase 로그인 세션을 즉시 폐기하지 않습니다.
      checkingSection.innerHTML =
        '<div class="message message-error">' +
        '관리자 권한을 확인하는 중 오류가 발생했습니다. ' +
        '<a href="/operator/">운영 현황으로 돌아가 다시 시도</a>' +
        '</div>';
    }
  }

  async function logout() {
    logoutButton.disabled = true;

    if (window.AdminSessionTimeout && window.AdminSessionTimeout.logoutToHome) {
      await window.AdminSessionTimeout.logoutToHome();
      return;
    }

    try {
      await auth.signOut();
    } catch (error) {
      console.error("로그아웃 실패", error);
    } finally {
      window.location.replace("/");
    }
  }

  async function initialize() {
    if (!window.firebase || !firebase.apps || firebase.apps.length === 0) {
      checkingSection.innerHTML =
        '<p class="message message-error">Firebase 초기화에 실패했습니다. Firebase Hosting 주소에서 접속해 주세요.</p>';
      return;
    }

    auth = firebase.auth();
    db = firebase.firestore();
    functions = firebase.app().functions(REGION);

    // Firebase 인증과 별도로 동일 탭의 운영자 웹 세션이 있어야 이 페이지를 사용할 수 있습니다.

    searchButton.addEventListener("click", findUserByPhone);
    refreshButton.addEventListener("click", loadRecentUsers);
    refreshActivityButton.addEventListener("click", () => {
      if (currentSingleUser && currentSingleUser.uid) {
        loadUserActivity(currentSingleUser.uid);
      }
    });
    logoutButton.addEventListener("click", logout);

    phoneSearchInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        findUserByPhone();
      }
    });

    auth.onAuthStateChanged(async user => {
      if (!user) {
        if (
          window.AdminSessionTimeout &&
          window.AdminSessionTimeout.isEnding &&
          window.AdminSessionTimeout.isEnding()
        ) {
          return;
        }

        if (window.AdminSessionTimeout) {
          window.AdminSessionTimeout.stop();
        }
        window.location.replace("/");
        return;
      }

      await verifyAdmin(user);
    });
  }

  window.addEventListener("DOMContentLoaded", initialize);
})();
