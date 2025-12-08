document.addEventListener('DOMContentLoaded', () => {
//elements
    const form         = document.querySelector('#account-form') || document.querySelector('form');
    const phoneInput   = document.querySelector('#phone');
    const phoneStatus  = document.querySelector('#phone-status');
    const confirmInput  = document.querySelector('#confirm-phone');
    const confirmStatus = document.querySelector('#confirm-phone-status');


if (!form || !phoneInput || !phoneStatus || !confirmInput || ! confirmStatus){
    return;
}

// Accessibility
  phoneStatus.setAttribute('role', 'status');
  phoneStatus.setAttribute('aria-live', 'polite');
  confirmStatus.setAttribute('role', 'status');
  confirmStatus.setAttribute('aria-live', 'polite');

//Helpers

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

//Gates
let phoneDeliverable = false;
let phonesMatch = false;
let debounceId;

// --- Primary phone number validation (server-backed) ---

async function fetchPhoneNumber(phone) {
    const requestedPhone = phone.trim();
    setStatusLoading(phoneStatus);
    try{
        const res  = await fetch(`/validate-phone?phone=${encodeURIComponent(requestedPhone)}`);
        const data = await res.json().catch(() => ({}))
    
        // If user changed input while request was in-lfight, ignore
        if(phoneInput.value.trim() !== requestedPhone) return;

        if (!res.ok) {
            phoneDeliverable = false;
            setStatusError(phoneStatus, data.error || 'ServerError. Please try again later');
            setConfirmEnabled(false);
            phonesMatch=false;
        }

        const result = String(data.valid || '');
        const reason = data.validation_errors || '';

        if (result == 'true'){
            phoneDeliverable = true;
            setStatusSuccess(phoneStatus, '✅ Valid phone number');
            setConfirmEnabled(true); //user can now confirm
        }else if (result == false){
            phoneDeliverable = false;
            setStatusError(phoneStatus, reason);
            phonesMatch = false;
        }else{
            phoneDeliverable = false;
            setStatusError(phoneStatus, reason || 'Invalid Phone Number.');
            phonesMatch = false;
        }
        // Re-evaluate the match when primary state changes
        evaluateConfirmMatch();
    }   catch (e){
        phoneDeliverable = false;
        setStatusError(phoneStatus, 'Error validating phone number. Please try again later.');
        setConfirmEnabled(false);
        phonesMatch = false;
    }
    }

function evaluateConfirmMatch() {
    const phoneVal   = phoneInput.value.trim();
    const confirmVal = confirmInput.value.trim();

    if (!phoneDeliverable) {
      phonesMatch = false;
      clearStates(confirmStatus);
      confirmStatus.textContent = 'Validate your phone first.';
      
      ;
      return;
    }

    if (!confirmVal) {
      phonesMatch = false;
      clearStates(confirmStatus);
      confirmStatus.textContent = 'Please repeat your phone.';
      
      ;
      return;
    }

    if (confirmVal.toLowerCase() === phoneVal.toLowerCase()) {
      phonesMatch = true;
      setStatusSuccess(confirmStatus, '✅ phones match');
      
      ;  // <-- only responsibility: reveal passwords div
    } else {
      phonesMatch = false;
      setStatusError(confirmStatus, 'phones do not match.');
      
      ;
    }
  }

// --- Wire up events ---
// Primary phone typing with debounce
phoneInput.addEventListener('input', () =>{
    clearTimeout(debounceId);;
    const phone = phoneInput.value;

    //Immediate resets
    if (phone === ''){
        phoneDeliverable = false;
        setConfirmEnabled(false);
        clearStates(phoneStatus);
        phoneStatus.textContent = 'Please enter a phone number.';
        phonesMatch = false;
        return;
    }
    if(phone.length<10){
        phoneDeliverable = false;
        setConfirmEnabled(false);
        clearStates(phoneStatus);
        phoneStatus.textContent = '';
        phonesMatch = false;
        return;
    }
    debounceId = setTimeout(()=>{
        fetchPhoneNumber(phone);
    }, 500);
    

    // Confirm-phone typing (updates match)
    confirmInput.addEventListener('input', evaluateConfirmMatch);

    // Defense in depth on submit

    // Enforce phone validity + match before allowing submit
    evaluateConfirmMatch();
    if (!(phoneDeliverable && phonesMatch)){
        e.preventDefault();
        return;
    }
})
})    
