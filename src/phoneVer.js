import IMask from "imask";

document.addEventListener("DOMContentLoaded", () => {
  // --- Element references ---
  const form = document.querySelector("#phoneVer-form");
  if (!form) {
    console.warn("phoneVer form not found on this page");
    return;
  }
  const submitBtn = document.querySelector("#submit-btn");
  const submitStatus = document.querySelector("#submit-status");
  const firstName = document.querySelector("#firstName");
  const lastName = document.querySelector("#lastName");
  const suffix = document.querySelector("#suffix");
  const phoneInput = document.querySelector("#phone");
  const confirmInput = document.querySelector("#confirm-phone");
  const phoneStatus = document.querySelector("#phone-status");
  const confirmStatus = document.querySelector("#confirm-phone-status");
  const smsRadios = document.querySelectorAll('input[name="SMSCapable"]');
  const smsError = document.getElementById("SMSCapable-error");

  // --- IMask setup ---
  const maskOptions = { mask: "(000) 000-0000", lazy: false };
  if (phoneInput && !phoneInput._imask) {
    phoneInput._imask = IMask(phoneInput, maskOptions);
  }
  if (confirmInput && !confirmInput._imask) {
    confirmInput._imask = IMask(confirmInput, maskOptions);
  }

  // --- Status helpers ---
  function setSubmitStatusLoading(msg) {
    submitStatus.classList.remove("error", "success");
    submitStatus.classList.add("loading");
    submitStatus.innerHTML = `<span class="spinner-border spinner-border-sm text-secondary" role="status" aria-hidden="true"></span> ${msg}`;
  }
  function setSubmitStatusSuccess(msg) {
    submitStatus.classList.remove("error");
    submitStatus.classList.add("success");
    submitStatus.textContent = msg;
  }
  function setSubmitStatusError(msg) {
    submitStatus.classList.remove("success");
    submitStatus.classList.add("error");
    submitStatus.innerHTML = `
      <div class="alert alert-danger alert-dismissible fade show" role="alert">
        ❌ ${msg}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      </div>
    `;
  }
  function clearStates(el) {
    el.classList.remove("loading", "success", "error");
    el.innerHTML = "";
  }
  function setStatusLoading(el, text = "Checking...") {
    clearStates(el);
    el.classList.add("loading");
    el.innerHTML =
      '<span class="spinner-border spinner-border-sm text-secondary" role="status" aria-hidden="true"></span> ' +
      text;
  }
  function setStatusSuccess(el, msg = "✅ OK") {
    clearStates(el);
    el.classList.add("success");
    el.textContent = msg;
  }
  function setStatusError(el, msg = "Error.") {
    clearStates(el);
    el.classList.add("error");
    el.innerHTML = `
      <div class="alert alert-danger alert-dismissible fade show" role="alert">
        ❌ ${msg}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      </div>`;
  }
  function setConfirmEnabled(enabled) {
    confirmInput.disabled = !enabled;
  }
  const digitsOnly = (s) => s.replace(/\D+/g, "");

  // --- State ---
  let phoneDeliverable = false;
  let phonesMatch = false;
  let debounceId;
  let inflightAbort = null;

  // --- Phone validation logic (async) ---
  async function fetchPhoneNumber(phone) {
    const requestedPhone = phone.trim();
    setStatusLoading(phoneStatus, "Validating phone...");
    setSubmitStatusLoading("Checking...");
    if (inflightAbort) inflightAbort.abort();
    inflightAbort = new AbortController();
    try {
      const url = new URL("/validate-phone", window.location.origin);
      url.searchParams.set("phone", requestedPhone);
      const res = await fetch(url.toString(), { signal: inflightAbort.signal });
      const data = await res.json().catch(() => ({}));
      if (phoneInput.value.trim() !== requestedPhone) return;
      if (!res.ok) {
        phoneDeliverable = false;
        setStatusError(
          phoneStatus,
          data.error || "Server error. Please try again later."
        );
        setConfirmEnabled(false);
        phonesMatch = false;
        updateSubmitState();
        return;
      }
      const result = !!data.valid;
      const reason = data.validation_errors || "";
      if (result) {
        phoneDeliverable = true;
        setStatusSuccess(phoneStatus, `✅ Valid phone (${phoneInput.value})`);
        setConfirmEnabled(true);
        // Duplicate check (if backend returns exists)
        if (data.exists) {
          setStatusError(
            phoneStatus,
            "Duplicate record found. Please check your details."
          );
          setSubmitStatusError(
            "Duplicate record exists. Please check your details."
          );
          setConfirmEnabled(false);
          phonesMatch = false;
          updateSubmitState();
          return;
        }
      } else {
        phoneDeliverable = false;
        setStatusError(phoneStatus, reason || "Invalid phone number.");
        setConfirmEnabled(false);
        phonesMatch = false;
      }
      evaluateConfirmMatch();
    } catch (e) {
      if (e.name === "AbortError") return;
      phoneDeliverable = false;
      setStatusError(
        phoneStatus,
        "Error validating phone number. Please try again later."
      );
      setConfirmEnabled(false);
      phonesMatch = false;
    } finally {
      inflightAbort = null;
      updateSubmitState();
    }
  }

  function evaluateConfirmMatch() {
    const phoneVal = digitsOnly(phoneInput.value.trim());
    const confirmVal = digitsOnly(confirmInput.value.trim());
    if (!phoneDeliverable) {
      phonesMatch = false;
      clearStates(confirmStatus);
      confirmStatus.textContent = "Validate your phone first.";
      updateSubmitState();
      return;
    }
    if (!confirmVal) {
      phonesMatch = false;
      clearStates(confirmStatus);
      confirmStatus.textContent = "Please repeat your phone.";
      updateSubmitState();
      return;
    }
    if (confirmVal === phoneVal) {
      phonesMatch = true;
      setStatusSuccess(confirmStatus, "✅ Phones match");
    } else {
      phonesMatch = false;
      setStatusError(confirmStatus, "Phones do not match.");
    }
    updateSubmitState();
  }

  // --- Radio selection check ---
  function isRadioSelected() {
    return document.querySelector('input[name="SMSCapable"]:checked') !== null;
  }

  // --- Submit button logic ---
  function allFieldsFilled() {
    return (
      firstName.value.trim() !== "" &&
      lastName.value.trim() !== "" &&
      phoneInput.value.trim() !== "" &&
      confirmInput.value.trim() !== ""
    );
  }
  function phonesAreMatching() {
    return (
      digitsOnly(phoneInput.value.trim()) ===
      digitsOnly(confirmInput.value.trim())
    );
  }

  function updateSubmitState() {
    // Show/hide radio error
    if (smsError) smsError.style.display = isRadioSelected() ? "none" : "block";
    if (
      allFieldsFilled() &&
      phonesAreMatching() &&
      phoneDeliverable &&
      phonesMatch &&
      isRadioSelected()
    ) {
      submitBtn.disabled = false;
      setSubmitStatusSuccess("✅ Ready to submit");
    } else {
      submitBtn.disabled = true;
      setSubmitStatusError(
        "Please complete all required fields, ensure phone numbers match, and select Yes or No for SMSCapable."
      );
    }
  }

  // --- Event listeners ---
  phoneInput.addEventListener("input", () => {
    clearTimeout(debounceId);
    const raw = phoneInput.value;
    if (raw.trim() === "") {
      phoneDeliverable = false;
      setConfirmEnabled(false);
      clearStates(phoneStatus);
      phoneStatus.textContent = "Please enter a phone number.";
      phonesMatch = false;
      updateSubmitState();
      return;
    }
    const digits = digitsOnly(raw);
    if (digits.length < 10) {
      phoneDeliverable = false;
      setConfirmEnabled(false);
      clearStates(phoneStatus);
      phoneStatus.textContent = "Enter at least 10 digits.";
      phonesMatch = false;
      updateSubmitState();
      return;
    }
    setSubmitStatusLoading("Checking...");
    debounceId = setTimeout(() => {
      fetchPhoneNumber(raw);
    }, 500);
    updateSubmitState();
  });

  confirmInput.addEventListener("input", () => {
    evaluateConfirmMatch();
    updateSubmitState();
  });

  // Block paste into confirm field
  confirmInput.addEventListener("paste", (e) => {
    e.preventDefault();
    setStatusError(
      confirmStatus,
      "Pasting is disabled. Please retype your phone."
    );
    updateSubmitState();
  });

  // Listen for changes on first/last name fields
  if (firstName) firstName.addEventListener("input", updateSubmitState);
  if (lastName) lastName.addEventListener("input", updateSubmitState);

  // Listen for changes on radio buttons
  smsRadios.forEach((radio) => {
    radio.addEventListener("change", updateSubmitState);
  });

  // On load, ensure submit is disabled and radio error is hidden
  updateSubmitState();
  if (smsError) smsError.style.display = "none";

  // --- AJAX form submission ---
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    console.log("AJAX submit handler running!");

    evaluateConfirmMatch();
    const smsChosen = isRadioSelected();

    // Client-side validation
    if (!(phoneDeliverable && phonesMatch && smsChosen && allFieldsFilled())) {
      if (!phoneDeliverable)
        setStatusError(phoneStatus, "Please enter a valid phone.");
      if (!phonesMatch) setStatusError(confirmStatus, "Phones do not match.");
      if (!smsChosen && smsError) smsError.style.display = "block";
      setSubmitStatusError(
        "Please complete all required fields and ensure phone numbers match."
      );
      updateSubmitState();
      return;
    }
    submitBtn.disabled = true;
    setSubmitStatusLoading("Submitting...");

    // Build payload for backend
    const payload = {
      firstName: firstName.value.trim(),
      lastName: lastName.value.trim(),
      suffix: suffix.value.trim(),
      phone: phoneInput.value.trim(),
      SMSCapable:
        document.querySelector('input[name="SMSCapable"]:checked')?.value ===
        "yes",
    };

    try {
      console.log("Payload being sent: ", payload)
      const resp = await fetch("/submit-phoneVer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),credentials: "include"
      });
      const data = await resp.json();
      if (!data.success) {
        setSubmitStatusError(data.message || "Submission failed.");
        return;
      }
      setSubmitStatusSuccess("Info updated successfully!");
      setTimeout(() => {
        window.location.href = "/congregationInfo";
      }, 1000);
    } catch (err) {
      setSubmitStatusError("Server error. Please try again later.");
      console.error(err);
    }
  });
});
