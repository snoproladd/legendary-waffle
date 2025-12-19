// public/js/submits.js
document.addEventListener("DOMContentLoaded", () => {
  const form =
    document.querySelector('form[action="/submit-advanced-info"]');
    
  const emailInput = document.querySelector("#email");
  const confirmInput = document.querySelector("#confirm-email");
  const emailStatus = document.querySelector("#email-status"); // reuse your status area

  const passwordInput = document.querySelector("#password");
  const confirmPasswordInput = document.querySelector("#confirm-password");
  const firstNameInput = document.querySelector("#firstName");
  const lastNameInput = document.querySelector("#lastName");
  const suffixInput = document.querySelector("#suffix");
  const phoneInput = document.querySelector("#phone");
//#region 
// Submit button (fallback if no explicit type="submit")

    let submitBtn = form ? form.querySelector('button[type="submit"]') : null;
    if (!submitBtn && form)
      submitBtn = form.querySelector("button.btn.btn-primary");

    if (!form || !emailInput || !confirmInput || !emailStatus) return;

    // Local state gates (mirroring email_validation.js outcomes)
    let emailDeliverable = false; // set true only when /validate-email says deliverable
    let emailsMatch = false; // true when email == confirm (case-insensitive)
    let emailTaken = null; // null=unknown, true/false = cached existence
    let lastCheckedEmail = ""; // dedupe repeated checks

    let debounceId;
    let existsAbortController = null;

    // UI helpers (ASCII-only statuses to keep clean)
    function clearEmailStatus() {
      emailStatus.classList.remove("loading", "success", "error");
      emailStatus.innerHTML = "";
    }
    function setEmailLoading(msg = "Checking...") {
      clearEmailStatus();
      emailStatus.classList.add("loading");
      emailStatus.textContent = msg;
    }
    function setEmailSuccess(msg = "OK") {
      clearEmailStatus();
      emailStatus.classList.add("success");
      emailStatus.textContent = msg;
    }
    function setEmailError(msg = "Error.") {
      clearEmailStatus();
      emailStatus.classList.add("error");
      emailStatus.textContent = msg;
    }

    // ---- Existence check (preload & cache) ----
    async function checkEmailExists(email) {
      const normalized = email.trim().toLowerCase();
      if (!normalized) {
        emailTaken = null;
        return false;
      }

      // If we already checked the same email and have a result, reuse it
      if (lastCheckedEmail === normalized && emailTaken !== null) {
        return emailTaken;
      }

      // Abort any in-flight existence check
      if (existsAbortController) existsAbortController.abort();
      existsAbortController = new AbortController();

      try {
        const url = `/api/volunteers/exists?email=${encodeURIComponent(
          normalized
        )}`;
        const res = await fetch(url, { signal: existsAbortController.signal });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          // Treat server error as unknown; force re-check on submit
          emailTaken = null;
          lastCheckedEmail = normalized;
          return null;
        }

        emailTaken = !!data.exists;
        lastCheckedEmail = normalized;
        return emailTaken;
      } catch {
        emailTaken = null;
        lastCheckedEmail = normalized;
        return null;
      }
    }

    // ---- Derived gates from your existing logic ----
    function isEmailBlockedByDomain(email) {
      return String(email).trim().toLowerCase().endsWith("@jwpub.org");
    }

    function emailsEqualInsensitive(a, b) {
      return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
    }

    // Wire into email typing to keep gates current (mirrors email_validation.js outcomes)
    function reevaluateEmailGates() {
      const email = emailInput.value.trim();
      const confirm = confirmInput.value.trim();

      // Domain block (defense in depth)
      if (isEmailBlockedByDomain(email)) {
        emailDeliverable = false;
        emailsMatch = false;
        emailTaken = null;
        setEmailError("Emails from @jwpub.org are not allowed.");
        return;
      }

      // You already call /validate-email in email_validation.js; we cannot read its internal flags here.
      // So we conservatively set deliverable to true only if both fields have content and match.
      emailsMatch =
        !!email && !!confirm && emailsEqualInsensitive(email, confirm);

      // If your email_validation.js sets an attribute, we can read it:
      // Example: emailStatus.dataset.deliverable = 'true'|'false'
      const deliverableAttr = emailStatus?.dataset?.deliverable;
      if (deliverableAttr === "true") emailDeliverable = true;
      else if (deliverableAttr === "false") emailDeliverable = false;
      else {
        // Fallback heuristic: require a basic email form before preloading
        emailDeliverable = /\S+@\S+\.\S+/.test(email);
      }

      // Preload existence only when both gates are true
      if (emailDeliverable && emailsMatch) {
        // Debounce to avoid firing on every keystroke
        clearTimeout(debounceId);
        debounceId = setTimeout(() => {
          checkEmailExists(email);
        }, 300);
      }
    }

    // Hook into password typing to preload existence if not already known
    function maybePreloadDuringPasswordTyping() {
      const email = emailInput.value.trim();
      if (emailDeliverable && emailsMatch && emailTaken === null) {
        // Start the existence check while user types password
        checkEmailExists(email);
      }
    }

    // ---- Event wiring ----
    emailInput.addEventListener("input", reevaluateEmailGates);
    confirmInput.addEventListener("input", reevaluateEmailGates);

    if (passwordInput) {
      passwordInput.addEventListener("input", maybePreloadDuringPasswordTyping);
    }
    if (confirmPasswordInput) {
      confirmPasswordInput.addEventListener(
        "input",
        maybePreloadDuringPasswordTyping
      );
    }

    // ---- Submit guard ----
    form.addEventListener("submit", async (e) => {
      const email = emailInput.value.trim();
      const confirm = confirmInput.value.trim();

      // Block jwpub domain
      if (isEmailBlockedByDomain(email)) {
        e.preventDefault();
        setEmailError("Emails from @jwpub.org are not allowed.");
        return;
      }

      // Require deliverable + match before submission (consistent with email_validation.js)
      emailsMatch = emailsEqualInsensitive(email, confirm);
      if (!(emailDeliverable && emailsMatch)) {
        e.preventDefault();
        setEmailError(
          "Please validate your email and ensure both entries match."
        );
        return;
      }

      // Final existence check (if unknown or stale, refresh synchronously)
      if (emailTaken === null || lastCheckedEmail !== email.toLowerCase()) {
        setEmailLoading("Checking for existing account...");
        const exists = await checkEmailExists(email);
        if (exists === null) {
          // Could not verify; allow submit but warn
          setEmailError("Could not verify email at this time. Please try again.");
          e.preventDefault();
          return;
        }
      }

      if (emailTaken) {
        e.preventDefault();
        setEmailError("This email is already registered.");
        return;
      }

      // If you also gate on password match, let passwords.js handle that.
      // Otherwise, allow submit    // Otherwise, allow submit to proceed to POST /api/volunteers
      setEmailSuccess("Email OK. Submitting...");
    });
  });
//#endregion