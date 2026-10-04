const config = window.BASELINE_REVIEW_CONFIG;

const state = {
  candidates: [],
  selected: 0,
  reviews: {},
  reviewerId: "",
  sourceProtocol: "",
};

const CHECKS = [
  ["source_support", "Source support", "Does the permitted source support the fixed reference answer?"],
  ["schema_capacity", "Schema capacity", "Can the proposed schema represent or derive the required information?"],
  ["metadata_grounding", "Metadata grounding", "Are the proposed metadata values correct and grounded in the permitted source?"],
  ["answer_correctness", "Answer correctness", "Is the proposed baseline answer correct and supported?"],
];

const $ = (id) => document.getElementById(id);

function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs) {
    Object.entries(options.attrs).forEach(([key, value]) => node.setAttribute(key, value));
  }
  children.forEach((child) => node.append(child));
  return node;
}

function defaultReview() {
  return {
    judgments: Object.fromEntries(CHECKS.map(([key]) => [key, ""])),
    disposition: "",
    corrected_answer: "",
    corrected_target_route_json: "",
    corrected_source_files_json: "",
    corrected_schema_json: "",
    corrected_metadata_json: "",
    comment: "",
    done: false,
    reviewed_at: null,
  };
}

function reviewFor(candidate) {
  if (!state.reviews[candidate.baseline_id]) {
    state.reviews[candidate.baseline_id] = defaultReview();
  }
  return state.reviews[candidate.baseline_id];
}

function saveLocal() {
  const payload = {
    protocol: config.protocol,
    reviewer_id: state.reviewerId,
    selected: state.selected,
    reviews: state.reviews,
  };
  localStorage.setItem(config.storageKey, JSON.stringify(payload));
}

function restoreLocal() {
  const raw = localStorage.getItem(config.storageKey);
  if (!raw) return;
  try {
    const payload = JSON.parse(raw);
    if (payload.protocol !== config.protocol) return;
    state.reviewerId = payload.reviewer_id || "";
    state.selected = Number.isInteger(payload.selected) ? payload.selected : 0;
    state.reviews = payload.reviews || {};
  } catch (error) {
    console.warn("Could not restore baseline review progress", error);
  }
}

function normalizedFileName(path) {
  const parts = String(path).split("/");
  return parts[parts.length - 1] || path;
}

function sourceLinks(candidate) {
  const box = element("div", { className: "source-links" });
  const files = candidate.source_files || [];
  const records = candidate.permitted_source_evidence?.records || [];
  if (!files.length) {
    box.append(element("span", { className: "muted", text: "No source file is attached." }));
    return box;
  }
  files.forEach((path, index) => {
    const sourceName = records[index]?.record_metadata?.source_file || normalizedFileName(path);
    if (config.sourceLinksEnabled === false) {
      box.append(element("span", {
        className: "source-link",
        text: files.length === 1 ? sourceName : `Source ${index + 1}: ${sourceName}`,
      }));
      return;
    }
    const link = element("a", {
      className: "source-link",
      text: files.length === 1 ? sourceName : `Source ${index + 1}: ${sourceName}`,
      attrs: {
        href: `${config.sourceBase}${path.split("/").map(encodeURIComponent).join("/")}`,
        target: "_blank",
        rel: "noopener",
      },
    });
    box.append(link);
  });
  return box;
}

function sourceSummary(candidate) {
  const evidence = candidate.permitted_source_evidence || {};
  const records = evidence.records || [];
  const grid = element("div", { className: "source-summary" });
  records.forEach((record) => {
    const sourceName = record.record_metadata?.source_file || record.record_id || "Source record";
    const facts = [
      `${record.row_count ?? "Unknown"} rows`,
      `${(record.table_columns || []).length} columns`,
      record.table_rows_available ? "measurements available" : "measurements unavailable",
    ];
    grid.append(
      element("div", { className: "source-record" }, [
        element("strong", { text: sourceName }),
        element("span", { text: facts.join(" · ") }),
        element("span", { className: "columns", text: (record.table_columns || []).join(", ") || "No tabular columns" }),
      ]),
    );
  });
  return grid;
}

function fieldCard(field, requiredNames) {
  const required = requiredNames.has(field.name);
  const card = element("section", { className: `field-card${required ? " required" : ""}` });
  const title = element("div", { className: "field-title" }, [
    element("strong", { text: field.name || "Unnamed field" }),
    element("span", { className: "type-tag", text: field.type || "unspecified" }),
  ]);
  if (required) title.append(element("span", { className: "required-tag", text: "Required route" }));
  card.append(title);
  if (field.description) card.append(element("p", { text: field.description }));

  const details = [
    ["Source pattern", field.source_pattern],
    ["Pattern", field.regex],
    ["Depends on", field.depends_on],
    ["Formula", field.formula],
    ["Extraction / derivation guidance", field.comment],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");

  details.forEach(([label, value]) => {
    card.append(
      element("div", { className: "field-detail" }, [
        element("span", { text: label }),
        element("code", { text: Array.isArray(value) ? value.join(", ") : String(value) }),
      ]),
    );
  });
  return card;
}

function schemaSection(candidate) {
  const section = element("section", { className: "panel" });
  section.append(
    element("div", { className: "panel-heading" }, [
      element("div", {}, [
        element("h2", { text: "Proposed schema" }),
        element("p", { text: "Required route fields are highlighted." }),
      ]),
      element("span", {
        className: "count-tag",
        text: `${(candidate.proposed_baseline_schema_fields || []).length} fields`,
      }),
    ]),
  );

  const requiredNames = new Set((candidate.required_route_fields || []).map((field) => field.name));
  const requiredGrid = element("div", { className: "field-grid" });
  (candidate.proposed_baseline_schema_fields || [])
    .filter((field) => requiredNames.has(field.name))
    .forEach((field) => requiredGrid.append(fieldCard(field, requiredNames)));
  section.append(requiredGrid);

  const otherFields = (candidate.proposed_baseline_schema_fields || []).filter((field) => !requiredNames.has(field.name));
  if (otherFields.length) {
    const details = element("details", { className: "schema-details" }, [
      element("summary", { text: `Show ${otherFields.length} additional schema fields` }),
    ]);
    const otherGrid = element("div", { className: "field-grid compact" });
    otherFields.forEach((field) => otherGrid.append(fieldCard(field, requiredNames)));
    details.append(otherGrid);
    section.append(details);
  }
  return section;
}

function jsonBlock(value) {
  return element("pre", { className: "json-block", text: JSON.stringify(value, null, 2) });
}

function proposedMetadata(candidate) {
  return candidate.proposed_metadata || candidate.reconstructed_metadata || {};
}

function targetRouteSection(candidate) {
  const route = candidate.target_route || {};
  const assessment = candidate.automatic_assessment || {};
  const status = assessment.construction_state || route.construction_state || "UNASSESSED";
  const issues = assessment.issues || route.precheck_issues || [];
  const section = element("section", { className: "panel route-panel" }, [
    element("div", { className: "panel-heading" }, [
      element("div", {}, [
        element("h2", { text: "Target route" }),
        element("p", { text: route.procedure || "No route procedure provided." }),
      ]),
      element("span", { className: `construction-state ${status.toLowerCase()}`, text: status.replaceAll("_", " ") }),
    ]),
  ]);
  const facts = element("div", { className: "route-facts" }, [
    labeledValue("Route ID", route.route_id || "Not provided"),
    labeledValue("Evidence kind", route.evidence_kind || "Not provided"),
    labeledValue("Source scope", route.source_scope || "Not provided"),
    labeledValue("Required fields", (route.required_fields || []).join(", ") || "Not provided"),
  ]);
  section.append(facts);
  if (issues.length) {
    const list = element("ul", { className: "issue-list" });
    issues.forEach((issue) => list.append(element("li", { text: issue })));
    section.append(element("div", { className: "issues" }, [element("strong", { text: "Precheck issues" }), list]));
  }
  return section;
}

function labeledValue(label, value, className = "") {
  return element("div", { className: `labeled-value ${className}`.trim() }, [
    element("div", { className: "value-label", text: label }),
    element("div", { className: "value-content", text: value || "Not provided" }),
  ]);
}

function choiceGroup(candidate, review, key, label, question) {
  const row = element("fieldset", { className: "check-row" });
  row.append(element("legend", { text: label }), element("p", { text: question }));
  const choices = element("div", { className: "choice-group" });
  ["YES", "NO", "UNCERTAIN"].forEach((value) => {
    const id = `${candidate.baseline_id}-${key}-${value}`;
    const input = element("input", { attrs: { id, type: "radio", name: `${candidate.baseline_id}-${key}`, value } });
    input.checked = review.judgments[key] === value;
    input.addEventListener("change", () => {
      review.judgments[key] = value;
      review.done = false;
      saveLocal();
      render();
    });
    choices.append(element("label", { attrs: { for: id } }, [input, document.createTextNode(value)]));
  });
  row.append(choices);
  return row;
}

function correctionEditor(candidate, review) {
  const details = element("details", { className: "correction-editor" });
  if (review.disposition === "REVISE") details.open = true;
  details.append(element("summary", { text: "Proposed corrections" }));

  const answer = element("textarea", {
    attrs: { rows: "3", placeholder: candidate.proposed_baseline_answer || "Corrected baseline answer" },
  });
  answer.value = review.corrected_answer || "";
  answer.addEventListener("input", () => {
    review.corrected_answer = answer.value;
    review.done = false;
    saveLocal();
  });

  const route = element("textarea", {
    attrs: { rows: "10", spellcheck: "false", placeholder: JSON.stringify(candidate.target_route || {}, null, 2) },
  });
  route.value = review.corrected_target_route_json || "";
  route.addEventListener("input", () => {
    review.corrected_target_route_json = route.value;
    review.done = false;
    saveLocal();
  });

  const sourceFiles = element("textarea", {
    attrs: { rows: "4", spellcheck: "false", placeholder: JSON.stringify(candidate.source_files || [], null, 2) },
  });
  sourceFiles.value = review.corrected_source_files_json || "";
  sourceFiles.addEventListener("input", () => {
    review.corrected_source_files_json = sourceFiles.value;
    review.done = false;
    saveLocal();
  });

  const schema = element("textarea", {
    attrs: { rows: "10", spellcheck: "false", placeholder: JSON.stringify(candidate.proposed_baseline_schema_fields || [], null, 2) },
  });
  schema.value = review.corrected_schema_json || "";
  schema.addEventListener("input", () => {
    review.corrected_schema_json = schema.value;
    review.done = false;
    saveLocal();
  });

  const metadata = element("textarea", {
    attrs: { rows: "11", spellcheck: "false", placeholder: JSON.stringify(proposedMetadata(candidate), null, 2) },
  });
  metadata.value = review.corrected_metadata_json || "";
  metadata.addEventListener("input", () => {
    review.corrected_metadata_json = metadata.value;
    review.done = false;
    saveLocal();
  });

  details.append(
    element("label", { className: "editor-field" }, [element("span", { text: "Corrected answer" }), answer]),
    element("label", { className: "editor-field" }, [element("span", { text: "Corrected target route (JSON)" }), route]),
    element("label", { className: "editor-field" }, [element("span", { text: "Corrected source files (JSON)" }), sourceFiles]),
    element("label", { className: "editor-field" }, [element("span", { text: "Corrected schema fields (JSON)" }), schema]),
    element("label", { className: "editor-field" }, [element("span", { text: "Corrected metadata (JSON)" }), metadata]),
  );
  return details;
}

function validationError(review, candidate) {
  const unanswered = CHECKS.filter(([key]) => !review.judgments[key]);
  if (unanswered.length) return "Complete all four validation checks.";
  if (!review.disposition) return "Select Approve, Revise or Exclude.";
  if (review.disposition === "APPROVE" && CHECKS.some(([key]) => review.judgments[key] !== "YES")) {
    return "Approve requires YES for all four validation checks.";
  }
  const constructionState = candidate?.automatic_assessment?.construction_state || "READY_FOR_EXPERT_REVIEW";
  if (
    review.disposition === "APPROVE" &&
    constructionState !== "READY_FOR_EXPERT_REVIEW" &&
    !review.corrected_target_route_json.trim() &&
    !review.corrected_source_files_json.trim() &&
    !review.corrected_schema_json.trim() &&
    !review.corrected_metadata_json.trim() &&
    !review.comment.trim()
  ) {
    return "Explain or correct the flagged construction issue before approving this baseline.";
  }
  if (review.disposition === "REVISE") {
    const hasCorrection = Boolean(
      review.corrected_answer.trim() ||
        review.corrected_target_route_json.trim() ||
        review.corrected_source_files_json.trim() ||
        review.corrected_schema_json.trim() ||
        review.corrected_metadata_json.trim() ||
        review.comment.trim(),
    );
    if (!hasCorrection) return "Describe or enter the correction required for this baseline.";
  }
  if (review.disposition === "EXCLUDE" && !review.comment.trim()) {
    return "Give a reason for excluding this baseline.";
  }
  for (const [label, raw] of [
    ["Corrected target route", review.corrected_target_route_json],
    ["Corrected source files", review.corrected_source_files_json],
    ["Corrected schema fields", review.corrected_schema_json],
    ["Corrected metadata", review.corrected_metadata_json],
  ]) {
    if (!raw.trim()) continue;
    try {
      JSON.parse(raw);
    } catch (error) {
      return `${label} is not valid JSON.`;
    }
  }
  return "";
}

function decisionSection(candidate, review) {
  const section = element("section", { className: "panel validation-panel" }, [
    element("h2", { text: "Expert validation" }),
  ]);
  CHECKS.forEach(([key, label, question]) => section.append(choiceGroup(candidate, review, key, label, question)));

  const disposition = element("fieldset", { className: "disposition" }, [
    element("legend", { text: "Baseline decision" }),
  ]);
  const options = element("div", { className: "decision-options" });
  [
    ["APPROVE", "Approve"],
    ["REVISE", "Revise"],
    ["EXCLUDE", "Exclude"],
  ].forEach(([value, label]) => {
    const id = `${candidate.baseline_id}-decision-${value}`;
    const input = element("input", { attrs: { id, type: "radio", name: `${candidate.baseline_id}-decision`, value } });
    input.checked = review.disposition === value;
    input.addEventListener("change", () => {
      review.disposition = value;
      review.done = false;
      saveLocal();
      render();
    });
    options.append(element("label", { className: value.toLowerCase(), attrs: { for: id } }, [input, document.createTextNode(label)]));
  });
  disposition.append(options);
  section.append(disposition, correctionEditor(candidate, review));

  const note = element("textarea", { attrs: { rows: "4", placeholder: "Correction details or exclusion reason" } });
  note.value = review.comment || "";
  note.addEventListener("input", () => {
    review.comment = note.value;
    review.done = false;
    saveLocal();
  });
  section.append(element("label", { className: "editor-field note-field" }, [element("span", { text: "Reviewer note" }), note]));

  const error = validationError(review, candidate);
  if (error && (review.disposition || Object.values(review.judgments).some(Boolean))) {
    section.append(element("div", { className: "validation-message", text: error }));
  }
  return section;
}

function navigation(candidate, review) {
  const bar = element("div", { className: "navigation" });
  const previous = element("button", { className: "button secondary", text: "Previous" });
  previous.disabled = state.selected === 0;
  previous.addEventListener("click", () => {
    state.selected -= 1;
    saveLocal();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  const status = element("span", {
    className: `completion ${review.done ? "done" : "pending"}`,
    text: review.done ? "Validated" : "Pending",
  });

  const next = element("button", {
    className: "button primary",
    text: state.selected === state.candidates.length - 1 ? "Save baseline" : "Save & Next",
  });
  next.addEventListener("click", () => {
    const error = validationError(review, candidate);
    if (error) {
      window.alert(error);
      return;
    }
    review.done = true;
    review.reviewed_at = new Date().toISOString();
    if (state.selected < state.candidates.length - 1) state.selected += 1;
    saveLocal();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  bar.append(previous, status, next);
  return bar;
}

function renderCase() {
  const root = $("caseView");
  root.innerHTML = "";
  const candidate = state.candidates[state.selected];
  if (!candidate) {
    root.append(element("section", { className: "panel empty-state" }, [element("p", { text: "No baseline loaded." })]));
    return;
  }
  const review = reviewFor(candidate);
  root.append(navigation(candidate, review));

  const heading = element("section", { className: "panel case-heading" }, [
    element("div", {}, [
      element("div", { className: "eyebrow", text: `Baseline ${state.selected + 1}/${state.candidates.length} · ${candidate.domain}` }),
      element("h2", { text: `${candidate.query_id}: ${candidate.question}` }),
      element("code", { className: "baseline-id", text: candidate.baseline_id }),
    ]),
    review.done ? element("span", { className: `decision-badge ${review.disposition.toLowerCase()}`, text: review.disposition }) : element("span", { className: "decision-badge pending", text: "PENDING" }),
  ]);
  root.append(heading);
  root.append(targetRouteSection(candidate));

  const evidenceGrid = element("div", { className: "evidence-grid" });
  evidenceGrid.append(
    element("section", { className: "panel" }, [
      element("h2", { text: "Reference and proposed answer" }),
      labeledValue("Fixed reference answer", candidate.fixed_reference_answer, "reference"),
      labeledValue("Proposed baseline answer", candidate.proposed_baseline_answer, "answer"),
    ]),
    element("section", { className: "panel" }, [
      element("div", { className: "panel-heading" }, [
        element("div", {}, [element("h2", { text: "Permitted source" }), element("p", { text: "Only the files attached to this baseline are in scope." })]),
        element("span", { className: "count-tag", text: `${candidate.permitted_source_evidence?.record_count || 0} record(s)` }),
      ]),
      sourceLinks(candidate),
      sourceSummary(candidate),
      candidate.permitted_context_evidence
        ? element("details", { className: "context-evidence" }, [
            element("summary", { text: "Show permitted dataset context" }),
            element("p", { text: candidate.permitted_context_evidence }),
          ])
        : element("span"),
    ]),
  );
  root.append(evidenceGrid, schemaSection(candidate));

  const metadataPanel = element("section", { className: "panel" }, [
    element("div", { className: "panel-heading" }, [
      element("div", {}, [element("h2", { text: "Proposed metadata" }), element("p", { text: "Validate values against the permitted source." })]),
      element("span", { className: "count-tag", text: `${Object.keys(proposedMetadata(candidate)).length} entries` }),
    ]),
    jsonBlock(proposedMetadata(candidate)),
  ]);
  const provenancePanel = element("details", { className: "panel provenance-panel" }, [
    element("summary", { text: "Show metadata provenance and source-route bindings" }),
    element("h3", { text: "Metadata provenance" }),
    jsonBlock(candidate.metadata_provenance || {}),
    element("h3", { text: "Source-route bindings" }),
    jsonBlock(candidate.metadata_route_bindings || {}),
  ]);
  root.append(metadataPanel, provenancePanel, decisionSection(candidate, review), navigation(candidate, review));
}

function doneCount() {
  return state.candidates.filter((candidate) => reviewFor(candidate).done).length;
}

function renderList() {
  const root = $("caseList");
  root.innerHTML = "";
  const filter = $("caseFilter").value;
  let currentDomain = "";
  state.candidates.forEach((candidate, index) => {
    const review = reviewFor(candidate);
    if (filter === "pending" && review.done) return;
    if (["APPROVE", "REVISE", "EXCLUDE"].includes(filter) && review.disposition !== filter) return;
    if (candidate.domain !== currentDomain) {
      currentDomain = candidate.domain;
      root.append(element("div", { className: "domain-heading", text: currentDomain }));
    }
    const button = element("button", {
      className: `case-button${index === state.selected ? " active" : ""}${review.done ? " done" : ""}`,
      attrs: { type: "button" },
    });
    button.append(
      element("div", { className: "case-button-top" }, [
        element("strong", { text: `${index + 1}. ${candidate.query_id}` }),
        element("span", {
          className: `mini-status ${review.done ? review.disposition.toLowerCase() : "pending"}`,
          text: review.done ? review.disposition : "PENDING",
        }),
      ]),
      element("span", { text: candidate.question }),
    );
    button.addEventListener("click", () => {
      state.selected = index;
      saveLocal();
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    root.append(button);
  });
}

function updateProgress() {
  const done = doneCount();
  const total = state.candidates.length;
  const counts = { APPROVE: 0, REVISE: 0, EXCLUDE: 0 };
  state.candidates.forEach((candidate) => {
    const review = reviewFor(candidate);
    if (review.done && counts[review.disposition] !== undefined) counts[review.disposition] += 1;
  });
  $("progressText").textContent = `${done}/${total} validated · ${counts.APPROVE} approved · ${counts.REVISE} revise · ${counts.EXCLUDE} excluded`;
  $("sidebarProgress").textContent = `${done}/${total} complete`;
}

function render() {
  $("reviewerId").value = state.reviewerId;
  renderList();
  renderCase();
  updateProgress();
}

function parseOptionalJson(raw) {
  return raw.trim() ? JSON.parse(raw) : null;
}

function exportReview() {
  state.reviewerId = $("reviewerId").value.trim();
  saveLocal();
  if (!state.reviewerId) {
    window.alert("Enter the reviewer name before exporting.");
    return;
  }
  const reviews = state.candidates.map((candidate) => {
    const review = reviewFor(candidate);
    return {
      baseline_id: candidate.baseline_id,
      query_id: candidate.query_id,
      domain: candidate.domain,
      candidate_evidence_hash: candidate.candidate_evidence_hash,
      judgments: { ...review.judgments },
      disposition: review.disposition,
      corrections: {
        proposed_baseline_answer: review.corrected_answer.trim() || null,
        target_route: parseOptionalJson(review.corrected_target_route_json),
        source_files: parseOptionalJson(review.corrected_source_files_json),
        proposed_baseline_schema_fields: parseOptionalJson(review.corrected_schema_json),
        proposed_metadata: parseOptionalJson(review.corrected_metadata_json),
      },
      comment: review.comment,
      done: review.done,
      reviewed_at: review.reviewed_at,
    };
  });
  const payload = {
    protocol: config.protocol,
    reviewer_id: state.reviewerId,
    exported_at: new Date().toISOString(),
    candidate_count: state.candidates.length,
    complete_count: reviews.filter((review) => review.done).length,
    source_protocol: state.sourceProtocol,
    reviews,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  const safeName = state.reviewerId.replace(/[^a-z0-9_-]+/gi, "-");
  link.href = URL.createObjectURL(blob);
  link.download = `rq1-baseline-validation-${safeName}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importReview(file) {
  const payload = JSON.parse(await file.text());
  if (payload.protocol !== config.protocol || !Array.isArray(payload.reviews)) {
    throw new Error("This is not an RQ1 baseline validation export.");
  }
  const known = new Map(state.candidates.map((candidate) => [candidate.baseline_id, candidate]));
  const imported = {};
  payload.reviews.forEach((entry) => {
    const candidate = known.get(entry.baseline_id);
    if (!candidate) return;
    if (entry.candidate_evidence_hash && entry.candidate_evidence_hash !== candidate.candidate_evidence_hash) {
      throw new Error(`Evidence hash mismatch for ${entry.baseline_id}.`);
    }
    imported[entry.baseline_id] = {
      judgments: { ...defaultReview().judgments, ...(entry.judgments || {}) },
      disposition: entry.disposition || "",
      corrected_answer: entry.corrections?.proposed_baseline_answer || "",
      corrected_target_route_json: entry.corrections?.target_route
        ? JSON.stringify(entry.corrections.target_route, null, 2)
        : "",
      corrected_source_files_json: entry.corrections?.source_files
        ? JSON.stringify(entry.corrections.source_files, null, 2)
        : "",
      corrected_schema_json: entry.corrections?.proposed_baseline_schema_fields
        ? JSON.stringify(entry.corrections.proposed_baseline_schema_fields, null, 2)
        : "",
      corrected_metadata_json: entry.corrections?.proposed_metadata || entry.corrections?.reconstructed_metadata
        ? JSON.stringify(entry.corrections?.proposed_metadata || entry.corrections?.reconstructed_metadata, null, 2)
        : "",
      comment: entry.comment || "",
      done: Boolean(entry.done),
      reviewed_at: entry.reviewed_at || null,
    };
  });
  state.reviews = imported;
  state.reviewerId = payload.reviewer_id || "";
  state.selected = 0;
  saveLocal();
  render();
}

async function loadCandidates() {
  const response = await fetch(config.candidatesPath);
  if (!response.ok) throw new Error(`Could not load candidate baselines (${response.status}).`);
  const payload = await response.json();
  state.candidates = payload.candidates || [];
  state.sourceProtocol = payload.protocol || "";
  restoreLocal();
  state.selected = Math.min(Math.max(state.selected, 0), Math.max(state.candidates.length - 1, 0));
  render();
}

$("reviewerId").addEventListener("input", (event) => {
  state.reviewerId = event.target.value;
  saveLocal();
});
$("caseFilter").addEventListener("change", renderList);
$("exportBtn").addEventListener("click", () => {
  try {
    exportReview();
  } catch (error) {
    window.alert(error.message);
  }
});
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await importReview(file);
    window.alert("Review progress restored.");
  } catch (error) {
    window.alert(error.message);
  } finally {
    event.target.value = "";
  }
});

loadCandidates().catch((error) => {
  $("caseView").innerHTML = `<section class="panel error-state"><h2>Could not load baselines</h2><p>${error.message}</p><p>Open this page through the local HTTP server rather than as a file.</p></section>`;
  $("progressText").textContent = "Baseline data could not be loaded.";
});
