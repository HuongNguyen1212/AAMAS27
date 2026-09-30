const defaultPath = "blinded_cases.json";
const state = {
  cases: [],
  selected: 0,
  reviews: {},
};

const $ = (id) => document.getElementById(id);

function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  });
  children.forEach((child) => node.append(child));
  return node;
}

function kv(key, value) {
  const keyClass = `key ${keyClassFor(key)}`;
  return el("div", { class: "kv" }, [
    el("div", { class: keyClass, text: key }),
    el("div", { class: "value", text: text(value) }),
  ]);
}

function keyClassFor(key) {
  const normalized = String(key).toLowerCase();
  if (normalized.includes("schema")) return "schema-key";
  if (normalized.includes("metadata")) return "metadata-key";
  if (normalized.includes("system answer")) return "answer-key";
  if (normalized.includes("rejection")) return "rejection-key";
  if (normalized.includes("primary cause") || normalized.includes("cause states") || normalized.includes("gold")) {
    return "gold-key";
  }
  if (normalized.includes("question")) return "question-key";
  if (normalized.includes("dataset")) return "dataset-key";
  return "";
}

function chipList(items) {
  return el(
    "div",
    { class: "chips" },
    (items || []).map((item) => {
      if (item && typeof item === "object") {
        const type = item.type ? `: ${item.type}` : "";
        const name = `${item.name || ""}${type}`;
        if (item.description) {
          return el("div", { class: "field-chip" }, [
            el("div", { class: "field-name", text: name }),
            el("div", { class: "field-description", text: item.description }),
          ]);
        }
        return el("span", { class: "chip", text: name });
      }
      return el("span", { class: "chip", text: String(item) });
    }),
  );
}

function datasetLinks(item) {
  const metadata = item.metadata || {};
  const raw = item.source_files || metadata.source_file;
  const files = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const domain = String(item.domain || "").toLowerCase();
  const links = files
    .map((file) => String(file))
    .filter((file) => file.endsWith(".txt"))
    .map((file) => {
      const href = `datasets/${domain}/${encodeURIComponent(file)}`;
      return el("a", { href, target: "_blank", rel: "noopener", text: file });
    });
  if (!links.length) return el("span", { text: "No source file link available." });
  const box = el("div", { class: "dataset-links" });
  links.forEach((link) => box.append(link));
  return box;
}

function currentReview(caseId) {
  if (!state.reviews[caseId]) {
    state.reviews[caseId] = { comment: "", done: false };
  }
  return state.reviews[caseId];
}

function doneCount() {
  return state.cases.filter((item) => currentReview(item.case_id).done).length;
}

function currentPositionText() {
  if (!state.cases.length) return "0/0";
  return `${state.selected + 1}/${state.cases.length}`;
}

function isCaseComplete(item) {
  const review = currentReview(item.case_id);
  return causeNames().every((cause) => Boolean(review[cause]));
}

function causeNames() {
  return ["SchemaDeficiency", "DataGap", "ReasoningFailure", "EvaluationFailure"];
}

function displayCaseId(index) {
  return `C-${String(index + 1).padStart(4, "0")}`;
}

function derivedGateDecision(review) {
  return review.SchemaDeficiency === "SUPPORTED" ? "AUTHORIZE" : "BLOCK";
}

function updateProgressText() {
  const total = state.cases.length;
  const done = doneCount();
  $("progressText").textContent = total
    ? `Case ${currentPositionText()} · ${done}/${total} marked done`
    : "Load cases to start reviewing.";
  $("sidebarProgress").textContent = `${done}/${total} done`;
}

function renderList() {
  const list = $("caseList");
  list.innerHTML = "";
  const mode = $("groupMode")?.value || "domain";
  let lastGroup = null;
  state.cases.forEach((item, index) => {
    const group = mode === "domain" ? item.domain || "Unknown" : "";
    if (mode !== "none" && group !== lastGroup) {
      list.append(el("div", { class: "group-title", text: group }));
      lastGroup = group;
    }
    const review = currentReview(item.case_id);
    const classes = ["case-item"];
    if (index === state.selected) classes.push("active");
    if (review.done) classes.push("done");
    const status = review.done ? "done" : isCaseComplete(item) ? "ready" : "open";
    const btn = el("button", { type: "button", class: classes.join(" ") }, [
      el("div", { class: "case-row-top" }, [
        el("div", { class: "case-id", text: `${index + 1}. ${displayCaseId(index)}` }),
        el("div", { class: `case-status ${status}`, text: status }),
      ]),
      el("div", { class: "case-question", text: item.question || "" }),
      el("div", { class: "case-meta", text: `${item.domain || "runtime"} · blinded controlled case` }),
    ]);
    btn.addEventListener("click", () => {
      state.selected = index;
      render();
    });
    list.append(btn);
  });
}

function renderCase() {
  const root = $("caseView");
  root.innerHTML = "";
  const item = state.cases[state.selected];
  if (!item) {
    root.append(el("div", { class: "panel" }, [el("p", { text: "Load a simple_cases.json file." })]));
    return;
  }
  const review = currentReview(item.case_id);

  root.append(renderNavigation(item, review));

  const left = el("div", { class: "case-col" });
  const right = el("div", { class: "case-col evidence-col" });
  const grid = el("div", { class: "case-grid" }, [left, right]);

  left.append(
    el("section", { class: "panel" }, [
      el("h2", { text: `Case ${currentPositionText()}` }),
      kv("Case ID", displayCaseId(state.selected)),
      kv("Domain", item.domain),
      kv("Question", item.question),
      kv("Related dataset file", ""),
      datasetLinks(item),
    ]),
  );

  right.append(
    el("section", { class: "panel" }, [
      el("h2", { text: "Evidence" }),
      kv("Schema fields", ""),
      chipList(item.schema_fields || []),
      kv("Metadata", item.metadata || {}),
      kv("System answer", item.system_answer),
      kv("Rejection reason", item.rejection_reason),
    ]),
  );

  left.append(
    el("section", { class: "panel" }, [
      el("h2", { text: "Runtime Status" }),
      kv("Status", item.runtime_status || {}),
    ]),
  );
  left.append(renderPosthocAnnotation(item, review));
  root.append(grid);
  root.append(renderNavigation(item, review));
}

function renderNavigation(item, review) {
  const bar = el("section", { class: "nav-panel" });
  const previous = el("button", { type: "button", text: "Previous" });
  previous.disabled = state.selected <= 0;
  previous.addEventListener("click", () => {
    if (state.selected > 0) {
      state.selected -= 1;
      render();
    }
  });

  const status = el("div", { class: "nav-status", text: isCaseComplete(item) ? "Complete" : "Incomplete" });

  const next = el("button", { type: "button", class: "primary", text: state.selected + 1 >= state.cases.length ? "Finish" : "Next" });
  next.addEventListener("click", () => {
    review.done = isCaseComplete(item);
    if (state.selected + 1 < state.cases.length) {
      state.selected += 1;
    }
    render();
  });

  bar.append(previous, status, next);
  return bar;
}

function renderControlledReview(item, review) {
  return renderPosthocAnnotation(item, review);
}

function renderPosthocAnnotation(item, review) {
  const causes = causeNames();
  const states = ["SUPPORTED", "NOT_SUPPORTED", "UNRESOLVED"];
  const panel = el("section", { class: "panel" }, [
    el("h2", { text: "Your Attribution" }),
    el("p", { text: "Assess each hypothesis independently from the shown evidence." }),
  ]);
  causes.forEach((cause) => {
    const options = el("div", { class: "annotation-options" });
    const row = el("div", { class: "annotation-line" }, [el("div", { class: "annotation-cause", text: cause }), options]);
    states.forEach((stateValue) => {
      const input = el("input", { type: "radio", name: `${item.case_id}-${cause}`, value: stateValue });
      input.checked = review[cause] === stateValue;
      input.addEventListener("change", () => {
        review[cause] = stateValue;
        review.annotation_status = causes.every((name) => review[name]) ? "complete" : "incomplete";
        render();
      });
      options.append(el("label", {}, [input, document.createTextNode(stateValue)]));
    });
    panel.append(row);
  });
  const textarea = el("textarea", { placeholder: "Optional note" });
  textarea.value = review.comment || "";
  textarea.addEventListener("input", () => {
    review.comment = textarea.value;
  });
  panel.append(textarea);
  return panel;
}

function render() {
  renderList();
  renderCase();
  updateProgressText();
}

async function loadCases() {
  const url = $("packetUrl").value.trim() || defaultPath;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  const payload = await response.json();
  state.cases = Array.isArray(payload) ? payload : payload.cases || [];
  state.selected = 0;
  state.cases.forEach((item) => currentReview(item.case_id));
  render();
}

function exportReview() {
  const reviewerId = ($("reviewerId").value.trim() || "reviewer_01").replace(/\s+/g, "_");
  if (!$("reviewerId").value.trim()) {
    const proceed = window.confirm("Reviewer name is empty. Export as reviewer_01?");
    if (!proceed) return;
    $("reviewerId").value = "reviewer_01";
  }
  const incomplete = state.cases.filter((item) => !isCaseComplete(item));
  if (incomplete.length) {
    const proceed = window.confirm(`${incomplete.length} cases are incomplete. Export anyway?`);
    if (!proceed) return;
  }
  const annotations = state.cases.map((item, index) => {
    const review = currentReview(item.case_id);
    return {
      display_case_id: displayCaseId(index),
      controlled_case_id: item.case_id,
      domain: item.domain || "",
      cause_states: Object.fromEntries(causeNames().map((cause) => [cause, review[cause] || ""])),
      derived_gate_decision: isCaseComplete(item) ? derivedGateDecision(review) : "",
      comment: review.comment || "",
      done: Boolean(review.done),
    };
  });
  const payload = {
    reviewer_id: reviewerId,
    source: $("packetUrl").value.trim() || defaultPath,
    exported_at: new Date().toISOString(),
    case_count: state.cases.length,
    complete_count: state.cases.length - incomplete.length,
    done_count: doneCount(),
    protocol: "rq1-controlled-benchmark-blind-expert-audit-v1",
    annotations,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `controlled_benchmark_review_${safeFilename(reviewerId)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function safeFilename(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "reviewer_01";
}

$("packetUrl").value = new URLSearchParams(window.location.search).get("cases") || defaultPath;
$("reviewerId").value = new URLSearchParams(window.location.search).get("reviewer") || "";
$("loadBtn").addEventListener("click", () => loadCases().catch((err) => alert(err.message)));
$("exportBtn").addEventListener("click", exportReview);
$("groupMode").addEventListener("change", render);
loadCases().catch(() => render());
