(() => {
  "use strict";

  const MAX_NOTICES = 200;
  const REGION = "asia-northeast3";

  const checkingSection = document.getElementById("checkingSection");
  const noticesSection = document.getElementById("noticesSection");
  const signedInInfo = document.getElementById("signedInInfo");
  const refreshButton = document.getElementById("refreshButton");
  const logoutButton = document.getElementById("logoutButton");
  const newNoticeButton = document.getElementById("newNoticeButton");
  const pageMessage = document.getElementById("pageMessage");
  const noticeList = document.getElementById("noticeList");
  const emptyState = document.getElementById("emptyState");
  const totalCountBadge = document.getElementById("totalCountBadge");
  const publicCountBadge = document.getElementById("publicCountBadge");
  const importantCountBadge = document.getElementById("importantCountBadge");

  const editorModal = document.getElementById("editorModal");
  const editorTitle = document.getElementById("editorTitle");
  const noticeForm = document.getElementById("noticeForm");
  const noticeTitleInput = document.getElementById("noticeTitleInput");
  const noticeContentInput = document.getElementById("noticeContentInput");
  const noticeImportantInput = document.getElementById("noticeImportantInput");
  const noticeActiveInput = document.getElementById("noticeActiveInput");
  const editorMessage = document.getElementById("editorMessage");
  const cancelEditButton = document.getElementById("cancelEditButton");
  const saveNoticeButton = document.getElementById("saveNoticeButton");

  let auth;
  let db;
  let functions;
  let currentEditId = "";

  function setMessage(element, text, type = "") {
    element.textContent = text || "";
    element.className = "message";
    if (type) element.classList.add("message-" + type);
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
      hour12: false,
      timeZone: "Asia/Seoul"
    }).format(new Date(ms));
  }

  function makeNoticeItem(document) {
    const data = document.data() || {};
    const activeValue = data.active;

    return {
      id: document.id,
      title: String(data.title || "").trim(),
      content: String(data.content || data.message || "").trim(),
      active: activeValue === undefined ? true : activeValue === true,
      important: data.important === true,
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null,
      createdBy: String(data.createdBy || "").trim()
    };
  }

  function noticeSortValue(item) {
    return Math.max(toMillis(item.updatedAt), toMillis(item.createdAt));
  }

  function createBadge(text, className) {
    const badge = document.createElement("span");
    badge.className = "notice-badge " + className;
    badge.textContent = text;
    return badge;
  }

  function createActionButton(text, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "notice-action " + className;
    button.textContent = text;
    button.addEventListener("click", handler);
    return button;
  }

  function renderNotices(items) {
    noticeList.replaceChildren();

    const publicCount = items.filter(item => item.active).length;
    const importantCount = items.filter(item => item.important).length;

    totalCountBadge.textContent = "전체 " + items.length;
    publicCountBadge.textContent = "공개 " + publicCount;
    importantCountBadge.textContent = "중요 " + importantCount;
    emptyState.hidden = items.length !== 0;

    for (const item of items) {
      const card = document.createElement("article");
      card.className = "notice-card";
      if (!item.active) card.classList.add("notice-card-hidden");
      if (item.important) card.classList.add("notice-card-important");

      const head = document.createElement("div");
      head.className = "notice-card-head";

      const titleWrap = document.createElement("div");
      titleWrap.className = "notice-card-title-wrap";

      const badges = document.createElement("div");
      badges.className = "notice-badges";
      badges.appendChild(createBadge(
        item.active ? "공개" : "숨김",
        item.active ? "notice-badge-public" : "notice-badge-hidden"
      ));
      if (item.important) {
        badges.appendChild(createBadge("중요", "notice-badge-important"));
      }

      const title = document.createElement("h3");
      title.className = "notice-card-title";
      title.textContent = item.title || "제목 없음";

      const meta = document.createElement("p");
      meta.className = "notice-card-meta";
      const created = formatDateTime(item.createdAt);
      const updatedMs = toMillis(item.updatedAt);
      const createdMs = toMillis(item.createdAt);
      const updatedText = updatedMs && updatedMs !== createdMs
        ? " · 수정 " + formatDateTime(item.updatedAt)
        : "";
      meta.textContent = "작성 " + created + updatedText;

      titleWrap.append(badges, title, meta);
      head.appendChild(titleWrap);

      const content = document.createElement("p");
      content.className = "notice-content";
      content.textContent = item.content || "내용 없음";

      const actions = document.createElement("div");
      actions.className = "notice-card-actions";
      actions.appendChild(createActionButton(
        "수정",
        "notice-action-edit",
        () => openEditor(item)
      ));
      actions.appendChild(createActionButton(
        item.active ? "숨김" : "다시 공개",
        item.active ? "notice-action-visibility" : "notice-action-show",
        event => changeVisibility(item, !item.active, event.currentTarget)
      ));

      card.append(head, content, actions);
      noticeList.appendChild(card);
    }
  }


  async function recordNoticeAudit(action, noticeId) {
    if (!functions || !noticeId) return false;

    try {
      const callable = functions.httpsCallable("adminRecordNoticeAudit");
      await callable({
        action: String(action || ""),
        noticeId: String(noticeId || "")
      });
      return true;
    } catch (error) {
      console.error("공지사항 운영기록 저장 실패", error);
      return false;
    }
  }

  async function loadNotices() {
    refreshButton.disabled = true;
    newNoticeButton.disabled = true;
    setMessage(pageMessage, "공지사항을 불러오는 중입니다.");

    try {
      const snapshot = await db.collection("notices").limit(MAX_NOTICES).get();
      const items = snapshot.docs
        .map(makeNoticeItem)
        .sort((a, b) => noticeSortValue(b) - noticeSortValue(a));

      renderNotices(items);

      const suffix = items.length >= MAX_NOTICES
        ? " · 최근 " + MAX_NOTICES + "건까지 표시"
        : "";
      setMessage(
        pageMessage,
        "공지사항 " + items.length + "건을 불러왔습니다." + suffix,
        "success"
      );
    } catch (error) {
      console.error("공지사항 조회 실패", error);
      renderNotices([]);

      let message = "공지사항을 불러오지 못했습니다.";
      if (error && error.code === "permission-denied") {
        message = "공지사항 조회 권한이 없습니다. admin Custom Claim과 Firestore Rules를 확인해 주세요.";
      } else if (error && error.message) {
        message = "공지사항 조회 실패: " + error.message;
      }
      setMessage(pageMessage, message, "error");
    } finally {
      refreshButton.disabled = false;
      newNoticeButton.disabled = false;
    }
  }

  function openEditor(item) {
    currentEditId = item && item.id ? item.id : "";
    editorTitle.textContent = currentEditId ? "공지사항 수정" : "새 공지 작성";
    saveNoticeButton.textContent = currentEditId ? "저장" : "등록";
    noticeTitleInput.value = item ? item.title : "";
    noticeContentInput.value = item ? item.content : "";
    noticeImportantInput.checked = item ? item.important === true : false;
    noticeActiveInput.checked = item ? item.active === true : true;
    setMessage(editorMessage, "");
    editorModal.hidden = false;
    window.setTimeout(() => noticeTitleInput.focus(), 0);
  }

  function closeEditor() {
    if (saveNoticeButton.disabled) return;
    currentEditId = "";
    noticeForm.reset();
    noticeActiveInput.checked = true;
    setMessage(editorMessage, "");
    editorModal.hidden = true;
  }

  async function saveNotice(event) {
    event.preventDefault();

    const title = noticeTitleInput.value.trim();
    const content = noticeContentInput.value.trim();

    if (!title) {
      setMessage(editorMessage, "공지 제목을 입력해 주세요.", "error");
      noticeTitleInput.focus();
      return;
    }
    if (!content) {
      setMessage(editorMessage, "공지 내용을 입력해 주세요.", "error");
      noticeContentInput.focus();
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setMessage(editorMessage, "관리자 로그인이 만료되었습니다.", "error");
      return;
    }

    saveNoticeButton.disabled = true;
    cancelEditButton.disabled = true;
    setMessage(
      editorMessage,
      currentEditId ? "공지사항을 저장하는 중입니다." : "공지사항을 등록하는 중입니다."
    );

    const values = {
      title,
      content,
      important: noticeImportantInput.checked,
      active: noticeActiveInput.checked,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
      const wasEditing = Boolean(currentEditId);
      let savedNoticeId = currentEditId;

      if (currentEditId) {
        await db.collection("notices").doc(currentEditId).set(values, { merge: true });
      } else {
        values.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        values.createdBy = user.uid;
        const createdReference = await db.collection("notices").add(values);
        savedNoticeId = createdReference.id;
      }

      const auditSaved = await recordNoticeAudit(
        wasEditing ? "NOTICE_UPDATED" : "NOTICE_CREATED",
        savedNoticeId
      );

      currentEditId = "";
      editorModal.hidden = true;
      noticeForm.reset();
      noticeActiveInput.checked = true;

      setMessage(
        pageMessage,
        auditSaved
          ? (wasEditing ? "공지사항을 수정했습니다." : "새 공지사항을 등록했습니다.")
          : (wasEditing
              ? "공지사항은 수정됐지만 운영기록 저장에 실패했습니다."
              : "공지는 등록됐지만 운영기록 저장에 실패했습니다."),
        auditSaved ? "success" : "warning"
      );
      await loadNotices();
    } catch (error) {
      console.error("공지사항 저장 실패", error);
      let message = "공지사항을 저장하지 못했습니다.";
      if (error && error.code === "permission-denied") {
        message = "공지사항 쓰기 권한이 없습니다. admin Custom Claim과 Firestore Rules를 확인해 주세요.";
      } else if (error && error.message) {
        message = "공지사항 저장 실패: " + error.message;
      }
      setMessage(editorMessage, message, "error");
    } finally {
      saveNoticeButton.disabled = false;
      cancelEditButton.disabled = false;
    }
  }

  async function changeVisibility(item, makeActive, sourceButton) {
    const question = makeActive
      ? "이 공지를 다시 공개하시겠습니까?"
      : "이 공지를 숨기시겠습니까? 숨기면 일반 이용자의 공지사항 화면에 표시되지 않습니다.";

    if (!window.confirm(question)) return;

    sourceButton.disabled = true;
    setMessage(
      pageMessage,
      makeActive ? "공지사항을 공개하는 중입니다." : "공지사항을 숨기는 중입니다."
    );

    try {
      await db.collection("notices").doc(item.id).update({
        active: makeActive,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      const auditSaved = await recordNoticeAudit(
        makeActive ? "NOTICE_SHOWN" : "NOTICE_HIDDEN",
        item.id
      );

      setMessage(
        pageMessage,
        auditSaved
          ? (makeActive ? "공지사항을 다시 공개했습니다." : "공지사항을 숨겼습니다.")
          : (makeActive
              ? "공지는 다시 공개됐지만 운영기록 저장에 실패했습니다."
              : "공지는 숨김 처리됐지만 운영기록 저장에 실패했습니다."),
        auditSaved ? "success" : "warning"
      );
      await loadNotices();
    } catch (error) {
      console.error("공지사항 공개 상태 변경 실패", error);
      let message = "공지사항 공개 상태를 변경하지 못했습니다.";
      if (error && error.code === "permission-denied") {
        message = "공지사항 변경 권한이 없습니다. admin Custom Claim과 Firestore Rules를 확인해 주세요.";
      } else if (error && error.message) {
        message = "공지사항 변경 실패: " + error.message;
      }
      setMessage(pageMessage, message, "error");
      sourceButton.disabled = false;
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
        window.AdminSessionTimeout.start({ auth, uid: user.uid });

      if (!sessionStarted) {
        await auth.signOut().catch(() => {});
        window.location.replace("/");
        return;
      }

      signedInInfo.textContent = maskAdminPhone(user.phoneNumber) +
        " · 관리자 인증 완료 · 30분 자동 로그아웃";

      checkingSection.hidden = true;
      noticesSection.hidden = false;
      await loadNotices();
    } catch (error) {
      console.error("관리자 권한 확인 실패", error);
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

    refreshButton.addEventListener("click", loadNotices);
    newNoticeButton.addEventListener("click", () => openEditor(null));
    logoutButton.addEventListener("click", logout);
    cancelEditButton.addEventListener("click", closeEditor);
    noticeForm.addEventListener("submit", saveNotice);

    editorModal.addEventListener("click", event => {
      if (event.target === editorModal) closeEditor();
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !editorModal.hidden) closeEditor();
    });

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
