(() => {
  "use strict";

  const SESSION_KEY = "hellotoday_operator_session_v4";
  const NAV_TICKET_KEY = "hellotoday_operator_nav_ticket_v1";

  const SESSION_MS = 30 * 60 * 1000;
  const WARNING_MS = 5 * 60 * 1000;
  const NAV_TICKET_MS = 10 * 1000;
  const CHECK_INTERVAL_MS = 1000;

  let auth = null;
  let userUid = "";
  let timerId = null;
  let expiring = false;
  let modal = null;
  let countdown = null;

  function now() {
    return Date.now();
  }

  function randomToken() {
    if (window.crypto && window.crypto.getRandomValues) {
      const bytes = new Uint32Array(4);
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes, value => value.toString(16).padStart(8, "0")).join("");
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function readSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;

      const uid = String(parsed.uid || "");
      const token = String(parsed.token || "");
      const startedAt = Number(parsed.startedAt || 0);
      const expiresAt = Number(parsed.expiresAt || 0);

      if (!uid || !token || !Number.isFinite(startedAt) || !Number.isFinite(expiresAt)) {
        return null;
      }

      return { uid, token, startedAt, expiresAt };
    } catch (_) {
      return null;
    }
  }

  function writeSession(session) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      return true;
    } catch (_) {
      return false;
    }
  }

  function clearSessionRecord() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(NAV_TICKET_KEY);

      // 이전 시험 버전 잔여값 정리
      sessionStorage.removeItem("hellotoday_operator_session_v3");
      localStorage.removeItem("hellotoday_admin_session_v1");
      localStorage.removeItem("hellotoday_admin_session_v2");
    } catch (_) {
      // 무시
    }

    if (String(window.name || "").startsWith("hellotoday-operator:")) {
      window.name = "";
    }
  }

  function createSession(uid) {
    if (!uid) return null;

    const startedAt = now();
    const session = {
      uid: String(uid),
      token: randomToken(),
      startedAt,
      expiresAt: startedAt + SESSION_MS
    };

    return writeSession(session) ? session : null;
  }

  function begin(uid) {
    return Boolean(createSession(uid));
  }

  function hasValidSession(uid) {
    const session = readSession();
    return Boolean(
      session &&
      session.uid === String(uid || "") &&
      session.expiresAt > now()
    );
  }

  function issueInternalNavigationTicket(targetHref) {
    const session = readSession();
    if (!session || session.expiresAt <= now()) return false;

    try {
      const url = new URL(targetHref, window.location.href);

      if (
        url.origin !== window.location.origin ||
        !url.pathname.startsWith("/operator/")
      ) {
        return false;
      }

      const ticket = {
        uid: session.uid,
        sessionToken: session.token,
        targetPath: url.pathname,
        issuedAt: now(),
        nonce: randomToken()
      };

      sessionStorage.setItem(NAV_TICKET_KEY, JSON.stringify(ticket));
      return true;
    } catch (_) {
      return false;
    }
  }

  function consumeInternalNavigationTicket(uid) {
    let raw = null;

    try {
      raw = sessionStorage.getItem(NAV_TICKET_KEY);
      sessionStorage.removeItem(NAV_TICKET_KEY);
    } catch (_) {
      return false;
    }

    if (!raw) return false;

    try {
      const ticket = JSON.parse(raw);
      const session = readSession();

      if (!ticket || !session) return false;
      if (session.expiresAt <= now()) return false;
      if (session.uid !== String(uid || "")) return false;
      if (ticket.uid !== session.uid) return false;
      if (ticket.sessionToken !== session.token) return false;
      if (ticket.targetPath !== window.location.pathname) return false;

      const age = now() - Number(ticket.issuedAt || 0);
      if (age < 0 || age > NAV_TICKET_MS) return false;

      return true;
    } catch (_) {
      return false;
    }
  }

  function isReloadNavigation() {
    try {
      const entry = performance.getEntriesByType("navigation")[0];
      return Boolean(entry && entry.type === "reload");
    } catch (_) {
      return false;
    }
  }

  function ensureModal() {
    if (modal) return;

    modal = document.createElement("div");
    modal.className = "admin-session-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="admin-session-dialog" role="dialog" aria-modal="true" aria-labelledby="adminSessionTitle">
        <p class="admin-session-kicker">SECURITY</p>
        <h2 id="adminSessionTitle">운영자 로그인 시간이 곧 만료됩니다.</h2>
        <p class="admin-session-text">
          보안을 위해 로그인 후 30분이 지나면 자동으로 로그아웃됩니다.<br>
          계속 사용하시려면 로그인 시간을 연장해 주세요.
        </p>
        <p class="admin-session-countdown">
          자동 로그아웃까지 <strong id="adminSessionCountdown">05:00</strong>
        </p>
        <div class="admin-session-actions">
          <button id="adminSessionExtend" class="button button-primary" type="button">로그인 연장</button>
          <button id="adminSessionLogout" class="button button-outline" type="button">지금 로그아웃</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    countdown = modal.querySelector("#adminSessionCountdown");

    modal.querySelector("#adminSessionExtend").addEventListener("click", extend);
    modal.querySelector("#adminSessionLogout").addEventListener("click", logoutToHome);
  }

  function showModal() {
    ensureModal();
    modal.hidden = false;
  }

  function hideModal() {
    if (modal) modal.hidden = true;
  }

  function formatRemaining(ms) {
    const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function stopTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function stop() {
    stopTimer();
    hideModal();
    auth = null;
    userUid = "";
  }

  function clear() {
    stop();
    clearSessionRecord();
  }

  async function finishLogout() {
    if (expiring) return;
    expiring = true;

    stopTimer();
    hideModal();
    clearSessionRecord();

    try {
      if (auth && auth.currentUser) {
        await auth.signOut();
      }
    } catch (error) {
      console.error("운영자 로그아웃 실패", error);
    } finally {
      window.location.replace("/");
    }
  }

  async function logoutToHome() {
    await finishLogout();
  }

  function checkNow() {
    if (!userUid) return;

    const session = readSession();

    if (!session || session.uid !== userUid) {
      finishLogout();
      return;
    }

    const remaining = session.expiresAt - now();

    if (remaining <= 0) {
      finishLogout();
      return;
    }

    if (remaining <= WARNING_MS) {
      showModal();
      if (countdown) countdown.textContent = formatRemaining(remaining);
    } else {
      hideModal();
    }
  }

  function extend() {
    if (!userUid) return;
    createSession(userUid);
    hideModal();
    checkNow();
  }

  function start(options = {}) {
    auth = options.auth || null;
    userUid = String(options.uid || "");
    expiring = false;

    if (!auth || !userUid || !hasValidSession(userUid)) {
      return false;
    }

    ensureModal();
    stopTimer();
    checkNow();
    timerId = window.setInterval(checkNow, CHECK_INTERVAL_MS);
    return true;
  }

  function isEnding() {
    return expiring === true;
  }

  // 실제 내부 링크 클릭 순간에만 10초짜리 1회용 이동 티켓을 발급합니다.
  document.addEventListener(
    "click",
    event => {
      const anchor = event.target.closest("a[href]");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      let url;
      try {
        url = new URL(href, window.location.href);
      } catch (_) {
        return;
      }

      const isOperatorInternal =
        url.origin === window.location.origin &&
        url.pathname.startsWith("/operator/");

      const isHomeExit =
        url.origin === window.location.origin &&
        (url.pathname === "/" || anchor.dataset.operatorHomeExit === "true");

      if (isHomeExit) {
        event.preventDefault();
        logoutToHome();
        return;
      }

      if (isOperatorInternal) {
        issueInternalNavigationTicket(url.href);
      }
    },
    true
  );

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && userUid) {
      checkNow();
    }
  });

  window.addEventListener("focus", () => {
    if (userUid) {
      checkNow();
    }
  });

  window.AdminSessionTimeout = {
    begin,
    start,
    extend,
    stop,
    clear,
    hasValidSession,
    issueInternalNavigationTicket,
    consumeInternalNavigationTicket,
    isReloadNavigation,
    logoutToHome,
    isEnding
  };
})();
