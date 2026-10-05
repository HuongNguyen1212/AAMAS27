const config = window.HUMAN_ROUTE_CONFIG;

const state = {
  packet: null,
  items: [],
  selected: 0,
  reviews: {},
  reviewerId: "",
};

const $ = (id) => document.getElementById(id);

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs) {
    Object.entries(options.attrs).forEach(([key, value]) => node.setAttribute(key, value));
  }
  children.forEach((child) => node.append(child));
  return node;
}

function blankReview() {
  return {
    eligibility: "",
    target_quantity: "",
    source_scope: "",
    selected_source_files: [],
    use_dataset_context: false,
    evidence_kind: "",
    schema_fields_json: "",
    extraction_or_derivation_procedure: "",
    metadata_json: "",
    metadata_provenance_json: "",
    route_fields: [],
    baseline_answer: "",
    reference_supported: "",
    source_support: "",
    schema_capacity: "",
    metadata_grounding: "",
    answer_correctness: "",
    supported_information: "",
    exclusion_reason: "",
    notes: "",
    ui_step: 1,
    done: false,
    reviewed_at: null,
  };
}

function blankRouteField() {
  return {
    name: "",
    auto_name: true,
    concept_label: "",
    use_existing: null,
    type: "string",
    description: "",
    value_raw: "",
    source_ref: "",
    source_bindings: [],
    evidence_kind: "",
    method: "",
    schema_extra: {},
    provenance_extra: {},
  };
}

function fieldNameFromConcept(concept) {
  let name = String(concept || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (name && !/^[a-z]/.test(name)) name = `field_${name}`;
  return name;
}

function metadataValueFromRaw(field) {
  const raw = String(field.value_raw || "").trim();
  if (!raw) throw new Error(`Enter a metadata value for ${field.name || "each field"}.`);
  if (field.type === "number") {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${field.name || "Metadata"} must contain a valid number.`);
    return value;
  }
  if (field.type === "boolean") {
    if (raw !== "true" && raw !== "false") throw new Error(`${field.name || "Metadata"} must be true or false.`);
    return raw === "true";
  }
  if (field.type === "array" || field.type === "object") {
    let value;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new Error(`${field.name || "Metadata"} must contain a valid ${field.type}.`);
    }
    if (field.type === "array" && !Array.isArray(value)) throw new Error(`${field.name || "Metadata"} must be a list.`);
    if (field.type === "object" && (Array.isArray(value) || value === null || typeof value !== "object")) {
      throw new Error(`${field.name || "Metadata"} must be an object.`);
    }
    return value;
  }
  return String(field.value_raw || "").trim();
}

function valueToRaw(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function routeFieldsFromStructured(item, schemaFields, metadata, provenance, defaultEvidenceKind = "") {
  if (!Array.isArray(schemaFields)) return [];
  const bootstrapFields = item?.bootstrap_schema_fields || [];
  const sourceInventory = item?.source_inventory || [];
  const bootstrapNames = new Set(bootstrapFields.map((field) => field.name));
  return schemaFields.map((field) => {
    const name = String(field?.name || "");
    const source = provenance?.[name] || {};
    const matchedSource = sourceInventory.find((entry) => entry.source_file === source.source_file || entry.file_name === source.source_file);
    const schemaExtra = Object.fromEntries(Object.entries(field || {}).filter(([key]) => !["name", "use_existing", "type", "description"].includes(key)));
    const provenanceExtra = Object.fromEntries(Object.entries(source || {}).filter(([key]) => !["source_file", "source_bindings", "dataset_context", "evidence_kind", "method"].includes(key)));
    return {
      ...blankRouteField(),
      name,
      auto_name: false,
      concept_label: name.replaceAll("_", " "),
      use_existing: field?.use_existing === true || bootstrapNames.has(name),
      type: String(field?.type || bootstrapFields.find((entry) => entry.name === name)?.type || "string"),
      description: String(field?.description || bootstrapFields.find((entry) => entry.name === name)?.description || ""),
      value_raw: Object.prototype.hasOwnProperty.call(metadata || {}, name) ? valueToRaw(metadata[name]) : "",
      source_ref: source.dataset_context === true ? "__DATASET_CONTEXT__" : String(matchedSource?.source_file || source.source_file || ""),
      source_bindings: Array.isArray(source.source_bindings)
        ? source.source_bindings.map((binding) => ({
          source_file: String(binding?.source_file || ""),
          source_kind: String(binding?.source_kind || ""),
          source_key: String(binding?.source_key || ""),
        }))
        : [],
      evidence_kind: String(source.evidence_kind || defaultEvidenceKind || ""),
      method: String(source.method || ""),
      schema_extra: schemaExtra,
      provenance_extra: provenanceExtra,
    };
  });
}

function ensureRouteFields(item, review) {
  if (Array.isArray(review.route_fields) && review.route_fields.length) return;
  try {
    const fields = review.schema_fields_json ? JSON.parse(review.schema_fields_json) : [];
    const metadata = review.metadata_json ? JSON.parse(review.metadata_json) : {};
    const provenance = review.metadata_provenance_json ? JSON.parse(review.metadata_provenance_json) : {};
    review.route_fields = routeFieldsFromStructured(item, fields, metadata, provenance, review.evidence_kind);
  } catch (error) {
    review.route_fields = [];
  }
}

function syncRouteFields(review) {
  const schemaFields = [];
  const metadata = {};
  const provenance = {};
  const evidenceKinds = new Set();
  const targetQuantities = [];
  review.route_fields.forEach((field) => {
    const name = String(field.name || "").trim();
    if (!name) return;
    const method = String(field.method || "").trim();
    const evidenceKind = String(field.evidence_kind || "").trim();
    if (evidenceKind) evidenceKinds.add(evidenceKind);
    const sourceBindings = field.source_bindings.map((binding) => ({ ...binding }));
    const routeKinds = [...new Set(sourceBindings.map((binding) => binding.source_kind))];
    const dependencies = [...new Set(sourceBindings.map((binding) => binding.source_key))];
    const description = String(field.description || "").trim();
    targetQuantities.push(description || name.replaceAll("_", " "));
    const schemaExtra = Object.fromEntries(
      Object.entries(field.schema_extra || {}).filter(
        ([key]) => !["source_pattern", "depends_on", "formula", "comment"].includes(key),
      ),
    );
    schemaFields.push({
      ...schemaExtra,
      name,
      type: field.type || "string",
      description,
      ...(routeKinds.length ? { source_pattern: routeKinds.join("+").toLowerCase() } : {}),
      ...(dependencies.length ? { depends_on: dependencies } : {}),
      ...(evidenceKind === "DETERMINISTIC_DERIVATION" && method ? { formula: method } : {}),
      ...(method ? { comment: method } : {}),
      ...(field.use_existing ? { use_existing: true } : {}),
    });
    if (String(field.value_raw || "").trim()) metadata[name] = metadataValueFromRaw(field);
    const source = {
      ...field.provenance_extra,
      source_file: field.source_bindings[0]?.source_file || field.source_ref,
      source_bindings: sourceBindings,
      evidence_kind: evidenceKind,
      method,
    };
    provenance[name] = source;
  });
  review.schema_fields_json = schemaFields.length ? JSON.stringify(schemaFields, null, 2) : "";
  review.metadata_json = Object.keys(metadata).length ? JSON.stringify(metadata, null, 2) : "";
  review.metadata_provenance_json = Object.keys(provenance).length ? JSON.stringify(provenance, null, 2) : "";
  review.evidence_kind = evidenceKinds.size === 1 ? [...evidenceKinds][0] : evidenceKinds.size > 1 ? "MIXED" : "";
  review.target_quantity = targetQuantities.join("\n");
  review.extraction_or_derivation_procedure = review.route_fields
    .filter((field) => String(field.name || "").trim() && String(field.method || "").trim())
    .map((field) => `${String(field.name).trim()}: ${String(field.method).trim()}`)
    .join("; ");
}

function reviewFor(item) {
  if (!state.reviews[item.query_id]) state.reviews[item.query_id] = blankReview();
  return state.reviews[item.query_id];
}

function persist() {
  localStorage.setItem(config.storageKey, JSON.stringify({
    packet_hash: state.packet?.packet_hash || "",
    reviewer_id: state.reviewerId,
    selected: state.selected,
    reviews: state.reviews,
  }));
}

function restoreLocal() {
  const raw = localStorage.getItem(config.storageKey);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    if (saved.packet_hash !== state.packet.packet_hash) return;
    state.reviewerId = saved.reviewer_id || "";
    state.selected = Number.isInteger(saved.selected) ? saved.selected : 0;
    state.reviews = saved.reviews || {};
    Object.values(state.reviews).forEach(removeDatasetContextEvidence);
  } catch (error) {
    console.warn("Could not restore route-authoring progress", error);
  }
}

function removeDatasetContextEvidence(review) {
  if (!review || typeof review !== "object") return;
  if (typeof review.supported_information !== "string") review.supported_information = "";
  const fields = Array.isArray(review.route_fields) ? review.route_fields : [];
  const unsupportedMethod = !["", "DIRECT_EXTRACTION", "DETERMINISTIC_DERIVATION", "DOMAIN_RULE", "MIXED"].includes(review.evidence_kind || "");
  const usedContext = review.use_dataset_context === true
    || fields.some((field) => field.source_ref === "__DATASET_CONTEXT__");
  review.use_dataset_context = false;
  fields.forEach((field) => {
    if (!String(field.concept_label || "").trim() && String(field.name || "").trim()) {
      field.concept_label = String(field.name).replaceAll("_", " ");
    }
    if (field.source_ref === "__DATASET_CONTEXT__") field.source_ref = "";
    if (!Array.isArray(field.source_bindings)) field.source_bindings = [];
  });
  if (review.source_scope === "RECORD_AND_CONTEXT") review.source_scope = "";
  if (unsupportedMethod) review.evidence_kind = "";
  if (usedContext || unsupportedMethod) {
    resetValidationChecks(review);
    review.done = false;
    review.reviewed_at = null;
    if (review.eligibility === "ELIGIBLE") review.ui_step = 2;
  }
}

function parseJson(raw, expected, label) {
  if (!String(raw || "").trim()) throw new Error(`${label} is required.`);
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (expected === "array" && (!Array.isArray(value) || value.length === 0)) {
    throw new Error(`${label} must be a non-empty JSON array.`);
  }
  if (expected === "object" && (Array.isArray(value) || value === null || typeof value !== "object" || Object.keys(value).length === 0)) {
    throw new Error(`${label} must be a non-empty JSON object.`);
  }
  return value;
}

function routeDefinitionError(item, review) {
  if (!review.selected_source_files.length) return "Select at least one source file.";
  ensureRouteFields(item, review);
  if (!review.route_fields.length) return "Add at least one value needed for the answer.";
  const names = new Set();
  for (const field of review.route_fields) {
    if (field.use_existing !== true && field.use_existing !== false) return "For each value, choose an existing field or create a new field.";
    const name = String(field.name || "").trim();
    if (!name) return "Choose or enter a field name for every value.";
    if (!/^[a-z][a-z0-9_]*$/.test(name)) return `${name}: field names must use snake_case, for example potential_unit.`;
    if (names.has(name)) return `${name} was selected more than once. Use each field only once.`;
    names.add(name);
    if (!field.use_existing && !String(field.concept_label || "").trim()) return `Enter a short concept name for ${name}.`;
    if (!field.use_existing && !String(field.description || "").trim()) return `Explain what the new field ${name} stores.`;
    if (!String(field.value_raw || "").trim()) return `Enter the value for ${name}.`;
    if (!field.evidence_kind) return `${name}: choose how this value was obtained.`;
    if (!Array.isArray(field.source_bindings) || !field.source_bindings.length) {
      return `${name}: select at least one filename, header or data column used to obtain this value.`;
    }
    for (const binding of field.source_bindings) {
      if (!review.selected_source_files.includes(binding.source_file)) {
        return `${name}: every selected source component must belong to a selected file.`;
      }
      if (!sourceBindingExists(item, binding)) {
        return `${name}: one selected source component is no longer available. Select it again.`;
      }
    }
    if (!String(field.method || "").trim()) return `${name}: ${methodInstructions(field.evidence_kind).error}`;
  }
  try {
    syncRouteFields(review);
    const fields = parseJson(review.schema_fields_json, "array", "Schema fields");
    if (fields.some((field) => !field || typeof field !== "object" || !String(field.name || "").trim())) {
      return "Every schema field must be an object with a non-empty name.";
    }
    parseJson(review.metadata_json, "object", "Grounded metadata");
    parseJson(review.metadata_provenance_json, "object", "Metadata provenance");
  } catch (error) {
    return error.message;
  }
  return "";
}

function validationError(item, review) {
  if (!state.reviewerId.trim()) return "Enter an expert identifier before completing a specification.";
  if (!review.eligibility) return "Decide whether the reference answer can be verified from the shown evidence.";
  if (review.eligibility === "INELIGIBLE") {
    if (review.reference_supported === "PARTIAL" && !String(review.supported_information || "").trim()) {
      return "State which part of the reference answer can be verified.";
    }
    return review.exclusion_reason.trim() ? "" : "Explain why the reference answer cannot be verified from the shown evidence.";
  }
  if (review.eligibility === "UNCERTAIN") {
    return review.notes.trim() ? "" : "Record what must be resolved before eligibility can be decided.";
  }
  if (review.reference_supported !== "YES") return "A baseline can be completed only when the reference answer is supported by the shown evidence.";
  const routeError = routeDefinitionError(item, review);
  if (routeError) return routeError;
  for (const [key, label] of [
    ["source_support", "The selected evidence supports the required information"],
    ["schema_capacity", "The selected fields can represent the required information"],
    ["metadata_grounding", "The metadata values follow from the evidence"],
    ["answer_correctness", "The reference answer follows from the metadata"],
  ]) {
    if (review[key] !== "YES") return `Confirm this statement before saving: ${label}.`;
  }
  return "";
}

function doneCount() {
  return state.items.filter((item) => reviewFor(item).done).length;
}

function updateProgress() {
  $("progressText").textContent = `${doneCount()}/${state.items.length} specifications complete`;
}

function itemStatus(item) {
  return reviewFor(item).done ? "COMPLETE" : "PENDING";
}

function filteredItems() {
  const domain = $("domainFilter").value;
  const status = $("statusFilter").value;
  return state.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => domain === "ALL" || item.domain === domain)
    .filter(({ item }) => status === "ALL" || itemStatus(item) === status);
}

function renderList() {
  const root = $("itemList");
  root.innerHTML = "";
  filteredItems().forEach(({ item, index }) => {
    const status = itemStatus(item);
    const button = el("button", {
      className: `item-button${index === state.selected ? " active" : ""}`,
      attrs: { type: "button" },
    }, [
      el("div", { className: "item-top" }, [
        el("span", { text: `${item.query_id} · ${item.domain}` }),
        el("span", { className: `status ${status.toLowerCase()}`, text: status }),
      ]),
      el("div", { className: "item-question", text: item.question }),
    ]);
    button.addEventListener("click", () => {
      state.selected = index;
      persist();
      render();
    });
    root.append(button);
  });
}

function labeledValue(label, value) {
  return el("div", { className: "labeled-value" }, [
    el("div", { className: "value-label", text: label }),
    el("div", { className: "value-content", text: value || "Not provided" }),
  ]);
}

function renderSchema(item) {
  const grid = el("div", { className: "schema-grid" });
  item.bootstrap_schema_fields.forEach((field) => {
    grid.append(el("section", { className: "schema-card" }, [
      el("strong", { text: field.name }),
      el("span", { className: "field-type", text: field.type || "unspecified type" }),
      el("p", { text: field.description || "No description recorded." }),
    ]));
  });
  return grid;
}

function renderSources(item) {
  const grid = el("div", { className: "source-grid" });
  item.source_inventory.forEach((source) => {
    const details = [
      `${source.row_count} rows`,
      `${source.table_columns.length} columns`,
      source.table_columns.join(", "),
    ];
    const children = [
      el("strong", { text: source.file_name }),
      el("p", { text: details.join(" · ") }),
      el("p", { text: Object.entries(source.header_metadata || {}).map(([key, value]) => `${key}: ${value}`).join(" · ") || "No header metadata" }),
    ];
    if (source.review_path && config.sourceLinksEnabled !== false) {
      children.push(el("a", {
        className: "source-link",
        text: "Open source data",
        attrs: { href: source.review_path, target: "_blank", rel: "noopener" },
      }));
    } else if (source.review_path) {
      children.push(el("span", {
        className: "private-source-note",
        text: "Use the privately provided source file with this exact name.",
      }));
    }
    grid.append(el("section", { className: "source-card" }, children));
  });
  return grid;
}

function sourceBindingId(binding) {
  return [binding.source_file, binding.source_kind, binding.source_key].join("\u0000");
}

function sourceComponents(source) {
  const components = [{
    source_file: source.source_file,
    source_kind: "FILE_NAME",
    source_key: source.file_name,
    label: `Filename: ${source.file_name}`,
  }];
  Object.keys(source.header_metadata || {}).forEach((key) => {
    components.push({
      source_file: source.source_file,
      source_kind: "HEADER_FIELD",
      source_key: key,
      label: `Header: ${key}`,
    });
  });
  (source.table_columns || []).forEach((column) => {
    components.push({
      source_file: source.source_file,
      source_kind: "TABLE_COLUMN",
      source_key: column,
      label: `Column: ${column}`,
    });
  });
  return components;
}

function sourceBindingExists(item, binding) {
  const source = item.source_inventory.find((entry) => entry.source_file === binding.source_file);
  if (!source) return false;
  return sourceComponents(source).some((component) => sourceBindingId(component) === sourceBindingId(binding));
}

function sourceComponentSelector(item, review, field) {
  if (!Array.isArray(field.source_bindings)) field.source_bindings = [];
  const selected = new Set(field.source_bindings.map(sourceBindingId));
  const groups = el("div", { className: "source-component-groups" });
  review.selected_source_files.forEach((sourceFile) => {
    const source = item.source_inventory.find((entry) => entry.source_file === sourceFile);
    if (!source) return;
    const options = el("div", { className: "source-component-options" });
    sourceComponents(source).forEach((component) => {
      const input = el("input", { attrs: { type: "checkbox" } });
      const id = sourceBindingId(component);
      input.checked = selected.has(id);
      input.addEventListener("change", () => {
        const current = new Map(field.source_bindings.map((binding) => [sourceBindingId(binding), binding]));
        if (input.checked) {
          current.set(id, {
            source_file: component.source_file,
            source_kind: component.source_kind,
            source_key: component.source_key,
          });
        } else {
          current.delete(id);
        }
        field.source_bindings = [...current.values()];
        field.source_ref = field.source_bindings[0]?.source_file || "";
        routeFieldChanged(review);
      });
      options.append(el("label", { className: "source-component-option" }, [
        input,
        el("span", { text: component.label }),
      ]));
    });
    groups.append(el("section", { className: "source-component-group" }, [
      el("strong", { text: source.file_name }),
      options,
    ]));
  });
  return el("div", { className: "route-control full source-component-selector" }, [
    el("span", { text: "4. Tick the exact source parts used for this value" }),
    el("div", { className: "help", text: "Copied value: tick where it appears. Calculation: tick every input column. Scientific rule: tick every column you examined." }),
    groups,
  ]);
}

function selectField(label, value, options, onChange, full = false) {
  const select = el("select");
  select.append(el("option", { text: "Select...", attrs: { value: "" } }));
  options.forEach(([optionValue, optionLabel]) => {
    const option = el("option", { text: optionLabel, attrs: { value: optionValue } });
    option.selected = value === optionValue;
    select.append(option);
  });
  select.addEventListener("change", () => onChange(select.value));
  return el("label", { className: `form-field${full ? " full" : ""}` }, [
    el("span", { text: label }),
    select,
  ]);
}

function textField(label, value, onInput, options = {}) {
  const textarea = el("textarea", {
    className: options.json ? "json-input" : "",
    attrs: { placeholder: options.placeholder || "" },
  });
  textarea.value = value || "";
  textarea.addEventListener("input", () => onInput(textarea.value));
  const children = [el("span", { text: label }), textarea];
  if (options.help) children.push(el("div", { className: "help", text: options.help }));
  return el("label", { className: `form-field${options.full === false ? "" : " full"}` }, children);
}

function formStep(number, title, description) {
  return el("div", { className: "form-step" }, [
    el("span", { className: "form-step-number", text: number }),
    el("div", {}, [
      el("strong", { text: title }),
      el("span", { text: description }),
    ]),
  ]);
}

function resetValidationChecks(review) {
  review.source_support = "";
  review.schema_capacity = "";
  review.metadata_grounding = "";
  review.answer_correctness = "";
}

function routeFieldChanged(review, rerender = false) {
  resetValidationChecks(review);
  review.done = false;
  review.reviewed_at = null;
  persist();
  renderList();
  updateProgress();
  if (rerender) render();
}

function compactTextInput(label, value, onInput, placeholder = "") {
  const input = el("input", { attrs: { type: "text", placeholder } });
  input.value = value || "";
  input.addEventListener("input", () => onInput(input.value));
  return el("label", { className: "route-control" }, [el("span", { text: label }), input]);
}

function compactTextarea(label, value, onInput, placeholder = "") {
  const input = el("textarea", { attrs: { placeholder } });
  input.value = value || "";
  input.addEventListener("input", () => onInput(input.value));
  return el("label", { className: "route-control full" }, [el("span", { text: label }), input]);
}

function compactSelect(label, value, options, onChange) {
  const select = el("select");
  select.append(el("option", { text: "Select...", attrs: { value: "" } }));
  options.forEach(([optionValue, optionLabel]) => {
    const option = el("option", { text: optionLabel, attrs: { value: optionValue } });
    option.selected = value === optionValue;
    select.append(option);
  });
  select.addEventListener("change", () => onChange(select.value));
  return el("label", { className: "route-control" }, [el("span", { text: label }), select]);
}

function newFieldIdentityControls(field, review) {
  const concept = el("input", { attrs: { type: "text", placeholder: "Example: potential unit" } });
  const name = el("input", { attrs: { type: "text", placeholder: "Example: potential_unit" } });
  const description = el("textarea", {
    attrs: {
      placeholder: "Example: Unit used for applied and working-electrode potential values.",
    },
  });
  const preview = el("code");
  const refreshPreview = () => {
    preview.textContent = `${field.concept_label || "potential unit"} → ${field.name || "potential_unit"}`;
  };
  concept.value = field.concept_label || "";
  description.value = field.description || "";
  name.value = field.name || "";
  concept.addEventListener("input", () => {
    field.concept_label = concept.value;
    if (field.auto_name !== false || !field.name) {
      field.name = fieldNameFromConcept(concept.value);
      field.auto_name = true;
      name.value = field.name;
    }
    refreshPreview();
    routeFieldChanged(review);
  });
  name.addEventListener("input", () => {
    field.name = name.value.toLowerCase();
    field.auto_name = false;
    refreshPreview();
    routeFieldChanged(review);
  });
  description.addEventListener("input", () => {
    field.description = description.value;
    routeFieldChanged(review);
  });
  refreshPreview();
  return [
    el("label", { className: "route-control" }, [
      el("span", { text: "Short concept name" }),
      concept,
    ]),
    el("label", { className: "route-control" }, [
      el("span", { text: "Check or edit the suggested field name" }),
      name,
    ]),
    el("div", { className: "field-name-help full" }, [
      el("span", { text: "The page only converts letters to lowercase and replaces spaces with underscores. No model is used. Confirm that the name is meaningful and unique." }),
      preview,
    ]),
    el("label", { className: "route-control full" }, [
      el("span", { text: "What does this field store?" }),
      description,
      el("small", { text: "Write one clear sentence. Include the scope and unit when they matter." }),
    ]),
  ];
}

function methodInstructions(evidenceKind) {
  const instructions = {
    DIRECT_EXTRACTION: {
      title: "Copy from the file",
      text: "Type the exact column or header name. No formula is needed.",
      label: "Identify the exact source location",
      placeholder: "Column or header = Potential applied (V)",
      error: "Enter the exact column, header or other source location where you read this value.",
      example: "Column or header = Potential applied (V)",
    },
    DETERMINISTIC_DERIVATION: {
      title: "Calculate from values in the file",
      text: "Provide the formula, input column or columns and result unit.",
      label: "Describe the calculation",
      placeholder: "Formula = max(Time(s)) - min(Time(s)); Input = Time(s); Unit = seconds",
      error: "Enter the formula, input columns or fields and output unit.",
      example: "Formula = max(Time(s)) - min(Time(s)); Input = Time(s); Unit = seconds",
    },
    DOMAIN_RULE: {
      title: "Interpret the data using a scientific rule",
      text: "Provide the scientific rule, any threshold and the data examined. Enter 'Not applicable' when no threshold is used.",
      label: "Describe the scientific criterion",
      placeholder: "Rule = featureless current with no faradaic peak; Threshold = not applicable; Data region = forward scan",
      error: "Enter the scientific criterion, threshold and data region used.",
      example: "Rule = featureless current with no faradaic peak; Threshold = not applicable; Data region = forward scan",
    },
  };
  return instructions[evidenceKind] || {
    title: "First select how the information is obtained",
    text: "The form will then tell you whether to enter a source location, formula or scientific rule.",
    label: "How is this value obtained?",
    placeholder: "Select the route type above first.",
    error: "Select how the information is obtained before describing the field route.",
  };
}

function routeFieldEditor(item, review) {
  ensureRouteFields(item, review);
  if (!review.route_fields.length) review.route_fields.push(blankRouteField());
  const wrapper = el("div", { className: "route-editor form-field full" });
  wrapper.append(el("div", { className: "route-editor-heading" }, [
    el("div", {}, [
      el("strong", { text: "Add the metadata value or values needed for the answer" }),
      el("span", { text: "Use one box for each field. If the answer needs two fields, complete two boxes." }),
    ]),
  ]));

  if (!review.route_fields.length) {
    wrapper.append(el("div", { className: "route-empty", text: "No field has been added yet." }));
  }

  review.route_fields.forEach((field, index) => {
    const card = el("section", { className: "route-field-card" });
    const remove = el("button", { className: "secondary compact-button", text: "Remove", attrs: { type: "button" } });
    remove.addEventListener("click", () => {
      review.route_fields.splice(index, 1);
      routeFieldChanged(review, true);
    });
    card.append(el("div", { className: "route-field-header" }, [
      el("strong", { text: `Value ${index + 1}${field.name ? `: ${field.name}` : ""}` }),
      remove,
    ]));

    const controls = el("div", { className: "route-field-grid" });
    const originValue = field.use_existing === true ? "EXISTING" : field.use_existing === false ? "NEW" : "";
    const originControl = compactSelect("1. Where should this metadata value be stored?", originValue, [
      ["EXISTING", "Use a field already listed in the schema"],
      ["NEW", "Create a new field because no suitable field exists"],
    ], (value) => {
      const previousOrigin = field.use_existing;
      field.use_existing = value === "EXISTING" ? true : value === "NEW" ? false : null;
      if (field.use_existing && !item.bootstrap_schema_fields.some((entry) => entry.name === field.name)) {
        field.name = "";
        field.concept_label = "";
        field.description = "";
        field.auto_name = false;
      }
      if (field.use_existing === false && previousOrigin !== false) {
        field.name = "";
        field.concept_label = "";
        field.description = "";
        field.type = "string";
        field.auto_name = true;
      }
      routeFieldChanged(review, true);
    });
    originControl.classList.add("full");
    controls.append(originControl);

    if (field.use_existing === true) {
      controls.append(compactSelect("Choose the field", field.name, item.bootstrap_schema_fields.map((entry) => [entry.name, `${entry.name} (${entry.type || "unspecified"})`]), (value) => {
        const selected = item.bootstrap_schema_fields.find((entry) => entry.name === value);
        field.name = value;
        field.auto_name = false;
        field.concept_label = value.replaceAll("_", " ");
        field.type = selected?.type || "string";
        field.description = selected?.description || "";
        routeFieldChanged(review, true);
      }));
      if (field.name) {
        controls.append(el("div", { className: "existing-field-summary full" }, [
          el("strong", { text: `${field.name}: ${field.type}` }),
          el("span", { text: field.description || "No bootstrap description recorded." }),
        ]));
      }
    } else if (field.use_existing === false) {
      controls.append(
        ...newFieldIdentityControls(field, review),
        compactSelect("Choose the value type", field.type, [["string", "Text"], ["number", "Number"], ["boolean", "True / false"], ["array", "List"], ["object", "Object"]], (value) => {
          field.type = value || "string";
          field.value_raw = "";
          routeFieldChanged(review, true);
        }),
      );
    }

    if (field.use_existing === true || field.use_existing === false) {
      if (field.type === "boolean") {
        controls.append(compactSelect("2. Enter the verified metadata value", field.value_raw, [["true", "True"], ["false", "False"]], (value) => {
          field.value_raw = value;
          routeFieldChanged(review);
        }));
      } else {
        const valueHint = field.type === "array"
          ? "Enter a list in this form: [1, 2, 3]."
          : field.type === "object"
            ? "Enter labeled values in this form: {\"unit\": \"V\"}."
            : field.type === "number"
              ? "Enter only the number. Put the unit in the field description. Example: 5400"
              : "Enter the value exactly as supported by the evidence. Include the unit when needed.";
        controls.append(compactTextarea("2. Enter the verified metadata value", field.value_raw, (value) => {
          field.value_raw = value;
          routeFieldChanged(review);
        }, valueHint));
      }

      controls.append(compactSelect("3. How did you obtain this value?", field.evidence_kind, [
        ["DIRECT_EXTRACTION", "Copy it directly - no calculation"],
        ["DETERMINISTIC_DERIVATION", "Calculate it from values in the file"],
        ["DOMAIN_RULE", "Interpret the data using a scientific rule"],
      ], (value) => {
        field.evidence_kind = value;
        field.method = "";
        routeFieldChanged(review, true);
      }));

      controls.append(
        sourceComponentSelector(item, review, field),
      );
      if (field.evidence_kind) {
        const methodHelp = methodInstructions(field.evidence_kind);
        controls.append(el("div", { className: "method-guidance full" }, [
          el("strong", { text: methodHelp.title }),
          el("span", { text: methodHelp.text }),
          el("div", { className: "method-example" }, [
            el("b", { text: "Example" }),
            el("span", { text: methodHelp.example }),
          ]),
        ]));
        controls.append(compactTextarea(`5. ${methodHelp.label}`, field.method, (value) => {
          field.method = value;
          routeFieldChanged(review);
        }, methodHelp.placeholder));
      } else {
        controls.append(el("div", { className: "next-action full", text: "Choose an option in step 3 to see exactly what to write in step 5." }));
      }
    }
    card.append(controls);
    wrapper.append(card);
  });

  const add = el("button", { className: "secondary add-field-button", text: "Add another metadata value", attrs: { type: "button" } });
  add.addEventListener("click", () => {
    review.route_fields.push(blankRouteField());
    routeFieldChanged(review, true);
  });
  wrapper.append(add, el("div", { className: "help", text: "Add another value only when the answer requires another schema field." }));
  return wrapper;
}

function updateSourceScope(review) {
  review.use_dataset_context = false;
  if (review.selected_source_files.length > 1) review.source_scope = "RECORD_COLLECTION";
  else if (review.selected_source_files.length === 1) review.source_scope = "SINGLE_RECORD";
  else review.source_scope = "";
}

function sourceSelector(item, review) {
  const box = el("div", { className: "source-options" });
  item.source_inventory.forEach((source) => {
    const input = el("input", { attrs: { type: "checkbox", value: source.source_file } });
    input.checked = review.selected_source_files.includes(source.source_file);
    input.addEventListener("change", () => {
      const selected = new Set(review.selected_source_files);
      if (input.checked) selected.add(source.source_file);
      else selected.delete(source.source_file);
      review.selected_source_files = [...selected];
      review.route_fields.forEach((field) => {
        field.source_bindings = (field.source_bindings || []).filter((binding) => selected.has(binding.source_file));
        field.source_ref = field.source_bindings[0]?.source_file || "";
      });
      updateSourceScope(review);
      resetValidationChecks(review);
      review.done = false;
      persist();
      render();
    });
    box.append(el("label", { className: "check-option" }, [input, el("span", { text: source.file_name })]));
  });
  return el("div", { className: "form-field full" }, [
    el("span", { text: "A. Which source file or files are needed?" }),
    box,
    el("div", { className: "help", text: "Select only the files you actually inspect. If one file is enough, select only that file." }),
  ]);
}

function mutate(review, key, value) {
  review[key] = value;
  if (["target_quantity", "evidence_kind"].includes(key)) resetValidationChecks(review);
  review.done = false;
  review.reviewed_at = null;
  persist();
  renderList();
  updateProgress();
}

function setBaselineFeasibility(item, review, value) {
  review.reference_supported = value;
  review.eligibility = value === "YES"
    ? "ELIGIBLE"
    : ["PARTIAL", "NO"].includes(value)
      ? "INELIGIBLE"
      : value === "UNCERTAIN"
        ? "UNCERTAIN"
        : "";
  review.baseline_answer = value === "YES" ? item.fixed_reference_answer : "";
  if (value !== "PARTIAL") review.supported_information = "";
  if (value === "YES") review.exclusion_reason = "";
  review.ui_step = value === "YES" ? 2 : 1;
  resetValidationChecks(review);
  review.done = false;
  review.reviewed_at = null;
  persist();
  render();
}

function validationCheck(review, key, label) {
  const input = el("input", { attrs: { type: "checkbox" } });
  input.checked = review[key] === "YES";
  input.addEventListener("change", () => mutate(review, key, input.checked ? "YES" : ""));
  return el("label", { className: "validation-check" }, [input, el("span", { text: label })]);
}

function baselineSummary(item, review) {
  ensureRouteFields(item, review);
  const sourceNames = review.selected_source_files.map((sourceFile) => {
    const source = item.source_inventory.find((entry) => entry.source_file === sourceFile);
    return source?.file_name || sourceFile;
  });
  const fields = el("div", { className: "summary-fields" });
  review.route_fields.forEach((field) => {
    const sourceParts = (field.source_bindings || []).map((binding) => {
      const source = item.source_inventory.find((entry) => entry.source_file === binding.source_file);
      const prefix = binding.source_kind === "TABLE_COLUMN"
        ? "Column"
        : binding.source_kind === "HEADER_FIELD"
          ? "Header"
          : "Filename";
      return `${source?.file_name || binding.source_file} - ${prefix}: ${binding.source_key}`;
    });
    fields.append(el("div", { className: "summary-field" }, [
      el("strong", { text: field.name || "Unnamed field" }),
      el("span", { text: `Value: ${field.value_raw || "Not entered"}` }),
      el("span", { text: `Source parts: ${sourceParts.join("; ") || "Not selected"}` }),
      el("span", { text: `Method: ${field.method || "Not entered"}` }),
    ]));
  });
  return el("div", { className: "baseline-summary form-field full" }, [
    labeledValue("Required information (from selected fields)", review.target_quantity),
    labeledValue("Source files used", sourceNames.join(", ")),
    labeledValue(
      "How values were obtained",
      review.evidence_kind === "MIXED"
        ? "Different methods are recorded for individual metadata values"
        : methodInstructions(review.evidence_kind).title,
    ),
    el("div", { className: "summary-label", text: "Values entered" }),
    fields,
    labeledValue("Reference answer", item.fixed_reference_answer),
  ]);
}

function renderForm(item, review) {
  const panel = el("section", { className: "panel" }, [el("h2", { text: "Complete this question" })]);
  const form = el("div", { className: "form-grid" });
  form.append(
    formStep("1", "Check the reference answer", "Use only the available source files. Shared experiment information is background only, not evidence."),
    selectField("Does the permitted source data support the reference answer?", review.reference_supported, [
      ["YES", "Yes - the source data supports every part of the reference answer"],
      ["PARTIAL", "Partially - the source data supports some parts but not all"],
      ["NO", "No - the required information is absent from the source data"],
      ["UNCERTAIN", "Not sure - I cannot determine support from the source data"],
    ], (value) => setBaselineFeasibility(item, review, value), true),
  );

  if (review.eligibility === "INELIGIBLE") {
    if (review.reference_supported === "PARTIAL") {
      form.append(textField("What information can be verified?", review.supported_information, (value) => mutate(review, "supported_information", value), {
        placeholder: "Example: The current unit A can be verified from the current column header.",
      }));
    }
    form.append(textField("What information is missing?", review.exclusion_reason, (value) => mutate(review, "exclusion_reason", value), {
      placeholder: review.reference_supported === "PARTIAL"
        ? "Example: The potential unit cannot be verified from the available source evidence."
        : "Example: The source does not report the hydrogen charging method.",
    }));
  } else if (review.eligibility === "UNCERTAIN") {
    form.append(textField("Why can you not decide?", review.notes, (value) => mutate(review, "notes", value), {
      placeholder: "State which evidence, definition or scientific decision is unclear.",
    }));
  } else if (review.eligibility === "ELIGIBLE") {
    review.baseline_answer = item.fixed_reference_answer;
    updateSourceScope(review);
    review.ui_step = review.ui_step || (review.done ? 3 : 2);
    if (review.ui_step === 2) {
      form.append(
        formStep("2", "Build one verified baseline", "Choose the source files, then add each metadata field and complete its numbered entries from top to bottom."),
        sourceSelector(item, review),
      );
      if (!review.selected_source_files.length) {
        form.append(el("div", { className: "next-action form-field full", text: "Now select the source file or files you actually need." }));
      } else {
        form.append(routeFieldEditor(item, review));
      }
    } else {
      form.append(
        formStep("3", "Check and save", "Read the summary. Tick each box only after you have checked the statement."),
        baselineSummary(item, review),
        el("div", { className: "validation-list form-field full" }, [
          validationCheck(review, "source_support", "I checked that the selected source contains or supports the required information."),
          validationCheck(review, "schema_capacity", "I checked that the selected field or fields can store the required information."),
          validationCheck(review, "metadata_grounding", "I checked every entered value against the source and method."),
          validationCheck(review, "answer_correctness", "I checked that the entered values support the reference answer."),
        ]),
        textField("Optional note", review.notes, (value) => mutate(review, "notes", value), {
          placeholder: "Add an assumption, tolerance or scientific decision only when another reviewer needs to know it.",
        }),
      );
    }
  }
  panel.append(form);
  return panel;
}

function nextPending(fromIndex) {
  for (let offset = 1; offset <= state.items.length; offset += 1) {
    const index = (fromIndex + offset) % state.items.length;
    if (!reviewFor(state.items[index]).done) return index;
  }
  return -1;
}

function navigation(item, review) {
  const isRouteStep = review.eligibility === "ELIGIBLE" && review.ui_step === 2;
  const isConfirmationStep = review.eligibility === "ELIGIBLE" && review.ui_step === 3;
  const previous = el("button", {
    className: "secondary",
    text: isConfirmationStep ? "Back to edit" : "Previous question",
    attrs: { type: "button" },
  });
  previous.disabled = !isConfirmationStep && state.selected === 0;
  previous.addEventListener("click", () => {
    if (isConfirmationStep) review.ui_step = 2;
    else state.selected -= 1;
    persist();
    render();
  });
  const statusText = review.done
    ? "Complete"
    : isRouteStep
      ? "Step 2 of 3"
      : isConfirmationStep
        ? "Step 3 of 3"
        : "Step 1 of 3";
  const status = el("div", { className: "nav-status", text: statusText });
  const nextText = isRouteStep
    ? "Check my entries"
    : isConfirmationStep || ["INELIGIBLE", "UNCERTAIN"].includes(review.eligibility)
      ? "Save this question and continue"
      : "Continue";
  const next = el("button", { text: nextText, attrs: { type: "button" } });
  next.addEventListener("click", () => {
    if (isRouteStep) {
      const error = routeDefinitionError(item, review);
      if (error) {
        window.alert(error);
        return;
      }
      review.ui_step = 3;
      persist();
      render();
      return;
    }
    const error = validationError(item, review);
    if (error) {
      window.alert(error);
      return;
    }
    review.done = true;
    review.reviewed_at = new Date().toISOString();
    const target = nextPending(state.selected);
    if (target >= 0) state.selected = target;
    persist();
    render();
  });
  return el("section", { className: "nav-panel" }, [previous, status, next]);
}

function renderItem() {
  const root = $("itemView");
  root.innerHTML = "";
  const item = state.items[state.selected];
  if (!item) {
    root.append(el("section", { className: "panel" }, [el("p", { text: "No question is available." })]));
    return;
  }
  const review = reviewFor(item);
  root.append(el("section", { className: "panel question-heading" }, [
    el("div", {}, [
      el("div", { className: "eyebrow", text: `${item.query_id} · ${item.domain} · ${state.selected + 1}/${state.items.length}` }),
      el("h2", { text: item.question }),
    ]),
    el("span", { className: `completion-badge${review.done ? " complete" : ""}`, text: review.done ? "COMPLETE" : "PENDING" }),
  ]));

  root.append(el("section", { className: "panel" }, [
    el("h2", { text: "Question and answer to verify" }),
    labeledValue("Question", item.question),
    labeledValue("Reference answer", item.fixed_reference_answer),
  ]));
  root.append(el("details", { className: "panel reference-details" }, [
    el("summary", { text: `Open available source files (${item.source_inventory.length})` }),
    renderSources(item),
  ]));
  root.append(el("details", { className: "panel reference-details" }, [
    el("summary", { text: `Open the current schema (${item.bootstrap_schema_fields.length} fields)` }),
    renderSchema(item),
  ]));
  root.append(el("details", { className: "panel reference-details" }, [
    el("summary", { text: "Open background information (for understanding only, not evidence)" }),
    el("pre", { className: "context", text: item.dataset_context || "No shared experiment information was provided." }),
  ]));
  root.append(renderForm(item, review));
  root.append(navigation(item, review));
}

function render() {
  $("reviewerId").value = state.reviewerId;
  renderList();
  renderItem();
  updateProgress();
}

function structuredReview(item, review) {
  ensureRouteFields(item, review);
  try {
    syncRouteFields(review);
  } catch (error) {
    // Incomplete drafts are exported with their form rows below and can be resumed.
  }
  const specification = {
    eligibility: review.eligibility,
    reference_supported: review.reference_supported,
    validation_checks: {
      source_support: review.source_support,
      schema_capacity: review.schema_capacity,
      metadata_grounding: review.metadata_grounding,
      answer_correctness: review.answer_correctness,
    },
    exclusion_reason: review.exclusion_reason.trim() || null,
    supported_information: String(review.supported_information || "").trim() || null,
    target_quantity: review.target_quantity.trim() || null,
    source_scope: review.source_scope || null,
    source_files: [...review.selected_source_files],
    use_dataset_context: false,
    evidence_kind: review.evidence_kind || null,
    schema_fields: review.schema_fields_json.trim() ? JSON.parse(review.schema_fields_json) : null,
    extraction_or_derivation_procedure: review.extraction_or_derivation_procedure.trim() || null,
    grounded_metadata: review.metadata_json.trim() ? JSON.parse(review.metadata_json) : null,
    metadata_provenance: review.metadata_provenance_json.trim() ? JSON.parse(review.metadata_provenance_json) : null,
    baseline_answer: review.baseline_answer.trim() || null,
    notes: review.notes.trim() || null,
    ...(!review.done ? { authoring_draft_fields: review.route_fields } : {}),
  };
  return {
    query_id: item.query_id,
    domain: item.domain,
    evidence_hash: item.evidence_hash,
    done: review.done,
    reviewed_at: review.reviewed_at,
    specification,
  };
}

function exportProgress() {
  if (!state.reviewerId.trim()) {
    window.alert("Enter an expert identifier before exporting.");
    return;
  }
  const payload = {
    protocol: config.reviewProtocol,
    review_stage: "INDEPENDENT_AUTHORING",
    packet_protocol: state.packet.protocol,
    packet_hash: state.packet.packet_hash,
    reviewer_id: state.reviewerId.trim(),
    exported_at: new Date().toISOString(),
    completed_count: doneCount(),
    question_count: state.items.length,
    reviews: state.items.map((item) => structuredReview(item, reviewFor(item))),
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  const safeName = state.reviewerId.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  link.href = URL.createObjectURL(blob);
  link.download = `rq1-human-route-review-${safeName}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function reviewFromStructured(entry, item) {
  const spec = entry.specification || {};
  const routeFields = Array.isArray(spec.authoring_draft_fields)
    ? spec.authoring_draft_fields
    : routeFieldsFromStructured(item, spec.schema_fields, spec.grounded_metadata, spec.metadata_provenance, spec.evidence_kind);
  routeFields.forEach((field) => {
    if (!Array.isArray(field.source_bindings)) field.source_bindings = [];
    if (!field.evidence_kind && spec.evidence_kind !== "MIXED") {
      field.evidence_kind = spec.evidence_kind || "";
    }
  });
  const review = {
    eligibility: spec.eligibility || "",
    target_quantity: spec.target_quantity || "",
    source_scope: spec.source_scope || "",
    selected_source_files: spec.source_files || [],
    use_dataset_context: false,
    evidence_kind: spec.evidence_kind || "",
    schema_fields_json: spec.schema_fields ? JSON.stringify(spec.schema_fields, null, 2) : "",
    extraction_or_derivation_procedure: spec.extraction_or_derivation_procedure || "",
    metadata_json: spec.grounded_metadata ? JSON.stringify(spec.grounded_metadata, null, 2) : "",
    metadata_provenance_json: spec.metadata_provenance ? JSON.stringify(spec.metadata_provenance, null, 2) : "",
    route_fields: routeFields,
    baseline_answer: spec.baseline_answer || "",
    reference_supported: spec.reference_supported || "",
    source_support: spec.validation_checks?.source_support || "",
    schema_capacity: spec.validation_checks?.schema_capacity || "",
    metadata_grounding: spec.validation_checks?.metadata_grounding || "",
    answer_correctness: spec.validation_checks?.answer_correctness || "",
    exclusion_reason: spec.exclusion_reason || "",
    supported_information: spec.supported_information || "",
    notes: spec.notes || "",
    ui_step: entry.done === true ? 3 : spec.eligibility === "ELIGIBLE" ? 2 : 1,
    done: entry.done === true,
    reviewed_at: entry.reviewed_at || null,
  };
  removeDatasetContextEvidence(review);
  return review;
}

async function importProgress(file) {
  const payload = JSON.parse(await file.text());
  if (payload.protocol !== config.reviewProtocol) throw new Error("Unexpected review protocol.");
  if (payload.packet_hash !== state.packet.packet_hash) throw new Error("The review was created from a different evidence packet.");
  state.reviewerId = payload.reviewer_id || "";
  state.reviews = Object.fromEntries((payload.reviews || []).map((entry) => {
    const item = state.items.find((candidate) => candidate.query_id === entry.query_id);
    return [entry.query_id, reviewFromStructured(entry, item)];
  }));
  state.selected = Math.max(0, state.items.findIndex((item) => !reviewFor(item).done));
  persist();
  render();
}

async function loadPacket() {
  const response = await fetch(config.packetPath);
  if (!response.ok) throw new Error(`Failed to load ${config.packetPath}: ${response.status}`);
  state.packet = await response.json();
  if (state.packet.route_suggestions_included !== false || state.packet.previous_annotations_included !== false) {
    throw new Error("The packet is not a blank independent-authoring packet.");
  }
  state.items = state.packet.items || [];
  restoreLocal();
  state.items.forEach((item) => reviewFor(item));
  state.selected = Math.min(Math.max(state.selected, 0), Math.max(0, state.items.length - 1));
  render();
}

$("reviewerId").addEventListener("input", (event) => {
  state.reviewerId = event.target.value;
  persist();
});
$("domainFilter").addEventListener("change", renderList);
$("statusFilter").addEventListener("change", renderList);
document.querySelectorAll(".guide-link").forEach((link) => {
  link.addEventListener("click", () => {
    $("reviewGuide").open = true;
  });
});
$("exportBtn").addEventListener("click", exportProgress);
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await importProgress(file);
  } catch (error) {
    window.alert(error.message);
  } finally {
    event.target.value = "";
  }
});

loadPacket().catch((error) => {
  $("progressText").textContent = error.message;
  console.error(error);
});
