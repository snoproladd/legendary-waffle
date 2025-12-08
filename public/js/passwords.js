
document.addEventListener('DOMContentLoaded', () => {
  let debounceId;

  // Elements
  const form =
    document.querySelector('form[action="/submit-advanced-info"]') ||
    document.querySelector('#account-form') ||
    document.querySelector('form');

  const passwordInput        = document.querySelector('#password');
  const confirmPasswordInput = document.querySelector('#confirm-password');
  const statusDiv            = document.querySelector('#passwords-matched-status');
  const togglePasswordBtn    = document.querySelector('#togglePassword');

  // Try to use the actual submit button; fall back gracefully
  let submitBtn = form ? form.querySelector('button[type="submit"]') : null;
  if (!submitBtn && form) {
    submitBtn = form.querySelector('button.btn.btn-primary');
  }

  // If inputs are missing, abort (but don't require 'form' to exist just to compare)
  if (!passwordInput || !confirmPasswordInput || !statusDiv) return;

  // Accessibility: screen readers announce updates
  statusDiv.setAttribute('role', 'status');
  statusDiv.setAttribute('aria-live', 'polite');

  // Shared styling helpers (matching your email script style)
  function clearStates() {
    statusDiv.classList.remove('loading', 'success', 'error');
    statusDiv.innerHTML = ''; // reset content
  }

  function setStatusLoading() {
    clearStates();
    statusDiv.classList.add('loading');
    statusDiv.innerHTML =
      '<span class="spinner-border spinner-border-sm text-secondary" role="status" aria-hidden="true"></span> Checking...';
  }

  function setStatusSuccess(msg = '✅ Passwords match') {
    clearStates();
    statusDiv.classList.add('success');
    statusDiv.textContent = msg;
  }

  function setStatusError(msg = 'Passwords do not match.') {
    clearStates();
    statusDiv.classList.add('error');
    statusDiv.innerHTML = `
      <div class="alert alert-danger alert-dismissible fade show" role="alert">
        ❌ ${msg}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      </div>
    `;
  }

  // Button state handler
  function setSubmitEnabled(enabled) {
    if (submitBtn) submitBtn.disabled = !enabled;
  }

  // Core comparison logic
  function comparePasswords() {
    const pwd  = passwordInput.value.trim();
    const conf = confirmPasswordInput.value.trim();

    if (pwd === '' && conf === '') {
      clearStates();
      setSubmitEnabled(false);
      return;
    }

    if (pwd !== '' && conf === '') {
      clearStates();
      setSubmitEnabled(false);
      return;
    }

    if (pwd === conf) {
      setStatusSuccess('✅ Passwords match');
      setSubmitEnabled(true);
    } else {
      setStatusError('Passwords do not match.');
      setSubmitEnabled(false);
    }
  }

  // Debounced handler
  function debouncedCompare() {
    clearTimeout(debounceId);
    setStatusLoading();
    debounceId = setTimeout(() => {
      comparePasswords();
    }, 500); // or 1000ms if you prefer slower checks
  }

  // Wire up events (listen on both fields)
  passwordInput.addEventListener('input', debouncedCompare);
  confirmPasswordInput.addEventListener('input', debouncedCompare);

  // Ensure submit starts disabled until a match is detected
  setSubmitEnabled(false);

  // Show/Hide password toggle (Bootstrap friendly)
  if (togglePasswordBtn) {
    togglePasswordBtn.addEventListener('click', () => {
      const isText = passwordInput.getAttribute('type') === 'text';
      passwordInput.setAttribute('type', isText ? 'password' : 'text');

      // Sync the icon (if you use Font Awesome eye/eye-slash)
      const icon = togglePasswordBtn.querySelector('i');
      if (icon) {
        icon.classList.toggle('fa-eye', isText);
        icon.classList.toggle('fa-eye-slash', !isText);
      }
    });
  }

  // Only add a submit guard if the form exists
  if (form) {
    form.addEventListener('submit', (e) => {
      const pwd  = passwordInput.value.trim();
      const conf = confirmPasswordInput.value.trim();

      if (pwd === '' || conf === '') {
        e.preventDefault();
        setStatusError('Please complete both password fields.');
        setSubmitEnabled(false);
        return;
      }

      if (pwd !== conf) {
        e.preventDefault();
        setStatusError('Passwords do not match.');
        setSubmitEnabled(false);
        return;
      }
    });
  }
});
