const PACKET_URL = "review_packet.json";
const PROTOCOL = "rq2-single-answer-human-audit-v3";

const state = {
  packet: null,
  reviews: {},
  currentId: null,
  reviewerId: "",
};

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function blankReview() {
  return { score: "", note: "" };
}

function reviewFor(caseId) {
  if (!state.reviews[caseId]) state.reviews[caseId] = blankReview();
  return state.reviews[caseId];
}

function isComplete(review) {
  return ["1.0", "0.5", "0.0", "null"].includes(review?.score);
}

function storageKey() {
  return `${PROTOCOL}:${state.packet?.packet_id || "unloaded"}`;
}

function saveLocal() {
  localStorage.setItem(storageKey(), JSON.stringify({
    protocol: PROTOCOL,
    reviewer_id: state.reviewerId,
    reviews: state.reviews,
  }));
}

function loadLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey()));
    if (saved?.protocol === PROTOCOL) {
      state.reviews = saved.reviews || {};
      state.reviewerId = saved.reviewer_id || "";
    }
  } catch (_) {
    localStorage.removeItem(storageKey());
  }
}

function filteredCases() {
  const domain = $("#domainFilter").value;
  const status = $("#statusFilter").value;
  return state.packet.cases.filter((item) => {
    const complete = isComplete(state.reviews[item.case_id]);
    return (domain === "all" || item.domain === domain) &&
      (status === "all" || (status === "complete") === complete);
  });
}

function updateProgress() {
  const total = state.packet.cases.length;
  const done = state.packet.cases.filter((item) => isComplete(state.reviews[item.case_id])).length;
  const prefix = state.packet.sample_status === "frozen"
    ? ""
    : state.packet.sample_status === "pending" ? "Waiting for final packet · " : "Preview packet · ";
  $("#progressText").textContent = `${prefix}${done} of ${total} answers reviewed`;
}

function normalizePacket(payload) {
  if (payload.protocol === PROTOCOL && Array.isArray(payload.cases)) return payload;
  throw new Error("The website and review packet use different protocol versions");
}

function renderList() {
  const cases = filteredCases();
  $("#pairList").innerHTML = cases.map((item) => {
    const complete = isComplete(state.reviews[item.case_id]);
    return `<button type="button" class="pair-link ${complete ? "complete" : ""} ${item.case_id === state.currentId ? "active" : ""}" data-case-id="${escapeHtml(item.case_id)}">
      <span class="status-dot"></span>
      <span>${escapeHtml(item.case_id)}</span>
      <small>${escapeHtml(item.domain)}</small>
    </button>`;
  }).join("") || '<p class="empty">No answers match these filters.</p>';

  document.querySelectorAll(".pair-link").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentId = button.dataset.caseId;
      render();
    });
  });
}

function scoreControls(selected) {
  const choices = [
    ["1.0", "Correct", "All material reference content is present and there is no material contradiction."],
    ["0.5", "Partially correct", "The main direction is right, but an essential value, condition or qualification is missing or wrong."],
    ["0.0", "Incorrect", "The answer is wrong, contradictory, irrelevant, or gives no answer when the reference does."],
    ["null", "Not sure", "The comparison cannot be decided from the question and the two answers shown."],
  ];
  return `<div class="score-options">${choices.map(([value, title, description]) => `
    <label class="score-option">
      <input type="radio" name="score" value="${value}" ${selected === value ? "checked" : ""} />
      <span><strong>${title}</strong><small>${description}</small></span>
    </label>`).join("")}</div>`;
}

function renderCase() {
  const item = state.packet.cases.find((row) => row.case_id === state.currentId);
  if (!item) {
    $("#reviewView").innerHTML = '<p class="empty">Choose an answer from the list.</p>';
    return;
  }
  const review = reviewFor(item.case_id);
  const position = state.packet.cases.findIndex((row) => row.case_id === item.case_id) + 1;
  $("#reviewView").innerHTML = `
    <div class="case-head">
      <div><span class="case-tag">${escapeHtml(item.domain)}</span><h2>${escapeHtml(item.question)}</h2></div>
      <span class="case-count">Answer ${position} of ${state.packet.cases.length}</span>
    </div>
    <section class="reference"><h3>Reference answer</h3><p>${escapeHtml(item.reference_answer)}</p></section>
    <section class="response response-single">
      <div class="response-title"><h3>System answer</h3></div>
      <div class="answer-text">${escapeHtml(item.system_answer)}</div>
    </section>
    ${(item.first_pass_choice || item.independent_judge_choice) ? `<section class="decision-comparison">
      <h3>Why the decisions disagree</h3>
      <div class="decision-grid">
        <div class="decision-card expert-decision">
          <span>First-pass expert choice</span>
          <strong>${escapeHtml(item.first_pass_choice)}</strong>
          <p>${escapeHtml(item.first_pass_note || "No note provided.")}</p>
        </div>
        <div class="decision-card judge-decision">
          <span>Independent judge choice</span>
          <strong>${escapeHtml(item.independent_judge_choice)}</strong>
          <p>${escapeHtml(item.independent_judge_reason || "No rationale available.")}</p>
        </div>
      </div>
    </section>` : ""}
    <section class="comparison">
      <h3>How accurate is the system answer?</h3>
      <p>Compare its scientific content with the reference. Differences in wording alone do not matter.</p>
      ${scoreControls(review.score)}
      <label class="note">Optional note<textarea id="note" placeholder="Explain an ambiguity or disagreement when useful.">${escapeHtml(review.note)}</textarea></label>
      <div id="validation" class="validation"></div>
    </section>
    <div class="case-actions">
      <button id="previousBtn" type="button" class="secondary">Previous</button>
      <span class="complete-label ${isComplete(review) ? "done" : ""}">${isComplete(review) ? "Complete" : "Incomplete"}</span>
      <div class="action-right"><button id="saveBtn" type="button" class="secondary">Save</button><button id="nextBtn" type="button">Save and next</button></div>
    </div>`;

  bindReviewInputs(review);
}

function readReviewForm(review) {
  review.score = document.querySelector('input[name="score"]:checked')?.value || "";
  review.note = $("#note").value.trim();
}

function saveCurrent(showValidation = false) {
  const review = reviewFor(state.currentId);
  readReviewForm(review);
  saveLocal();
  updateProgress();
  renderList();
  const validation = $("#validation");
  if (validation) validation.textContent = showValidation && !isComplete(review) ? "Select one score before continuing." : "";
  const label = document.querySelector(".complete-label");
  if (label) {
    label.textContent = isComplete(review) ? "Complete" : "Incomplete";
    label.classList.toggle("done", isComplete(review));
  }
  return isComplete(review);
}

function move(offset) {
  const cases = state.packet.cases;
  const index = cases.findIndex((item) => item.case_id === state.currentId);
  const next = cases[Math.min(Math.max(index + offset, 0), cases.length - 1)];
  if (next) state.currentId = next.case_id;
  render();
}

function bindReviewInputs(review) {
  document.querySelectorAll('input[name="score"]').forEach((input) => input.addEventListener("change", () => saveCurrent(false)));
  $("#note").addEventListener("input", () => { readReviewForm(review); saveLocal(); });
  $("#saveBtn").addEventListener("click", () => saveCurrent(false));
  $("#nextBtn").addEventListener("click", () => { if (saveCurrent(true)) move(1); });
  $("#previousBtn").addEventListener("click", () => { saveCurrent(false); move(-1); });
}

function render() {
  updateProgress();
  renderList();
  renderCase();
}

function exportReview() {
  state.reviewerId = $("#reviewerId").value.trim();
  const missing = state.packet.cases.filter((item) => !isComplete(state.reviews[item.case_id]));
  if (!state.reviewerId) {
    window.alert("Enter a reviewer ID before exporting.");
    return;
  }
  if (missing.length) {
    window.alert(`${missing.length} answers still need a score.`);
    return;
  }
  saveLocal();
  const payload = {
    protocol: PROTOCOL,
    packet_id: state.packet.packet_id,
    reviewer_id: state.reviewerId,
    exported_at: new Date().toISOString(),
    packet_status: state.packet.sample_status,
    case_count: state.packet.cases.length,
    reviews: state.packet.cases.map((item) => ({ case_id: item.case_id, ...reviewFor(item.case_id) })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `rq2-human-audit-${state.reviewerId}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importReview(file) {
  const payload = JSON.parse(await file.text());
  if (payload.protocol !== PROTOCOL) throw new Error("This file belongs to a different review protocol.");
  if (payload.packet_id !== state.packet.packet_id) throw new Error("This review file belongs to a different review packet.");
  const reviews = Array.isArray(payload.reviews)
    ? Object.fromEntries(payload.reviews.map(({ case_id, ...review }) => [case_id, review]))
    : payload.reviews;
  const packetIds = new Set(state.packet.cases.map((item) => item.case_id));
  const importedIds = Object.keys(reviews || {});
  if (importedIds.some((caseId) => !packetIds.has(caseId))) throw new Error("This review file belongs to a different packet.");
  state.reviews = reviews || {};
  state.reviewerId = payload.reviewer_id || "";
  $("#reviewerId").value = state.reviewerId;
  saveLocal();
  render();
}

async function init() {
  const response = await fetch(PACKET_URL);
  if (!response.ok) throw new Error(`Cannot load ${PACKET_URL}`);
  state.packet = normalizePacket(await response.json());
  loadLocal();
  $("#reviewerId").value = state.reviewerId;
  state.currentId = state.packet.cases[0]?.case_id || null;
  $("#reviewerId").addEventListener("input", (event) => { state.reviewerId = event.target.value; saveLocal(); });
  $("#domainFilter").addEventListener("change", renderList);
  $("#statusFilter").addEventListener("change", renderList);
  $("#exportBtn").addEventListener("click", exportReview);
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", async (event) => {
    try { if (event.target.files[0]) await importReview(event.target.files[0]); }
    catch (error) { window.alert(error.message); }
    event.target.value = "";
  });
  render();
}

init().catch((error) => {
  $("#reviewView").innerHTML = `<p class="empty">${escapeHtml(error.message)}. Open this directory through a local web server.</p>`;
});
