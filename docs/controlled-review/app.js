const reviewConfig = window.RQ1_REVIEW_CONFIG || {};
const defaultPath = reviewConfig.defaultPath || "rereview_cases.json";
const storageKey = reviewConfig.storageKey || "rq1-controlled-benchmark-rereview-v7";
const reviewProtocol = reviewConfig.protocol || "rq1-controlled-benchmark-source-grounded-rereview-v7";
const usePreviousAnnotations = reviewConfig.usePreviousAnnotations !== false;
const progressLabel = reviewConfig.progressLabel || "review cases";
const progressVerb = reviewConfig.progressVerb || "reviewed";
const controlledDatasetBase = reviewConfig.controlledDatasetBase || "datasets/";
const originalDatasetBase = reviewConfig.originalDatasetBase || "../review_web/datasets/";
const sourceFilesDownloadable = reviewConfig.sourceFilesDownloadable !== false;
const showSourceSection = reviewConfig.showSourceSection !== false;
const caseDescriptor = reviewConfig.caseDescriptor || "blinded controlled case";
const exportFilenamePrefix = reviewConfig.exportFilenamePrefix || "controlled_benchmark_review";
const showRouteWarnings = reviewConfig.showRouteWarnings !== false;
const emptyMetadataMessage = reviewConfig.emptyMetadataMessage
  || "No question-relevant value or source reference is currently available.";
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

function plainName(value) {
  const words = String(value || "").replaceAll("_", " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unnamed information";
}

function plainValue(value) {
  if (value === null || value === undefined || value === "") return "Not available";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    if (!value.length) return "No values available";
    return value.map((entry) => typeof entry === "object" ? JSON.stringify(entry) : String(entry)).join("; ");
  }
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function storageDescription(item) {
  if (item.value_representation === "source_column_references") {
    return "references to source-data columns; the full column is not copied here";
  }
  const labels = {
    number: "one numeric value",
    integer: "one whole-number value",
    string: "one text value",
    boolean: "a Yes/No value",
    array: "a list of values",
    object: "a structured set of values",
  };
  return labels[item.type] || "a value needed by the system";
}

function dataTypeDescription(item) {
  const labels = {
    number: "number",
    integer: "whole number",
    string: "text",
    boolean: "Yes/No",
    array: "list",
    object: "structured object",
  };
  return labels[item.type] || String(item.type || "not specified");
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
  if (normalized.includes("source-column route")) return "metadata-key";
  if (normalized.includes("system answer")) return "answer-key";
  if (normalized.includes("rejection")) return "rejection-key";
  if (normalized.includes("question")) return "question-key";
  if (normalized.includes("dataset")) return "dataset-key";
  return "";
}

function routeList(items) {
  return el(
    "div",
    { class: "route-list" },
    (items || []).map((item) => {
      if (item && typeof item === "object") {
        const card = el("div", { class: "route-item" }, [
          el("div", { class: "route-name", text: plainName(item.name) }),
        ]);
        card.append(el("div", { class: "route-detail" }, [
          el("strong", { text: "Field name: " }),
          document.createTextNode(String(item.name || "not specified")),
        ]));
        card.append(el("div", { class: "route-detail" }, [
          el("strong", { text: "Data type: " }),
          document.createTextNode(dataTypeDescription(item)),
        ]));
        if (item.description) {
          card.append(el("div", { class: "route-detail" }, [
            el("strong", { text: "Purpose: " }),
            document.createTextNode(String(item.description)),
          ]));
        }

        card.append(el("div", { class: "route-detail" }, [
          el("strong", { text: "What it stores: " }),
          document.createTextNode(storageDescription(item)),
        ]));

        const inputs = item.depends_on || item.depend;
        if (inputs && (!Array.isArray(inputs) || inputs.length)) {
          card.append(el("div", { class: "route-detail" }, [
            el("strong", { text: "Read from: " }),
            document.createTextNode(Array.isArray(inputs) ? inputs.join(", ") : String(inputs)),
          ]));
        }

        const formula = item.formula;
        const guidance = item.comment && item.comment !== item.formula ? item.comment : "";
        if (formula) card.append(el("div", { class: "route-detail" }, [
          el("strong", { text: "Calculation or decision rule: " }),
          document.createTextNode(String(formula)),
        ]));

        if (guidance) card.append(el("div", { class: "route-detail" }, [
          el("strong", { text: formula ? "Additional extraction guidance: " : "How to obtain it: " }),
          document.createTextNode(String(guidance)),
        ]));

        if (item.unit) card.append(el("div", { class: "route-detail" }, [
          el("strong", { text: "Unit: " }),
          document.createTextNode(String(item.unit)),
        ]));

        if (item.source_pattern) card.append(el("div", { class: "route-detail" }, [
          el("strong", { text: "Source access: " }),
          document.createTextNode(String(item.source_pattern).replaceAll("_", " ")),
        ]));

        if (showRouteWarnings && !inputs && !formula && !guidance && !item.source_pattern) card.append(el("div", {
          class: "route-warning",
          text: "No source location or calculation rule is shown for this item.",
        }));

        return card;
      }
      return el("div", { class: "route-item", text: plainName(item) });
    }),
  );
}

function valueList(values) {
  const entries = Object.entries(values || {});
  if (!entries.length) {
    return emptyMetadataMessage
      ? el("div", { class: "empty-evidence", text: emptyMetadataMessage })
      : document.createDocumentFragment();
  }
  return el("div", { class: "information-list" }, entries.map(([name, value]) => {
    return el("div", { class: "information-item" }, [
      el("div", { class: "information-name", text: plainName(name) }),
      el("div", { class: "information-value", text: plainValue(value) }),
    ]);
  }));
}

function sourceRouteList(routes) {
  const entries = Object.entries(routes || {});
  if (!entries.length) return null;
  return el("div", { class: "information-list" }, entries.map(([name, bindings]) => {
    const lines = (bindings || []).map((binding) => {
      const count = Number(binding.source_file_count || 0);
      const scope = count === 1 ? "1 source file" : `${count} source files`;
      return `${binding.column}${binding.unit ? ` (${binding.unit})` : ""} · ${scope}`;
    });
    return el("div", { class: "information-item" }, [
      el("div", { class: "information-name", text: plainName(name) }),
      el("div", { class: "information-value", text: lines.join("; ") || "No source column selected" }),
    ]);
  }));
}

function jsonDetails(title, value) {
  return el("details", { class: "raw-json" }, [
    el("summary", { text: title }),
    el("pre", { text: JSON.stringify(value, null, 2) }),
  ]);
}

function splitMetadata(item) {
  const fields = new Map(
    (item.schema_fields || []).map((field) => [field.name, field]),
  );
  const values = {};
  const sourceRoutes = {};
  Object.entries(item.metadata || {}).forEach(([name, value]) => {
    if (fields.get(name)?.value_representation === "source_column_references") {
      const grouped = new Map();
      (Array.isArray(value) ? value : []).forEach((entry) => {
        const key = `${entry?.column || ""}\u0000${entry?.unit || ""}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            column: entry?.column || "column not specified",
            unit: entry?.unit || "",
            source_files: new Set(),
          });
        }
        if (entry?.source_file) grouped.get(key).source_files.add(entry.source_file);
      });
      sourceRoutes[name] = [...grouped.values()].map((entry) => ({
        column: entry.column,
        ...(entry.unit ? { unit: entry.unit } : {}),
        source_file_count: entry.source_files.size,
      }));
    } else {
      values[name] = value;
    }
  });
  return { values, sourceRoutes };
}

function datasetLinks(item) {
  const raw = item.source_files || item.metadata?.source_file;
  const files = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const domain = String(item.domain || "").toLowerCase();
  const links = files
    .map((file) => String(file))
    .filter((file) => file.endsWith(".txt") || file.endsWith(".json"))
    .map((file) => {
      if (!sourceFilesDownloadable) {
        return el("span", { class: "source-file-name", text: file.split("/").at(-1) });
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

function sourceEvidenceSummary(sourceEvidence) {
  const records = sourceEvidence?.records || [];
  if (!records.length) {
    return el("div", { class: "empty-evidence", text: "No source record information is shown." });
  }
  return el("div", { class: "information-list source-summary" }, records.map((record, index) => {
    const sourceFile = record?.record_metadata?.source_file || record?.record_id || `source-${index + 1}`;
    const columns = Array.isArray(record?.table_columns) ? record.table_columns : [];
    const details = [
      `${Number(record?.row_count || 0).toLocaleString()} rows`,
      columns.length ? `Columns: ${columns.join(", ")}` : "No table columns shown",
    ];
    return el("div", { class: "information-item" }, [
      el("div", { class: "information-name", text: sourceFile }),
      el("div", { class: "information-value", text: details.join(". ") }),
    ]);
  }));
}

function causeNames() {
  return ["SchemaDeficiency", "DataGap", "ReasoningFailure", "EvaluationFailure"];
}

const causeCopy = {
  SchemaDeficiency: {
    title: "1. Missing capability (Schema Deficiency)",
    question: "Does the schema lack a necessary field or rule for reading or calculating the answer?",
  },
  DataGap: {
    title: "2. Missing source information (Data Gap)",
    question: "Is required information absent from the permitted source files and available metadata?",
  },
  ReasoningFailure: {
    title: "3. Answer-use problem (Reasoning Failure)",
    question: "Did the system know how to obtain the information, but still produce a wrong or missing answer?",
  },
  EvaluationFailure: {
    title: "4. Wrong rejection (Evaluation Failure)",
    question: "Is the produced answer scientifically acceptable even though it was rejected?",
  },
};

const stateCopy = {
  SUPPORTED: "Yes: supported by the shown information",
  NOT_SUPPORTED: "No: not supported",
  UNRESOLVED: "Cannot decide from what is shown",
};

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
      el("div", { class: "case-meta", text: `${item.domain || "runtime"} · ${caseDescriptor}` }),
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
    el("h2", { text: "Your four judgments" }),
    el("p", { text: "Answer every question separately. More than one Yes is allowed when the shown information supports it." }),
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
      el("div", { class: "annotation-cause", text: causeCopy[cause].title }),
      el("div", { class: "annotation-question", text: causeCopy[cause].question }),
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
        document.createTextNode(stateCopy[stateValue]),
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
  const shownMetadata = splitMetadata(item);

  const caseSummary = [
    el("h2", { text: `Case ${currentPositionText()}` }),
    kv("Case ID", shownCaseId(item, state.selected)),
    kv("Domain", item.domain),
    kv("Question", item.question),
  ];
  if (showSourceSection && item.hide_source_section !== true) {
    const sourceLabel = sourceCount === 1 ? "Available source file" : "Available source files";
    if (sourceCount === 0) {
      caseSummary.push(kv(sourceLabel, "None"));
    } else {
      caseSummary.push(
        kv(sourceLabel, ""),
        datasetLinks(item),
        el("h3", { text: "Source information available to the system" }),
        sourceEvidenceSummary(item.source_evidence),
      );
    }
  }
  left.append(el("section", { class: "panel" }, caseSummary));

  const routes = sourceRouteList(shownMetadata.sourceRoutes);
  right.append(el("section", { class: "panel" }, [
    el("div", { class: "start-here-label", text: "Start here" }),
    el("h2", { text: "Information shown to the system" }),
    el("div", { class: "evidence-section" }, [
      el("h3", { text: "A. Schema fields available to the system" }),
      el("p", { class: "section-help", text: "Each field below shows what the system can store and, when needed, how it can read or calculate that information. Only the fields and rules shown here exist in this case." }),
      routeList(item.schema_fields || []),
      jsonDetails("Schema JSON", item.schema_fields || []),
    ]),
    el("div", { class: "evidence-section" }, [
      el("h3", { text: "B. Metadata available from the current source data" }),
      el("p", { class: "section-help", text: "These are the values and source-column references currently available for the schema fields. Only the metadata shown here is available in this case." }),
      valueList(shownMetadata.values),
      ...(routes ? [routes] : []),
      jsonDetails("Metadata JSON", item.metadata || {}),
    ]),
    el("div", { class: "evidence-section answer-section" }, [
      el("h3", { text: "C. Answer produced from the available information" }),
      el("div", { class: "answer-text", text: item.system_answer || "No answer." }),
    ]),
    el("div", { class: "evidence-section rejection-section" }, [
      el("h3", { text: "D. Evaluator decision about the answer" }),
      el("div", { class: "rejection-text", text: item.rejection_reason || "No evaluator feedback." }),
    ]),
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
  link.download = `${safeFilename(exportFilenamePrefix)}_${safeFilename(reviewerId)}_${allComplete ? "validated" : "progress"}.json`;
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
