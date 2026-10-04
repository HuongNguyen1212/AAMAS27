const reviewConfig = window.RQ1_REVIEW_CONFIG || {};
const defaultPath = reviewConfig.defaultPath || "rereview_cases.json";
const storageKey = reviewConfig.storageKey || "rq1-controlled-benchmark-rereview-v7";
const reviewProtocol = reviewConfig.protocol || "rq1-controlled-benchmark-source-grounded-rereview-v7";
const usePreviousAnnotations = reviewConfig.usePreviousAnnotations !== false;
const progressLabel = reviewConfig.progressLabel || "review cases";
const progressVerb = reviewConfig.progressVerb || "reviewed";
const controlledDatasetBase = reviewConfig.controlledDatasetBase || "datasets/";
const originalDatasetBase = reviewConfig.originalDatasetBase || "../review_web/datasets/";
const sourceLinksEnabled = reviewConfig.sourceLinksEnabled !== false;
const state = {
  cases: [],
  selected: 0,
  reviews: {},
  requiredCount: 0,
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
  return el("div", { class: "kv" }, [
    el("div", { class: `key ${keyClassFor(key)}`, text: key }),
    el("div", { class: "value", text: text(value) }),
  ]);
}

function keyClassFor(key) {
  const normalized = String(key).toLowerCase();
  if (normalized.includes("schema")) return "schema-key";
  if (normalized.includes("metadata")) return "metadata-key";
  if (normalized.includes("system answer")) return "answer-key";
  if (normalized.includes("rejection")) return "rejection-key";
  if (normalized.includes("question")) return "question-key";
  if (normalized.includes("dataset")) return "dataset-key";
  return "";
}

function chipList(items) {
  const labels = {
    source_pattern: "Source pattern",
    regex: "Pattern",
    depends_on: "Depends on",
    depend: "Source dependency",
    formula: "Formula",
    comment: "Extraction / derivation guidance",
    unit: "Unit",
  };
  return el(
    "div",
    { class: "chips" },
    (items || []).map((item) => {
      if (item && typeof item === "object") {
        const type = item.type ? `: ${item.type}` : "";
        const name = `${item.name || ""}${type}`;
        const card = el("div", { class: "field-chip" }, [
          el("div", { class: "field-name", text: name }),
        ]);
        if (item.description) {
          card.append(el("div", { class: "field-description", text: item.description }));
        }
        const details = Object.entries(item).filter(
          ([key, value]) => !["name", "type", "description"].includes(key)
            && value !== null
            && value !== ""
            && (!Array.isArray(value) || value.length),
        );
        details.forEach(([key, value]) => {
          const renderedValue = text(value);
          const valueNode = key === "comment" && renderedValue.length > 320
            ? el("details", { class: "field-property-value field-guidance" }, [
                el("summary", { text: "Show full guidance" }),
                el("div", { class: "field-guidance-text", text: renderedValue }),
              ])
            : el("span", { class: "field-property-value", text: renderedValue });
          card.append(el("div", { class: "field-property" }, [
            el("span", { class: "field-property-label", text: labels[key] || key.replaceAll("_", " ") }),
            valueNode,
          ]));
        });
        const hasRoute = ["source_pattern", "regex", "depends_on", "depend", "formula", "comment"]
          .some((key) => item[key] !== undefined && item[key] !== null && item[key] !== "");
        if (!hasRoute) {
          card.append(el("div", {
            class: "field-route-missing",
            text: "No explicit source pattern, dependency, formula or field-level extraction guidance is recorded in this schema snapshot.",
          }));
        }
        return card;
      }
      return el("span", { class: "chip", text: String(item) });
    }),
  );
}

function datasetLinks(item) {
  const raw = item.source_files || item.metadata?.source_file;
  const files = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const domain = String(item.domain || "").toLowerCase();
  const links = files
    .map((file) => String(file))
    .filter((file) => file.endsWith(".txt") || file.endsWith(".json"))
    .map((file) => {
      if (!sourceLinksEnabled) {
        return el("span", {
          class: "source-file-name",
          text: file.split("/").at(-1) || file,
        });
      }
      const href = file === "dataset_context.txt"
        ? `${controlledDatasetBase}context/${encodeURIComponent(file)}`
        : file.startsWith("controlled_sources/")
          ? `${controlledDatasetBase}${file.split("/").map(encodeURIComponent).join("/")}`
          : `${originalDatasetBase}${domain}/${encodeURIComponent(file)}`;
      return el("a", {
        href,
        target: "_blank",
        rel: "noopener",
        text: file,
      });
    });
  if (!links.length) return el("span", { text: "No source file link available." });
  const box = el("div", { class: "dataset-links" });
  links.forEach((link) => box.append(link));
  return box;
}

function causeNames() {
  return ["SchemaDeficiency", "DataGap", "ReasoningFailure", "EvaluationFailure"];
}

function isRetained(item) {
  return usePreviousAnnotations && item.review_status === "COMPLETED_PREVIOUS_ROUND";
}

function currentReview(item) {
  if (!state.reviews[item.case_id]) {
    if (isRetained(item)) {
      state.reviews[item.case_id] = {
        ...(item.previous_annotation?.cause_states || {}),
        comment: item.previous_annotation?.comment || "",
        done: true,
        revised: false,
      };
    } else {
      state.reviews[item.case_id] = { comment: "", done: false };
    }
  }
  return state.reviews[item.case_id];
}

function isCaseComplete(item) {
  const review = currentReview(item);
  return causeNames().every((cause) => Boolean(review[cause]));
}

function doneCount() {
  return state.cases.filter((item) => currentReview(item).done).length;
}

function requiredDoneCount() {
  return state.cases.filter((item) => !isRetained(item) && currentReview(item).done).length;
}

function currentPositionText() {
  return state.cases.length ? `${state.selected + 1}/${state.cases.length}` : "0/0";
}

function nextUnfinishedIndex(afterIndex) {
  for (let index = afterIndex + 1; index < state.cases.length; index += 1) {
    if (!currentReview(state.cases[index]).done) return index;
  }
  for (let index = 0; index <= afterIndex; index += 1) {
    if (!currentReview(state.cases[index]).done) return index;
  }
  return -1;
}

function displayCaseId(index) {
  return `C-${String(index + 1).padStart(4, "0")}`;
}

function shownCaseId(item, index) {
  return String(item?.case_id || displayCaseId(index));
}

function derivedGateDecision(review) {
  if (!validCauseState(review.SchemaDeficiency)) return "";
  return review.SchemaDeficiency === "SUPPORTED" ? "AUTHORIZE" : "BLOCK";
}

function persist() {
  const reviews = Object.fromEntries(
    state.cases.map((item) => [item.case_id, currentReview(item)]),
  );
  localStorage.setItem(storageKey, JSON.stringify({
    reviewer: $("reviewerId").value,
    reviews,
  }));
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    $("reviewerId").value = new URLSearchParams(window.location.search).get("reviewer") || saved.reviewer || "";
    Object.entries(saved.reviews || {}).forEach(([caseId, review]) => {
      const item = state.cases.find((entry) => entry.case_id === caseId);
      if (item) state.reviews[caseId] = review;
    });
  } catch {
    localStorage.removeItem(storageKey);
  }
}

function updateProgressText() {
  const total = state.cases.length;
  const requiredDone = requiredDoneCount();
  $("progressText").textContent = total
    ? `Case ${currentPositionText()} · ${requiredDone}/${state.requiredCount} ${progressLabel} done`
    : "Load cases to start reviewing.";
  $("sidebarProgress").textContent = `${requiredDone}/${state.requiredCount} ${progressVerb}`;
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
    const review = currentReview(item);
    const classes = ["case-item"];
    if (index === state.selected) classes.push("active");
    if (review.done) classes.push("done");
    if (isRetained(item)) classes.push("retained");
    const status = review.done ? "done" : isCaseComplete(item) ? "ready" : "pending";
    const button = el("button", { type: "button", class: classes.join(" ") }, [
      el("div", { class: "case-row-top" }, [
        el("div", { class: "case-id", text: `${index + 1}. ${shownCaseId(item, index)}` }),
        el("div", { class: `case-status ${status}`, text: status }),
      ]),
      el("div", { class: "case-question", text: item.question || "" }),
      el("div", { class: "case-meta", text: `${item.domain || "runtime"} · blinded controlled case` }),
    ]);
    button.addEventListener("click", () => {
      state.selected = index;
      render();
    });
    list.append(button);
  });
  const active = list.querySelector(".case-item.active");
  const sidebar = list.closest("aside");
  if (active && sidebar) sidebar.scrollTop = Math.max(0, active.offsetTop - 96);
}

function renderNavigation(item) {
  const bar = el("section", { class: "nav-panel" });
  const previous = el("button", { type: "button", text: "Previous" });
  previous.disabled = state.selected <= 0;
  previous.addEventListener("click", () => {
    if (state.selected > 0) state.selected -= 1;
    render();
  });

  const complete = isCaseComplete(item);
  const status = el("div", { class: "nav-status", text: complete ? "Complete" : "Incomplete" });
  const next = el("button", {
    type: "button",
    class: "primary",
    text: nextUnfinishedIndex(state.selected) < 0 && complete ? "Finish" : "Next",
  });
  next.addEventListener("click", () => {
    const review = currentReview(item);
    review.done = isCaseComplete(item);
    persist();
    const nextIndex = nextUnfinishedIndex(state.selected);
    if (nextIndex >= 0) state.selected = nextIndex;
    render();
  });

  bar.append(previous, status, next);
  return bar;
}

function renderAnnotation(item) {
  const review = currentReview(item);
  const states = ["SUPPORTED", "NOT_SUPPORTED", "UNRESOLVED"];
  const panel = el("section", { class: "panel" }, [
    el("h2", { text: "Your Attribution" }),
    el("p", { text: "Assess each hypothesis independently from the shown evidence." }),
  ]);
  if (isRetained(item)) {
    panel.append(el("div", {
      class: "retained-note",
      text: "You completed this case in the previous review. The previous assessment is shown, but you may revise it.",
    }));
  }
  causeNames().forEach((cause) => {
    const options = el("div", { class: "annotation-options" });
    const row = el("div", { class: "annotation-line" }, [
      el("div", { class: "annotation-cause", text: cause }),
      options,
    ]);
    states.forEach((stateValue) => {
      const input = el("input", {
        type: "radio",
        name: `${item.case_id}-${cause}`,
        value: stateValue,
      });
      input.checked = review[cause] === stateValue;
      input.addEventListener("change", () => {
        review[cause] = stateValue;
        review.done = false;
        review.revised = true;
        persist();
        render();
      });
      options.append(el("label", {}, [
        input,
        document.createTextNode(stateValue),
      ]));
    });
    panel.append(row);
  });
  const textarea = el("textarea", { placeholder: "Optional note" });
  textarea.value = review.comment || "";
  textarea.addEventListener("input", () => {
    review.comment = textarea.value;
    review.done = false;
    review.revised = true;
    persist();
    renderList();
    updateProgressText();
  });
  panel.append(textarea);
  return panel;
}

function renderCase() {
  const root = $("caseView");
  root.innerHTML = "";
  const item = state.cases[state.selected];
  if (!item) {
    root.append(el("div", { class: "panel" }, [el("p", { text: "Load a case packet." })]));
    return;
  }

  root.append(renderNavigation(item));
  const left = el("div", { class: "case-col" });
  const right = el("div", { class: "case-col evidence-col" });
  const grid = el("div", { class: "case-grid" }, [left, right]);
  const sourceCount = Array.isArray(item.source_files) ? item.source_files.length : 0;
  const shownMetadata = item.metadata_records || item.metadata || {};

  left.append(el("section", { class: "panel" }, [
    el("h2", { text: `Case ${currentPositionText()}` }),
    kv("Case ID", shownCaseId(item, state.selected)),
    kv("Domain", item.domain),
    kv("Question", item.question),
    kv(sourceCount === 1 ? "Related dataset file" : "Related dataset files", ""),
    datasetLinks(item),
  ]));

  right.append(el("section", { class: "panel" }, [
    el("h2", { text: "Evidence" }),
    kv("Schema fields", ""),
    chipList(item.schema_fields || []),
    kv(Array.isArray(shownMetadata) ? "Metadata records" : "Metadata", shownMetadata),
    kv("Permitted source evidence", item.source_evidence || {}),
    kv("System answer", item.system_answer),
    kv("Rejection reason", item.rejection_reason),
  ]));

  left.append(renderAnnotation(item));
  root.append(grid);
  root.append(renderNavigation(item));
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
  state.requiredCount = Array.isArray(payload)
    ? state.cases.filter((item) => !isRetained(item)).length
    : Number(payload.rereview_required_count ?? state.cases.filter((item) => !isRetained(item)).length);
  const requestedCase = new URLSearchParams(window.location.search).get("case");
  const requestedIndex = state.cases.findIndex((item) => item.case_id === requestedCase);
  restore();
  state.cases.forEach((item) => currentReview(item));
  const firstRequired = state.cases.findIndex((item) => !isRetained(item));
  state.selected = requestedIndex >= 0 ? requestedIndex : firstRequired >= 0 ? firstRequired : 0;
  render();
}

function exportReview() {
  const reviewerId = ($("reviewerId").value.trim() || "reviewer_01").replace(/\s+/g, "_");
  if (!$("reviewerId").value.trim()) {
    const proceed = window.confirm("Reviewer name is empty. Export as reviewer_01?");
    if (!proceed) return;
    $("reviewerId").value = "reviewer_01";
  }
  const annotations = state.cases.map((item, index) => {
    const review = currentReview(item);
    return {
      display_case_id: shownCaseId(item, index),
      controlled_case_id: item.case_id,
      domain: item.domain || "",
      cause_states: Object.fromEntries(causeNames().map((cause) => [cause, review[cause] || ""])),
      derived_gate_decision: derivedGateDecision(review),
      comment: review.comment || "",
      done: Boolean(review.done),
      retained_from_previous_review: isRetained(item),
      revised_in_current_review: Boolean(review.revised),
    };
  });
  const completeCount = state.cases.filter((item) => isCaseComplete(item)).length;
  const allComplete = completeCount === state.cases.length;
  const payload = {
    reviewer_id: reviewerId,
    source: $("packetUrl").value.trim() || defaultPath,
    exported_at: new Date().toISOString(),
    case_count: state.cases.length,
    complete_count: completeCount,
    incomplete_count: state.cases.length - completeCount,
    done_count: doneCount(),
    resume_case_id: state.cases[state.selected]?.case_id || "",
    protocol: reviewProtocol,
    annotations,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `controlled_benchmark_review_${safeFilename(reviewerId)}_${allComplete ? "validated" : "progress"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function validCauseState(value) {
  return ["SUPPORTED", "NOT_SUPPORTED", "UNRESOLVED"].includes(value);
}

async function importProgress(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload.protocol !== reviewProtocol) {
      throw new Error("This progress file was created by a different review packet or website version.");
    }
    const annotations = Array.isArray(payload.annotations) ? payload.annotations : [];
    if (!annotations.length) {
      throw new Error("This JSON file does not contain review annotations.");
    }

    const byDisplayId = new Map(
      state.cases.map((item, index) => [shownCaseId(item, index), item]),
    );
    const byControlledId = new Map(state.cases.map((item) => [item.case_id, item]));
    let importedCount = 0;

    annotations.forEach((annotation) => {
      const item = byDisplayId.get(annotation.display_case_id)
        || byControlledId.get(annotation.controlled_case_id);
      if (!item) return;
      const review = currentReview(item);
      const importedStates = annotation.cause_states || {};
      causeNames().forEach((cause) => {
        if (validCauseState(importedStates[cause])) review[cause] = importedStates[cause];
      });
      if (typeof annotation.comment === "string") review.comment = annotation.comment;
      review.revised = Boolean(annotation.revised_in_current_review);
      review.done = Boolean(annotation.done) && causeNames().every((cause) => validCauseState(review[cause]));
      importedCount += 1;
    });

    if (typeof payload.reviewer_id === "string" && payload.reviewer_id.trim()) {
      $("reviewerId").value = payload.reviewer_id;
    }
    const resumeIndex = state.cases.findIndex((item) => item.case_id === payload.resume_case_id);
    const firstUnfinished = state.cases.findIndex((item) => !currentReview(item).done);
    state.selected = resumeIndex >= 0 ? resumeIndex : firstUnfinished >= 0 ? firstUnfinished : 0;
    persist();
    render();
    window.alert(`Imported ${importedCount} cases. ${doneCount()}/${state.cases.length} are marked done.`);
  } catch (error) {
    window.alert(`Could not import progress: ${error.message}`);
  } finally {
    event.target.value = "";
  }
}

function safeFilename(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "reviewer_01";
}

$("packetUrl").value = new URLSearchParams(window.location.search).get("cases") || defaultPath;
$("reviewerId").addEventListener("input", persist);
$("loadBtn").addEventListener("click", () => loadCases().catch((error) => alert(error.message)));
$("exportBtn").addEventListener("click", exportReview);
$("importProgressBtn").addEventListener("click", () => $("importProgressFile").click());
$("importProgressFile").addEventListener("change", importProgress);
$("groupMode").addEventListener("change", render);
loadCases().catch(() => render());
