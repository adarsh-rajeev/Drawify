(function () {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const fileNameEl = document.getElementById("file-name");

  const analyzeProgress = document.getElementById("analyze-progress");
  const analyzeError = document.getElementById("analyze-error");
  const analyzeResult = document.getElementById("analyze-result");

  const columnSelect = document.getElementById("column-select");
  const kInput = document.getElementById("k-input");
  const dedupeToggle = document.getElementById("dedupe-toggle");
  const rowCountEl = document.getElementById("row-count");
  const previewTable = document.getElementById("preview-table");

  const drawBtn = document.getElementById("draw-btn");
  const drawProgress = document.getElementById("draw-progress");
  const drawError = document.getElementById("draw-error");

  const resultsSection = document.getElementById("results-section");
  const winnersList = document.getElementById("winners-list");
  const receiptJson = document.getElementById("receipt-json");
  const downloadReceiptBtn = document.getElementById("download-receipt-btn");

  let currentFile = null;

  function show(el) {
    el.classList.remove("hidden");
  }
  function hide(el) {
    el.classList.add("hidden");
  }
  function setText(el, text) {
    el.textContent = text;
  }
  function htmlEscape(s) {
    return s == null
      ? ""
      : String(s).replace(
          /[&<>"']/g,
          (m) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            }[m])
        );
  }

  function renderPreviewTable(preview) {
    if (!preview || preview.length === 0) {
      previewTable.innerHTML =
        '<tbody><tr><td class="p-2 text-gray-500">No preview available.</td></tr></tbody>';
      return;
    }
    const columns = Object.keys(preview[0]);
    let thead = '<thead class="bg-gray-50"><tr>';
    for (const c of columns) {
      thead += `<th class="px-3 py-2 text-left font-semibold text-gray-700">${htmlEscape(
        c
      )}</th>`;
    }
    thead += "</tr></thead>";

    let tbody = '<tbody class="divide-y divide-gray-200">';
    for (const row of preview) {
      tbody += "<tr>";
      for (const c of columns) {
        tbody += `<td class="px-3 py-2 whitespace-nowrap text-gray-800">${htmlEscape(
          row[c]
        )}</td>`;
      }
      tbody += "</tr>";
    }
    tbody += "</tbody>";

    previewTable.innerHTML = thead + tbody;
  }

  function fireConfetti() {
    if (typeof confetti !== "function") return;
    const duration = 2 * 1000;
    const end = Date.now() + duration;

    (function frame() {
      confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0 } });
      confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1 } });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }

  function analyzeFile(file) {
    hide(analyzeError);
    show(analyzeProgress);
    hide(analyzeResult);
    hide(resultsSection);
    winnersList.innerHTML = "";
    receiptJson.textContent = "";

    const form = new FormData();
    form.append("file", file);

    fetch("/api/analyze", { method: "POST", body: form })
      .then((r) => r.json().then((j) => ({ ok: r.ok, json: j })))
      .then(({ ok, json }) => {
        hide(analyzeProgress);
        if (!ok || !json.ok) {
          setText(analyzeError, json.error || "Failed to analyze file.");
          show(analyzeError);
          return;
        }

        // Populate columns
        columnSelect.innerHTML = "";
        (json.columns || []).forEach((c) => {
          const opt = document.createElement("option");
          opt.value = c;
          opt.textContent = c;
          columnSelect.appendChild(opt);
        });

        // Defaults
        kInput.value = 1;
        dedupeToggle.checked = true;

        setText(rowCountEl, `Rows detected: ${json.row_count}`);
        renderPreviewTable(json.preview);

        show(analyzeResult);
      })
      .catch((err) => {
        hide(analyzeProgress);
        setText(analyzeError, `Error: ${err}`);
        show(analyzeError);
      });
  }

  function handleFileSelection(file) {
    currentFile = file;
    setText(fileNameEl, file ? `Selected file: ${file.name}` : "");
    if (file) analyzeFile(file);
  }

  // Drag and drop handlers
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("border-indigo-400", "bg-indigo-50");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("border-indigo-400", "bg-indigo-50");
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("border-indigo-400", "bg-indigo-50");
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelection(file);
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) handleFileSelection(file);
  });

  // Draw
  document.getElementById("draw-btn").addEventListener("click", () => {
    hide(drawError);
    if (!currentFile) {
      setText(drawError, "Please upload a CSV or XLSX file first.");
      show(drawError);
      return;
    }
    const column = columnSelect.value;
    const k = parseInt(kInput.value, 10) || 1;
    const dedupe = dedupeToggle.checked;

    const form = new FormData();
    form.append("file", currentFile);
    form.append("column", column);
    form.append("k", String(k));
    form.append("dedupe", String(dedupe));

    hide(resultsSection);
    hide(drawError);
    show(drawProgress);

    fetch("/api/draw", { method: "POST", body: form })
      .then((r) => r.json().then((j) => ({ ok: r.ok, json: j })))
      .then(({ ok, json }) => {
        hide(drawProgress);
        if (!ok || !json.ok) {
          setText(drawError, json.error || "Failed to draw winners.");
          show(drawError);
          return;
        }

        const winners = json.winners || [];
        if (winners.length > 0) fireConfetti();

        let html = "";
        if (winners.length === 1) {
          html = `<div class="p-4 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-900">
                    <p class="font-semibold">Winner:</p>
                    <p class="mt-1 text-lg">${htmlEscape(winners[0])}</p>
                  </div>`;
        } else {
          html = `<ol class="list-decimal list-inside space-y-1">`;
          winners.forEach((w, i) => {
            html += `<li class="text-gray-900"><span class="font-semibold">#${
              i + 1
            }:</span> ${htmlEscape(w)}</li>`;
          });
          html += `</ol>`;
        }
        winnersList.innerHTML = html;

        receiptJson.textContent = JSON.stringify(json.receipt, null, 2);
        show(resultsSection);
      })
      .catch((err) => {
        hide(drawProgress);
        setText(drawError, `Error: ${err}`);
        show(drawError);
      });
  });

  // Download receipt
  downloadReceiptBtn.addEventListener("click", () => {
    const text = receiptJson.textContent.trim();
    if (!text) return;
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `lucky-draw-receipt-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
})();
