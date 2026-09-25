(() => {
  "use strict";

  const loginSection = document.getElementById("loginSection");
  const checkingSection = document.getElementById("checkingSection");
  const dashboardSection = document.getElementById("dashboardSection");
  const phoneInput = document.getElementById("phoneInput");
  const codeInput = document.getElementById("codeInput");
  const sendCodeButton = document.getElementById("sendCodeButton");
  const verifyCodeButton = document.getElementById("verifyCodeButton");
  const resendCodeButton = document.getElementById("resendCodeButton");
  const verificationArea = document.getElementById("verificationArea");
  const authMessage = document.getElementById("authMessage");
  const dashboardMessage = document.getElementById("dashboardMessage");
  const loginStateBadge = document.getElementById("loginStateBadge");
  const signedInInfo = document.getElementById("signedInInfo");
  const refreshStatsButton = document.getElementById("refreshStatsButton");
  const logoutButton = document.getElementById("logoutButton");
  const statTotal = document.getElementById("statTotal");
  const statSenior = document.getElementById("statSenior");
  const statGuardian = document.getElementById("statGuardian");
  const statCareWorker = document.getElementById("statCareWorker");
  const statSuspended = document.getElementById("statSuspended");

  let auth;
  let db;
  let confirmationResult = null;
  let recaptchaVerifier = null;
  let recaptchaWidgetId = null;
  let freshLoginInProgress = false;
  let freshLoginCompletedThisPage = false;

  function setMessage(element, text, type = "") {
    element.textContent = text || "";
    element.className = "message";
    if (type) element.classList.add(`message-${type}`);
  }

  function showOnly(section) {
    loginSection.hidden = section !== "login";
    checkingSection.hidden = section !== "checking";
    dashboardSection.hidden = section !== "dashboard";
  }

  function normalizeKoreanPhone(raw) {
    const input = String(raw || "").trim();
    if (!input) throw new Error("전화번호를 입력해 주세요.");

    const compact = input.replace(/[^\d+]/g, "");
    if (/^\+82\d{9,10}$/.test(compact)) return compact;

    const digits = compact.replace(/\D/g, "");
    if (/^01\d{8,9}$/.test(digits)) return `+82${digits.substring(1)}`;
    if (/^82\d{9,10}$/.test(digits)) return `+${digits}`;

    throw new Error("010으로 시작하는 휴대전화번호를 정확히 입력해 주세요.");
  }

  function maskPhone(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (digits.length < 8) return "인증된 전화번호";
    return `***-****-${digits.slice(-4)}`;
  }

  function resetRecaptcha() {
    if (recaptchaWidgetId !== null && window.grecaptcha && typeof window.grecaptcha.reset === "function") {
      window.grecaptcha.reset(recaptchaWidgetId);
    }
  }

  async function ensureRecaptcha() {
    if (recaptchaVerifier) return recaptchaVerifier;

    recaptchaVerifier = new firebase.auth.RecaptchaVerifier("recaptcha-container", {
      size: "normal",
      callback: () => setMessage(authMessage, "보안 확인이 완료되었습니다.", "success"),
      "expired-callback": () => setMessage(authMessage, "보안 확인 시간이 만료되었습니다. 다시 확인해 주세요.", "warning")
    });

    recaptchaWidgetId = await recaptchaVerifier.render();
    return recaptchaVerifier;
  }

  async function sendVerificationCode() {
    let phoneNumber;
    try {
      phoneNumber = normalizeKoreanPhone(phoneInput.value);
    } catch (error) {
      setMessage(authMessage, error.message, "error");
      phoneInput.focus();
      return;
    }

    sendCodeButton.disabled = true;
    sendCodeButton.textContent = "인증번호 보내는 중…";
    setMessage(authMessage, "");

    try {
      const verifier = await ensureRecaptcha();
      confirmationResult = await auth.signInWithPhoneNumber(phoneNumber, verifier);
      verificationArea.hidden = false;
      codeInput.value = "";
      codeInput.focus();
      setMessage(authMessage, "인증번호를 전송했습니다. 휴대폰에 도착한 6자리 번호를 입력해 주세요.", "success");
    } catch (error) {
      console.error("SMS 인증번호 전송 실패", error);
      resetRecaptcha();

      let message = "인증번호를 보내지 못했습니다.";
      if (error && error.code === "auth/too-many-requests") message = "인증 요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.";
      else if (error && error.code === "auth/invalid-phone-number") message = "전화번호 형식을 확인해 주세요.";
      else if (error && error.code === "auth/captcha-check-failed") message = "보안 확인에 실패했습니다. 다시 시도해 주세요.";
      else if (error && error.code === "auth/operation-not-allowed") message = "Firebase Authentication에서 전화번호 로그인이 활성화되어 있는지 확인해 주세요.";
      else if (error && error.message) message += ` (${error.message})`;

      setMessage(authMessage, message, "error");
    } finally {
      sendCodeButton.disabled = false;
      sendCodeButton.textContent = "인증번호 받기";
    }
  }

  async function verifyCode() {
    const code = String(codeInput.value || "").replace(/\D/g, "");
    if (!confirmationResult) {
      setMessage(authMessage, "먼저 인증번호 받기를 눌러 주세요.", "warning");
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setMessage(authMessage, "6자리 인증번호를 입력해 주세요.", "error");
      codeInput.focus();
      return;
    }

    verifyCodeButton.disabled = true;
    verifyCodeButton.textContent = "확인 중…";
    setMessage(authMessage, "인증번호를 확인하고 있습니다.");

    try {
      freshLoginInProgress = true;

      const credential = await confirmationResult.confirm(code);

      if (credential && credential.user && window.AdminSessionTimeout) {
        window.AdminSessionTimeout.begin(credential.user.uid);
        freshLoginCompletedThisPage = true;
      }

      freshLoginInProgress = false;
    } catch (error) {
      freshLoginInProgress = false;
      console.error("인증번호 확인 실패", error);
      let message = "인증번호가 올바르지 않거나 만료되었습니다.";
      if (error && error.code === "auth/code-expired") message = "인증번호가 만료되었습니다. 다시 받아 주세요.";
      else if (error && error.code === "auth/invalid-verification-code") message = "인증번호가 올바르지 않습니다.";
      setMessage(authMessage, message, "error");
    } finally {
      verifyCodeButton.disabled = false;
      verifyCodeButton.textContent = "로그인";
    }
  }

  async function verifyAdmin(user) {
    showOnly("checking");

    try {
      // 같은 운영자 세션 안에서는 현재 ID 토큰을 우선 사용합니다.
      // admin claim이 보이지 않을 때만 한 번 강제 갱신합니다.
      let tokenResult = await user.getIdTokenResult();
      let isAdmin =
        tokenResult &&
        tokenResult.claims &&
        tokenResult.claims.admin === true;

      if (!isAdmin) {
        tokenResult = await user.getIdTokenResult(true);
        isAdmin =
          tokenResult &&
          tokenResult.claims &&
          tokenResult.claims.admin === true;
      }

      if (!isAdmin) {
        if (window.AdminSessionTimeout) {
          window.AdminSessionTimeout.clear();
        }
        await auth.signOut();
        showOnly("login");
        loginStateBadge.textContent = "권한 없음";
        loginStateBadge.className = "badge badge-danger";
        setMessage(authMessage, "전화번호 인증은 완료되었지만 운영자 권한이 등록된 계정이 아닙니다.", "error");
        return;
      }

      // Firebase 인증과 별도로 운영자 웹 세션이 있어야 화면을 엽니다.
      // SMS 인증이 진행 중이면 auth observer가 먼저 도착할 수 있으므로 그 경우만 세션을 생성합니다.
      if (
        freshLoginInProgress &&
        window.AdminSessionTimeout &&
        !window.AdminSessionTimeout.hasValidSession(user.uid)
      ) {
        window.AdminSessionTimeout.begin(user.uid);
        freshLoginCompletedThisPage = true;
      }

      const sessionStarted = window.AdminSessionTimeout
        ? window.AdminSessionTimeout.start({
            auth,
            uid: user.uid
          })
        : false;

      if (!sessionStarted) {
        await auth.signOut().catch(() => {});
        showOnly("login");
        loginStateBadge.textContent = "로그인 필요";
        loginStateBadge.className = "badge badge-muted";
        setMessage(
          authMessage,
          "운영자 웹 세션이 종료되었습니다. 전화번호 인증으로 다시 로그인해 주세요.",
          "warning"
        );
        return;
      }

      confirmationResult = null;
      loginStateBadge.textContent = "관리자 인증";
      loginStateBadge.className = "badge badge-live";
      signedInInfo.textContent = `${maskPhone(user.phoneNumber)} · 관리자 인증 완료 · 30분 자동 로그아웃`;
      showOnly("dashboard");
      await loadStats();
    } catch (error) {
      console.error("관리자 권한 확인 실패", error);
      await auth.signOut().catch(() => {});
      showOnly("login");
      setMessage(authMessage, "운영자 권한을 확인하지 못했습니다. 다시 로그인해 주세요.", "error");
    }
  }

  function hasMode(data, targetMode) {
    const currentMode = String(data.mode || "").toUpperCase();
    const modes = Array.isArray(data.modes)
      ? data.modes.map(value => String(value || "").toUpperCase())
      : [];
    return currentMode === targetMode || modes.includes(targetMode);
  }

  async function loadStats() {
    refreshStatsButton.disabled = true;
    setMessage(dashboardMessage, "운영 현황을 불러오는 중입니다.");

    statTotal.textContent = "-";
    statSenior.textContent = "-";
    statGuardian.textContent = "-";
    statCareWorker.textContent = "-";
    statSuspended.textContent = "-";

    try {
      const snapshot = await db.collection("users").get();
      let seniors = 0, guardians = 0, careWorkers = 0, suspended = 0;

      snapshot.forEach(document => {
        const data = document.data() || {};
        if (hasMode(data, "SENIOR")) seniors += 1;
        if (hasMode(data, "GUARDIAN")) guardians += 1;
        if (hasMode(data, "CARE_WORKER")) careWorkers += 1;

        const disabled = data.disabled === true;
        const status = String(data.status || "").toUpperCase();
        if (disabled || status === "SUSPENDED") suspended += 1;
      });

      statTotal.textContent = String(snapshot.size);
      statSenior.textContent = String(seniors);
      statGuardian.textContent = String(guardians);
      statCareWorker.textContent = String(careWorkers);
      statSuspended.textContent = String(suspended);

      const now = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date());
      setMessage(dashboardMessage, `운영 현황을 갱신했습니다. · ${now}`, "success");
    } catch (error) {
      console.error("운영 현황 조회 실패", error);
      let message = "운영 현황을 불러오지 못했습니다.";
      if (error && error.code === "permission-denied") {
        message = "Firestore 접근 권한이 없습니다. admin Custom Claim과 Firestore Rules를 확인해 주세요.";
      }
      setMessage(dashboardMessage, message, "error");
    } finally {
      refreshStatsButton.disabled = false;
    }
  }

  async function logout() {
    logoutButton.disabled = true;

    if (window.AdminSessionTimeout && window.AdminSessionTimeout.logoutToHome) {
      await window.AdminSessionTimeout.logoutToHome();
      return;
    }

    // 공통 세션 모듈을 사용할 수 없는 예외 상황에서도 홈페이지로 이동합니다.
    try {
      await auth.signOut();
    } catch (error) {
      console.error("로그아웃 실패", error);
    } finally {
      window.location.replace("/");
    }
  }

  function setupPlannedMenuButtons() {
    document.querySelectorAll("[data-planned]").forEach(button => {
      button.addEventListener("click", () => {
        const label = button.querySelector("span")?.textContent || "이 메뉴";
        setMessage(dashboardMessage, `${label}는 운영자 로그인과 현황 조회 확인 후 다음 단계에서 연결합니다.`, "warning");
      });
    });

    document.querySelector('[data-section="overview"]')?.addEventListener("click", loadStats);

    document.querySelector('[data-section="users"]')?.addEventListener("click", () => {
      if (
        window.AdminSessionTimeout &&
        window.AdminSessionTimeout.issueInternalNavigationTicket
      ) {
        window.AdminSessionTimeout.issueInternalNavigationTicket(
          "/operator/users.html"
        );
      }
      window.location.href = "/operator/users.html";
    });
  }

  async function initialize() {
    if (!window.firebase || !firebase.apps || firebase.apps.length === 0) {
      setMessage(authMessage, "Firebase 초기화에 실패했습니다. Firebase Hosting 주소에서 접속해 주세요.", "error");
      sendCodeButton.disabled = true;
      return;
    }

    auth = firebase.auth();
    db = firebase.firestore();

    // Firebase Auth는 SESSION으로 유지하지만, 실제 운영자 화면 접근은 별도의 운영자 웹 세션으로 제어합니다.
    await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
    auth.useDeviceLanguage();

    sendCodeButton.addEventListener("click", sendVerificationCode);
    resendCodeButton.addEventListener("click", sendVerificationCode);
    verifyCodeButton.addEventListener("click", verifyCode);
    refreshStatsButton.addEventListener("click", loadStats);
    logoutButton.addEventListener("click", logout);

    phoneInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        sendVerificationCode();
      }
    });

    codeInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        verifyCode();
      }
    });

    setupPlannedMenuButtons();
    await ensureRecaptcha();

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
        showOnly("login");

        const params = new URLSearchParams(window.location.search);
        if (params.get("timeout") === "1") {
          setMessage(
            authMessage,
            "보안을 위해 30분 운영자 세션이 만료되어 자동 로그아웃되었습니다. 다시 로그인해 주세요.",
            "warning"
          );
          window.history.replaceState({}, document.title, window.location.pathname);
        }
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

      const canReuseExistingSession =
        cameFromInternalMenu || isAllowedReload;

      if (
        !freshLoginInProgress &&
        !freshLoginCompletedThisPage &&
        !canReuseExistingSession
      ) {
        if (window.AdminSessionTimeout) {
          window.AdminSessionTimeout.clear();
        }

        // Firebase 자체 인증이 브라우저에 남아 있어도 여기서 명시적으로 끊습니다.
        await auth.signOut().catch(() => {});

        showOnly("login");
        loginStateBadge.textContent = "로그인 필요";
        loginStateBadge.className = "badge badge-muted";
        setMessage(
          authMessage,
          "보안을 위해 운영자 관리에 새로 들어올 때는 전화번호 인증을 다시 해야 합니다.",
          "warning"
        );
        return;
      }

      await verifyAdmin(user);
    });
  }

  window.addEventListener("DOMContentLoaded", initialize);
})();
