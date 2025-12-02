document.addEventListener('DOMContentLoaded', () => {
  let timeout;
  let lastValidatedEmail = '';

  const emailInput = document.querySelector('#email');
  const statusDiv = document.querySelector('#email-status');
  const form = document.querySelector('form');

  if (!emailInput || !statusDiv || !form) return;

  emailInput.addEventListener('input', () => {
    clearTimeout(timeout);
    const email = emailInput.value.trim();

    if (email === '') {
      statusDiv.textContent = 'Please enter an email address.';
      statusDiv.className = 'status';
      return;
    }

    if (email.length < 5) {
      statusDiv.textContent = '';
      statusDiv.className = 'status';
      return;
    }

    statusDiv.innerHTML = '<span class="spinner-border spinner-border-sm text-secondary" role="status" aria-hidden="true"></span> Checking...';
    statusDiv.className = 'status loading';

    timeout = setTimeout(() => {
      if (email === lastValidatedEmail) return;

      fetch(`/validate-email?email=${encodeURIComponent(email)}`)
        .then(res => res.json())
        .then(data => {
          lastValidatedEmail = email;

          if (data.result === 'deliverable') {
            statusDiv.textContent = '✅ Valid email';
            statusDiv.className = 'status success';
          } else {
            statusDiv.innerHTML = `
              <div class="alert alert-danger alert-dismissible fade show" role="alert">
                ❌ ${data.reason || 'Invalid email address.'}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
              </div>
            `;
            statusDiv.className = 'status error';
          }
        })
        .catch(() => {
          statusDiv.innerHTML = `
            <div class="alert alert-danger alert-dismissible fade show" role="alert">
              Error validating email. Please try again later.
              <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
          `;
          statusDiv.className = 'status error';
        });
    }, 500);
  });

  form.addEventListener('submit', (e) => {
    const email = emailInput.value.trim().toLowerCase();
    if (email.endsWith('@jwpub.org')) {
      e.preventDefault();
      statusDiv.innerHTML = `
        <div class="alert alert-danger alert-dismissible fade show" role="alert">
          ❌ Emails from @jwpub.org are not allowed.
          <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
      `;
      statusDiv.className = 'status error';
    }
  });
});