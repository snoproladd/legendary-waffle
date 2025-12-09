
// public/js/phoneVer.js
document.addEventListener('DOMContentLoaded', () => {
  const form           = document.querySelector('#account-form') || document.querySelector('form');
  const phoneInput     = document.querySelector('#phone');
  const phoneStatus    = document.querySelector('#phone-status');
  const confirmInput   = document.querySelector('#confirm-phone');
  const confirmStatus  = document.querySelector('#confirm-phone-status');

  if (!form || !phoneInput || !phoneStatus || !confirmInput || !confirmStatus) return;

  // Accessibility
  phoneStatus.setAttribute('role', 'status');
  phoneStatus.setAttribute('aria-live', 'polite');
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

  const digitsOnly = (s) => s.replace(/\D+/g, '');

  // Gates
  let phoneDeliverable = false;
  let phonesMatch      = false;
  let debounceId;
  let inflightAbort    = null;

  // Fetch with cancellation
  async function fetchPhoneNumber(phone) {
    const requestedPhone = phone.trim();
    setStatusLoading(phoneStatus, 'Validating phone...');

    // Cancel previous request
    if (inflightAbort) inflightAbort.abort();
    inflightAbort = new AbortController();

    try {
      const url = new URL('/validate-phone', window.location.origin);
      url.searchParams.set('phone', requestedPhone);

      const res = await fetch(url.toString(), { signal: inflightAbort.signal });
      const data = await res.json().catch(() => ({}));

      // If user changed input while request was inflight, ignore results
      if (phoneInput.value.trim() !== requestedPhone) return;

      if (!res.ok) {
        phoneDeliverable = false;
        setStatusError(phoneStatus, data.error || 'Server error. Please try again later.');
        setConfirmEnabled(false);
        phonesMatch = false;
        return;
      }

      const result = !!data.valid;
      const reason = data.validation_errors || '';

      if (result) {
        phoneDeliverable = true;
        const normalized = data.normalized ? ` (${data.normalized})` : '';
        setStatusSuccess(phoneStatus, `✅ Valid phone${normalized}`);
        setConfirmEnabled(true);
      } else {
        phoneDeliverable = false;
        setStatusError(phoneStatus, reason || 'Invalid phone number.');
        setConfirmEnabled(false);
        phonesMatch = false;
      }

      evaluateConfirmMatch(); // re-evaluate match when primary state changes
    } catch (e) {
      if (e.name === 'AbortError') return; // user typed again; we aborted intentionally
      phoneDeliverable = false;
      setStatusError(phoneStatus, 'Error validating phone number. Please try again later.');
      setConfirmEnabled(false);
      phonesMatch = false;
    } finally {
      inflightAbort = null;
    }
  }

  function evaluateConfirmMatch() {
    const phoneVal   = digitsOnly(phoneInput.value.trim());
    const confirmVal = digitsOnly(confirmInput.value.trim());

    if (!phoneDeliverable) {
      phonesMatch = false;
      clearStates(confirmStatus);
      confirmStatus.textContent = 'Validate your phone first.';
      return;
    }

    if (!confirmVal) {
      phonesMatch = false;
      clearStates(confirmStatus);
      confirmStatus.textContent = 'Please repeat your phone.';
      return;
    }

    if (confirmVal === phoneVal) {
      phonesMatch = true;
      setStatusSuccess(confirmStatus, '✅ Phones match');
    } else {
      phonesMatch = false;
      setStatusError(confirmStatus, 'Phones do not match.');
    }
  }

  // Wire up events once
  phoneInput.addEventListener('input', () => {
    clearTimeout(debounceId);

    const raw = phoneInput.value;
    if (raw.trim() === '') {
      phoneDeliverable = false;
      setConfirmEnabled(false);
      clearStates(phoneStatus);
      phoneStatus.textContent = 'Please enter a phone number.';
      phonesMatch = false;
      return;
    }

    const digits = digitsOnly(raw);
    if (digits.length < 10) {
      phoneDeliverable = false;
      setConfirmEnabled(false);
      clearStates(phoneStatus);
      phoneStatus.textContent = 'Enter at least 10 digits.';
      phonesMatch = false;
      return;
    }

    debounceId = setTimeout(() => {
      fetchPhoneNumber(raw);
    }, 500);
  });

  confirmInput.addEventListener('input', evaluateConfirmMatch);

  // Optional: block paste into confirm field (prevents copy/paste)
  confirmInput.addEventListener('paste', (e) => {
    e.preventDefault();
    setStatusError(confirmStatus, 'Pasting is disabled. Please retype your phone.');
  });

  // Gate form submission
  form.addEventListener('submit', (e) => {
    evaluateConfirmMatch();

    const smsChosen =
      form.querySelector('input[name="SMS-capable"]:checked') !== null;

    if (!(phoneDeliverable && phonesMatch && smsChosen)) {
      e.preventDefault();
      // Inform user
      if (!phoneDeliverable) setStatusError(phoneStatus, 'Please enter a valid phone.');
      if (!phonesMatch)     setStatusError(confirmStatus, 'Phones do not match.');
      if (!smsChosen) {
        const last = form.querySelector('label[for="SMS-capable-yes"]');
        if (last) last.focus();
      }
    }
  });
});
