const cfConfig = {
  error: {
    title: "Error!",
    message:
      "Sorry, an error occurred while receiving your message. Try contacting me with another method.",
  },
  success: {
    title: "Message Sent Successfully.",
    message: "Thank you for contacting me, I'll get back to you soon.",
  },
};

const cfbody = `
<div class="box right-button" id="cf" style="display: inline-block; z-index: 9999;">
  <div class="button color" onclick="cfClick();">
    <span class="m-cf-icon-default"><i class="material-icons">chat_bubble</i></span>
    <span class="cl-icon"><i class="material-icons">arrow_downward</i></span>
  </div>
  <div class="panel" id="cfcontent"></div>
</div>
`;

const cfform = `
<h3 class="title">Contact Me</h3>
<p>Drop a message, I'll try to contact you soon.</p>
<div>
  <input class="element" oninput="cfonChange('cfname')" id="cfname" type="text" name="name" placeholder="Name" autocomplete="name" maxlength="100">
  <input class="element" oninput="cfonChange('cfsubject')" id="cfsubject" type="text" name="subject" placeholder="Subject" autocomplete="off" maxlength="200">
  <textarea class="element" oninput="cfonChange('cfmessage')" id="cfmessage" name="message" placeholder="Your message" maxlength="4000"></textarea>
  <button id="cfbutton" onclick="cfSubmitMessage()" class="form-button color">Send</button>
</div>
`;

function GEBID(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createHtmlFromObj({ title, message }) {
  return `<h3 class="title">${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p>`;
}

function getFormEl() {
  return GEBID("contactform");
}

function loadConfigFromDom() {
  const el = getFormEl();
  if (!el) return;
  const err = el.getAttribute("error_text");
  const ok = el.getAttribute("success_text");
  if (err) cfConfig.error.message = err;
  if (ok) cfConfig.success.message = ok;
}

function initContactForm() {
  const host = getFormEl();
  if (!host) {
    console.warn("[contactform] #contactform element not found");
    return;
  }

  loadConfigFromDom();

  const cfstylesheet = document.createElement("link");
  cfstylesheet.rel = "stylesheet";
  cfstylesheet.href = "/contactform/cf.css";
  document.head.appendChild(cfstylesheet);

  cfstylesheet.onload = function () {
    const cfdiv = document.createElement("section");
    cfdiv.classList.add("contact-form-cf");
    cfdiv.innerHTML = cfbody;
    document.body.appendChild(cfdiv);

    let cfresult = null;
    try {
      cfresult = JSON.parse(localStorage.getItem("contact-form") || "null");
    } catch {
      cfresult = null;
    }

    const waitDisabled = host.getAttribute("disable_waittime") === "true";
    if (
      !waitDisabled &&
      cfresult &&
      cfresult.sent &&
      cfresult.canSendUnix > Date.now()
    ) {
      GEBID("cfcontent").innerHTML = createHtmlFromObj(cfConfig.success);
    } else {
      GEBID("cfcontent").innerHTML = cfform;
    }
  };

  cfstylesheet.onerror = function () {
    console.warn("[contactform] failed to load cf.css");
  };
}

function cfClick() {
  const box = GEBID("cf");
  if (!box) return;
  box.classList.toggle("showing-state");
  box.classList.toggle("showing");
}

async function cfSubmitMessage() {
  const nameEl = GEBID("cfname");
  const subjectEl = GEBID("cfsubject");
  const messageEl = GEBID("cfmessage");
  const button = GEBID("cfbutton");
  const host = getFormEl();

  if (!nameEl || !subjectEl || !messageEl || !button || !host) return;

  const cfvalue = {
    name: nameEl.value.trim(),
    subject: subjectEl.value.trim(),
    message: messageEl.value.trim(),
  };

  if (!cfvalue.name) {
    nameEl.classList.add("error");
    return;
  }
  if (!cfvalue.subject) {
    subjectEl.classList.add("error");
    return;
  }
  if (!cfvalue.message) {
    messageEl.classList.add("error");
    return;
  }

  const workerUrl = host.getAttribute("form_worker_url");
  if (!workerUrl) {
    console.error("[contactform] form_worker_url is missing on #contactform");
    GEBID("cfcontent").innerHTML = createHtmlFromObj(cfConfig.error);
    return;
  }

  button.removeAttribute("onclick");
  button.disabled = true;
  button.classList.remove("color");
  button.classList.add("onclick");
  button.textContent = "Sending...";

  try {
    const res = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfvalue),
    });

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error("Invalid response");
    }

    if (data && data.status === true) {
      GEBID("cfcontent").innerHTML = createHtmlFromObj(cfConfig.success);
      localStorage.setItem(
        "contact-form",
        JSON.stringify({
          sent: true,
          canSendUnix: Date.now() + 43200000, // 12 hours
        })
      );
    } else {
      throw new Error((data && data.msg) || "Send failed");
    }
  } catch (error) {
    console.error(error);
    GEBID("cfcontent").innerHTML = createHtmlFromObj(cfConfig.error);
  }
}

function cfonChange(id) {
  const el = GEBID(id);
  if (el) el.classList.remove("error");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initContactForm);
} else {
  initContactForm();
}