
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const form         = document.querySelector('#account-form') || document.querySelector('form');
  const emailInput   = document.querySelector('#email');
  const emailStatus  = document.querySelector('#email-status');

  const confirmInput  = document.querySelector('#confirm-email');
  const confirmStatus = document.querySelector('#confirm-email-status');

  const passwordsDiv = document.querySelector('#passwords');

 

const showPasswords = (show) => {
  if (passwordsDiv) {
    passwordsDiv.classList.toggle('d-none', !show);
  }
};


if (!form || !emailInput || !emailStatus || !confirmInput || !confirmStatus) {
  return; // only email controls are truly required
}


  // Accessibility
  emailStatus.setAttribute('role', 'status');
  emailStatus.setAttribute('aria-live', 'polite');
  confirmStatus.setAttribute('role', 'status');
  confirmStatus.setAttribute('aria-live', 'polite');

  // Helpers
  const clearStates = (el) => el.classList.remove('loading', 'success', 'error');

  const setStatusLoading = (el, text = 'Checking...') => {
    clearStates(el);
    el.classList.add('loading');
    el.innerHTML =
      '<span class="spinner-border spinner-border-sm text-secondary" role="status" aria-hidden="true"></span> ' +
      text;
  };

  const setStatusSuccess = (el, msg = '✅ OK') => {
    clearStates(el);
    el.classList.add('success');
    el.textContent = msg;
  };

  const setStatusError = (el, msg = 'Error.') => {
    clearStates(el);
    el.classList.add('error');
    el.innerHTML = `
      <div class="alert alert-danger alert-dismissible fade show" role="alert">
        ❌ ${msg}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      </div>`;
  };

  

  const setConfirmEnabled = (enabled) => { confirmInput.disabled = !enabled; };

  // Gates
  let emailDeliverable = false;
  let emailsMatch      = false;
  let debounceId;

  // --- Primary email validation (server-backed) ---
  async function validateEmail(email) {
    const requestedEmail = email.trim();
    setStatusLoading(emailStatus);

    try {
      const res  = await fetch(`/validate-email?email=${encodeURIComponent(requestedEmail)}`);
      const data = await res.json().catch(() => ({}));

      // If user changed input while request was in-flight, ignore
      if (emailInput.value.trim() !== requestedEmail) return;

      // Block domain
      if (requestedEmail.toLowerCase().endsWith('@jwpub.org')) {
        emailDeliverable = false;
        setStatusError(emailStatus, 'Emails from @jwpub.org are not allowed.');
        setConfirmEnabled(false);
        emailsMatch = false;
        showPasswords(false);
        return;
      }

      if (!res.ok) {
        emailDeliverable = false;
        setStatusError(emailStatus, data.error || 'Server error. Please try again later.');
        setConfirmEnabled(false);
        emailsMatch = false;
        
        showPasswords(false);
        return;
      }

      const result = String(data.result || '').toLowerCase();
      const reason = data.reason || '';

      if (result === 'deliverable') {
        emailDeliverable = true;
        setStatusSuccess(emailStatus, '✅ Valid email');
        setConfirmEnabled(true); // user can now confirm
      } else if (result === 'risky' || result === 'unknown') {
        emailDeliverable = false;
        setStatusError(emailStatus, reason || 'Email may be risky or unknown.');
        setConfirmEnabled(false);
        emailsMatch = false;
        
        showPasswords(false);
      } else {
        emailDeliverable = false;
        setStatusError(emailStatus, reason || 'Invalid email address.');
        setConfirmEnabled(false);
        emailsMatch = false;
        
        showPasswords(false);
      }

      // Re-evaluate the match when primary state changes
      evaluateConfirmMatch();
    } catch (e) {
      emailDeliverable = false;
      setStatusError(emailStatus, 'Error validating email. Please try again later.');
      setConfirmEnabled(false);
      emailsMatch = false;
      
      showPasswords(false);
    }
  }

  // --- Confirm email exact match gate (toggles #passwords only) ---
  function evaluateConfirmMatch() {
    const emailVal   = emailInput.value.trim();
    const confirmVal = confirmInput.value.trim();

    if (!emailDeliverable) {
      emailsMatch = false;
      clearStates(confirmStatus);
      confirmStatus.textContent = 'Validate your email first.';
      
      showPasswords(false);
      return;
    }

    if (!confirmVal) {
      emailsMatch = false;
      clearStates(confirmStatus);
      confirmStatus.textContent = 'Please repeat your email.';
      
      showPasswords(false);
      return;
    }

    if (confirmVal.toLowerCase() === emailVal.toLowerCase()) {
      emailsMatch = true;
      setStatusSuccess(confirmStatus, '✅ Emails match');
      
      showPasswords(true);  // <-- only responsibility: reveal passwords div
    } else {
      emailsMatch = false;
      setStatusError(confirmStatus, 'Emails do not match.');
      
      showPasswords(false);
    }
  }

  // --- Wire up events ---

  // Primary email typing with debounce
  emailInput.addEventListener('input', () => {
    clearTimeout(debounceId);
    const email = emailInput.value.trim();

    // Immediate resets
    if (email === '') {
      emailDeliverable = false;
      setConfirmEnabled(false);
      clearStates(emailStatus);
      emailStatus.textContent = 'Please enter an email address.';
      emailsMatch = false;
      
      showPasswords(false);
      return;
    }

    if (email.length < 5) {
      emailDeliverable = false;
      setConfirmEnabled(false);
      clearStates(emailStatus);
      emailStatus.textContent = '';
      emailsMatch = false;
      
      showPasswords(false);
      return;
    }

    debounceId = setTimeout(() => {
      validateEmail(email);
    }, 500);
  });

  // Confirm-email typing (updates match + toggles #passwords)
  confirmInput.addEventListener('input', evaluateConfirmMatch);

  // Defense in depth on submit (no password logic here)
  form.addEventListener('submit', (e) => {
    const email = emailInput.value.trim().toLowerCase();
    const confirm = confirmInput.value.trim().toLowerCase();

    // Block jwpub domain on submit too
    if (email.endsWith('@jwpub.org')) {
      e.preventDefault();
      setStatusError(emailStatus, 'Emails from @jwpub.org are not allowed.');
      return;
    }

    // Enforce email deliverability + match before allowing submit
    evaluateConfirmMatch();
    if (!(emailDeliverable && emailsMatch)) {
      e.preventDefault();
      return;
    }

    // Password logic is handled by /js/passwords.js; this script does not gate submit beyond emails
  });
});
