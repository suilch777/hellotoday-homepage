(() => {
  "use strict";
  window.InstitutionPhoneAuth = {
    create({auth, app, show, message, run, complete, cancel}) {
      const $ = id => document.getElementById(id);
      let confirmation = null, verifiedUser = null, verifier = null, active = false, sending = false, cooldownUntil = 0;
      function clearVerifier() { verifier?.clear(); verifier = null; }
      function invalidate() { confirmation = null; verifiedUser = null; $("smsCode").value = ""; $("smsCodeArea").hidden = true; }
      function reset() { active = false; invalidate(); clearVerifier(); cooldownUntil = 0; $("smsPhone").value = ""; $("smsConsent").checked = false; }
      function update() {
        if (!active || sending) return;
        const seconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
        $("sendSms").disabled = seconds > 0;
        $("sendSms").textContent = seconds ? `다시 받기 (${seconds}초)` : confirmation ? "인증번호 다시 받기" : "인증번호 받기";
      }
      function normalizePhone(raw) {
        const phone = raw.replace(/[\s()-]/g, "");
        if (/^01\d{8,9}$/.test(phone)) return "+82" + phone.slice(1);
        if (/^\+82\d{9,10}$/.test(phone)) return phone;
        throw {code: "auth/invalid-phone-number"};
      }
      async function send() {
        if (sending || Date.now() < cooldownUntil) return;
        if (!$("smsConsent").checked) { message("휴대전화 인증 정보 이용에 동의해 주세요.", true); return; }
        const phone = normalizePhone($("smsPhone").value);
        sending = true; invalidate(); clearVerifier(); $("smsPhone").disabled = true;
        try {
          verifier = new firebase.auth.RecaptchaVerifier("smsRecaptcha", {size: "normal"}, app);
          // Same SMS sign-in and confirm flow used by operator/operator.js.
          confirmation = await auth.signInWithPhoneNumber(phone, verifier);
          cooldownUntil = Date.now() + 60000;
          $("smsDestination").textContent = `${phone}로 인증번호를 보냈습니다.`;
          $("smsCodeArea").hidden = false; $("smsCode").focus();
          message("문자로 받은 6자리 인증번호를 입력해 주세요.");
        } finally { sending = false; clearVerifier(); $("smsPhone").disabled = false; update(); }
      }
      async function confirm() {
        if (!confirmation) { message("먼저 인증번호를 받아 주세요.", true); return; }
        const code = $("smsCode").value.trim();
        if (!/^\d{6}$/.test(code)) { message("6자리 인증번호를 입력해 주세요.", true); return; }
        try {
          if (!verifiedUser) verifiedUser = (await confirmation.confirm(code)).user;
          await complete(verifiedUser);
          reset();
        } catch (error) {
          if (["auth/code-expired", "auth/session-expired", "functions/permission-denied", "functions/unauthenticated"].includes(error.code)) {
            invalidate(); await auth.signOut();
          }
          throw error;
        }
      }
      $("sendSms").onclick = () => run(send);
      $("smsForm").onsubmit = event => { event.preventDefault(); run(confirm); };
      $("cancelSms").onclick = () => run(async () => { reset(); await cancel(); });
      $("smsPhone").addEventListener("input", () => { invalidate(); update(); });
      const interval = setInterval(update, 1000);
      return {reset, update, open() { reset(); active = true; show("smsView"); update(); }, destroy() { reset(); clearInterval(interval); }};
    },
  };
})();
