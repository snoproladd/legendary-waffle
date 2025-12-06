
document.addEventListener('DOMContentLoaded', () => {
  let debounceId;
  let lastRequestedEmail = '';

  const emailInput = document.querySelector('#email');
  const statusDiv = document.querySelector('#email-status');
  const form = document.querySelector('form');

  if (!emailInput || !statusDiv || !form) return;

  // Accessibility: let screen readers announce updates
  statusDiv.setAttribute('role', 'status');
  statusDiv.setAttribute('aria-live', 'polite');

  function clearStates() {
    statusDiv.classList.remove('loading', 'success', 'error');
  }

  function setStatusLoading() {
    clearStates();
    statusDiv.classList.add('loading');
    statusDiv.innerHTML =
      '<span class="spinner-border spinner-border-sm text-secondary" role="status" aria-hidden="true"></span> Checking...';
  }

  function setStatusSuccess(msg = '✅ Valid email') {
    clearStates();
    statusDiv.classList.add('success');
    statusDiv.textContent = msg;
  }

  function setStatusError(msg = 'Invalid email address.') {
    clearStates();
    statusDiv.classList.add('error');
    statusDiv.innerHTML = `
      <div class="alert alert-danger alert-dismissible fade show" role="alert">
        ❌ ${msg}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      </div>
    `;
  }

  async function validateEmail(email) {
    const requestedEmail = email.trim();
    lastRequestedEmail = requestedEmail;
    setStatusLoading();

    try {
      const res = await fetch(`/validate-email?email=${encodeURIComponent(requestedEmail)}`);
      const data = await res.json().catch(() => ({}));

      // Ignore stale result if input changed while the request was in-flight
      if (emailInput.value.trim() !== requestedEmail) return;

      if (!res.ok) {
        setStatusError(data.error || 'Server error. Please try again later.');
        return;
      }

      const result = String(data.result || '').toLowerCase();
      const reason = data.reason || '';

      if (result === 'deliverable') {
        setStatusSuccess('✅ Valid email');
      } else if (result === 'risky' || result === 'unknown') {
        setStatusError(reason || 'Email may be risky or unknown.');
      } else {
        setStatusError(reason || 'Invalid email address.');
      }
    } catch (e) {
      setStatusError('Error validating email. Please try again later.');
    }
  }

  emailInput.addEventListener('input', () => {
    clearTimeout(debounceId);
    const email = emailInput.value.trim();

    if (email === '') {
      clearStates();
      statusDiv.textContent = 'Please enter an email address.';
      return;
    }

    if (email.length < 5) {
      clearStates();
      statusDiv.textContent = '';
      return;
    }

    debounceId = setTimeout(() => {
      // Avoid redundant calls unless the value changed
      if (email === lastRequestedEmail) return;
      validateEmail(email);
    }, 500);
  });

  form.addEventListener('submit', (e) => {
    const email = emailInput.value.trim().toLowerCase();
    if (email.endsWith('@jwpub.org')) {
      e.preventDefault();
      setStatusError('Emails from @jwpub.org are not allowed.');
      return;
    }

    // Optional: enforce revalidation before submit
    // e.preventDefault();
    // validateEmail(email).then(() => {
    //   if (statusDiv.classList.contains('success')) form.submit();
    // });
  });
});

