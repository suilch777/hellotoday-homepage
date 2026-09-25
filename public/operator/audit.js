(() => {
  "use strict";

  const MAX_QUERY = 200;
  const MAX_VISIBLE = 100;

  const VISIBLE_ACTIONS = new Set([
    "NOTICE_CREATED",
    "NOTICE_UPDATED",
    "NOTICE_HIDDEN",
    "NOTICE_SHOWN",
    "USER_SUSPENDED",
    "USER_RESTORED"
  ]);

  const checkingSection = document.getElementById("checkingSection");
  const auditSection = document.getElementById("auditSection");
  const signedInInfo = document.getElementById("signedInInfo");
  const refreshButton = document.getElementById("refreshButton");
  const logoutButton = document.getElementById("logoutButton");
  const pageMessage = document.getElementById("pageMessage");
  const totalCountBadge = document.getElementById("totalCountBadge");
  const noticeCountBadge = document.getElementById("noticeCountBadge");
  const userCountBadge = document.getElementById("userCountBadge");
  const auditTableBody = document.getElementById("auditTableBody");
  const auditCardList = document.getElementById("auditCardList");
  const emptyState = document.getElementById("emptyState");

  let auth;
  let db;

  function setMessage(text, type = "") {
    pageMessage.textContent = text || "";
    pageMessage.className = "message";
    if (type) pageMessage.classList.add("message-" + type);
  }

  function maskAdminPhone(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (digits.length < 4) return "인증된 관리자";
    return "***-****-" + digits.slice(-4);
  }

  function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return 0;
  }

  function formatDateTime(value) {
    const ms = toMillis(value);
    if (!ms) return "기록 없음";

    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "Asia/Seoul"
    }).format(new Date(ms));
  }

  function shortId(value) {
    const text = String(value || "").trim();
    if (!text) return "확인 불가";
    return text.length <= 8 ? text : "…" + text.slice(-8);
  }

  function actionInfo(action) {
    const map = {
      NOTICE_CREATED: {kind: "공지", label: "공지 등록"},
      NOTICE_UPDATED: {kind: "공지", label: "공지 수정"},
      NOTICE_HIDDEN: {kind: "공지", label: "공지 숨김"},
      NOTICE_SHOWN: {kind: "공지", label: "공지 재공개"},
      USER_SUSPENDED: {kind: "이용자", label: "이용자 정지"},
      USER_RESTORED: {kind: "이용자", label: "이용자 정지 해제"}
    };
    return map[action] || {kind: "기타", label: action || "알 수 없음"};
  }

  function makeItem(document) {
    const data = document.data() || {};
    const action = String(data.action || "").trim();
    const info = actionInfo(action);
    const metadata = data.metadata && typeof data.metadata === "object"
      ? data.metadata
      : {};

    let target = "대상 확인 불가";
    if (info.kind === "공지") {
      const title = String(metadata.title || "").trim();
      const noticeId = String(data.targetId || "").trim();
      target = title || ("공지 " + shortId(noticeId));
    } else if (info.kind === "이용자") {
      const parts = [];
      const memberNo = String(metadata.memberNo || "").trim();
      const maskedPhone = String(metadata.maskedPhone || "").trim();

      if (memberNo) {
        parts.push("회원번호 " + memberNo);
      }

      if (maskedPhone) {
        parts.push(maskedPhone);
      }

      target = parts.length > 0
        ? parts.join(" · ")
        : "이용자 " + shortId(data.targetUid || data.targetId);
    }

    const actorMaskedPhone =
      String(metadata.actorMaskedPhone || "").trim();

    return {
      id: document.id,
      action,
      kind: info.kind,
      label: info.label,
      target,
      actor: actorMaskedPhone
        ? "운영자 " + actorMaskedPhone
        : "운영자 " + shortId(data.adminUid || data.actorUid),
      createdAt: data.createdAt || null
    };
  }

  function createCell(text, className = "") {
    const cell = document.createElement("td");
    cell.textContent = text;
    if (className) cell.className = className;
    return cell;
  }

  function render(items) {
    auditTableBody.replaceChildren();
    auditCardList.replaceChildren();

    const noticeCount = items.filter(item => item.kind === "공지").length;
    const userCount = items.filter(item => item.kind === "이용자").length;

    totalCountBadge.textContent = "전체 " + items.length;
    noticeCountBadge.textContent = "공지 " + noticeCount;
    userCountBadge.textContent = "이용자 " + userCount;
    emptyState.hidden = items.length !== 0;

    for (const item of items) {
      const row = document.createElement("tr");
      row.append(
        createCell(formatDateTime(item.createdAt)),
        createCell(item.kind, "audit-kind"),
        createCell(item.label, "audit-action"),
        createCell(item.target, "audit-target"),
        createCell(item.actor)
      );
      auditTableBody.appendChild(row);

      const card = document.createElement("article");
      card.className = "audit-card";

      const top = document.createElement("div");
      top.className = "audit-card-top";

      const title = document.createElement("h3");
      title.className = "audit-card-title";
      title.textContent = item.label;

      const time = document.createElement("span");
      time.className = "audit-card-time";
      time.textContent = formatDateTime(item.createdAt);

      top.append(title, time);

      const lines = document.createElement("div");
      lines.className = "audit-card-lines";

      const kind = document.createElement("p");
      kind.textContent = "구분: " + item.kind;
      const target = document.createElement("p");
      target.textContent = "대상: " + item.target;
      const actor = document.createElement("p");
      actor.textContent = item.actor;

      lines.append(kind, target, actor);
      card.append(top, lines);
      auditCardList.appendChild(card);
    }
  }

  async function loadAuditLogs() {
    refreshButton.disabled = true;
    setMessage("운영 기록을 불러오는 중입니다.");

    try {
      const snapshot = await db
        .collection("admin_audit_logs")
        .orderBy("createdAt", "desc")
        .limit(MAX_QUERY)
        .get();

      const items = snapshot.docs
        .map(makeItem)
        .filter(item => VISIBLE_ACTIONS.has(item.action))
        .slice(0, MAX_VISIBLE);

      render(items);

      setMessage(
        items.length > 0
          ? "운영 기록 " + items.length + "건을 불러왔습니다."
          : "아직 표시할 운영 기록이 없습니다.",
        "success"
      );
    } catch (error) {
      console.error("운영 기록 조회 실패", error);
      render([]);

      let message = "운영 기록을 불러오지 못했습니다.";
      if (error && error.code === "permission-denied") {
        message = "운영 기록 조회 권한이 없습니다. admin Custom Claim과 Firestore Rules를 확인해 주세요.";
      } else if (error && error.message) {
        message = "운영 기록 조회 실패: " + error.message;
      }

      setMessage(message, "error");
    } finally {
      refreshButton.disabled = false;
    }
  }

  async function verifyAdmin(user) {
    try {
      const tokenResult = await user.getIdTokenResult();
      const isAdmin = tokenResult &&
        tokenResult.claims &&
        tokenResult.claims.admin === true;

      if (!isAdmin) {
        if (window.AdminSessionTimeout) window.AdminSessionTimeout.clear();
        await auth.signOut();
        window.location.replace("/operator/?auth=denied");
        return;
      }

      const hasAppSession = window.AdminSessionTimeout &&
        window.AdminSessionTimeout.hasValidSession &&
        window.AdminSessionTimeout.hasValidSession(user.uid);

      const cameFromInternalMenu = hasAppSession &&
        window.AdminSessionTimeout &&
        window.AdminSessionTimeout.consumeInternalNavigationTicket &&
        window.AdminSessionTimeout.consumeInternalNavigationTicket(user.uid);

      const isAllowedReload = hasAppSession &&
        window.AdminSessionTimeout &&
        window.AdminSessionTimeout.isReloadNavigation &&
        window.AdminSessionTimeout.isReloadNavigation();

      if (!cameFromInternalMenu && !isAllowedReload) {
        if (window.AdminSessionTimeout) window.AdminSessionTimeout.clear();
        await auth.signOut().catch(() => {});
        window.location.replace("/");
        return;
      }

      const sessionStarted = window.AdminSessionTimeout &&
        window.AdminSessionTimeout.start({auth, uid: user.uid});

      if (!sessionStarted) {
        await auth.signOut().catch(() => {});
        window.location.replace("/");
        return;
      }

      signedInInfo.textContent =
        maskAdminPhone(user.phoneNumber) +
        " · 관리자 인증 완료 · 30분 자동 로그아웃";

      checkingSection.hidden = true;
      auditSection.hidden = false;
      await loadAuditLogs();
    } catch (error) {
      console.error("관리자 권한 확인 실패", error);
      checkingSection.innerHTML =
        '<div class="message message-error">' +
        '관리자 권한을 확인하는 중 오류가 발생했습니다. ' +
        '<a href="/operator/">운영 현황으로 돌아가 다시 시도</a>' +
        "</div>";
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

    refreshButton.addEventListener("click", loadAuditLogs);
    logoutButton.addEventListener("click", logout);

    auth.onAuthStateChanged(async user => {
      if (!user) {
        if (window.AdminSessionTimeout &&
            window.AdminSessionTimeout.isEnding &&
            window.AdminSessionTimeout.isEnding()) {
          return;
        }

        if (window.AdminSessionTimeout) window.AdminSessionTimeout.stop();
        window.location.replace("/");
        return;
      }

      await verifyAdmin(user);
    });
  }

  window.addEventListener("DOMContentLoaded", initialize);
})();
